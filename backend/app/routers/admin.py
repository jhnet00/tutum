"""
============================================
Admin Router - ?대윭?ㅽ꽣 紐⑤땲?곕쭅 API
============================================

K8s ?몃뱶/?뚮뱶 ?곹깭? Mimir 硫뷀듃由?쓣 議고쉶??
Admin ??쒕낫?쒖뿉 ?ㅼ떆媛??곗씠?곕? ?쒓났?⑸땲??

?곗씠???뚯뒪:
  - K8s API Server: in-cluster ServiceAccount (nodes, pods)
  - Mimir: http://10.60.11.95:9009/prometheus (硫뷀듃由?
  - Loki:  http://10.60.11.95:3100 (濡쒓렇)
"""

import asyncio
import json
import logging
import math
import os
import time
from ipaddress import ip_address, ip_network
from datetime import datetime, timezone, timedelta

import boto3
import httpx
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, Request

from ..database import get_database, get_news_collection
from ..middleware.rate_limit import check_rate_limit
from .auth import UserResponse, get_current_user

logger = logging.getLogger(__name__)

MIMIR_URL = os.getenv("MIMIR_URL", "http://10.60.11.95:9009/prometheus")
LOKI_URL = os.getenv("LOKI_URL", "http://10.60.11.95:3100")

_DEFAULT_ADMIN_NETWORKS = "127.0.0.0/8,192.168.0.0/24,10.0.0.0/8"


def _parse_admin_networks(raw_networks: str) -> list:
    networks = []
    for raw in raw_networks.split(","):
        cidr = raw.strip()
        if not cidr:
            continue
        try:
            networks.append(ip_network(cidr))
        except ValueError:
            logger.warning("Ignoring invalid ADMIN_IP_ALLOWLIST CIDR: %s", cidr)
    return networks


_ADMIN_IP_ALLOWLIST = _parse_admin_networks(
    os.getenv("ADMIN_IP_ALLOWLIST", _DEFAULT_ADMIN_NETWORKS)
)


def _extract_client_ip(request: Request) -> str:
    # Prefer proxy-provided real client IP, then fallback.
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        # nginx appends client chain; using the last hop is safer than trusting first user-supplied value.
        return forwarded_for.split(",")[-1].strip()

    return request.client.host if request.client else ""


def _is_ip_allowed(ip_text: str) -> bool:
    try:
        client_ip = ip_address(ip_text)
    except ValueError:
        return False
    return any(client_ip in net for net in _ADMIN_IP_ALLOWLIST)


async def require_admin_access(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    # Enforce admin access by source IP range.
    client_ip = _extract_client_ip(request)
    if not _is_ip_allowed(client_ip):
        raise HTTPException(
            status_code=403,
            detail="Admin access denied for this network.",
        )
    return current_user


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin_access)])

# Shared HTTP clients ??reused across requests for connection pooling
# X-Scope-OrgID: Mimir/Loki multi-tenancy ?꾩닔 ?ㅻ뜑 (tenant=tutum)
_HTTP_MIMIR = httpx.AsyncClient(timeout=5.0, headers={"X-Scope-OrgID": "tutum"})
_HTTP_LOKI = httpx.AsyncClient(timeout=8.0, headers={"X-Scope-OrgID": "tutum"})
_HTTP_MISC = httpx.AsyncClient(timeout=8.0)


def _mimir_api_urls(api_path: str) -> list[str]:
    """
    Build candidate Mimir API URLs.
    Mimir can expose Prometheus APIs with or without /prometheus prefix.
    """
    base = MIMIR_URL.rstrip("/")
    with_prefix = (
        f"{base}/prometheus{api_path}"
        if not base.endswith("/prometheus")
        else f"{base}{api_path}"
    )
    without_prefix = (
        f"{base[:-11]}{api_path}"
        if base.endswith("/prometheus")
        else f"{base}{api_path}"
    )

    urls: list[str] = []
    for url in (with_prefix, without_prefix):
        if url not in urls:
            urls.append(url)
    return urls


async def _mimir_query(api_path: str, params: dict) -> dict | None:
    """Execute a Prometheus query against Mimir with path fallbacks."""
    last_error = ""
    for url in _mimir_api_urls(api_path):
        try:
            resp = await _HTTP_MIMIR.get(url, params=params)
            if resp.status_code >= 400:
                last_error = f"{url} -> HTTP {resp.status_code}"
                continue
            data = resp.json()
            if data.get("status") == "success":
                return data
            last_error = f'{url} -> status="{data.get("status", "unknown")}"'
        except Exception as e:
            last_error = f"{url} -> {e}"

    if last_error:
        logger.warning("Mimir query failed [%s]: %s", api_path, last_error)
    return None

# ??? Bedrock client (lazy init) ???????????????????????????????????????????????

_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=os.getenv("AWS_REGION", "ap-northeast-2"),
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            config=Config(connect_timeout=10, read_timeout=30, retries={"max_attempts": 2}),
        )
    return _bedrock_client


# ??? K8s client (lazy init) ??????????????????????????????????????????????????

_k8s_core = None
_k8s_metrics = None


def _get_k8s_clients():
    global _k8s_core, _k8s_metrics
    if _k8s_core is None:
        from kubernetes import client, config as k8s_config
        try:
            k8s_config.load_incluster_config()
        except Exception:
            k8s_config.load_kube_config()
        _k8s_core = client.CoreV1Api()
        _k8s_metrics = client.CustomObjectsApi()
    return _k8s_core, _k8s_metrics


# ??? ?ы띁 ?????????????????????????????????????????????????????????????????????

def _pod_downtime_sec(container_statuses) -> int:
    """留덉?留??ъ떆?????ㅼ슫?섏뼱 ?덉뿀???쒓컙(珥?. ?ъ떆???대젰 ?놁쑝硫?0."""
    for cs in container_statuses:
        if cs.last_state and cs.last_state.terminated:
            finished = cs.last_state.terminated.finished_at
            started = None
            if cs.state and cs.state.running:
                started = cs.state.running.started_at
            if finished and started:
                delta = (started - finished).total_seconds()
                return max(0, int(delta))
    return 0


def _node_role(node) -> str:
    labels = node.metadata.labels or {}
    if "node-role.kubernetes.io/control-plane" in labels:
        return "control-plane"
    if "node-role.kubernetes.io/master" in labels:
        return "master"
    return "worker"


def _node_status(node) -> str:
    for cond in (node.status.conditions or []):
        if cond.type == "Ready":
            return "Ready" if cond.status == "True" else "NotReady"
    return "Unknown"


DEFAULT_INSTANCE_HOURLY_RATES_USD = {
    "c5.large": 0.085,
    "c5.xlarge": 0.17,
    "c5a.large": 0.077,
    "c6g.large": 0.088,
    "c6i.large": 0.102,
    "m5.large": 0.096,
    "m5.xlarge": 0.192,
    "m5.2xlarge": 0.384,
    "m6i.large": 0.12,
    "m6i.xlarge": 0.24,
    "t3.medium": 0.042,
    "t3.large": 0.083,
}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Ignoring invalid float env %s=%s", name, raw)
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Ignoring invalid int env %s=%s", name, raw)
        return default


def _load_rate_map(env_name: str, defaults: dict[str, float]) -> dict[str, float]:
    raw = os.getenv(env_name, "").strip()
    if not raw:
        return dict(defaults)

    merged = dict(defaults)
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Ignoring invalid JSON env %s", env_name)
        return merged

    if not isinstance(loaded, dict):
        logger.warning("Ignoring non-object JSON env %s", env_name)
        return merged

    for key, value in loaded.items():
        try:
            merged[str(key).strip()] = float(value)
        except (TypeError, ValueError):
            logger.warning("Ignoring invalid hourly rate %s=%s in %s", key, value, env_name)
    return merged


def _node_label(labels: dict, *keys: str) -> str:
    for key in keys:
        value = labels.get(key)
        if value:
            return str(value)
    return ""


def _normalize_capacity_type(raw_value: str) -> str:
    normalized = (raw_value or "").strip().lower().replace("_", "-")
    if normalized in {"spot", "on-demand"}:
        return normalized
    if normalized in {"ondemand", "on demand"}:
        return "on-demand"
    return "on-demand"


def _estimate_hourly_rate(
    instance_type: str,
    capacity_type: str,
    on_demand_rates: dict[str, float],
    spot_rates: dict[str, float],
    spot_discount_ratio: float,
) -> tuple[float | None, str]:
    if not instance_type:
        return None, "missing-instance-type"

    if capacity_type == "spot" and instance_type in spot_rates:
        return round(spot_rates[instance_type], 4), "spot-explicit"

    base_rate = on_demand_rates.get(instance_type)
    if base_rate is None:
        return None, "missing-rate"

    if capacity_type == "spot":
        return round(base_rate * spot_discount_ratio, 4), "spot-ratio"

    return round(base_rate, 4), "on-demand"


def _safe_round_money(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


# ??? Endpoints ????????????????????????????????????????????????????????????????

@router.get("/nodes")
async def get_nodes():
    """
    K8s ?몃뱶 紐⑸줉怨?CPU/Memory ?ъ슜瑜?諛섑솚.
    metrics-server媛 諛고룷???덉뼱???ъ슜???곗씠?곌? ?쒓났?⑸땲??
    """
    try:
        core, metrics_api = _get_k8s_clients()
        nodes = core.list_node(_request_timeout=10).items

        # metrics-server?먯꽌 ?몃뱶 ?ъ슜??議고쉶
        usage_map = {}
        try:
            raw = metrics_api.list_cluster_custom_object(
                group="metrics.k8s.io", version="v1beta1", plural="nodes"
            )
            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                cpu_nano = int(item["usage"]["cpu"].rstrip("n"))
                mem_ki = int(item["usage"]["memory"].rstrip("Ki"))
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception as e:
            logger.warning("metrics-server 議고쉶 ?ㅽ뙣: %s", e)

        result = []
        for node in nodes:
            name = node.metadata.name
            # ?몃뱶 allocatable ?뺣낫
            alloc = node.status.allocatable or {}
            cpu_alloc_str = alloc.get("cpu", "0")
            mem_alloc_str = alloc.get("memory", "0Ki")

            # CPU: "6" ??6000m, "6000m" ??6000
            if cpu_alloc_str.endswith("m"):
                cpu_alloc_m = int(cpu_alloc_str[:-1])
            else:
                cpu_alloc_m = int(float(cpu_alloc_str)) * 1000

            # Memory: "12345678Ki" ??bytes
            if mem_alloc_str.endswith("Ki"):
                mem_alloc_ki = int(mem_alloc_str[:-2])
            else:
                mem_alloc_ki = int(mem_alloc_str) // 1024

            cpu_pct = 0
            mem_pct = 0
            if name in usage_map:
                u = usage_map[name]
                cpu_pct = round(u["cpu_nano"] / 1_000_000 / cpu_alloc_m * 100) if cpu_alloc_m else 0
                mem_pct = round(u["mem_ki"] / mem_alloc_ki * 100) if mem_alloc_ki else 0

            # ?대? IP
            ip = ""
            for addr in (node.status.addresses or []):
                if addr.type == "InternalIP":
                    ip = addr.address
                    break

            result.append({
                "name": name,
                "role": _node_role(node),
                "status": _node_status(node),
                "cpu_percent": min(cpu_pct, 100),
                "memory_percent": min(mem_pct, 100),
                "ip": ip,
            })

        return {"nodes": result}

    except Exception as e:
        logger.error("get_nodes ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pods")
async def get_pods(namespace: str = "all"):
    """
    ?뚮뱶 紐⑸줉 諛섑솚. namespace='all'?대㈃ ?꾩껜 ?ㅼ엫?ㅽ럹?댁뒪 議고쉶.
    tutum-app, tutum-data, monitoring ??二쇱슂 ns留??ы븿.
    """
    TARGET_NAMESPACES = {"tutum-app", "tutum-data", "monitoring", "keda"}

    try:
        core, _ = _get_k8s_clients()

        if namespace == "all":
            pods = core.list_pod_for_all_namespaces(_request_timeout=10).items
        else:
            pods = core.list_namespaced_pod(namespace, _request_timeout=10).items

        result = []
        for pod in pods:
            ns = pod.metadata.namespace
            if namespace == "all" and ns not in TARGET_NAMESPACES:
                continue

            # ?뚮뱶 ?곹깭
            phase = pod.status.phase or "Unknown"
            # CrashLoopBackOff ???몃? ?곹깭
            container_statuses = pod.status.container_statuses or []
            waiting_reason = None
            for cs in container_statuses:
                if cs.state and cs.state.waiting:
                    waiting_reason = cs.state.waiting.reason
                    break
            display_status = waiting_reason if waiting_reason else phase

            # Ready 而⑦뀒?대꼫 ??
            ready_count = sum(1 for cs in container_statuses if cs.ready)
            total_count = len(container_statuses)

            # 湲곕룞 ?쒓컖 (ISO)
            start_ts = pod.status.start_time or pod.metadata.creation_timestamp
            start_time = start_ts.isoformat() if start_ts else "-"

            # ?ㅼ슫???(珥?: 留덉?留??ъ떆????二쎌뼱?덈뜕 ?쒓컙
            downtime_sec = _pod_downtime_sec(container_statuses)

            result.append({
                "name": pod.metadata.name,
                "namespace": ns,
                "status": display_status,
                "node": pod.spec.node_name or "-",
                "ready": f"{ready_count}/{total_count}",
                "start_time": start_time,
                "downtime_sec": downtime_sec,
            })

        return {"pods": result}

    except Exception as e:
        logger.error("get_pods ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/metrics")
async def get_metrics():
    """理쒓렐 1?쒓컙 KPI 硫뷀듃由?쓣 Mimir?먯꽌 議고쉶?쒕떎."""
    step = "5m"
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=1)

    async def _query_range_values(query: str) -> list[float]:
        data = await _mimir_query(
            "/api/v1/query_range",
            params={
                "query": query,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "step": step,
            },
        )
        if not data:
            return []

        results = data.get("data", {}).get("result", [])
        if not results:
            return []

        values: list[float] = []
        for _, raw in results[0].get("values", []):
            try:
                num = float(raw)
                if math.isfinite(num):
                    values.append(round(num, 2))
            except (TypeError, ValueError):
                continue
        return values[-12:] if len(values) >= 12 else values

    async def _query_instant_value(query: str) -> float | None:
        data = await _mimir_query(
            "/api/v1/query",
            params={"query": query, "time": end.isoformat()},
        )
        if not data:
            return None

        results = data.get("data", {}).get("result", [])
        if not results:
            return None

        try:
            num = float(results[0]["value"][1])
            return round(num, 2) if math.isfinite(num) else None
        except (TypeError, ValueError, IndexError, KeyError):
            return None

    query_candidates = {
        "rps": [
            'sum(rate(http_requests_total{namespace="tutum-app"}[2m]))',
            "sum(rate(http_requests_total[2m]))",
            'sum(rate(http_request_duration_seconds_count{namespace="tutum-app"}[2m]))',
            "sum(rate(http_request_duration_seconds_count[2m]))",
        ],
        "latency_p95": [
            (
                'histogram_quantile(0.95, sum by(le) '
                '(rate(http_request_duration_seconds_bucket{namespace="tutum-app"}[2m]))) * 1000'
            ),
            (
                "histogram_quantile(0.95, sum by(le) "
                "(rate(http_request_duration_seconds_bucket[2m]))) * 1000"
            ),
            (
                'histogram_quantile(0.95, sum by(le) '
                '(rate(http_request_duration_highr_seconds_bucket{namespace="tutum-app"}[2m]))) * 1000'
            ),
            (
                "histogram_quantile(0.95, sum by(le) "
                "(rate(http_request_duration_highr_seconds_bucket[2m]))) * 1000"
            ),
        ],
        "error_rate": [
            # or on() vector(0): 5xx ?붿껌???놁쓣 ??鍮?踰≫꽣 ???0 諛섑솚 ??N/A 諛⑹?
            (
                '(sum(rate(http_requests_total{namespace="tutum-app",status=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_requests_total{namespace="tutum-app"}[2m])) * 100'
            ),
            (
                '(sum(rate(http_requests_total{status=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_requests_total[2m])) * 100'
            ),
            (
                '(sum(rate(http_requests_total{namespace="tutum-app",status_code=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_requests_total{namespace="tutum-app"}[2m])) * 100'
            ),
            (
                '(sum(rate(http_requests_total{status_code=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_requests_total[2m])) * 100'
            ),
            (
                '(sum(rate(http_server_request_duration_seconds_count'
                '{namespace="tutum-app",http_status=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_server_request_duration_seconds_count{namespace="tutum-app"}[2m])) * 100'
            ),
            (
                '(sum(rate(http_server_request_duration_seconds_count{http_status=~"5.."}[2m])) or on() vector(0)) '
                '/ sum(rate(http_server_request_duration_seconds_count[2m])) * 100'
            ),
        ],
        "kafka_lag": [
            "sum(kafka_consumergroup_lag)",
            "sum(kafka_consumergroup_group_lag)",
            "sum(kafka_consumergroup_lag_sum)",
        ],
        "error_5xx": [
            'sum(increase(http_requests_total{namespace="tutum-app",status=~"5.."}[5m]))',
            'sum(increase(http_requests_total{status=~"5.."}[5m]))',
            'sum(increase(http_requests_total{namespace="tutum-app",status_code=~"5.."}[5m]))',
            'sum(increase(http_requests_total{status_code=~"5.."}[5m]))',
        ],
        "error_4xx": [
            'sum(increase(http_requests_total{namespace="tutum-app",status=~"4.."}[5m]))',
            'sum(increase(http_requests_total{status=~"4.."}[5m]))',
            'sum(increase(http_requests_total{namespace="tutum-app",status_code=~"4.."}[5m]))',
            'sum(increase(http_requests_total{status_code=~"4.."}[5m]))',
        ],
    }

    async def _query_top_endpoints(query: str) -> list[dict]:
        """handler ?덉씠釉붾퀎 踰≫꽣 寃곌낵瑜?諛섑솚?쒕떎 (?붾뱶?ъ씤?몃퀎 ?먮윭 吏묎퀎??."""
        data = await _mimir_query(
            "/api/v1/query",
            params={"query": query, "time": end.isoformat()},
        )
        if not data:
            return []
        results = data.get("data", {}).get("result", [])
        out = []
        for r in results:
            metric = r.get("metric", {})
            handler = (
                metric.get("handler")
                or metric.get("path")
                or metric.get("route")
                or ""
            )
            try:
                val = float(r["value"][1])
            except (TypeError, ValueError, KeyError, IndexError):
                val = 0.0
            if math.isfinite(val) and val > 0 and handler:
                out.append({"endpoint": handler, "count": round(val, 1)})
        return sorted(out, key=lambda x: -x["count"])[:5]

    result: dict[str, list[float]] = {}
    for key, candidates in query_candidates.items():
        values: list[float] = []
        for query in candidates:
            values = await _query_range_values(query)
            if values:
                break

        if not values:
            for query in candidates:
                instant = await _query_instant_value(query)
                if instant is not None:
                    values = [instant] * 12
                    break

        if not values:
            logger.warning("Mimir query returned no data [%s]", key)
        result[key] = values

    # ?붾뱶?ъ씤?몃퀎 5xx ?먮윭 Top 5 (吏??1?쒓컙)
    top_5xx: list[dict] = []
    for q in [
        'topk(5, sum(increase(http_requests_total{namespace="tutum-app",status=~"5.."}[1h])) by (handler))',
        'topk(5, sum(increase(http_requests_total{status=~"5.."}[1h])) by (handler))',
        'topk(5, sum(increase(http_requests_total{namespace="tutum-app",status_code=~"5.."}[1h])) by (handler))',
    ]:
        top_5xx = await _query_top_endpoints(q)
        if top_5xx:
            break

    return {**result, "top_5xx_endpoints": top_5xx}


@router.get("/logs")
async def get_logs(namespace: str = "tutum-app", limit: int = 50):
    """
    Loki?먯꽌 ?ㅼ떆媛?濡쒓렇 議고쉶 + 理쒓렐 1?쒓컙 ?먮윭 ?대젰 ?붿빟.
    namespace: "tutum-app" | "tutum-data" | "all"
    """
    ns_pattern = "(tutum-app|tutum-data)" if namespace == "all" else namespace
    base_selector = f'{{job="loki.source.kubernetes.pods", namespace=~"{ns_pattern}"}}'
    log_query = base_selector  # ?ㅼ떆媛??ㅽ듃由?(理쒓렐 10遺?
    error_query = f'{base_selector} |= "ERROR"'  # ?먮윭 ?대젰 (理쒓렐 1?쒓컙)

    end_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)

    def _parse_streams(result: list, default_level: str = "INFO") -> list[dict]:
        """Loki query_range result ??log entry list."""
        logs = []
        for stream in result:
            labels = stream["stream"]
            level = labels.get("level", default_level).upper()
            # Alloy loki.source.kubernetes ?덉씠釉? namespace, pod 吏곸젒 ?ъ슜
            ns_name = labels.get("namespace", "")
            pod_name = labels.get("pod", labels.get("instance", ""))
            for ts_ns, msg in stream.get("values", []):
                ts = datetime.fromtimestamp(int(ts_ns) / 1_000_000_000, tz=timezone.utc)
                logs.append({
                    "time":      ts.strftime("%H:%M:%S"),
                    "timestamp": int(ts_ns),
                    "level":     level if level in ("INFO", "WARN", "WARNING", "ERROR", "DEBUG") else "INFO",
                    "namespace": ns_name,
                    "pod":       pod_name,
                    "msg":       msg.rstrip("\n"),
                })
        return logs

    try:
        # 1) ?ㅼ떆媛??ㅽ듃由???理쒓렐 10遺?
        stream_resp, error_resp = await asyncio.gather(
            _HTTP_LOKI.get(
                f"{LOKI_URL}/loki/api/v1/query_range",
                params={"query": log_query, "limit": limit,
                        "start": end_ns - 600_000_000_000, "end": end_ns, "direction": "backward"},
            ),
            _HTTP_LOKI.get(
                f"{LOKI_URL}/loki/api/v1/query_range",
                params={"query": error_query, "limit": 500,
                        "start": end_ns - 3_600_000_000_000, "end": end_ns, "direction": "backward"},
            ),
            return_exceptions=True,
        )

        # ?ㅼ떆媛?濡쒓렇 ?뚯떛
        logs: list[dict] = []
        if not isinstance(stream_resp, Exception) and stream_resp.json().get("status") == "success":
            logs = _parse_streams(stream_resp.json()["data"]["result"])
        logs.sort(key=lambda x: x["timestamp"], reverse=True)
        unique, seen = [], set()
        for log in logs:
            key = (log["timestamp"], log["pod"], log["msg"][:50])
            if key not in seen:
                seen.add(key)
                unique.append(log)

        # ?먮윭 ?대젰 吏묎퀎 (1?쒓컙, pod蹂?ERROR 嫄댁닔 + 留덉?留?諛쒖깮)
        error_summary: list[dict] = []
        if not isinstance(error_resp, Exception) and error_resp.json().get("status") == "success":
            err_logs = _parse_streams(error_resp.json()["data"]["result"], default_level="ERROR")
            # pod蹂?吏묎퀎
            pod_stat: dict[str, dict] = {}
            for e in err_logs:
                pod = e["pod"]
                if pod not in pod_stat:
                    pod_stat[pod] = {
                        "count": 0, "last_time": e["time"],
                        "last_msg": e["msg"][:80], "namespace": e["namespace"],
                    }
                pod_stat[pod]["count"] += 1
            error_summary = sorted(
                [{"pod": k, **v} for k, v in pod_stat.items()],
                key=lambda x: -x["count"],
            )

        return {"logs": unique[:limit], "error_summary": error_summary}

    except Exception as e:
        logger.error("get_logs Loki ?ㅻ쪟: %s", e)
        return {"logs": [], "error_summary": []}


# ??? AI 吏꾨떒 ???????????????????????????????????????????????????????????????????

_DIAGNOSE_SYSTEM_PROMPT = """?뱀떊? Kubernetes ?대윭?ㅽ꽣 ?댁쁺 ?꾨Ц媛 AI?낅땲??
二쇱뼱吏??대윭?ㅽ꽣 ?곹깭 ?곗씠?곕? 遺꾩꽍?섏뿬 ?ㅼ쓬 JSON ?뺤떇?쇰줈留??묐떟?섏꽭??
?ㅻⅨ ?띿뒪?몃굹 留덊겕?ㅼ슫 ?놁씠 ?쒖닔 JSON留?諛섑솚?섏꽭??

{
  "severity": "OK" | "WARN" | "CRITICAL",
  "summary": "??以??꾩껜 ?붿빟 (?쒓뎅?? 50???대궡)",
  "issues": [
    {"level": "WARN" | "ERROR", "title": "?댁뒋 ?쒕ぉ", "detail": "?곸꽭 ?ㅻ챸"}
  ],
  "recommendations": [
    {"priority": "HIGH" | "MEDIUM" | "LOW", "action": "沅뚯옣 議곗튂 (?쒓뎅??"}
  ]
}

severity 湲곗?:
- OK: 紐⑤뱺 ?뚮뱶 ?뺤긽, ?ъ떆???놁쓬, 由ъ냼???ъ쑀
- WARN: ?쇰? ?뚮뱶 ?댁뒋 or ?ъ떆???덉쓬 or 由ъ냼??70% ?댁긽
- CRITICAL: CrashLoopBackOff or ?ㅼ닔 ?뚮뱶 鍮꾩젙??or ?몃뱶 NotReady"""


@router.get("/diagnose")
async def get_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """
    ?꾩옱 ?대윭?ㅽ꽣 ?곹깭瑜?Bedrock Claude濡?AI 吏꾨떒.
    nodes + pods ?곗씠?곕? ?섏쭛???댁뒋/沅뚯옣議곗튂瑜?JSON?쇰줈 諛섑솚.
    """
    # 1. ?대윭?ㅽ꽣 ?꾩옱 ?곹깭 ?섏쭛
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        core, metrics_api = _get_k8s_clients()

        # ?몃뱶 ?섏쭛
        nodes_raw = core.list_node(_request_timeout=10).items
        usage_map = {}
        try:
            raw = metrics_api.list_cluster_custom_object(
                group="metrics.k8s.io", version="v1beta1", plural="nodes"
            )
            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                cpu_nano = int(item["usage"]["cpu"].rstrip("n"))
                mem_ki = int(item["usage"]["memory"].rstrip("Ki"))
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception:
            pass

        node_lines = []
        for node in nodes_raw:
            name = node.metadata.name
            alloc = node.status.allocatable or {}
            cpu_str = alloc.get("cpu", "0")
            mem_str = alloc.get("memory", "0Ki")
            cpu_m = int(float(cpu_str)) * 1000 if not cpu_str.endswith("m") else int(cpu_str[:-1])
            mem_ki = int(mem_str[:-2]) if mem_str.endswith("Ki") else int(mem_str) // 1024

            cpu_pct = mem_pct = 0
            if name in usage_map:
                u = usage_map[name]
                cpu_pct = round(u["cpu_nano"] / 1_000_000 / cpu_m * 100) if cpu_m else 0
                mem_pct = round(u["mem_ki"] / mem_ki * 100) if mem_ki else 0

            status = _node_status(node)
            role = _node_role(node)
            node_lines.append(f"  - {name} ({role}): {status}, CPU {cpu_pct}%, MEM {mem_pct}%")

        # ?뚮뱶 ?섏쭛
        TARGET_NS = {"tutum-app", "tutum-data", "monitoring", "keda"}
        pods_raw = core.list_pod_for_all_namespaces(_request_timeout=10).items
        pod_lines = []
        problem_pods = []
        for pod in pods_raw:
            if pod.metadata.namespace not in TARGET_NS:
                continue
            phase = pod.status.phase or "Unknown"
            cs_list = pod.status.container_statuses or []
            waiting_reason = None
            for cs in cs_list:
                if cs.state and cs.state.waiting:
                    waiting_reason = cs.state.waiting.reason
                    break
            display_status = waiting_reason if waiting_reason else phase
            restarts = sum(cs.restart_count for cs in cs_list)

            line = f"  - {pod.metadata.namespace}/{pod.metadata.name}: {display_status}, restarts={restarts}"
            pod_lines.append(line)
            if display_status not in ("Running", "Succeeded") or restarts > 5:
                problem_pods.append(line.strip())

    except Exception as e:
        logger.error("diagnose ?곗씠???섏쭛 ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=500, detail=f"?대윭?ㅽ꽣 ?곗씠???섏쭛 ?ㅽ뙣: {e}")

    # 2. ?꾨＼?꾪듃 援ъ꽦
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = f"""?대윭?ㅽ꽣 吏꾨떒 ?붿껌 ({now_str})

[?몃뱶 ?곹깭 ({len(nodes_raw)}媛?]
{chr(10).join(node_lines)}

[?뚮뱶 ?곹깭 ({len(pod_lines)}媛?]
{chr(10).join(pod_lines)}

[?붿빟]
- ?꾩껜 ?뚮뱶: {len(pod_lines)}媛?
- 臾몄젣 ?뚮뱶: {len(problem_pods)}媛?
{chr(10).join(problem_pods) if problem_pods else "  (?놁쓬)"}

???곗씠?곕? 遺꾩꽍?섏뿬 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"""

    # 3. Bedrock ?몄텧
    try:
        bedrock = _get_bedrock_client()
        model_id = os.getenv("BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "temperature": 0.2,
            "system": _DIAGNOSE_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
        })

        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: bedrock.invoke_model(
                modelId=model_id,
                body=body,
                contentType="application/json",
                accept="application/json",
            ),
        )
        raw_body = json.loads(response["body"].read())
        text = raw_body["content"][0]["text"].strip()

        # JSON ?뚯떛 (肄붾뱶釉붾줉 媛먯떥???덉쓣 寃쎌슦 ?쒓굅)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        diagnosis = json.loads(text)

    except Exception as e:
        logger.error("Bedrock 吏꾨떒 ?몄텧 ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=503, detail=f"AI 吏꾨떒 ?쒕퉬???ㅻ쪟: {e}")

    return {
        "diagnosis": diagnosis,
        "context": {
            "node_count": len(nodes_raw),
            "pod_count": len(pod_lines),
            "problem_count": len(problem_pods),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ??? ?뚯씠?꾨씪??紐⑤땲?곕쭅 ????????????????????????????????????????????????????????

_NEWS_WORKERS = ["news-producer", "news-consumer", "elastic-consumer"]
_PRICE_WORKERS = ["price-producer", "price-consumer"]
_OTHER_WORKERS = ["email-worker", "ocr-worker"]
_ALL_WORKERS = _NEWS_WORKERS + _PRICE_WORKERS + _OTHER_WORKERS

# ?섏쐞 ?명솚?깆슜 (pipeline-diagnose ?꾨＼?꾪듃 ??
_PIPELINE_WORKERS = _ALL_WORKERS


async def _collect_pipeline_data() -> dict:
    """?뚯씠?꾨씪???꾩껜 ?뚯빱 ?곹깭 ?섏쭛 (pipeline / pipeline-diagnose 怨듭슜)."""
    out: dict = {
        "workers": {
            w: {"status": "Unknown", "start_time": "-", "downtime_sec": 0, "running": False}
            for w in _ALL_WORKERS
        },
        "mongodb": {"news_total": 0, "news_last_1h": 0, "available": False},
        "elasticsearch": {"news_docs": 0, "available": False},
        "recent_logs": {w: [] for w in _ALL_WORKERS},
    }

    # 1. Worker ?뚮뱶 ?곹깭 (K8s)
    try:
        core, _ = _get_k8s_clients()
        for label in _ALL_WORKERS:
            try:
                pods = core.list_namespaced_pod("tutum-app", label_selector=f"app={label}", _request_timeout=5).items
                running_pods = [p for p in pods if p.status.phase == "Running"]
                pod = running_pods[0] if running_pods else (pods[0] if pods else None)
                if pod:
                    cs_list = pod.status.container_statuses or []
                    phase = pod.status.phase or "Unknown"
                    waiting_reason = None
                    for cs in cs_list:
                        if cs.state and cs.state.waiting:
                            waiting_reason = cs.state.waiting.reason
                            break
                    start_ts = pod.status.start_time or pod.metadata.creation_timestamp
                    start_time = start_ts.isoformat() if start_ts else "-"
                    downtime_sec = _pod_downtime_sec(cs_list)
                    out["workers"][label] = {
                        "status": waiting_reason or phase,
                        "start_time": start_time,
                        "downtime_sec": downtime_sec,
                        "running": (waiting_reason is None and phase == "Running"),
                    }
                else:
                    out["workers"][label] = {
                        "status": "Stopped", "start_time": "-", "downtime_sec": 0, "running": False
                    }
            except Exception:
                pass
    except Exception as e:
        logger.warning("pipeline K8s 議고쉶 ?ㅽ뙣: %s", e)

    # 2. MongoDB news count
    try:
        news_col = get_news_collection()
        if news_col is not None:
            total = await news_col.count_documents({})
            one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
            recent = await news_col.count_documents({"published_at": {"$gte": one_hour_ago}})
            out["mongodb"] = {"news_total": total, "news_last_1h": recent, "available": True}
    except Exception as e:
        logger.warning("pipeline MongoDB 議고쉶 ?ㅽ뙣: %s", e)

    # 3. Elasticsearch document count
    es_url = os.getenv("ELASTICSEARCH_URL", "http://elasticsearch.tutum-data.svc.cluster.local:9200")
    try:
        resp = await _HTTP_MISC.get(f"{es_url}/news/_count")
        if resp.status_code == 200:
            out["elasticsearch"] = {"news_docs": resp.json().get("count", 0), "available": True}
    except Exception as e:
        logger.warning("pipeline ES 議고쉶 ?ㅽ뙣: %s", e)

    # 4. Loki 理쒓렐 濡쒓렇 ?섑뵆 (理쒓렐 5遺?
    end_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)
    start_ns = end_ns - 300_000_000_000
    try:
        for worker in _ALL_WORKERS:
            try:
                query = f'{{job="loki.source.kubernetes.pods", namespace="tutum-app", app=~"{worker}.*"}}'
                resp = await _HTTP_LOKI.get(
                    f"{LOKI_URL}/loki/api/v1/query_range",
                    params={"query": query, "limit": 5, "start": start_ns, "end": end_ns, "direction": "backward"},
                )
                data = resp.json()
                if data.get("status") == "success":
                    logs_sample = []
                    for stream in data.get("data", {}).get("result", []):
                        for _, msg in stream.get("values", []):
                            logs_sample.append(msg.strip()[:120])
                    out["recent_logs"][worker] = logs_sample[:5]
            except Exception:
                pass
    except Exception as e:
        logger.warning("pipeline Loki ?섑뵆 ?ㅽ뙣: %s", e)

    return out


@router.get("/pipeline")
async def get_pipeline():
    """?뚯씠?꾨씪??3? 援ъ꽦?붿냼 ?ㅼ떆媛??곹깭 (Worker ?뚮뱶/MongoDB/ES/Loki ?섑뵆)."""
    return await _collect_pipeline_data()


_PIPELINE_SYSTEM_PROMPT = """?뱀떊? ?곗씠???뚯씠?꾨씪???댁쁺 ?꾨Ц媛 AI?낅땲??
?뚯씠?꾨씪??援ъ꽦?붿냼?ㅼ쓣 遺꾩꽍?섏뿬 ?ㅼ쓬 JSON ?뺤떇?쇰줈留??묐떟?섏꽭??
?ㅻⅨ ?띿뒪?몃굹 留덊겕?ㅼ슫 ?놁씠 ?쒖닔 JSON留?諛섑솚?섏꽭??

{
  "overall": "OK" | "WARN" | "CRITICAL",
  "components": [
    {
      "name": "news-producer",
      "label": "?댁뒪 ?섏쭛",
      "status": "OK" | "WARN" | "ERROR",
      "summary": "??以??붿빟 (20???대궡)",
      "issues": [{"title": "?댁뒋 ?쒕ぉ", "detail": "?곸꽭 ?ㅻ챸"}],
      "actions": [{"priority": "HIGH" | "MEDIUM" | "LOW", "action": "沅뚯옣 議곗튂"}]
    }
  ]
}

status 湲곗?:
- OK: ?뚮뱶 Running, 泥섎━ ?뺤긽
- WARN: ?ъ떆???덉쓬, 泥섎━ 吏?? ?쇱떆 以묒?/以묐떒 ?곹깭
- ERROR: ?뚮뱶 ?놁쓬, CrashLoop, ?ㅻ쪟 吏??
?뚯빱 洹몃９: ?댁뒪(news-producer/consumer/elastic-consumer), ?쒖꽭(price-producer/consumer), 湲고?(email-worker/ocr-worker)
以묒슂: 媛??뚯빱???낅젰 ?곗씠?곗? ?ㅼ젣 ?곹깭瑜?湲곕컲?쇰줈 ?먮떒?섏꽭??"""


@router.get("/pipeline-diagnose")
async def get_pipeline_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """?뚯씠?꾨씪??3? 援ъ꽦?붿냼瑜?Bedrock Claude濡?AI 遺꾩꽍."""
    # 1. ?곗씠???섏쭛
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        data = await _collect_pipeline_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"?뚯씠?꾨씪???곗씠???섏쭛 ?ㅽ뙣: {e}")

    # 2. ?꾨＼?꾪듃 援ъ꽦
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    WORKER_KR = {
        "news-producer": "news collection",
        "news-consumer": "mongodb storage",
        "elastic-consumer": "es indexing",
        "price-producer": "price collection",
        "price-consumer": "price storage",
        "email-worker": "email worker",
        "ocr-worker": "ocr worker",
    }

    lines = [f"?뚯씠?꾨씪??吏꾨떒 ?붿껌 ({now_str})", ""]
    for w in _PIPELINE_WORKERS:
        wd = data["workers"].get(w, {})
        lines.append(f"[{WORKER_KR[w]}] ({w})")
        status_str = wd.get('status', 'Unknown')
        restarts_str = wd.get('restarts', 0)
        running_str = wd.get('running', False)
        lines.append(f"  ?곹깭: {status_str}, ?ъ떆?? {restarts_str}?? Running: {running_str}")
        recent = data["recent_logs"].get(w, [])
        if recent:
            lines.append(f"  理쒓렐 濡쒓렇: {recent[0][:80]}")
        lines.append("")

    elastic = data["workers"].get("elastic-consumer", {})
    elastic_status = elastic.get("status", "Unknown")
    elastic_running = bool(elastic.get("running", False))
    if elastic_running:
        elastic_note = "李멸퀬: elastic-consumer???꾩옱 ?ㅽ뻾 以묒엯?덈떎. 鍮꾪솢?깆쑝濡?媛?뺥븯吏 留먭퀬 ?ㅼ젣 ?몃뜳???곹깭瑜??됯??섏꽭??"
    elif elastic_status == "Stopped":
        elastic_note = "李멸퀬: elastic-consumer ?뚮뱶媛 愿李곕릺吏 ?딆뒿?덈떎(以묒? ?곹깭)."
    else:
        elastic_note = f"李멸퀬: elastic-consumer ?곹깭??{elastic_status} ?낅땲??"

    lines += [
        "[?곗씠???꾪솴]",
        f"  MongoDB news ?꾩껜: {data['mongodb'].get('news_total', 'N/A')}嫄?,
        f"  MongoDB 理쒓렐 1?쒓컙 異붽?: {data['mongodb'].get('news_last_1h', 'N/A')}嫄?,
        f"  ES ?몃뜳??臾몄꽌: {data['elasticsearch'].get('news_docs', 'N/A')}嫄?,
        "",
        elastic_note,
        "???곗씠?곕? 湲곕컲?쇰줈 3媛?援ъ꽦?붿냼 媛곴컖??遺꾩꽍??JSON?쇰줈 諛섑솚?섏꽭??",
    ]
    prompt = "\n".join(lines)

    # 3. Bedrock ?몄텧
    try:
        bedrock = _get_bedrock_client()
        model_id = os.getenv("BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1500,
            "temperature": 0.2,
            "system": _PIPELINE_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
        })

        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: bedrock.invoke_model(
                modelId=model_id, body=body,
                contentType="application/json", accept="application/json",
            ),
        )
        raw_body = json.loads(response["body"].read())
        text = raw_body["content"][0]["text"].strip()

        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)

    except Exception as e:
        logger.error("pipeline-diagnose Bedrock ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


# ??? AI 吏꾨떒 怨듯넻 ?ы띁 ?????????????????????????????????????????????????????????

async def _call_bedrock_standard(prompt: str, system_prompt: str, max_tokens: int = 1024) -> dict:
    """Bedrock Claude 怨듯넻 ?몄텧 + JSON ?뚯떛."""
    bedrock = _get_bedrock_client()
    model_id = os.getenv("BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "system": system_prompt,
        "messages": [{"role": "user", "content": prompt}],
    })
    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        lambda: bedrock.invoke_model(
            modelId=model_id, body=body,
            contentType="application/json", accept="application/json",
        ),
    )
    raw_body = json.loads(response["body"].read())
    text = raw_body["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


@router.get("/infra-diagnose")
async def get_infra_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """?명봽???몃뱶/?뚮뱶) ?곹깭瑜?Bedrock Claude濡?AI 吏꾨떒."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        core, metrics_api = _get_k8s_clients()
        nodes_raw = core.list_node(_request_timeout=10).items
        usage_map: dict = {}
        try:
            raw = metrics_api.list_cluster_custom_object(
                group="metrics.k8s.io", version="v1beta1", plural="nodes"
            )
            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                cpu_nano = int(item["usage"]["cpu"].rstrip("n"))
                mem_ki = int(item["usage"]["memory"].rstrip("Ki"))
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception:
            pass

        node_lines = []
        for node in nodes_raw:
            name = node.metadata.name
            alloc = node.status.allocatable or {}
            cpu_str = alloc.get("cpu", "0")
            mem_str = alloc.get("memory", "0Ki")
            cpu_m = int(float(cpu_str)) * 1000 if not cpu_str.endswith("m") else int(cpu_str[:-1])
            mem_ki = int(mem_str[:-2]) if mem_str.endswith("Ki") else int(mem_str) // 1024
            cpu_pct = mem_pct = 0
            if name in usage_map:
                u = usage_map[name]
                cpu_pct = round(u["cpu_nano"] / 1_000_000 / cpu_m * 100) if cpu_m else 0
                mem_pct = round(u["mem_ki"] / mem_ki * 100) if mem_ki else 0
            node_lines.append(
                f"  - {name} ({_node_role(node)}): {_node_status(node)}, CPU {cpu_pct}%, MEM {mem_pct}%"
            )

        TARGET_NS = {"tutum-app", "tutum-data", "monitoring", "keda"}
        pods_raw = core.list_pod_for_all_namespaces(_request_timeout=10).items
        pod_lines, problem_pods = [], []
        for pod in pods_raw:
            if pod.metadata.namespace not in TARGET_NS:
                continue
            phase = pod.status.phase or "Unknown"
            cs_list = pod.status.container_statuses or []
            waiting_reason = next(
                (cs.state.waiting.reason for cs in cs_list if cs.state and cs.state.waiting), None
            )
            display_status = waiting_reason or phase
            restarts = sum(cs.restart_count for cs in cs_list)
            line = f"  - {pod.metadata.namespace}/{pod.metadata.name}: {display_status}, restarts={restarts}"
            pod_lines.append(line)
            if display_status not in ("Running", "Succeeded") or restarts > 5:
                problem_pods.append(line.strip())

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"?명봽???곗씠???섏쭛 ?ㅽ뙣: {e}")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"?명봽??吏꾨떒 ?붿껌 ({now_str})\n\n"
        f"[?몃뱶 ?곹깭 ({len(nodes_raw)}媛?]\n" + "\n".join(node_lines) + "\n\n"
        f"[?뚮뱶 ?곹깭 ({len(pod_lines)}媛?]\n" + "\n".join(pod_lines) + "\n\n"
        f"[?붿빟]\n- ?꾩껜 ?뚮뱶: {len(pod_lines)}媛?n- 臾몄젣 ?뚮뱶: {len(problem_pods)}媛?n"
        + ("\n".join(problem_pods) if problem_pods else "  (?놁쓬)") +
        "\n\n???명봽???곗씠?곕? 遺꾩꽍?섏뿬 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/data-diagnose")
async def get_data_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """?곗씠???덉씠??ES/Redis/Kafka/MongoDB/Disk) ?곹깭瑜?AI 吏꾨떒."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        dm = await get_data_metrics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"?곗씠??硫뷀듃由??섏쭛 ?ㅽ뙣: {e}")

    es = dm["elasticsearch"]
    redis = dm["redis"]
    kafka = dm["kafka"]
    disk = dm["disk"]
    mongo = dm["mongodb"]

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"?곗씠???덉씠??吏꾨떒 ?붿껌 ({now_str})\n\n"
        f"[Elasticsearch]\n"
        f"- 媛?? {es['available']}\n"
        f"- JVM Heap: {es['jvm_heap_used_gb']}GB / {es['jvm_heap_max_gb']}GB ({es['jvm_heap_pct']}%)\n"
        f"- ?몃뜳?? {es['indexing_rate']} docs/s, ??μ냼: {es['store_gb']}GB\n"
        f"- 寃??QPS: {es['search_qps']}, 吏?? {es['search_latency_ms']}ms\n"
        f"- ?ㅻ젅??嫄곕?: {es['thread_rejected']}\n\n"
        f"[Redis]\n"
        f"- 媛?? {redis['available']}\n"
        f"- 硫붾え由? {redis['memory_used_gb']}GB / {redis['memory_max_gb']}GB ({redis['memory_pct']}%)\n"
        f"- ?곌껐: {redis['clients']}媛? ?덊듃?? {redis['hit_rate_pct']}%\n\n"
        f"[Kafka]\n"
        f"- 媛?? {kafka['available']}\n"
        f"- Consumer Lag: {kafka['consumer_lag']}, 泥섎━?? {kafka['throughput_msg_per_min']}msg/min\n\n"
        f"[MongoDB]\n"
        f"- 媛?? {mongo['available']}\n"
        f"- ?곌껐: {mongo['connections']}媛?n"
        f"- ?쎄린: {mongo['ops_read_per_sec']}/s, ?곌린: {mongo['ops_write_per_sec']}/s\n\n"
        f"[Disk]\n"
        f"- ?꾩껜: {disk['total_gb']}GB, ?ъ슜: {disk['used_gb']}GB ({disk['used_pct']}%)\n"
        f"- ?쎄린: {disk['read_mbps']}MB/s, ?곌린: {disk['write_mbps']}MB/s\n\n"
        "???곗씠???덉씠???곹깭瑜?遺꾩꽍?섏뿬 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/log-diagnose")
async def get_log_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """理쒓렐 1?쒓컙 ?먮윭 濡쒓렇 ?⑦꽩??AI 遺꾩꽍."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    end_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)
    start_ns = end_ns - 3_600_000_000_000
    error_logs: list[str] = []
    try:
        resp = await _HTTP_LOKI.get(
            f"{LOKI_URL}/loki/api/v1/query_range",
            params={
                "query": '{job="loki.source.kubernetes.pods"} |= "ERROR"',
                "limit": 50,
                "start": start_ns,
                "end": end_ns,
                "direction": "backward",
            },
        )
        data = resp.json()
        if data.get("status") == "success":
            for stream in data.get("data", {}).get("result", []):
                labels = stream.get("stream", {})
                ns = labels.get("namespace", "")
                pod = labels.get("pod", labels.get("instance", ""))
                for _, msg in stream.get("values", []):
                    error_logs.append(f"[{ns}/{pod}] {msg[:120]}")
    except Exception as e:
        logger.warning("log-diagnose Loki 議고쉶 ?ㅽ뙣: %s", e)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    log_text = "\n".join(error_logs[:30]) if error_logs else "  (理쒓렐 1?쒓컙 ?먮윭 ?놁쓬)"
    prompt = (
        f"濡쒓렇 遺꾩꽍 吏꾨떒 ?붿껌 ({now_str})\n\n"
        f"[理쒓렐 1?쒓컙 ?먮윭 濡쒓렇 ({len(error_logs)}嫄?]\n{log_text}\n\n"
        "??濡쒓렇 ?⑦꽩??遺꾩꽍?섏뿬 諛섎났 ?먮윭쨌?댁긽 ?⑦꽩???뚯븙?섍퀬, 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/trace-diagnose")
async def get_trace_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """理쒓렐 1?쒓컙 ?몃젅?댁뒪 ?먮윭쨌吏?곗쓣 AI 遺꾩꽍."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    end_s = int(datetime.now(timezone.utc).timestamp())
    start_s = end_s - 3600
    base_params = {"service.name": "tutum-backend", "start": start_s, "end": end_s}

    error_lines: list[str] = []
    slow_lines: list[str] = []
    try:
        err_resp = await _HTTP_MISC.get(
            f"{TEMPO_URL}/api/search",
            params={**base_params, "q": '{span.http.status_code >= 500}', "limit": 10},
        )
        if err_resp.status_code == 200:
            for t in err_resp.json().get("traces", []):
                error_lines.append(f"  {t.get('rootTraceName','-')} {t.get('durationMs',0)}ms [5xx]")
    except Exception as e:
        logger.warning("trace-diagnose error query ?ㅽ뙣: %s", e)
    try:
        slow_resp = await _HTTP_MISC.get(
            f"{TEMPO_URL}/api/search",
            params={**base_params, "limit": 10, "minDuration": "200ms"},
        )
        if slow_resp.status_code == 200:
            for t in slow_resp.json().get("traces", []):
                slow_lines.append(f"  {t.get('rootTraceName','-')} {t.get('durationMs',0)}ms")
    except Exception as e:
        logger.warning("trace-diagnose slow query ?ㅽ뙣: %s", e)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"?몃젅?댁뒪 遺꾩꽍 吏꾨떒 ?붿껌 ({now_str})\n\n"
        f"[5xx ?먮윭 ?몃젅?댁뒪 ({len(error_lines)}嫄?]\n"
        + ("\n".join(error_lines) if error_lines else "  (?놁쓬)") + "\n\n"
        f"[?먮┛ ?붿껌 ?몃젅?댁뒪 >=200ms ({len(slow_lines)}嫄?]\n"
        + ("\n".join(slow_lines) if slow_lines else "  (?놁쓬)") + "\n\n"
        "???몃젅?댁뒪 ?곗씠?곕? 遺꾩꽍?섏뿬 ?먮윭?㉱룹????⑦꽩???뚯븙?섍퀬, 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/backup-diagnose")
async def get_backup_diagnose(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    """諛깆뾽 CronJob ?곹깭瑜?AI 吏꾨떒."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        data = await get_backup_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"諛깆뾽 ?곹깭 ?섏쭛 ?ㅽ뙣: {e}")

    backups = data.get("backups", [])
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"諛깆뾽 ?곹깭 吏꾨떒 ?붿껌 ({now_str})\n"]
    for b in backups:
        lines.append(
            f"[{b['name']}] ({b['cronjob']}, ns={b['namespace']})\n"
            f"  ?곹깭: {b['status']}, ?ㅼ?以? {b['schedule']}\n"
            f"  留덉?留??ㅽ뻾: {b['last_run_at']}, 留덉?留??깃났: {b['last_success_at']}\n"
            f"  ?먮윭: {b.get('last_error') or '?놁쓬'}"
        )
    prompt = "\n".join(lines) + "\n\n??諛깆뾽 ?곹깭瑜?遺꾩꽍?섏뿬 吏?뺣맂 JSON ?뺤떇?쇰줈 吏꾨떒 寃곌낵瑜?諛섑솚?섏꽭??"

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 遺꾩꽍 ?ㅽ뙣: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


# ??? ?ㅽ넗由ъ? (PVC) ????????????????????????????????????????????????????????????

@router.get("/storage")
async def get_storage():
    """
    K8s PersistentVolumeClaim 紐⑸줉怨??곹깭 諛섑솚.
    tutum-app, tutum-data, tutum-storage ?ㅼ엫?ㅽ럹?댁뒪 ???
    """
    TARGET_NS = {"tutum-app", "tutum-data", "tutum-storage"}
    try:
        core, _ = _get_k8s_clients()
        pvcs = core.list_persistent_volume_claim_for_all_namespaces(_request_timeout=10).items
        result = []
        for pvc in pvcs:
            if pvc.metadata.namespace not in TARGET_NS:
                continue
            capacity = ""
            if pvc.spec.resources and pvc.spec.resources.requests:
                capacity = pvc.spec.resources.requests.get("storage", "")
            result.append({
                "name": pvc.metadata.name,
                "namespace": pvc.metadata.namespace,
                "status": pvc.status.phase or "Unknown",
                "capacity": capacity,
                "storage_class": pvc.spec.storage_class_name or "-",
                "volume": pvc.spec.volume_name or "-",
            })
        result.sort(key=lambda x: (x["namespace"], x["name"]))
        return {"pvcs": result}
    except Exception as e:
        logger.error("get_storage ?ㅻ쪟: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ??? ?몃뱶 24?쒓컙 ?쒓퀎????????????????????????????????????????????????????????????

@router.get("/cost-forecast")
async def get_cost_forecast():
    """Estimate hourly and projected 24h cluster cost from active node inventory."""
    try:
        core, _ = _get_k8s_clients()
        nodes = core.list_node(_request_timeout=10).items

        on_demand_rates = _load_rate_map(
            "ADMIN_COST_INSTANCE_RATES_JSON",
            DEFAULT_INSTANCE_HOURLY_RATES_USD,
        )
        spot_rates = _load_rate_map("ADMIN_COST_SPOT_INSTANCE_RATES_JSON", {})
        spot_discount_ratio = _env_float("ADMIN_COST_SPOT_DISCOUNT_RATIO", 0.35)
        control_plane_hourly = _env_float("ADMIN_COST_CONTROL_PLANE_HOURLY_USD", 0.10)
        nat_gateway_hourly = _env_float("ADMIN_COST_NAT_GATEWAY_HOURLY_USD", 0.045)
        nat_gateway_count = _env_int("ADMIN_COST_NAT_GATEWAY_COUNT", 0)
        extra_fixed_hourly = _env_float("ADMIN_COST_EXTRA_FIXED_HOURLY_USD", 0.0)

        node_rows = []
        by_instance: dict[tuple[str, str], dict] = {}
        by_nodepool: dict[str, dict] = {}
        warnings: list[str] = []
        compute_hourly_total = 0.0
        priceable_nodes = 0
        aws_labeled_nodes = 0

        for node in nodes:
            labels = node.metadata.labels or {}
            instance_type = _node_label(
                labels,
                "node.kubernetes.io/instance-type",
                "beta.kubernetes.io/instance-type",
            )
            nodepool = _node_label(
                labels,
                "karpenter.sh/nodepool",
                "eks.amazonaws.com/nodegroup",
                "eks.amazonaws.com/nodeclass",
            ) or "-"
            zone = _node_label(labels, "topology.kubernetes.io/zone") or "-"
            capacity_type = _normalize_capacity_type(
                _node_label(
                    labels,
                    "karpenter.sh/capacity-type",
                    "eks.amazonaws.com/capacityType",
                    "eks.amazonaws.com/capacity-type",
                )
            )

            if instance_type:
                aws_labeled_nodes += 1

            hourly_rate, price_source = _estimate_hourly_rate(
                instance_type,
                capacity_type,
                on_demand_rates,
                spot_rates,
                spot_discount_ratio,
            )
            daily_rate = hourly_rate * 24 if hourly_rate is not None else None

            if hourly_rate is not None:
                compute_hourly_total += hourly_rate
                priceable_nodes += 1
            elif instance_type:
                warnings.append(f"Missing hourly rate for instance type: {instance_type}")

            node_rows.append({
                "name": node.metadata.name,
                "role": _node_role(node),
                "status": _node_status(node),
                "instance_type": instance_type or None,
                "capacity_type": capacity_type,
                "nodepool": nodepool,
                "zone": zone,
                "hourly_usd": _safe_round_money(hourly_rate),
                "daily_usd": _safe_round_money(daily_rate),
                "price_source": price_source,
            })

            if hourly_rate is None or not instance_type:
                continue

            instance_key = (instance_type, capacity_type)
            instance_bucket = by_instance.setdefault(
                instance_key,
                {
                    "instance_type": instance_type,
                    "capacity_type": capacity_type,
                    "nodes": 0,
                    "hourly_usd": 0.0,
                    "daily_usd": 0.0,
                },
            )
            instance_bucket["nodes"] += 1
            instance_bucket["hourly_usd"] += hourly_rate
            instance_bucket["daily_usd"] += daily_rate or 0.0

            nodepool_bucket = by_nodepool.setdefault(
                nodepool,
                {
                    "nodepool": nodepool,
                    "nodes": 0,
                    "hourly_usd": 0.0,
                    "daily_usd": 0.0,
                },
            )
            nodepool_bucket["nodes"] += 1
            nodepool_bucket["hourly_usd"] += hourly_rate
            nodepool_bucket["daily_usd"] += daily_rate or 0.0

        fixed_hourly_total = control_plane_hourly + (nat_gateway_hourly * nat_gateway_count) + extra_fixed_hourly
        total_hourly = compute_hourly_total + fixed_hourly_total
        total_daily = total_hourly * 24

        available = aws_labeled_nodes > 0
        if not available:
            warnings.append("No AWS instance-type labels found on nodes. This cluster may not be running on EKS workers.")

        unique_warnings = list(dict.fromkeys(warnings))

        return {
            "available": available,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "currency": "USD",
            "cluster_name": (
                os.getenv("EKS_CLUSTER_NAME_PRO")
                or os.getenv("EKS_CLUSTER_NAME_STG")
                or os.getenv("CLUSTER_NAME")
                or "unknown"
            ),
            "assumptions": {
                "pricing_source": "static-rate-card-with-env-overrides",
                "spot_discount_ratio": spot_discount_ratio,
                "control_plane_hourly_usd": control_plane_hourly,
                "nat_gateway_hourly_usd": nat_gateway_hourly,
                "nat_gateway_count": nat_gateway_count,
                "extra_fixed_hourly_usd": extra_fixed_hourly,
                "config_envs": [
                    "ADMIN_COST_INSTANCE_RATES_JSON",
                    "ADMIN_COST_SPOT_INSTANCE_RATES_JSON",
                    "ADMIN_COST_SPOT_DISCOUNT_RATIO",
                    "ADMIN_COST_CONTROL_PLANE_HOURLY_USD",
                    "ADMIN_COST_NAT_GATEWAY_HOURLY_USD",
                    "ADMIN_COST_NAT_GATEWAY_COUNT",
                    "ADMIN_COST_EXTRA_FIXED_HOURLY_USD",
                ],
            },
            "summary": {
                "nodes_total": len(nodes),
                "aws_labeled_nodes": aws_labeled_nodes,
                "priceable_nodes": priceable_nodes,
                "unpriced_nodes": max(0, aws_labeled_nodes - priceable_nodes),
                "compute_hourly_usd": _safe_round_money(compute_hourly_total),
                "fixed_hourly_usd": _safe_round_money(fixed_hourly_total),
                "total_hourly_usd": _safe_round_money(total_hourly),
                "projected_daily_usd": _safe_round_money(total_daily),
            },
            "fixed_costs": {
                "eks_control_plane_hourly_usd": _safe_round_money(control_plane_hourly),
                "nat_gateways_hourly_usd": _safe_round_money(nat_gateway_hourly * nat_gateway_count),
                "extra_fixed_hourly_usd": _safe_round_money(extra_fixed_hourly),
            },
            "breakdown_by_instance": [
                {
                    **bucket,
                    "hourly_usd": _safe_round_money(bucket["hourly_usd"]),
                    "daily_usd": _safe_round_money(bucket["daily_usd"]),
                }
                for bucket in sorted(
                    by_instance.values(),
                    key=lambda item: item["hourly_usd"],
                    reverse=True,
                )
            ],
            "breakdown_by_nodepool": [
                {
                    **bucket,
                    "hourly_usd": _safe_round_money(bucket["hourly_usd"]),
                    "daily_usd": _safe_round_money(bucket["daily_usd"]),
                }
                for bucket in sorted(
                    by_nodepool.values(),
                    key=lambda item: item["hourly_usd"],
                    reverse=True,
                )
            ],
            "nodes": sorted(node_rows, key=lambda item: (item["hourly_usd"] or 0), reverse=True),
            "warnings": unique_warnings,
        }
    except Exception as e:
        logger.error("get_cost_forecast error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node-history")
async def get_node_history():
    """
    Mimir?먯꽌 ?몃뱶蹂?CPU/Memory 24?쒓컙 ?쒓퀎??議고쉶.
    node-exporter 硫뷀듃由?node_memory_MemAvailable_bytes, node_cpu_seconds_total) ?ъ슜.
    instance ?덉씠釉? ?몃뱶 IP (192.168.0.220~225)
    """
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    step = "10m"  # 24h / 10m = 144 ?ъ씤??

    NODE_MAP = {
        "192.168.0.220": "cp-1",
        "192.168.0.221": "cp-2",
        "192.168.0.222": "cp-3",
        "192.168.0.223": "worker1",
        "192.168.0.224": "worker2",
        "192.168.0.225": "worker3",
    }

    async def _range(query: str) -> dict[str, list]:
        data = await _mimir_query(
            "/api/v1/query_range",
            params={"query": query, "start": start.isoformat(), "end": end.isoformat(), "step": step},
        )
        if not data:
            return {}
        out: dict[str, list] = {}
        for series in data.get("data", {}).get("result", []):
            instance = series["metric"].get("instance", "").split(":")[0]
            name = NODE_MAP.get(instance, instance)
            out[name] = [
                {"t": ts, "v": round(float(val), 1) if val != "NaN" else None}
                for ts, val in series["values"]
            ]
        return out

    # CPU ?ъ슜瑜?%: 100 - (idle %)
    cpu_data = await _range(
        '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
    )
    # Memory ?ъ슜瑜?%: (total - available) / total * 100
    mem_data = await _range(
        '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'
    )

    # ??꾩뒪?ы봽瑜?"HH:mm" ?щ㎎?쇰줈 蹂??(?꾨줎???쒖떆??
    def fmt_series(raw: dict[str, list]) -> dict[str, list]:
        result = {}
        for node, points in raw.items():
            result[node] = [
                {
                    "t": datetime.fromtimestamp(p["t"], tz=timezone.utc).strftime("%m-%d %H:%M"),
                    "v": p["v"],
                }
                for p in points
            ]
        return result

    return {
        "cpu": fmt_series(cpu_data),
        "memory": fmt_series(mem_data),
        "available": bool(cpu_data or mem_data),
    }


# ??? ?곗씠???덉씠??硫뷀듃由?????????????????????????????????????????????????????????

_mongo_io_prev: dict = {}  # {ts: float, opcounters: dict}


@router.get("/data-metrics")
async def get_data_metrics():
    """
    Mimir?먯꽌 Redis/Kafka/ES/Disk 硫뷀듃由?議고쉶 + MongoDB serverStatus 吏곸젒 議고쉶.
    kafka-exporter(9308), redis-exporter(9121)媛 Alloy???섑빐 ?ㅽ겕?⑸맂 ?곗씠??
    """
    now = datetime.now(timezone.utc)
    instant_params = {"time": now.isoformat()}

    query_candidates = {
        "redis_memory_used": ["redis_memory_used_bytes"],
        "redis_memory_max": ["redis_config_maxmemory", "redis_memory_max_bytes"],
        "redis_clients": ["redis_connected_clients"],
        "redis_hits": ["increase(redis_keyspace_hits_total[5m])"],
        "redis_misses": ["increase(redis_keyspace_misses_total[5m])"],
        "kafka_lag": [
            "sum(kafka_consumergroup_lag)",
            "sum(kafka_consumergroup_group_lag)",
            "sum(kafka_consumergroup_lag_sum)",
        ],
        "kafka_throughput": ["sum(rate(kafka_topic_partition_current_offset[5m])) * 60"],
        "es_indexing_rate": ["sum(rate(elasticsearch_indices_indexing_index_total[5m]))"],
        "es_jvm_heap_used": ['sum(elasticsearch_jvm_memory_used_bytes{area="heap"})'],
        "es_jvm_heap_max": ['sum(elasticsearch_jvm_memory_max_bytes{area="heap"})'],
        "disk_read_bps": ["sum(rate(node_disk_read_bytes_total[5m]))"],
        "disk_write_bps": ["sum(rate(node_disk_written_bytes_total[5m]))"],
        "disk_total_bytes": ['sum(node_filesystem_size_bytes{mountpoint="/"})'],
        "disk_avail_bytes": ['sum(node_filesystem_avail_bytes{mountpoint="/"})'],
        "es_search_qps": ["sum(rate(elasticsearch_indices_search_query_total[5m]))"],
        "es_search_time": ["sum(rate(elasticsearch_indices_search_query_time_seconds[5m]))"],
        "es_index_time": ["sum(rate(elasticsearch_indices_indexing_index_time_seconds_total[5m]))"],
        "es_index_total": ["sum(rate(elasticsearch_indices_indexing_index_total[5m]))"],
        "es_thread_rejected": ['sum(increase(elasticsearch_thread_pool_rejected_count{type="write"}[5m]))'],
        "es_store_bytes": [
            "sum(elasticsearch_indices_store_size_bytes_total)",
            "sum(elasticsearch_indices_store_size_bytes)",
        ],
    }

    raw: dict = {}
    for key, candidates in query_candidates.items():
        raw[key] = None
        for query in candidates:
            try:
                data = await _mimir_query(
                    "/api/v1/query",
                    params={"query": query, **instant_params},
                )
                if not data:
                    continue

                results = data.get("data", {}).get("result", [])
                if results:
                    raw[key] = float(results[0]["value"][1])
                    break
            except Exception as e:
                logger.warning("data-metrics Mimir ?ㅽ뙣 [%s]: %s", key, e)

    # Redis hit rate
    hits = raw.get("redis_hits")
    misses = raw.get("redis_misses")
    if hits is not None and misses is not None and (hits + misses) > 0:
        hit_rate = round(hits / (hits + misses) * 100, 1)
    else:
        hit_rate = None

    # 硫붾え由?GB 蹂??
    def to_gb(v): return round(v / 1024 / 1024 / 1024, 2) if v else None
    def to_pct(used, max_v): return round(used / max_v * 100, 1) if used and max_v else None

    # MongoDB serverStatus (ops/sec delta 怨꾩궛)
    global _mongo_io_prev
    mongo_io: dict = {"available": False}
    try:
        db = get_database()
        if db is not None:
            status = await db.command("serverStatus")
            conns = status.get("connections", {})
            lock = status.get("globalLock", {})
            clients = lock.get("activeClients", {})
            queued = lock.get("currentQueue", {})
            ops = status.get("opcounters", {})
            now_ts = time.time()

            ops_read_per_sec = None
            ops_write_per_sec = None
            if _mongo_io_prev:
                elapsed = now_ts - _mongo_io_prev["ts"]
                if elapsed > 0:
                    prev = _mongo_io_prev["ops"]
                    cur_reads = ops.get("query", 0) + ops.get("getmore", 0)
                    prev_reads = prev.get("query", 0) + prev.get("getmore", 0)
                    cur_writes = ops.get("insert", 0) + ops.get("update", 0) + ops.get("delete", 0)
                    prev_writes = prev.get("insert", 0) + prev.get("update", 0) + prev.get("delete", 0)
                    reads = max(0, cur_reads - prev_reads)
                    writes = max(0, cur_writes - prev_writes)
                    ops_read_per_sec = round(reads / elapsed, 1)
                    ops_write_per_sec = round(writes / elapsed, 1)
            _mongo_io_prev = {"ts": now_ts, "ops": dict(ops)}

            mongo_io = {
                "connections": conns.get("current"),
                "active_readers": clients.get("readers"),
                "active_writers": clients.get("writers"),
                "queued_readers": queued.get("readers"),
                "queued_writers": queued.get("writers"),
                "ops_read_per_sec": ops_read_per_sec,
                "ops_write_per_sec": ops_write_per_sec,
                "available": True,
            }
    except Exception as e:
        logger.warning("MongoDB serverStatus 議고쉶 ?ㅽ뙣: %s", e)

    def to_mbps(v): return round(v / 1024 / 1024, 2) if v is not None else None

    # IP ???몃뱶 ?대쫫 留ㅽ븨 (node_uname_info??nodename ?덉씠釉??ъ슜)
    node_name_map: dict[str, str] = {}
    try:
        uname_data = await _mimir_query(
            "/api/v1/query",
            params={"query": "node_uname_info", **instant_params},
        )
        if uname_data:
            for r in uname_data.get("data", {}).get("result", []):
                inst = r["metric"].get("instance", "")
                nodename = r["metric"].get("nodename", "")
                if inst and nodename:
                    node_name_map[inst.rsplit(":", 1)[0]] = nodename
    except Exception as e:
        logger.warning("node_uname_info query failed: %s", e)

    # Per-node disk usage (instance-level queries)
    disk_nodes: list = []
    try:
        size_data = await _mimir_query(
            "/api/v1/query",
            params={"query": 'node_filesystem_size_bytes{mountpoint="/"}', **instant_params},
        )
        avail_data = await _mimir_query(
            "/api/v1/query",
            params={"query": 'node_filesystem_avail_bytes{mountpoint="/"}', **instant_params},
        )
        if size_data and avail_data:
            size_results = size_data.get("data", {}).get("result", [])
            avail_results = avail_data.get("data", {}).get("result", [])
            avail_by_inst = {r["metric"].get("instance", ""): float(r["value"][1]) for r in avail_results}
            for r in size_results:
                inst = r["metric"].get("instance", "")
                total = float(r["value"][1])
                avail = avail_by_inst.get(inst, 0)
                used = total - avail
                hostname = inst.rsplit(":", 1)[0]
                node_name = node_name_map.get(hostname, hostname)
                disk_nodes.append({
                    "hostname": hostname,
                    "node_name": node_name,
                    "total_gb": round(total / 1024**3, 1),
                    "used_gb": round(used / 1024**3, 1),
                    "used_pct": round(used / total * 100, 1) if total > 0 else 0,
                })
            disk_nodes.sort(key=lambda x: x["node_name"])
    except Exception as e:
        logger.warning("Per-node disk query failed: %s", e)

    return {
        "redis": {
            "memory_used_gb":  to_gb(raw.get("redis_memory_used")),
            "memory_max_gb":   to_gb(raw.get("redis_memory_max")),
            "memory_pct":      to_pct(raw.get("redis_memory_used"), raw.get("redis_memory_max")),
            "clients":         int(raw["redis_clients"]) if raw.get("redis_clients") is not None else None,
            "hit_rate_pct":    hit_rate,
            "available":       raw.get("redis_memory_used") is not None,
        },
        "kafka": {
            "consumer_lag": int(raw["kafka_lag"]) if raw.get("kafka_lag") is not None else None,
            "throughput_msg_per_min": (
                round(raw["kafka_throughput"], 1) if raw.get("kafka_throughput") is not None else None
            ),
            "available": raw.get("kafka_lag") is not None,
        },
        "elasticsearch": {
            "indexing_rate":    round(raw["es_indexing_rate"], 2) if raw.get("es_indexing_rate") is not None else None,
            "jvm_heap_used_gb": to_gb(raw.get("es_jvm_heap_used")),
            "jvm_heap_max_gb":  to_gb(raw.get("es_jvm_heap_max")),
            "jvm_heap_pct":     to_pct(raw.get("es_jvm_heap_used"), raw.get("es_jvm_heap_max")),
            "search_qps":       round(raw["es_search_qps"], 3) if raw.get("es_search_qps") is not None else None,
            "search_latency_ms": (
                round(raw["es_search_time"] / raw["es_search_qps"] * 1000, 1)
                if raw.get("es_search_qps") and raw.get("es_search_time")
                else None
            ),
            "index_latency_ms": (
                round(raw["es_index_time"] / raw["es_index_total"] * 1000, 1)
                if raw.get("es_index_total") and raw.get("es_index_time")
                else None
            ),
            "thread_rejected":  int(raw["es_thread_rejected"]) if raw.get("es_thread_rejected") is not None else None,
            "store_gb":         to_gb(raw.get("es_store_bytes")),
            "available":        raw.get("es_jvm_heap_used") is not None,
        },
        "disk": {
            "read_mbps":      to_mbps(raw.get("disk_read_bps")),
            "write_mbps":     to_mbps(raw.get("disk_write_bps")),
            "total_gb":       to_gb(raw.get("disk_total_bytes")),
            "avail_gb":       to_gb(raw.get("disk_avail_bytes")),
            "used_gb":        (
                to_gb(raw["disk_total_bytes"] - raw["disk_avail_bytes"])
                if raw.get("disk_total_bytes") and raw.get("disk_avail_bytes")
                else None
            ),
            "used_pct":       (
                round((raw["disk_total_bytes"] - raw["disk_avail_bytes"]) / raw["disk_total_bytes"] * 100, 1)
                if raw.get("disk_total_bytes") and raw.get("disk_avail_bytes")
                else None
            ),
            "available":      raw.get("disk_read_bps") is not None,
            "nodes":          disk_nodes,
        },
        "mongodb": mongo_io,
    }


# ??? 諛깆뾽 ?곹깭 ???????????????????????????????????????????????????????????????

_BACKUP_CRONJOBS = [
    {"name": "mongodb-backup", "namespace": "tutum-data", "label": "MongoDB"},
    {"name": "elasticsearch-backup", "namespace": "tutum-data", "label": "Elasticsearch"},
    {"name": "etcd-backup", "namespace": "kube-system", "label": "etcd"},
]

_K8S_API = "https://kubernetes.default.svc"
_K8S_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
_K8S_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"


def _k8s_headers() -> dict:
    try:
        with open(_K8S_TOKEN_PATH) as f:
            token = f.read().strip()
        return {"Authorization": f"Bearer {token}"}
    except Exception:
        return {}


async def _k8s_get(path: str) -> dict | None:
    url = f"{_K8S_API}{path}"
    try:
        async with httpx.AsyncClient(verify=_K8S_CA_PATH, timeout=5.0) as client:
            resp = await client.get(url, headers=_k8s_headers())
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning("K8s API 議고쉶 ?ㅽ뙣 [%s]: %s", path, e)
    return None


@router.get("/backup-status")
async def get_backup_status():
    """
    CronJob 諛?理쒓렐 Job 寃곌낵濡?諛깆뾽 ?곹깭 議고쉶.
    """
    results = []
    for cj in _BACKUP_CRONJOBS:
        ns, name = cj["namespace"], cj["name"]
        entry: dict = {
            "name": cj["label"],
            "cronjob": name,
            "namespace": ns,
            "schedule": None,
            "last_run_at": None,
            "last_success_at": None,
            "status": "UNKNOWN",
            "last_error": None,
        }

        cj_data = await _k8s_get(f"/apis/batch/v1/namespaces/{ns}/cronjobs/{name}")
        if cj_data:
            entry["schedule"] = cj_data.get("spec", {}).get("schedule")
            last_sched = cj_data.get("status", {}).get("lastScheduleTime")
            last_succ = cj_data.get("status", {}).get("lastSuccessfulTime")
            if last_sched:
                entry["last_run_at"] = last_sched
            if last_succ:
                entry["last_success_at"] = last_succ

        # 理쒓렐 Job 紐⑸줉 議고쉶 (owner=CronJob)
        jobs_data = await _k8s_get(f"/apis/batch/v1/namespaces/{ns}/jobs")
        if jobs_data:
            owned = [
                j for j in jobs_data.get("items", [])
                if any(
                    ref.get("name") == name and ref.get("kind") == "CronJob"
                    for ref in j.get("metadata", {}).get("ownerReferences", [])
                )
            ]
            owned.sort(
                key=lambda j: j.get("metadata", {}).get("creationTimestamp", ""),
                reverse=True,
            )
            if owned:
                latest = owned[0]
                conds = latest.get("status", {}).get("conditions", [])
                failed_cond = next((c for c in conds if c.get("type") == "Failed"), None)
                succeeded = latest.get("status", {}).get("succeeded", 0)
                if succeeded:
                    entry["status"] = "OK"
                elif failed_cond:
                    entry["status"] = "ERROR"
                    entry["last_error"] = failed_cond.get("message")
                else:
                    entry["status"] = "RUNNING"
            else:
                entry["status"] = "NO_RUN"
        else:
            # jobs API ?ㅽ뙣 ??CronJob ?곹깭留뚯쑝濡??먮떒
            if entry["last_success_at"]:
                entry["status"] = "OK"
            elif entry["last_run_at"]:
                entry["status"] = "WARN"

        results.append(entry)

    return {"backups": results}


# ??? ?댁쁺 寃쎄퀬 ?붿빟 ???????????????????????????????????????????????????????????

@router.get("/action-needed")
async def get_action_needed():
    """
    ?꾧퀎移?湲곕컲 利됱떆 議곗튂 ?꾩슂 ??ぉ 紐⑸줉.
    data-metrics + backup-status瑜?吏묎퀎??寃쎄퀬 ?앹꽦.
    """
    alerts = []

    # data-metrics ?몄텧
    try:
        metrics = await get_data_metrics()

        disk = metrics.get("disk", {})
        used_pct = disk.get("used_pct")
        if used_pct is not None:
            if used_pct >= 85:
                alerts.append({
                    "level": "CRITICAL",
                    "category": "Disk",
                    "message": f"?대윭?ㅽ꽣 ?붿뒪???ъ슜瑜?{used_pct}% (?꾧퀎移? 85%)",
                    "action": "遺덊븘?뷀븳 ?곗씠???뺣━ ?먮뒗 蹂쇰ⅷ ?뺤옣",
                })
            elif used_pct >= 70:
                alerts.append({
                    "level": "WARN",
                    "category": "Disk",
                    "message": f"?대윭?ㅽ꽣 ?붿뒪???ъ슜瑜?{used_pct}% (?꾧퀎移? 70%)",
                    "action": "?붿뒪???ъ슜??異붿씠 紐⑤땲?곕쭅",
                })

        es = metrics.get("elasticsearch", {})
        jvm_pct = es.get("jvm_heap_pct")
        if jvm_pct is not None and jvm_pct >= 80:
            alerts.append({
                "level": "CRITICAL" if jvm_pct >= 90 else "WARN",
                "category": "Elasticsearch",
                "message": f"ES JVM Heap {jvm_pct}% (?꾧퀎移? 80%)",
                "action": "ES ??硫붾え由?利앹꽕 ?먮뒗 ?몃뜳???뺣━",
            })
        thread_rej = es.get("thread_rejected")
        if thread_rej and thread_rej > 0:
            alerts.append({
                "level": "WARN",
                "category": "Elasticsearch",
                "message": f"ES write thread pool rejected {thread_rej}嫄?(5m)",
                "action": "ES ?몃뜳???띾룄 議곗젅 ?먮뒗 replicas ?뺤옣",
            })

        kafka = metrics.get("kafka", {})
        lag = kafka.get("consumer_lag")
        if lag is not None and lag > 500:
            alerts.append({
                "level": "CRITICAL" if lag > 5000 else "WARN",
                "category": "Kafka",
                "message": f"Kafka consumer lag {lag:,}嫄?,
                "action": "elastic-consumer 濡쒓렇 ?뺤씤 諛?replicas 利앹꽕",
            })

        mongo = metrics.get("mongodb", {})
        qr = mongo.get("queued_readers") or 0
        qw = mongo.get("queued_writers") or 0
        if qr + qw > 10:
            alerts.append({
                "level": "WARN",
                "category": "MongoDB",
                "message": f"MongoDB ?湲?荑쇰━ {qr + qw}嫄?(readers={qr}, writers={qw})",
                "action": "?먮┛ 荑쇰━ ?뺤씤: db.currentOp()",
            })
    except Exception as e:
        logger.warning("action-needed metrics 議고쉶 ?ㅽ뙣: %s", e)

    # backup-status ?몄텧
    try:
        backup = await get_backup_status()
        for b in backup.get("backups", []):
            if b["status"] == "ERROR":
                alerts.append({
                    "level": "CRITICAL",
                    "category": "Backup",
                    "message": f"{b['name']} 諛깆뾽 ?ㅽ뙣: {b.get('last_error', '?????놁쓬')}",
                    "action": f"kubectl logs -n {b['namespace']} -l job-name=... ?뺤씤",
                })
            elif b["status"] == "NO_RUN":
                alerts.append({
                    "level": "WARN",
                    "category": "Backup",
                    "message": f"{b['name']} 諛깆뾽???꾩쭅 ??踰덈룄 ?ㅽ뻾?섏? ?딆쓬",
                    "action": "CronJob ?ㅼ?以?諛?沅뚰븳 ?뺤씤",
                })
    except Exception as e:
        logger.warning("action-needed backup 議고쉶 ?ㅽ뙣: %s", e)

    alerts.sort(key=lambda a: 0 if a["level"] == "CRITICAL" else 1)
    return {"alerts": alerts, "count": len(alerts)}


# ??? ?몃젅?댁뒪 (Tempo) ?????????????????????????????????????????????????????????

TEMPO_URL = os.getenv("TEMPO_URL", "http://192.168.0.230:3200")
GRAFANA_URL = os.getenv("GRAFANA_URL", "http://192.168.0.230:3000")


@router.get("/traces")
async def get_traces(limit: int = 20, min_duration_ms: int = 50):
    """
    Tempo?먯꽌 ?몃젅?댁뒪 議고쉶.
    - traces: ?먮┛ ?붿껌 (>= min_duration_ms)
    - error_traces: 5xx ?먮윭媛 諛쒖깮???몃젅?댁뒪
    """
    end_s = int(datetime.now(timezone.utc).timestamp())
    start_s = end_s - 3600  # 1?쒓컙

    def _grafana_url(trace_id: str) -> str:
        return (
            f"{GRAFANA_URL}/explore?datasource=tempo&left="
            "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"tempo\"},"
            f"\"queryType\":\"traceql\",\"query\":\"{trace_id}\",\"tableType\":\"traces\"}}]}}"
        )

    def _format(t: dict, is_error: bool = False) -> dict:
        duration_ms = round(int(t.get("durationMs", 0)))
        start_time_ms = int(t.get("startTimeUnixNano", 0)) // 1_000_000
        trace_id = t.get("traceID", "")
        # rootTraceName ?? "GET /api/v1/news" ??寃쎈줈/硫붿꽌??遺꾨━
        root_name = t.get("rootTraceName", "-")
        return {
            "traceID":         trace_id,
            "rootServiceName": t.get("rootServiceName", "tutum-backend"),
            "rootTraceName":   root_name,
            "durationMs":      duration_ms,
            "startTimeMs":     start_time_ms,
            "isError":         is_error,
            "grafana_url":     _grafana_url(trace_id),
        }

    async def _search(params: dict) -> list[dict]:
        try:
            resp = await _HTTP_MISC.get(f"{TEMPO_URL}/api/search", params=params)
            if resp.status_code != 200:
                return []
            return resp.json().get("traces", [])
        except Exception:
            return []

    base_params = {"service.name": "tutum-backend", "start": start_s, "end": end_s}

    # ?먮┛ ?붿껌 ?몃젅?댁뒪 (>= min_duration_ms)
    slow_raw = await _search({**base_params, "limit": limit, "minDuration": f"{min_duration_ms}ms"})
    # 5xx ?먮윭 ?몃젅?댁뒪 ??TraceQL ?ъ슜
    error_raw = await _search({**base_params, "q": '{span.http.status_code >= 500}', "limit": 10})
    # 4xx ?대씪?댁뼵???먮윭 ?몃젅?댁뒪
    client_error_raw = await _search({
        **base_params,
        "q": '{span.http.status_code >= 400 && span.http.status_code < 500}',
        "limit": 5,
    })

    error_ids = {t.get("traceID") for t in error_raw}

    traces = sorted(
        [_format(t, is_error=t.get("traceID") in error_ids) for t in slow_raw],
        key=lambda x: x["durationMs"], reverse=True,
    )
    error_traces = [_format(t, is_error=True) for t in error_raw]
    error_traces.sort(key=lambda x: x["startTimeMs"], reverse=True)

    client_error_traces = [_format(t, is_error=False) for t in client_error_raw
                           if t.get("traceID") not in error_ids]
    client_error_traces.sort(key=lambda x: x["startTimeMs"], reverse=True)

    return {
        "traces":             traces,
        "error_traces":       error_traces,       # 5xx ???쒕쾭 ?먮윭
        "client_error_traces": client_error_traces,  # 4xx ???대씪?댁뼵???먮윭
        "available":          True,
    }

