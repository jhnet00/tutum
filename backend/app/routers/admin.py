"""
============================================
Admin Router - 클러스터 모니터링 API
============================================

K8s 노드/파드 상태와 Mimir 메트릭을 조회해
Admin 대시보드에 실시간 데이터를 제공합니다.

데이터 소스:
  - K8s API Server: in-cluster ServiceAccount (nodes, pods)
  - Mimir: http://10.60.11.95:9009/prometheus (메트릭)
  - Loki:  http://10.60.11.95:3100 (로그)
"""

import asyncio
import json
import logging
import math
import os
import re
import time
from ipaddress import ip_address, ip_network
from datetime import datetime, timezone, timedelta

import boto3
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, Request

from ..config import get_settings
from ..database import get_database, get_news_collection
from ..middleware.rate_limit import check_rate_limit
from .auth import AuthIdentity, get_current_identity

logger = logging.getLogger(__name__)
settings = get_settings()

MIMIR_URL = os.getenv("MIMIR_URL", "http://10.60.11.95:9009/prometheus")
LOKI_URL = os.getenv("LOKI_URL", "http://10.60.11.95:3100")
_ADMIN_MONGO_CLIENT: AsyncIOMotorClient | None = None

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
    current_user: AuthIdentity = Depends(get_current_identity),
) -> AuthIdentity:
    # Enforce admin access by source IP range.
    client_ip = _extract_client_ip(request)
    if not _is_ip_allowed(client_ip):
        raise HTTPException(
            status_code=403,
            detail="Admin access denied for this network.",
        )
    return current_user


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin_access)])

# Shared HTTP clients — reused across requests for connection pooling
# X-Scope-OrgID: Mimir/Loki multi-tenancy 필수 헤더 (tenant=tutum)
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

# ─── Bedrock client (lazy init) ───────────────────────────────────────────────

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


# ─── K8s client (lazy init) ──────────────────────────────────────────────────

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


# ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _pod_downtime_sec(container_statuses) -> int:
    """마지막 재시작 시 다운되어 있었던 시간(초). 재시작 이력 없으면 0."""
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


def _cpu_usage_to_nano(raw: str) -> int:
    raw = (raw or "").strip()
    if not raw:
        return 0
    if raw.endswith("n"):
        return int(float(raw[:-1] or 0))
    if raw.endswith("u"):
        return int(float(raw[:-1]) * 1_000)
    if raw.endswith("m"):
        return int(float(raw[:-1]) * 1_000_000)
    return int(float(raw) * 1_000_000_000)


def _cpu_capacity_to_millicores(raw: str) -> int:
    raw = (raw or "").strip()
    if not raw:
        return 0
    if raw.endswith("n"):
        return int(float(raw[:-1]) / 1_000_000)
    if raw.endswith("u"):
        return int(float(raw[:-1]) / 1_000)
    if raw.endswith("m"):
        return int(float(raw[:-1]))
    return int(float(raw) * 1000)


def _memory_quantity_to_ki(raw: str) -> int:
    raw = (raw or "").strip()
    if not raw:
        return 0

    binary_units = {
        "Ki": 1,
        "Mi": 1024,
        "Gi": 1024 ** 2,
        "Ti": 1024 ** 3,
        "Pi": 1024 ** 4,
        "Ei": 1024 ** 5,
    }
    decimal_units = {
        "K": 1000 / 1024,
        "M": 1000 ** 2 / 1024,
        "G": 1000 ** 3 / 1024,
        "T": 1000 ** 4 / 1024,
        "P": 1000 ** 5 / 1024,
        "E": 1000 ** 6 / 1024,
    }

    for suffix, multiplier in binary_units.items():
        if raw.endswith(suffix):
            return int(float(raw[:-len(suffix)] or 0) * multiplier)

    for suffix, multiplier in decimal_units.items():
        if raw.endswith(suffix):
            return int(float(raw[:-len(suffix)] or 0) * multiplier)

    return int(float(raw) / 1024)


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


_GRAFANA_URL = os.getenv("GRAFANA_URL", "http://10.60.11.95:3000")
_TRACE_ID_PATTERNS = (
    re.compile(r"\btrace[_ ]?id[=:](?P<trace>[0-9a-f]{16,32})\b", re.IGNORECASE),
    re.compile(r"\btraceID[=:](?P<trace>[0-9a-f]{16,32})\b", re.IGNORECASE),
)
_REQUEST_LOG_RE = re.compile(
    r"\brequest_(?:complete|failed)\s+method=(?P<method>[A-Z]+)\s+path=(?P<path>\S+)\s+status=(?P<status>\d{3})\b"
)
_UVICORN_ACCESS_RE = re.compile(
    r'"(?P<method>[A-Z]+)\s+(?P<path>\S+)\s+HTTP/[^"]+"\s+(?P<status>\d{3})\b'
)
_CRITICAL_LOG_PATTERNS = (
    "traceback",
    "exception",
    "panic",
    "crashloop",
    "service unavailable",
    "connection refused",
    "timed out",
    "timeout",
    "not_ready",
    "not ready",
    "db error",
    "database error",
)
_WARN_LOG_PATTERNS = (
    "too_many_requests",
    "rate limit",
    "retry",
    "temporarily unavailable",
    "method not allowed",
    "forbidden",
)
_LOW_SIGNAL_STATUS_CODES = {400, 401, 403, 404, 405, 422}
_WARN_STATUS_CODES = {408, 409, 425, 429}
_SEVERITY_ORDER = {"CRITICAL": 3, "WARN": 2, "INFO": 1}


def _grafana_trace_url(trace_id: str) -> str:
    return (
        f"{_GRAFANA_URL}/explore?datasource=tempo&left="
        "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"tempo\"},"
        f"\"queryType\":\"traceql\",\"query\":\"{trace_id}\",\"tableType\":\"traces\"}}]}}"
    )


def _extract_trace_id(message: str) -> str | None:
    for pattern in _TRACE_ID_PATTERNS:
        match = pattern.search(message)
        if match:
            return match.group("trace").lower()
    return None


def _extract_request_context(message: str) -> tuple[str | None, int | None, str | None, str]:
    custom_match = _REQUEST_LOG_RE.search(message)
    if custom_match:
        return (
            custom_match.group("path"),
            int(custom_match.group("status")),
            custom_match.group("method"),
            "request",
        )

    access_match = _UVICORN_ACCESS_RE.search(message)
    if access_match:
        return (
            access_match.group("path"),
            int(access_match.group("status")),
            access_match.group("method"),
            "access",
        )

    return None, None, None, "application"


def _classify_log_severity(
    level: str,
    message: str,
    status_code: int | None = None,
    path: str | None = None,
) -> str:
    normalized_level = (level or "INFO").upper()
    text = (message or "").lower()

    if status_code is not None:
        if status_code >= 500:
            return "CRITICAL"
        if status_code in _WARN_STATUS_CODES:
            return "WARN"
        if status_code >= 400:
            return "INFO" if status_code in _LOW_SIGNAL_STATUS_CODES else "WARN"

    if any(pattern in text for pattern in _CRITICAL_LOG_PATTERNS):
        return "CRITICAL"

    if normalized_level == "ERROR":
        if any(pattern in text for pattern in _WARN_LOG_PATTERNS):
            return "WARN"
        return "CRITICAL"

    if normalized_level in {"WARN", "WARNING"}:
        return "WARN"

    if any(pattern in text for pattern in _WARN_LOG_PATTERNS):
        return "WARN"

    if path in {"/health", "/api/health", "/metrics", "/ready"}:
        return "INFO"

    return "INFO"


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/nodes")
async def get_nodes():
    """
    K8s 노드 목록과 CPU/Memory 사용률 반환.
    metrics-server가 배포돼 있어야 사용량 데이터가 제공됩니다.
    """
    try:
        core, metrics_api = _get_k8s_clients()
        nodes = core.list_node(_request_timeout=10).items

        # metrics-server에서 노드 사용량 조회
        usage_map = {}
        try:
            raw = metrics_api.list_cluster_custom_object(
                group="metrics.k8s.io", version="v1beta1", plural="nodes"
            )
            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                cpu_nano = _cpu_usage_to_nano(item["usage"]["cpu"])
                mem_ki = _memory_quantity_to_ki(item["usage"]["memory"])
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception as e:
            logger.warning("metrics-server 조회 실패: %s", e)

        result = []
        for node in nodes:
            name = node.metadata.name
            # 노드 allocatable 정보
            alloc = node.status.allocatable or {}
            cpu_alloc_str = alloc.get("cpu", "0")
            mem_alloc_str = alloc.get("memory", "0Ki")

            cpu_alloc_m = _cpu_capacity_to_millicores(cpu_alloc_str)
            mem_alloc_ki = _memory_quantity_to_ki(mem_alloc_str)

            cpu_pct = 0
            mem_pct = 0
            if name in usage_map:
                u = usage_map[name]
                cpu_pct = round(u["cpu_nano"] / 1_000_000 / cpu_alloc_m * 100) if cpu_alloc_m else 0
                mem_pct = round(u["mem_ki"] / mem_alloc_ki * 100) if mem_alloc_ki else 0

            # 내부 IP
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
        logger.error("get_nodes 오류: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pods")
async def get_pods(namespace: str = "all"):
    """
    파드 목록 반환. namespace='all'이면 전체 네임스페이스 조회.
    tutum-app, tutum-data, monitoring 등 주요 ns만 포함.
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

            # 파드 상태
            phase = pod.status.phase or "Unknown"
            # CrashLoopBackOff 등 세부 상태
            container_statuses = pod.status.container_statuses or []
            waiting_reason = None
            for cs in container_statuses:
                if cs.state and cs.state.waiting:
                    waiting_reason = cs.state.waiting.reason
                    break
            display_status = waiting_reason if waiting_reason else phase

            # Ready 컨테이너 수
            ready_count = sum(1 for cs in container_statuses if cs.ready)
            total_count = len(container_statuses)

            # 기동 시각 (ISO)
            start_ts = pod.status.start_time or pod.metadata.creation_timestamp
            start_time = start_ts.isoformat() if start_ts else "-"

            # 다운타임 (초): 마지막 재시작 전 죽어있던 시간
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
        logger.error("get_pods 오류: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/metrics")
async def get_metrics():
    """최근 1시간 KPI 메트릭을 Mimir에서 조회한다."""
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
            # or on() vector(0): 5xx 요청이 없을 때 빈 벡터 대신 0 반환 → N/A 방지
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
        """handler 레이블별 벡터 결과를 반환한다 (엔드포인트별 에러 집계용)."""
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

    # 엔드포인트별 5xx 에러 Top 5 (지난 1시간)
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
    Loki에서 실시간 로그 조회 + 최근 1시간 에러 이력 요약.
    namespace: "tutum-app" | "tutum-data" | "all"
    """
    ns_pattern = "(tutum-app|tutum-data)" if namespace == "all" else namespace
    base_selector = f'{{job="loki.source.kubernetes.pods", namespace=~"{ns_pattern}"}}'
    log_query = base_selector  # 실시간 스트림 (최근 10분)
    error_query = f'{base_selector} |= "ERROR"'  # 에러 이력 (최근 1시간)

    end_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)

    def _parse_streams(result: list, default_level: str = "INFO") -> list[dict]:
        """Loki query_range result → log entry list."""
        logs = []
        for stream in result:
            labels = stream["stream"]
            level = labels.get("level", labels.get("detected_level", default_level)).upper()
            # Alloy loki.source.kubernetes 레이블: namespace, pod 직접 사용
            ns_name = labels.get("namespace", "")
            pod_name = labels.get("pod", labels.get("instance", ""))
            for ts_ns, msg in stream.get("values", []):
                ts = datetime.fromtimestamp(int(ts_ns) / 1_000_000_000, tz=timezone.utc)
                msg_text = msg.rstrip("\n")
                path, status_code, method, source_kind = _extract_request_context(msg_text)
                trace_id = _extract_trace_id(msg_text)
                logs.append({
                    "time":      ts.strftime("%H:%M:%S"),
                    "timestamp": int(ts_ns),
                    "level":     level if level in ("INFO", "WARN", "WARNING", "ERROR", "DEBUG") else "INFO",
                    "namespace": ns_name,
                    "pod":       pod_name,
                    "msg":       msg_text,
                    "severity":  _classify_log_severity(level, msg_text, status_code, path),
                    "trace_id":  trace_id,
                    "trace_url": _grafana_trace_url(trace_id) if trace_id else None,
                    "status_code": status_code,
                    "path": path,
                    "method": method,
                    "source_kind": source_kind,
                })
        return logs

    try:
        # 1) 실시간 스트림 — 최근 10분
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

        # 실시간 로그 파싱
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

        severity_counts = {"critical": 0, "warn": 0, "info": 0, "trace_linked": 0}
        for log in unique[:limit]:
            severity = log.get("severity", "INFO")
            if severity == "CRITICAL":
                severity_counts["critical"] += 1
            elif severity == "WARN":
                severity_counts["warn"] += 1
            else:
                severity_counts["info"] += 1
            if log.get("trace_id"):
                severity_counts["trace_linked"] += 1

        # 에러 이력 집계 (1시간, pod별 ERROR 건수 + 마지막 발생)
        error_summary: list[dict] = []
        if not isinstance(error_resp, Exception) and error_resp.json().get("status") == "success":
            err_logs = _parse_streams(error_resp.json()["data"]["result"], default_level="ERROR")
            # pod별 집계
            pod_stat: dict[str, dict] = {}
            for e in err_logs:
                pod = e["pod"]
                if pod not in pod_stat:
                    pod_stat[pod] = {
                        "count": 0, "last_time": e["time"],
                        "last_msg": e["msg"][:80], "namespace": e["namespace"],
                        "critical_count": 0, "warn_count": 0, "info_count": 0,
                        "traceable_count": 0, "top_severity": "INFO",
                    }
                pod_stat[pod]["count"] += 1
                severity = e.get("severity", "INFO")
                if severity == "CRITICAL":
                    pod_stat[pod]["critical_count"] += 1
                elif severity == "WARN":
                    pod_stat[pod]["warn_count"] += 1
                else:
                    pod_stat[pod]["info_count"] += 1
                if e.get("trace_id"):
                    pod_stat[pod]["traceable_count"] += 1
                if _SEVERITY_ORDER[severity] > _SEVERITY_ORDER[pod_stat[pod]["top_severity"]]:
                    pod_stat[pod]["top_severity"] = severity
            error_summary = sorted(
                [{"pod": k, **v} for k, v in pod_stat.items()],
                key=lambda x: (-x["critical_count"], -x["count"]),
            )

        return {
            "logs": unique[:limit],
            "error_summary": error_summary,
            "severity_counts": severity_counts,
        }

    except Exception as e:
        logger.error("get_logs Loki 오류: %s", e)
        return {
            "logs": [],
            "error_summary": [],
            "severity_counts": {"critical": 0, "warn": 0, "info": 0, "trace_linked": 0},
        }


# ─── AI 진단 ───────────────────────────────────────────────────────────────────

_DIAGNOSE_SYSTEM_PROMPT = """당신은 Kubernetes 클러스터 운영 전문가 AI입니다.
주어진 클러스터 상태 데이터를 분석하여 다음 JSON 형식으로만 응답하세요.
다른 텍스트나 마크다운 없이 순수 JSON만 반환하세요.

{
  "severity": "OK" | "WARN" | "CRITICAL",
  "summary": "한 줄 전체 요약 (한국어, 50자 이내)",
  "issues": [
    {"level": "WARN" | "ERROR", "title": "이슈 제목", "detail": "상세 설명"}
  ],
  "recommendations": [
    {"priority": "HIGH" | "MEDIUM" | "LOW", "action": "권장 조치 (한국어)"}
  ]
}

severity 기준:
- OK: 모든 파드 정상, 재시작 없음, 리소스 여유
- WARN: 일부 파드 이슈 or 재시작 있음 or 리소스 70% 이상
- CRITICAL: CrashLoopBackOff or 다수 파드 비정상 or 노드 NotReady"""


@router.get("/diagnose")
async def get_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """
    현재 클러스터 상태를 Bedrock Claude로 AI 진단.
    nodes + pods 데이터를 수집해 이슈/권장조치를 JSON으로 반환.
    """
    # 1. 클러스터 현재 상태 수집
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        core, metrics_api = _get_k8s_clients()

        # 노드 수집
        nodes_raw = core.list_node(_request_timeout=10).items
        usage_map = {}
        try:
            raw = metrics_api.list_cluster_custom_object(
                group="metrics.k8s.io", version="v1beta1", plural="nodes"
            )
            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                cpu_nano = _cpu_usage_to_nano(item["usage"]["cpu"])
                mem_ki = _memory_quantity_to_ki(item["usage"]["memory"])
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception:
            pass

        node_lines = []
        for node in nodes_raw:
            name = node.metadata.name
            alloc = node.status.allocatable or {}
            cpu_str = alloc.get("cpu", "0")
            mem_str = alloc.get("memory", "0Ki")
            cpu_m = _cpu_capacity_to_millicores(cpu_str)
            mem_ki = _memory_quantity_to_ki(mem_str)

            cpu_pct = mem_pct = 0
            if name in usage_map:
                u = usage_map[name]
                cpu_pct = round(u["cpu_nano"] / 1_000_000 / cpu_m * 100) if cpu_m else 0
                mem_pct = round(u["mem_ki"] / mem_ki * 100) if mem_ki else 0

            status = _node_status(node)
            role = _node_role(node)
            node_lines.append(f"  - {name} ({role}): {status}, CPU {cpu_pct}%, MEM {mem_pct}%")

        # 파드 수집
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
        logger.error("diagnose 데이터 수집 오류: %s", e)
        raise HTTPException(status_code=500, detail=f"클러스터 데이터 수집 실패: {e}")

    # 2. 프롬프트 구성
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = f"""클러스터 진단 요청 ({now_str})

[노드 상태 ({len(nodes_raw)}개)]
{chr(10).join(node_lines)}

[파드 상태 ({len(pod_lines)}개)]
{chr(10).join(pod_lines)}

[요약]
- 전체 파드: {len(pod_lines)}개
- 문제 파드: {len(problem_pods)}개
{chr(10).join(problem_pods) if problem_pods else "  (없음)"}

위 데이터를 분석하여 지정된 JSON 형식으로 진단 결과를 반환하세요."""

    # 3. Bedrock 호출
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

        # JSON 파싱 (코드블록 감싸져 있을 경우 제거)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        diagnosis = await _parse_model_json(text)

    except Exception as e:
        logger.error("Bedrock 진단 호출 오류: %s", e)
        raise HTTPException(status_code=503, detail=f"AI 진단 서비스 오류: {e}")

    return {
        "diagnosis": diagnosis,
        "context": {
            "node_count": len(nodes_raw),
            "pod_count": len(pod_lines),
            "problem_count": len(problem_pods),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── 파이프라인 모니터링 ────────────────────────────────────────────────────────

_NEWS_WORKERS = ["news-producer", "news-consumer", "elastic-consumer"]
_PRICE_WORKERS = ["price-producer", "price-consumer"]
_OTHER_WORKERS = ["email-worker", "ocr-worker"]
_ALL_WORKERS = _NEWS_WORKERS + _PRICE_WORKERS + _OTHER_WORKERS

# 하위 호환성용 (pipeline-diagnose 프롬프트 등)
_PIPELINE_WORKERS = _ALL_WORKERS


async def _count_distinct_indexable_news(news_col) -> int:
    """Count Mongo news by business key(url/link), not by raw document rows."""
    rows = await news_col.aggregate([
        {
            "$match": {
                "title": {"$exists": True, "$type": "string", "$ne": ""},
                "$or": [
                    {"content": {"$exists": True, "$type": "string", "$ne": ""}},
                    {"body": {"$exists": True, "$type": "string", "$ne": ""}},
                ],
            }
        },
        {"$project": {"key": {"$ifNull": ["$url", "$link"]}}},
        {"$match": {"key": {"$exists": True, "$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$key"}},
        {"$count": "count"},
    ]).to_list(length=1)
    return int(rows[0]["count"]) if rows else 0


def _get_admin_news_collection():
    news_col = get_news_collection()
    if news_col is not None:
        return news_col

    db = get_database()
    if db is not None:
        return db["news"]

    global _ADMIN_MONGO_CLIENT
    if _ADMIN_MONGO_CLIENT is None:
        _ADMIN_MONGO_CLIENT = AsyncIOMotorClient(
            settings.MONGODB_URL,
            serverSelectionTimeoutMS=2000,
        )
    return _ADMIN_MONGO_CLIENT[settings.MONGODB_DB_NAME]["news"]


async def _count_recent_distinct_news(news_col, since: datetime) -> int:
    """Count distinct business keys recently ingested into MongoDB."""
    rows = await news_col.aggregate([
        {
            "$match": {
                "title": {"$exists": True, "$type": "string", "$ne": ""},
                "$or": [
                    {"content": {"$exists": True, "$type": "string", "$ne": ""}},
                    {"body": {"$exists": True, "$type": "string", "$ne": ""}},
                ],
            }
        },
        {
            "$addFields": {
                "_recent_key": {"$ifNull": ["$url", "$link"]},
                "_recent_ts": {"$toDate": {"$ifNull": ["$ingested_at", "$created_at"]}},
            }
        },
        {
            "$match": {
                "_recent_key": {"$exists": True, "$type": "string", "$ne": ""},
                "_recent_ts": {"$gte": since},
            }
        },
        {"$group": {"_id": "$_recent_key"}},
        {"$count": "count"},
    ]).to_list(length=1)
    return int(rows[0]["count"]) if rows else 0


async def _count_distinct_es_news_urls(es_url: str) -> int | None:
    """Count Elasticsearch docs by distinct business key(url)."""
    try:
        resp = await _HTTP_MISC.post(
            f"{es_url}/news/_search?size=0",
            json={
                "aggs": {
                    "distinct_urls": {
                        "cardinality": {"field": "url", "precision_threshold": 40000}
                    }
                }
            },
        )
        if resp.status_code == 200:
            return int(resp.json().get("aggregations", {}).get("distinct_urls", {}).get("value", 0))
    except Exception:
        return None
    return None


async def _collect_pipeline_data() -> dict:
    """파이프라인 전체 워커 상태 수집 (pipeline / pipeline-diagnose 공용)."""
    out: dict = {
        "workers": {
            w: {"status": "Unknown", "start_time": "-", "downtime_sec": 0, "running": False}
            for w in _ALL_WORKERS
        },
        "mongodb": {"news_total": 0, "news_last_1h": 0, "available": False},
        "elasticsearch": {"news_docs": 0, "available": False},
        "recent_logs": {w: [] for w in _ALL_WORKERS},
    }

    # 1. Worker 파드 상태 (K8s)
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
        logger.warning("pipeline K8s 조회 실패: %s", e)

    # 2. MongoDB news count
    try:
        news_col = _get_admin_news_collection()
        if news_col is not None:
            total = await _count_distinct_indexable_news(news_col)
            one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
            recent = await _count_recent_distinct_news(news_col, one_hour_ago)
            out["mongodb"] = {"news_total": total, "news_last_1h": recent, "available": True}
    except Exception as e:
        logger.warning("pipeline MongoDB 조회 실패: %s", e)

    # 3. Elasticsearch document count
    es_url = os.getenv("ELASTICSEARCH_URL", "http://elasticsearch.tutum-data.svc.cluster.local:9200")
    try:
        distinct_count = await _count_distinct_es_news_urls(es_url)
        if distinct_count is not None:
            out["elasticsearch"] = {"news_docs": distinct_count, "available": True}
        else:
            resp = await _HTTP_MISC.get(f"{es_url}/news/_count")
            if resp.status_code == 200:
                out["elasticsearch"] = {"news_docs": resp.json().get("count", 0), "available": True}
    except Exception as e:
        logger.warning("pipeline ES 조회 실패: %s", e)

    # 4. Loki 최근 로그 샘플 (최근 5분)
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
        logger.warning("pipeline Loki 샘플 실패: %s", e)

    return out


@router.get("/pipeline")
async def get_pipeline():
    """파이프라인 3대 구성요소 실시간 상태 (Worker 파드/MongoDB/ES/Loki 샘플)."""
    return await _collect_pipeline_data()


_PIPELINE_SYSTEM_PROMPT = """당신은 데이터 파이프라인 운영 전문가 AI입니다.
파이프라인 구성요소들을 분석하여 다음 JSON 형식으로만 응답하세요.
다른 텍스트나 마크다운 없이 순수 JSON만 반환하세요.

{
  "overall": "OK" | "WARN" | "CRITICAL",
  "components": [
    {
      "name": "news-producer",
      "label": "뉴스 수집",
      "status": "OK" | "WARN" | "ERROR",
      "summary": "한 줄 요약 (20자 이내)",
      "issues": [{"title": "이슈 제목", "detail": "상세 설명"}],
      "actions": [{"priority": "HIGH" | "MEDIUM" | "LOW", "action": "권장 조치"}]
    }
  ]
}

status 기준:
- OK: 파드 Running, 처리 정상
- WARN: 재시작 있음, 처리 지연, 일시 중지/중단 상태
- ERROR: 파드 없음, CrashLoop, 오류 지속
워커 그룹: 뉴스(news-producer/consumer/elastic-consumer), 시세(price-producer/consumer), 기타(email-worker/ocr-worker)
중요: 각 워커의 입력 데이터와 실제 상태를 기반으로 판단하세요."""


_JSON_REPAIR_SYSTEM_PROMPT = """You fix malformed JSON emitted by another model.
Return valid JSON only.
Do not add markdown fences, explanations, or extra keys.
Preserve the original schema and values as closely as possible."""


def _extract_json_text(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```")
        if len(parts) > 1:
            cleaned = parts[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end >= start:
        cleaned = cleaned[start:end + 1]

    return cleaned.strip()


async def _invoke_bedrock_text(system_prompt: str, prompt: str, max_tokens: int = 1024) -> str:
    bedrock = _get_bedrock_client()
    model_id = os.getenv("BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": 0.1,
        "system": system_prompt,
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
    return raw_body["content"][0]["text"].strip()


async def _parse_model_json(text: str) -> dict:
    candidate = _extract_json_text(text)
    last_error: Exception | None = None

    for strict in (True, False):
        try:
            return json.loads(candidate, strict=strict)
        except json.JSONDecodeError as exc:
            last_error = exc

    repair_prompt = (
        "Convert the following malformed JSON-like text into valid JSON.\n"
        "Return JSON only.\n\n"
        f"{candidate[:12000]}"
    )
    repaired = await _invoke_bedrock_text(
        _JSON_REPAIR_SYSTEM_PROMPT,
        repair_prompt,
        max_tokens=1800,
    )
    repaired_candidate = _extract_json_text(repaired)

    for strict in (True, False):
        try:
            return json.loads(repaired_candidate, strict=strict)
        except json.JSONDecodeError as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise json.JSONDecodeError("Failed to parse model JSON", candidate, 0)


@router.get("/pipeline-diagnose")
async def get_pipeline_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """파이프라인 3대 구성요소를 Bedrock Claude로 AI 분석."""
    # 1. 데이터 수집
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        data = await _collect_pipeline_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파이프라인 데이터 수집 실패: {e}")

    # 2. 프롬프트 구성
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

    lines = [f"파이프라인 진단 요청 ({now_str})", ""]
    for w in _PIPELINE_WORKERS:
        wd = data["workers"].get(w, {})
        lines.append(f"[{WORKER_KR[w]}] ({w})")
        status_str = wd.get('status', 'Unknown')
        restarts_str = wd.get('restarts', 0)
        running_str = wd.get('running', False)
        lines.append(f"  상태: {status_str}, 재시작: {restarts_str}회, Running: {running_str}")
        recent = data["recent_logs"].get(w, [])
        if recent:
            lines.append(f"  최근 로그: {recent[0][:80]}")
        lines.append("")

    elastic = data["workers"].get("elastic-consumer", {})
    elastic_status = elastic.get("status", "Unknown")
    elastic_running = bool(elastic.get("running", False))
    if elastic_running:
        elastic_note = "참고: elastic-consumer는 현재 실행 중입니다. 비활성으로 가정하지 말고 실제 인덱싱 상태를 평가하세요."
    elif elastic_status == "Stopped":
        elastic_note = "참고: elastic-consumer 파드가 관찰되지 않습니다(중지 상태)."
    else:
        elastic_note = f"참고: elastic-consumer 상태는 {elastic_status} 입니다."

    lines += [
        "[데이터 현황]",
        f"  MongoDB news 전체: {data['mongodb'].get('news_total', 'N/A')}건",
        f"  MongoDB 최근 1시간 추가: {data['mongodb'].get('news_last_1h', 'N/A')}건",
        f"  ES 인덱스 문서: {data['elasticsearch'].get('news_docs', 'N/A')}건",
        "",
        elastic_note,
        "위 데이터를 기반으로 3개 구성요소 각각의 분석을 JSON으로 반환하세요.",
    ]
    prompt = "\n".join(lines)

    # 3. Bedrock 호출
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
        result = await _parse_model_json(text)

    except Exception as e:
        logger.error("pipeline-diagnose Bedrock 오류: %s", e)
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


# ─── AI 진단 공통 헬퍼 ─────────────────────────────────────────────────────────

async def _call_bedrock_standard(prompt: str, system_prompt: str, max_tokens: int = 1024) -> dict:
    """Bedrock Claude 공통 호출 + JSON 파싱."""
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
    return await _parse_model_json(text)


_AI_SUMMARY_SYSTEM_PROMPT = """You are Tutum's SRE-focused admin AI.
Analyze the given JSON payload and return JSON only.
Do not include markdown, commentary, or any fields outside the required schema.

Required response schema:
{
  "overall": {
    "severity": "OK" | "WARN" | "CRITICAL",
    "summary": "short summary",
    "issues": [
      {"level": "WARN" | "ERROR", "title": "issue title", "detail": "issue detail"}
    ],
    "recommendations": [
      {"priority": "HIGH" | "MEDIUM" | "LOW", "action": "recommended action"}
    ]
  },
  "sections": [
    {
      "key": "infra",
      "label": "Infra",
      "diagnosis": {
        "severity": "OK" | "WARN" | "CRITICAL",
        "summary": "short summary",
        "issues": [
          {"level": "WARN" | "ERROR", "title": "issue title", "detail": "issue detail"}
        ],
        "recommendations": [
          {"priority": "HIGH" | "MEDIUM" | "LOW", "action": "recommended action"}
        ]
      }
    }
  ]
}

The sections array must contain exactly these six keys:
- infra
- pipeline
- data
- backup
- logs
- traces

Severity guidance:
- OK: healthy, low risk, no immediate action needed
- WARN: degraded, partial failure, elevated error rate, missing data, or capacity risk
- CRITICAL: user impact, hard failures, broken pipeline, or urgent operational action needed

Keep summaries concrete and actionable."""


def _normalize_ai_card(value: dict | None, default_summary: str) -> dict:
    issues = []
    recommendations = []

    if isinstance(value, dict):
        raw_issues = value.get("issues") or []
        raw_recommendations = value.get("recommendations") or []

        if isinstance(raw_issues, list):
            for item in raw_issues[:5]:
                if not isinstance(item, dict):
                    continue
                issues.append({
                    "level": item.get("level", "WARN") if item.get("level") in {"WARN", "ERROR"} else "WARN",
                    "title": str(item.get("title") or "Issue"),
                    "detail": str(item.get("detail") or ""),
                })

        if isinstance(raw_recommendations, list):
            for item in raw_recommendations[:5]:
                if not isinstance(item, dict):
                    continue
                recommendations.append({
                    "priority": (
                        item.get("priority", "MEDIUM")
                        if item.get("priority") in {"HIGH", "MEDIUM", "LOW"}
                        else "MEDIUM"
                    ),
                    "action": str(item.get("action") or ""),
                })

        severity = value.get("severity", "WARN")
        return {
            "severity": severity if severity in {"OK", "WARN", "CRITICAL"} else "WARN",
            "summary": str(value.get("summary") or default_summary),
            "issues": issues,
            "recommendations": recommendations,
        }

    return {
        "severity": "WARN",
        "summary": default_summary,
        "issues": [],
        "recommendations": [],
    }


@router.get("/infra-diagnose")
async def get_infra_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """인프라(노드/파드) 상태를 Bedrock Claude로 AI 진단."""
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
                cpu_nano = _cpu_usage_to_nano(item["usage"]["cpu"])
                mem_ki = _memory_quantity_to_ki(item["usage"]["memory"])
                usage_map[name] = {"cpu_nano": cpu_nano, "mem_ki": mem_ki}
        except Exception:
            pass

        node_lines = []
        for node in nodes_raw:
            name = node.metadata.name
            alloc = node.status.allocatable or {}
            cpu_str = alloc.get("cpu", "0")
            mem_str = alloc.get("memory", "0Ki")
            cpu_m = _cpu_capacity_to_millicores(cpu_str)
            mem_ki = _memory_quantity_to_ki(mem_str)
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
        raise HTTPException(status_code=500, detail=f"인프라 데이터 수집 실패: {e}")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"인프라 진단 요청 ({now_str})\n\n"
        f"[노드 상태 ({len(nodes_raw)}개)]\n" + "\n".join(node_lines) + "\n\n"
        f"[파드 상태 ({len(pod_lines)}개)]\n" + "\n".join(pod_lines) + "\n\n"
        f"[요약]\n- 전체 파드: {len(pod_lines)}개\n- 문제 파드: {len(problem_pods)}개\n"
        + ("\n".join(problem_pods) if problem_pods else "  (없음)") +
        "\n\n위 인프라 데이터를 분석하여 지정된 JSON 형식으로 진단 결과를 반환하세요."
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/data-diagnose")
async def get_data_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """데이터 레이어(ES/Redis/Kafka/MongoDB/Disk) 상태를 AI 진단."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        dm = await get_data_metrics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 메트릭 수집 실패: {e}")

    es = dm["elasticsearch"]
    redis = dm["redis"]
    kafka = dm["kafka"]
    disk = dm["disk"]
    mongo = dm["mongodb"]

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"데이터 레이어 진단 요청 ({now_str})\n\n"
        f"[Elasticsearch]\n"
        f"- 가용: {es['available']}\n"
        f"- JVM Heap: {es['jvm_heap_used_gb']}GB / {es['jvm_heap_max_gb']}GB ({es['jvm_heap_pct']}%)\n"
        f"- 인덱싱: {es['indexing_rate']} docs/s, 저장소: {es['store_gb']}GB\n"
        f"- 검색 QPS: {es['search_qps']}, 지연: {es['search_latency_ms']}ms\n"
        f"- 스레드 거부: {es['thread_rejected']}\n\n"
        f"[Redis]\n"
        f"- 가용: {redis['available']}\n"
        f"- 메모리: {redis['memory_used_gb']}GB / {redis['memory_max_gb']}GB ({redis['memory_pct']}%)\n"
        f"- 연결: {redis['clients']}개, 히트율: {redis['hit_rate_pct']}%\n\n"
        f"[Kafka]\n"
        f"- 가용: {kafka['available']}\n"
        f"- Consumer Lag: {kafka['consumer_lag']}, 처리량: {kafka['throughput_msg_per_min']}msg/min\n\n"
        f"[MongoDB]\n"
        f"- 가용: {mongo['available']}\n"
        f"- 연결: {mongo['connections']}개\n"
        f"- 읽기: {mongo['ops_read_per_sec']}/s, 쓰기: {mongo['ops_write_per_sec']}/s\n\n"
        f"[Disk]\n"
        f"- 전체: {disk['total_gb']}GB, 사용: {disk['used_gb']}GB ({disk['used_pct']}%)\n"
        f"- 읽기: {disk['read_mbps']}MB/s, 쓰기: {disk['write_mbps']}MB/s\n\n"
        "위 데이터 레이어 상태를 분석하여 지정된 JSON 형식으로 진단 결과를 반환하세요."
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/log-diagnose")
async def get_log_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """최근 1시간 에러 로그 패턴을 AI 분석."""
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
        logger.warning("log-diagnose Loki 조회 실패: %s", e)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    log_text = "\n".join(error_logs[:30]) if error_logs else "  (최근 1시간 에러 없음)"
    prompt = (
        f"로그 분석 진단 요청 ({now_str})\n\n"
        f"[최근 1시간 에러 로그 ({len(error_logs)}건)]\n{log_text}\n\n"
        "위 로그 패턴을 분석하여 반복 에러·이상 패턴을 파악하고, 지정된 JSON 형식으로 진단 결과를 반환하세요."
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/trace-diagnose")
async def get_trace_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """최근 1시간 트레이스 에러·지연을 AI 분석."""
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
                error_lines.append(
                    f"  {t.get('rootTraceName', '-')} {t.get('durationMs', 0)}ms [5xx]"
                )
    except Exception as e:
        logger.warning("trace-diagnose error query 실패: %s", e)
    try:
        slow_resp = await _HTTP_MISC.get(
            f"{TEMPO_URL}/api/search",
            params={**base_params, "limit": 10, "minDuration": "200ms"},
        )
        if slow_resp.status_code == 200:
            for t in slow_resp.json().get("traces", []):
                slow_lines.append(
                    f"  {t.get('rootTraceName', '-')} {t.get('durationMs', 0)}ms"
                )
    except Exception as e:
        logger.warning("trace-diagnose slow query 실패: %s", e)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = (
        f"트레이스 분석 진단 요청 ({now_str})\n\n"
        f"[5xx 에러 트레이스 ({len(error_lines)}건)]\n"
        + ("\n".join(error_lines) if error_lines else "  (없음)") + "\n\n"
        f"[느린 요청 트레이스 >=200ms ({len(slow_lines)}건)]\n"
        + ("\n".join(slow_lines) if slow_lines else "  (없음)") + "\n\n"
        "위 트레이스 데이터를 분석하여 에러율·지연 패턴을 파악하고, 지정된 JSON 형식으로 진단 결과를 반환하세요."
    )

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/backup-diagnose")
async def get_backup_diagnose(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """백업 CronJob 상태를 AI 진단."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        data = await get_backup_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 상태 수집 실패: {e}")

    backups = data.get("backups", [])
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"백업 상태 진단 요청 ({now_str})\n"]
    for b in backups:
        lines.append(
            f"[{b['name']}] ({b['cronjob']}, ns={b['namespace']})\n"
            f"  상태: {b['status']}, 스케줄: {b['schedule']}\n"
            f"  마지막 실행: {b['last_run_at']}, 마지막 성공: {b['last_success_at']}\n"
            f"  에러: {b.get('last_error') or '없음'}"
        )
    prompt = "\n".join(lines) + "\n\n위 백업 상태를 분석하여 지정된 JSON 형식으로 진단 결과를 반환하세요."

    try:
        result = await _call_bedrock_standard(prompt, _DIAGNOSE_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


# ─── 스토리지 (PVC) ────────────────────────────────────────────────────────────

@router.get("/ai-summary")
async def get_ai_summary(
    request: Request,
    current_user: AuthIdentity = Depends(get_current_identity),
):
    """Run one-shot AI analysis across all admin sectors."""
    await check_rate_limit(request, "admin_ai", user_id=current_user.id)

    try:
        (
            nodes_data,
            pods_data,
            metrics_data,
            pipeline_data,
            data_metrics,
            backup_data,
            logs_data,
            traces_data,
            alerts_data,
        ) = await asyncio.gather(
            get_nodes(),
            get_pods("all"),
            get_metrics(),
            _collect_pipeline_data(),
            get_data_metrics(),
            get_backup_status(),
            get_logs(namespace="all", limit=50),
            get_traces(limit=20, min_duration_ms=50),
            get_action_needed(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI summary data collection failed: {e}")

    nodes = nodes_data.get("nodes", [])
    pods = pods_data.get("pods", [])
    problem_nodes = [
        n for n in nodes
        if n.get("status") != "Ready"
        or (n.get("cpu_percent") or 0) >= 85
        or (n.get("memory_percent") or 0) >= 85
    ]

    def _pod_needs_attention(pod: dict) -> bool:
        if pod.get("status") not in ("Running", "Succeeded"):
            return True

        ready = str(pod.get("ready") or "").strip()
        if not ready or ready == "0/0" or "/" not in ready:
            return False

        try:
            ready_count, total_count = ready.split("/", 1)
            return int(ready_count) < int(total_count)
        except ValueError:
            return False

    problem_pods = [p for p in pods if _pod_needs_attention(p)]

    logs = logs_data.get("logs", [])
    error_summary = logs_data.get("error_summary", [])
    traces = traces_data.get("traces", [])
    payload = {
        "overview": {
            "rps_latest": (metrics_data.get("rps") or [None])[-1],
            "latency_p95_latest": (metrics_data.get("latency_p95") or [None])[-1],
            "error_rate_latest": (metrics_data.get("error_rate") or [None])[-1],
            "kafka_lag_latest": (metrics_data.get("kafka_lag") or [None])[-1],
            "top_5xx_endpoints": metrics_data.get("top_5xx_endpoints", []),
            "action_needed": alerts_data.get("alerts", [])[:10],
        },
        "infra": {
            "nodes_total": len(nodes),
            "problem_nodes": problem_nodes[:10],
            "pods_total": len(pods),
            "problem_pods": problem_pods[:15],
        },
        "pipeline": {
            "workers": pipeline_data.get("workers", {}),
            "mongodb": pipeline_data.get("mongodb", {}),
            "elasticsearch": pipeline_data.get("elasticsearch", {}),
        },
        "data": data_metrics,
        "backup": {
            "backups": backup_data.get("backups", []),
        },
        "logs": {
            "error_summary": error_summary[:10],
            "samples": [
                {
                    "time": item.get("time"),
                    "namespace": item.get("namespace"),
                    "pod": item.get("pod"),
                    "level": item.get("level"),
                    "msg": str(item.get("msg") or "")[:160],
                }
                for item in logs[:20]
            ],
        },
        "traces": {
            "available": traces_data.get("available", False),
            "error_traces": traces_data.get("error_traces", [])[:5],
            "client_error_traces": traces_data.get("client_error_traces", [])[:5],
            "slow_traces": traces[:10],
        },
    }

    prompt = (
        f"Tutum admin AI summary request ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})\n\n"
        "Analyze the following JSON payload and return the required JSON only.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )

    try:
        result = await _call_bedrock_standard(prompt, _AI_SUMMARY_SYSTEM_PROMPT, max_tokens=2600)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI summary generation failed: {e}")

    overall = _normalize_ai_card(
        result.get("overall") if isinstance(result, dict) else None,
        "Overall diagnosis is not available.",
    )
    raw_sections = result.get("sections") if isinstance(result, dict) else []
    section_map = {}
    if isinstance(raw_sections, list):
        for item in raw_sections:
            if isinstance(item, dict) and item.get("key"):
                section_map[str(item.get("key"))] = item

    sections = []
    for key, label in [
        ("infra", "Infra"),
        ("pipeline", "Pipeline"),
        ("data", "Data"),
        ("backup", "Backup"),
        ("logs", "Logs"),
        ("traces", "Traces"),
    ]:
        raw_item = section_map.get(key, {})
        diagnosis = raw_item.get("diagnosis") if isinstance(raw_item, dict) else None
        sections.append({
            "key": key,
            "label": str(raw_item.get("label") or label) if isinstance(raw_item, dict) else label,
            "diagnosis": _normalize_ai_card(diagnosis, f"{label} diagnosis is not available."),
        })

    return {
        "diagnosis": {
            "overall": overall,
            "sections": sections,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/storage")
async def get_storage():
    """
    K8s PersistentVolumeClaim 목록과 상태 반환.
    tutum-app, tutum-data, tutum-storage 네임스페이스 대상.
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
        logger.error("get_storage 오류: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ─── 노드 24시간 시계열 ──────────────────────────────────────────────────────────

@router.get("/cost-forecast")
async def get_cost_forecast():
    """Estimate hourly and projected 24h cluster cost from active node inventory.

    Kept as a backend-served forecast so the admin dashboard can render cost
    signals even when direct AWS Billing access is unavailable to the team.
    """
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

        fixed_hourly_total = (
            control_plane_hourly
            + (nat_gateway_hourly * nat_gateway_count)
            + extra_fixed_hourly
        )
        total_hourly = compute_hourly_total + fixed_hourly_total
        total_daily = total_hourly * 24

        available = aws_labeled_nodes > 0
        if not available:
            warnings.append(
                "No AWS instance-type labels found on nodes. "
                "This cluster may not be running on EKS workers."
            )

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
    Mimir에서 노드별 CPU/Memory 24시간 시계열 조회.
    node-exporter 메트릭(node_memory_MemAvailable_bytes, node_cpu_seconds_total) 사용.
    instance 레이블: 노드 IP (192.168.0.220~225)
    """
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    step = "10m"  # 24h / 10m = 144 포인트

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

    # CPU 사용률 %: 100 - (idle %)
    cpu_data = await _range(
        '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
    )
    # Memory 사용률 %: (total - available) / total * 100
    mem_data = await _range(
        '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'
    )

    # 타임스탬프를 "HH:mm" 포맷으로 변환 (프론트 표시용)
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


# ─── 데이터 레이어 메트릭 ────────────────────────────────────────────────────────

_mongo_io_prev: dict = {}  # {ts: float, opcounters: dict}


@router.get("/data-metrics")
async def get_data_metrics():
    """
    Mimir에서 Redis/Kafka/ES/Disk 메트릭 조회 + MongoDB serverStatus 직접 조회.
    kafka-exporter(9308), redis-exporter(9121)가 Alloy에 의해 스크랩된 데이터.
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
        "disk_total_bytes": [
            "sum(max by (instance) "
            '(node_filesystem_size_bytes{mountpoint=~"/var|/local|/mnt|/opt",fstype!~"tmpfs|erofs"}))'
        ],
        "disk_avail_bytes": [
            "sum(max by (instance) "
            '(node_filesystem_avail_bytes{mountpoint=~"/var|/local|/mnt|/opt",fstype!~"tmpfs|erofs"}))'
        ],
        "es_search_qps": ["sum(rate(elasticsearch_indices_search_query_total[5m]))"],
        "es_search_time": ["sum(rate(elasticsearch_indices_search_query_time_seconds[5m]))"],
        "es_index_time": ["sum(rate(elasticsearch_indices_indexing_index_time_seconds_total[5m]))"],
        "es_index_total": ["sum(rate(elasticsearch_indices_indexing_index_total[5m]))"],
        "es_thread_rejected": [
            'sum(increase(elasticsearch_thread_pool_rejected_count{type="write"}[5m]))'
        ],
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
                logger.warning("data-metrics Mimir 실패 [%s]: %s", key, e)

    # Redis hit rate
    hits = raw.get("redis_hits")
    misses = raw.get("redis_misses")
    if hits is not None and misses is not None and (hits + misses) > 0:
        hit_rate = round(hits / (hits + misses) * 100, 1)
    else:
        hit_rate = None

    # 메모리 GB 변환
    def to_gb(v): return round(v / 1024 / 1024 / 1024, 2) if v else None
    def to_pct(used, max_v): return round(used / max_v * 100, 1) if used and max_v else None

    # MongoDB serverStatus (ops/sec delta 계산)
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
        logger.warning("MongoDB serverStatus 조회 실패: %s", e)
        try:
            db = get_database()
            if db is not None:
                ping = await db.command("ping")
                db_stats = await db.command("dbStats")
                mongo_io = {
                    "collections": db_stats.get("collections"),
                    "objects": db_stats.get("objects"),
                    "storage_size_gb": round(db_stats.get("storageSize", 0) / 1024 / 1024 / 1024, 3),
                    "data_size_gb": round(db_stats.get("dataSize", 0) / 1024 / 1024 / 1024, 3),
                    "available": bool(ping.get("ok")),
                }
        except Exception as fallback_error:
            logger.warning("MongoDB fallback 조회 실패: %s", fallback_error)

    def to_mbps(v): return round(v / 1024 / 1024, 2) if v is not None else None

    # IP → 노드 이름 매핑 (node_uname_info의 nodename 레이블 사용)
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
            params={
                "query": (
                    'max by (instance) '
                    '(node_filesystem_size_bytes{mountpoint=~"/var|/local|/mnt|/opt",fstype!~"tmpfs|erofs"})'
                ),
                **instant_params,
            },
        )
        avail_data = await _mimir_query(
            "/api/v1/query",
            params={
                "query": (
                    'max by (instance) '
                    '(node_filesystem_avail_bytes{mountpoint=~"/var|/local|/mnt|/opt",fstype!~"tmpfs|erofs"})'
                ),
                **instant_params,
            },
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
            "available":      (
                raw.get("disk_total_bytes") is not None
                or raw.get("disk_avail_bytes") is not None
                or bool(disk_nodes)
            ),
            "nodes":          disk_nodes,
        },
        "mongodb": mongo_io,
    }


# ─── 백업 상태 ───────────────────────────────────────────────────────────────

_BACKUP_CRONJOBS = [
    {"name": "mongodb-backup", "namespace": "tutum-data", "label": "MongoDB"},
    {"name": "elasticsearch-backup", "namespace": "tutum-data", "label": "Elasticsearch"},
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
        logger.warning("K8s API 조회 실패 [%s]: %s", path, e)
    return None


@router.get("/backup-status")
async def get_backup_status():
    """
    CronJob 및 최근 Job 결과로 백업 상태 조회.
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

        # 최근 Job 목록 조회 (owner=CronJob)
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
            # jobs API 실패 → CronJob 상태만으로 판단
            if entry["last_success_at"]:
                entry["status"] = "OK"
            elif entry["last_run_at"]:
                entry["status"] = "WARN"

        results.append(entry)

    return {"backups": results}


# ─── 운영 경고 요약 ───────────────────────────────────────────────────────────

def _build_action_alert(
    *,
    level: str,
    category: str,
    message: str,
    action: str,
    owner: str,
    source: str,
    signal: str,
    runbook: str,
    service: str,
) -> dict:
    return {
        "level": level,
        "category": category,
        "message": message,
        "action": action,
        "owner": owner,
        "source": source,
        "signal": signal,
        "runbook": runbook,
        "service": service,
    }


def _action_alert_sort_key(alert: dict) -> tuple[int, str, str]:
    severity_rank = 0 if alert.get("level") == "CRITICAL" else 1
    return (
        severity_rank,
        str(alert.get("category", "")),
        str(alert.get("signal", "")),
    )


@router.get("/action-needed")
async def get_action_needed():
    """
    임계치 기반 즉시 조치 필요 항목 목록.
    data-metrics + backup-status를 집계해 경고 생성.
    """
    alerts: list[dict] = []

    try:
        metrics = await get_data_metrics()

        disk = metrics.get("disk", {})
        used_pct = disk.get("used_pct")
        if used_pct is not None:
            if used_pct >= 85:
                alerts.append(
                    _build_action_alert(
                        level="CRITICAL",
                        category="디스크",
                        message=f"클러스터 디스크 사용률이 {used_pct:.1f}%입니다. (치명 기준: 85% 이상)",
                        action="불필요한 데이터를 정리하거나 스토리지 볼륨을 즉시 확장하세요.",
                        owner="플랫폼",
                        source="Mimir 데이터 메트릭",
                        signal="disk.used_pct",
                        runbook="ADMIN_MONITORING_GUIDE > 디스크 용량",
                        service="클러스터 스토리지",
                    )
                )
            elif used_pct >= 70:
                alerts.append(
                    _build_action_alert(
                        level="WARN",
                        category="디스크",
                        message=f"클러스터 디스크 사용률이 {used_pct:.1f}%입니다. (주의 기준: 70% 이상)",
                        action="증가 추이를 모니터링하고 정리 또는 볼륨 확장을 준비하세요.",
                        owner="플랫폼",
                        source="Mimir 데이터 메트릭",
                        signal="disk.used_pct",
                        runbook="ADMIN_MONITORING_GUIDE > 디스크 용량",
                        service="클러스터 스토리지",
                    )
                )

        es = metrics.get("elasticsearch", {})
        jvm_pct = es.get("jvm_heap_pct")
        if jvm_pct is not None and jvm_pct >= 80:
            level = "CRITICAL" if jvm_pct >= 90 else "WARN"
            threshold_label = "치명 기준: 90% 이상" if level == "CRITICAL" else "주의 기준: 80% 이상"
            alerts.append(
                _build_action_alert(
                    level=level,
                    category="Elasticsearch",
                    message=f"Elasticsearch JVM 힙 사용률이 {jvm_pct:.1f}%입니다. ({threshold_label})",
                    action="인덱싱 부하를 줄이거나 Elasticsearch 메모리/용량을 확장하세요.",
                    owner="검색/데이터",
                    source="Mimir 데이터 메트릭",
                    signal="elasticsearch.jvm_heap_pct",
                    runbook="ADMIN_MONITORING_GUIDE > Elasticsearch 용량",
                    service="elasticsearch",
                )
            )

        thread_rej = es.get("thread_rejected")
        if thread_rej and thread_rej > 0:
            alerts.append(
                _build_action_alert(
                    level="WARN",
                    category="Elasticsearch",
                    message=f"최근 구간에서 Elasticsearch write thread pool이 {thread_rej}건의 작업을 거절했습니다.",
                    action="인덱싱 버스트를 점검하고 거절이 계속되면 replica를 확장하세요.",
                    owner="검색/데이터",
                    source="Mimir 데이터 메트릭",
                    signal="elasticsearch.thread_rejected",
                    runbook="ADMIN_MONITORING_GUIDE > Elasticsearch 인덱싱 부하",
                    service="elasticsearch",
                )
            )

        kafka = metrics.get("kafka", {})
        lag = kafka.get("consumer_lag")
        if lag is not None and lag > 500:
            level = "CRITICAL" if lag > 5000 else "WARN"
            threshold_label = "치명 기준: 5,000 초과" if level == "CRITICAL" else "주의 기준: 500 초과"
            alerts.append(
                _build_action_alert(
                    level=level,
                    category="Kafka",
                    message=f"Kafka consumer lag이 {lag:,}건입니다. ({threshold_label})",
                    action="컨슈머 상태를 확인하고 backlog가 계속 늘면 replica를 확장하세요.",
                    owner="파이프라인",
                    source="Mimir 데이터 메트릭",
                    signal="kafka.consumer_lag",
                    runbook="ADMIN_MONITORING_GUIDE > Kafka consumer lag",
                    service="Kafka / elastic-consumer",
                )
            )

        mongo = metrics.get("mongodb", {})
        queued_readers = mongo.get("queued_readers") or 0
        queued_writers = mongo.get("queued_writers") or 0
        queued_total = queued_readers + queued_writers
        if queued_total > 10:
            alerts.append(
                _build_action_alert(
                    level="WARN",
                    category="MongoDB",
                    message=(
                        f"MongoDB 대기 작업 수가 {queued_total}건입니다. "
                        f"(readers={queued_readers}, writers={queued_writers})"
                    ),
                    action="db.currentOp()로 느린 쿼리와 활성 작업을 점검하세요.",
                    owner="데이터",
                    source="Mimir 데이터 메트릭",
                    signal="mongodb.queued_ops",
                    runbook="ADMIN_MONITORING_GUIDE > Mongo 대기 작업",
                    service="mongodb",
                )
            )
    except Exception as e:
        logger.warning("action-needed metrics query failed: %s", e)

    try:
        backup = await get_backup_status()
        for item in backup.get("backups", []):
            if item["status"] == "ERROR":
                alerts.append(
                    _build_action_alert(
                        level="CRITICAL",
                        category="백업",
                        message=(
                            f"{item['name']} 백업이 실패했습니다: "
                            f"{item.get('last_error') or '오류 메시지가 기록되지 않았습니다'}"
                        ),
                        action=f"{item['namespace']} 네임스페이스의 최신 Job 로그를 확인하세요.",
                        owner="플랫폼",
                        source="Kubernetes CronJob 상태",
                        signal=f"backup.{item['name']}.status",
                        runbook="ADMIN_MONITORING_GUIDE > 백업 CronJob",
                        service=item["name"],
                    )
                )
            elif item["status"] == "NO_RUN":
                alerts.append(
                    _build_action_alert(
                        level="WARN",
                        category="백업",
                        message=f"{item['name']} 백업이 아직 한 번도 성공적으로 실행되지 않았습니다.",
                        action="CronJob 스케줄, RBAC, 이미지 pull 상태를 확인하세요.",
                        owner="플랫폼",
                        source="Kubernetes CronJob 상태",
                        signal=f"backup.{item['name']}.status",
                        runbook="ADMIN_MONITORING_GUIDE > 백업 CronJob",
                        service=item["name"],
                    )
                )
    except Exception as e:
        logger.warning("action-needed backup query failed: %s", e)

    alerts.sort(key=_action_alert_sort_key)
    return {"alerts": alerts, "count": len(alerts)}


# ─── 트레이스 (Tempo) ─────────────────────────────────────────────────────────

TEMPO_URL = os.getenv("TEMPO_URL", "http://10.60.11.95:3200")
GRAFANA_URL = _GRAFANA_URL


@router.get("/traces")
async def get_traces(limit: int = 20, min_duration_ms: int = 50):
    """
    Tempo에서 트레이스 조회.
    - traces: 느린 요청 (>= min_duration_ms)
    - error_traces: 5xx 에러가 발생한 트레이스
    """
    end_s = int(datetime.now(timezone.utc).timestamp())
    start_s = end_s - 3600  # 1시간

    def _format(t: dict, is_error: bool = False) -> dict:
        duration_ms = round(int(t.get("durationMs", 0)))
        start_time_ms = int(t.get("startTimeUnixNano", 0)) // 1_000_000
        trace_id = t.get("traceID", "")
        # rootTraceName 예: "GET /api/v1/news" → 경로/메서드 분리
        root_name = t.get("rootTraceName", "-")
        return {
            "traceID":         trace_id,
            "rootServiceName": t.get("rootServiceName", "tutum-backend"),
            "rootTraceName":   root_name,
            "durationMs":      duration_ms,
            "startTimeMs":     start_time_ms,
            "isError":         is_error,
            "grafana_url":     _grafana_trace_url(trace_id),
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

    # 느린 요청 트레이스 (>= min_duration_ms)
    slow_raw = await _search({**base_params, "limit": limit, "minDuration": f"{min_duration_ms}ms"})
    # 5xx 에러 트레이스 — TraceQL 사용
    error_raw = await _search({**base_params, "q": '{span.http.status_code >= 500}', "limit": 10})
    # 4xx 클라이언트 에러 트레이스
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
        "error_traces":       error_traces,       # 5xx — 서버 에러
        "client_error_traces": client_error_traces,  # 4xx — 클라이언트 에러
        "available":          True,
    }
