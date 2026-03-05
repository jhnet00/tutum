"""
============================================
Admin Router - 클러스터 모니터링 API
============================================

K8s 노드/파드 상태와 Mimir 메트릭을 조회해
Admin 대시보드에 실시간 데이터를 제공합니다.

데이터 소스:
  - K8s API Server: in-cluster ServiceAccount (nodes, pods)
  - Mimir: http://192.168.0.230:9009/prometheus (메트릭)
  - Loki:  http://192.168.0.230:3100 (로그)
"""

import asyncio
import json
import logging
import math
import os
import time
from datetime import datetime, timezone, timedelta

import boto3
import httpx
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_database, get_news_collection
from .auth import get_current_user

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)

MIMIR_URL = os.getenv("MIMIR_URL", "http://192.168.0.230:9009/prometheus")
LOKI_URL = os.getenv("LOKI_URL", "http://192.168.0.230:3100")

# Shared HTTP clients — reused across requests for connection pooling
_HTTP_MIMIR = httpx.AsyncClient(timeout=5.0)
_HTTP_LOKI = httpx.AsyncClient(timeout=8.0)
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
                cpu_nano = int(item["usage"]["cpu"].rstrip("n"))
                mem_ki = int(item["usage"]["memory"].rstrip("Ki"))
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

            # CPU: "6" → 6000m, "6000m" → 6000
            if cpu_alloc_str.endswith("m"):
                cpu_alloc_m = int(cpu_alloc_str[:-1])
            else:
                cpu_alloc_m = int(float(cpu_alloc_str)) * 1000

            # Memory: "12345678Ki" → bytes
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
    base_selector = f'{{job="loki.source.kubernetes.k8s_logs", instance=~"{ns_pattern}/.*"}}'
    log_query = base_selector  # 실시간 스트림 (최근 10분)
    error_query = f'{base_selector} |= "ERROR"'  # 에러 이력 (최근 1시간)

    end_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)

    def _parse_streams(result: list, default_level: str = "INFO") -> list[dict]:
        """Loki query_range result → log entry list."""
        logs = []
        for stream in result:
            labels = stream["stream"]
            instance = labels.get("instance", "")
            level = labels.get("level", default_level).upper()
            ns_pod = instance.split(":")[0]
            parts = ns_pod.split("/", 1)
            ns_name = parts[0] if len(parts) == 2 else ""
            pod_name = parts[1] if len(parts) == 2 else instance
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
                    }
                pod_stat[pod]["count"] += 1
            error_summary = sorted(
                [{"pod": k, **v} for k, v in pod_stat.items()],
                key=lambda x: -x["count"],
            )

        return {"logs": unique[:limit], "error_summary": error_summary}

    except Exception as e:
        logger.error("get_logs Loki 오류: %s", e)
        return {"logs": [], "error_summary": []}


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
async def get_diagnose():
    """
    현재 클러스터 상태를 Bedrock Claude로 AI 진단.
    nodes + pods 데이터를 수집해 이슈/권장조치를 JSON으로 반환.
    """
    # 1. 클러스터 현재 상태 수집
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
        model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0")
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
        diagnosis = json.loads(text)

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
        news_col = get_news_collection()
        if news_col is not None:
            total = await news_col.count_documents({})
            one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
            recent = await news_col.count_documents({"published_at": {"$gte": one_hour_ago}})
            out["mongodb"] = {"news_total": total, "news_last_1h": recent, "available": True}
    except Exception as e:
        logger.warning("pipeline MongoDB 조회 실패: %s", e)

    # 3. Elasticsearch document count
    es_url = os.getenv("ELASTICSEARCH_URL", "http://elasticsearch.tutum-data.svc.cluster.local:9200")
    try:
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
                query = f'{{job="loki.source.kubernetes.k8s_logs", instance=~"tutum-app/{worker}-.*"}}'
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


@router.get("/pipeline-diagnose")
async def get_pipeline_diagnose():
    """파이프라인 3대 구성요소를 Bedrock Claude로 AI 분석."""
    # 1. 데이터 수집
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
        model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0")
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
        logger.error("pipeline-diagnose Bedrock 오류: %s", e)
        raise HTTPException(status_code=503, detail=f"AI 분석 실패: {e}")

    return {"diagnosis": result, "generated_at": datetime.now(timezone.utc).isoformat()}


# ─── 스토리지 (PVC) ────────────────────────────────────────────────────────────

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
            clients = status.get("globalLock", {}).get("activeClients", {})
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
                "ops_read_per_sec": ops_read_per_sec,
                "ops_write_per_sec": ops_write_per_sec,
                "available": True,
            }
    except Exception as e:
        logger.warning("MongoDB serverStatus 조회 실패: %s", e)

    def to_mbps(v): return round(v / 1024 / 1024, 2) if v is not None else None

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
            "indexing_rate":  round(raw["es_indexing_rate"], 2) if raw.get("es_indexing_rate") is not None else None,
            "jvm_heap_used_gb": to_gb(raw.get("es_jvm_heap_used")),
            "jvm_heap_max_gb":  to_gb(raw.get("es_jvm_heap_max")),
            "jvm_heap_pct":   to_pct(raw.get("es_jvm_heap_used"), raw.get("es_jvm_heap_max")),
            "available":      raw.get("es_jvm_heap_used") is not None,
        },
        "disk": {
            "read_mbps":  to_mbps(raw.get("disk_read_bps")),
            "write_mbps": to_mbps(raw.get("disk_write_bps")),
            "available":  raw.get("disk_read_bps") is not None,
        },
        "mongodb": mongo_io,
    }


# ─── 트레이스 (Tempo) ─────────────────────────────────────────────────────────

TEMPO_URL = os.getenv("TEMPO_URL", "http://192.168.0.230:3200")


@router.get("/traces")
async def get_traces(limit: int = 20, min_duration_ms: int = 50):
    """
    Tempo에서 트레이스 조회.
    - traces: 느린 요청 (>= min_duration_ms)
    - error_traces: 5xx 에러가 발생한 트레이스
    """
    end_s = int(datetime.now(timezone.utc).timestamp())
    start_s = end_s - 3600  # 1시간

    def _grafana_url(trace_id: str) -> str:
        return (
            "http://192.168.0.230:3000/explore?datasource=tempo&left="
            "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"tempo\"},"
            f"\"queryType\":\"traceql\",\"query\":\"{trace_id}\",\"tableType\":\"traces\"}}]}}"
        )

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
