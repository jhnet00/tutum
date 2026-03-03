#!/bin/bash
# Failover 복구 테스트 스크립트
# 실행 위치: cp-1 또는 cp-2 (kubectl 접근 가능한 노드)
# 사용법: bash failover-test.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[INFO]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

echo "=============================="
echo " CloudDX Failover Test Suite"
echo "=============================="
echo ""

# ──────────────────────────────────────────
# TEST 1: Backend Pod 강제 종료
# ──────────────────────────────────────────
echo "▶ TEST 1: backend pod 강제 종료 후 복구"
BEFORE=$(kubectl get pods -n tutum-app -l app=backend --no-headers | grep Running | wc -l)
warn "현재 backend Running 파드: ${BEFORE}개"

TARGET=$(kubectl get pods -n tutum-app -l app=backend --no-headers | grep Running | head -1 | awk '{print $1}')
warn "강제 종료 대상: ${TARGET}"
kubectl delete pod "$TARGET" -n tutum-app

warn "30초 대기 중..."
sleep 30

AFTER=$(kubectl get pods -n tutum-app -l app=backend --no-headers | grep Running | wc -l)
if [ "$AFTER" -ge "$BEFORE" ]; then
  ok "backend 복구 완료 (Running: ${AFTER}개)"
else
  fail "backend 복구 실패 (Running: ${AFTER}개, 기대: ${BEFORE}개 이상)"
fi
echo ""

# ──────────────────────────────────────────
# TEST 2: Redis Master (redis-0) 재시작
# ──────────────────────────────────────────
echo "▶ TEST 2: redis-0 (master) pod 재시작 후 복구"
kubectl delete pod redis-0 -n tutum-data
warn "redis-0 삭제됨, 20초 대기..."
sleep 20

REDIS_STATUS=$(kubectl get pod redis-0 -n tutum-data --no-headers | awk '{print $2}')
if [ "$REDIS_STATUS" = "1/1" ]; then
  ok "redis-0 Running 복구 완료"
else
  warn "redis-0 상태: ${REDIS_STATUS} (아직 기동 중일 수 있음)"
fi

SLAVES=$(kubectl exec -n tutum-data redis-0 -- redis-cli info replication 2>/dev/null | grep connected_slaves | cut -d: -f2 | tr -d '\r')
if [ "${SLAVES:-0}" -ge 1 ]; then
  ok "redis 복제 유지: connected_slaves=${SLAVES}"
else
  warn "redis 복제 상태 확인 필요 (connected_slaves=${SLAVES:-?})"
fi
echo ""

# ──────────────────────────────────────────
# TEST 3: Kafka Broker (kafka-1) 재시작
# ──────────────────────────────────────────
echo "▶ TEST 3: kafka-1 pod 재시작 후 복구"
kubectl delete pod kafka-1 -n tutum-data
warn "kafka-1 삭제됨, 40초 대기 (KRaft quorum 재구성)..."
sleep 40

KAFKA_STATUS=$(kubectl get pod kafka-1 -n tutum-data --no-headers | awk '{print $2}')
if [ "$KAFKA_STATUS" = "1/1" ]; then
  ok "kafka-1 Running 복구 완료"
else
  warn "kafka-1 상태: ${KAFKA_STATUS}"
fi

KAFKA_RUNNING=$(kubectl get pods -n tutum-data -l app=kafka --no-headers | grep -c "1/1")
if [ "$KAFKA_RUNNING" -ge 2 ]; then
  ok "Kafka 클러스터 quorum 유지 (Running: ${KAFKA_RUNNING}/3)"
else
  fail "Kafka quorum 손실 위험 (Running: ${KAFKA_RUNNING}/3)"
fi
echo ""

# ──────────────────────────────────────────
# TEST 4: 전체 서비스 상태 최종 확인
# ──────────────────────────────────────────
echo "▶ TEST 4: 전체 tutum-app 파드 상태 확인"
NOT_READY=$(kubectl get pods -n tutum-app --no-headers | grep -v "Running\|Completed" | wc -l)
if [ "$NOT_READY" -eq 0 ]; then
  ok "tutum-app 전체 파드 Running"
else
  warn "Running 아닌 파드: ${NOT_READY}개"
  kubectl get pods -n tutum-app --no-headers | grep -v "Running\|Completed"
fi

echo ""
echo "=============================="
echo " Failover Test 완료"
echo "=============================="
