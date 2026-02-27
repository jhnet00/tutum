"""
============================================
Admin Router - 클러스터 모니터링 API
============================================

K8s 노드/파드 상태와 Mimir 메트릭을 조회해
Admin 대시보드에 실시간 데이터를 제공합니다.

데이터 소스:
  - K8s API Server: in-cluster ServiceAccount (nodes, pods)
  - Mimir: http://192.168.56.30:9009/prometheus (메트릭)
"""

import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

MIMIR_URL = os.getenv("MIMIR_URL", "http://192.168.56.30:9009/prometheus")


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

def _pod_age(creation_ts) -> str:
    if creation_ts is None:
        return "-"
    now = datetime.now(timezone.utc)
    delta = now - creation_ts
    s = int(delta.total_seconds())
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        return f"{s // 3600}h"
    return f"{s // 86400}d"


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
        nodes = core.list_node().items

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
            labels = node.metadata.labels or {}

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
            pods = core.list_pod_for_all_namespaces().items
        else:
            pods = core.list_namespaced_pod(namespace).items

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

            # 재시작 횟수
            restarts = sum(cs.restart_count for cs in container_statuses)

            # Ready 컨테이너 수
            ready_count = sum(1 for cs in container_statuses if cs.ready)
            total_count = len(container_statuses)

            result.append({
                "name": pod.metadata.name,
                "namespace": ns,
                "status": display_status,
                "restarts": restarts,
                "node": pod.spec.node_name or "-",
                "age": _pod_age(pod.metadata.creation_timestamp),
                "ready": f"{ready_count}/{total_count}",
            })

        return {"pods": result}

    except Exception as e:
        logger.error("get_pods 오류: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/metrics")
async def get_metrics():
    """
    Mimir에서 최근 1시간 메트릭 조회 (12포인트, 5분 간격).
    - rps: API 요청 수/초
    - latency_p95: P95 응답시간 (ms)
    - error_rate: 5xx 에러율 (%)
    - kafka_lag: 전체 consumer group lag 합계
    """
    step = "5m"
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=1)

    queries = {
        "rps": 'sum(rate(http_requests_total{namespace="tutum-app"}[2m]))',
        "latency_p95": (
            'histogram_quantile(0.95, sum by(le) '
            '(rate(http_request_duration_seconds_bucket{namespace="tutum-app"}[2m]))) * 1000'
        ),
        "error_rate": (
            'sum(rate(http_requests_total{namespace="tutum-app",status=~"5.."}[2m])) '
            '/ sum(rate(http_requests_total{namespace="tutum-app"}[2m])) * 100'
        ),
        "kafka_lag": 'sum(kafka_consumergroup_lag)',
    }

    result = {}
    async with httpx.AsyncClient(timeout=5.0) as client:
        for key, query in queries.items():
            try:
                resp = await client.get(
                    f"{MIMIR_URL}/api/v1/query_range",
                    params={
                        "query": query,
                        "start": start.isoformat(),
                        "end": end.isoformat(),
                        "step": step,
                    },
                )
                data = resp.json()
                if data.get("status") == "success":
                    results = data["data"]["result"]
                    if results:
                        values = [round(float(v[1]), 2) for v in results[0]["values"]]
                        result[key] = values[-12:] if len(values) >= 12 else values
                    else:
                        result[key] = []
                else:
                    result[key] = []
            except Exception as e:
                logger.warning("Mimir 쿼리 실패 [%s]: %s", key, e)
                result[key] = []

    return result
