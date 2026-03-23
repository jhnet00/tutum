# Tutum Admin 모니터링 대시보드 가이드

> 작성일: 2026-03-04
> 작성자: kyungyoonkim
> 대상: 백엔드·프론트엔드·인프라 팀원 모두
> URL: `https://tutum.my/admin` (로그인 필요)

---

## 목차

1. [대시보드 개요](#1-대시보드-개요)
2. [데이터 흐름 아키텍처](#2-데이터-흐름-아키텍처)
3. [탭별 상세 설명](#3-탭별-상세-설명)
   - [Overview 탭](#31-overview-탭)
   - [Infra 탭](#32-infra-탭)
   - [Pipeline 탭](#33-pipeline-탭)
   - [Logs 탭](#34-logs-탭)
   - [Traces 탭](#35-traces-탭)
   - [AI 분석 탭](#36-ai-분석-탭)
4. [알림 기준](#4-알림-기준)
5. [N/A 또는 데이터 없음 대처법](#5-na-또는-데이터-없음-대처법)

---

## 1. 대시보드 개요

`/admin` 페이지는 Tutum 서비스의 운영 상태를 한 화면에서 파악하기 위한 내부 모니터링 도구입니다.

### 왜 만들었는가?

Grafana는 강력하지만 패널 직접 설정이 필요하고 팀원 누구나 보기 어렵습니다.
이 대시보드는 **Tutum 서비스에 특화된** 지표만 모아서, 코드를 모르는 팀원도 현재 상태를 즉시 파악할 수 있도록 만들었습니다.

### 접근

```
https://tutum.my/admin
→ 로그인 페이지로 이동 (JWT 인증 필요)
→ 로그인 후 /admin으로 자동 리다이렉트
```

---

## 2. 데이터 흐름 아키텍처

```
┌──────────────────────────────────────────────────────────┐
│                      K8s 클러스터                         │
│                                                           │
│  백엔드 파드  ──OTel gRPC──▶  Alloy (DaemonSet)          │
│  node-exporter              │   ├─ Mimir (Prometheus)    │
│  redis-exporter             │   ├─ Loki  (Logs)          │
│  kafka-exporter             │   └─ Tempo (Traces)        │
│  elasticsearch-exporter     │         │                  │
└─────────────────────────────┼─────────┼──────────────────┘
                              │         │
                    192.168.0.230 (모니터링 VM)
                              │         │
                   ┌──────────▼─────────▼──────────┐
                   │  Mimir :9009  Loki :3100        │
                   │  Tempo :3200  Grafana :3000     │
                   └──────────────────────────────── ┘
                              │
                    백엔드 API (/api/v1/admin/*)
                              │
                    프론트엔드 /admin 페이지
```

### 각 컴포넌트 역할

| 컴포넌트 | 역할 | 어디서 실행 |
|---|---|---|
| **Alloy** | 메트릭·로그·트레이스 수집기 (DaemonSet, 전 노드 실행) | tutum-infra 또는 monitoring |
| **Mimir** | Prometheus 호환 장기 메트릭 저장소 | 192.168.0.230:9009 |
| **Loki** | 로그 집계 저장소 | 192.168.0.230:3100 |
| **Tempo** | 분산 트레이싱 저장소 | 192.168.0.230:3200 |
| **node-exporter** | 노드 CPU/메모리/디스크 메트릭 수집 | 전 노드 DaemonSet |
| **redis-exporter** | Redis 메모리·커넥션·히트율 수집 | tutum-data |
| **kafka-exporter** | Kafka consumer lag·처리량 수집 | tutum-data |
| **elasticsearch-exporter** | ES 인덱스·JVM Heap 수집 | tutum-data |

---

## 3. 탭별 상세 설명

### 3.1 Overview 탭

서비스 전체 건강 상태를 한눈에 볼 수 있는 탭입니다.

#### KPI 카드 (상단 4개)

| 카드 | 의미 | 데이터 출처 | 임계치 |
|---|---|---|---|
| **RPS** | 초당 처리 요청 수 | Mimir: `rate(http_requests_total[5m])` | - |
| **P95 Latency** | 상위 5% 느린 요청의 응답시간 | Mimir: `histogram_quantile(0.95, ...)` | **100ms 초과 = 심각** |
| **Error Rate** | 5xx 에러 비율 (%) | Mimir: `rate(error) / rate(total)` | - |
| **Kafka Lag** | 미처리 메시지 수 | Mimir: `kafka_consumergroup_lag` | **1000 초과 = 알림** |

> **RPS가 0에 가까우면?** → 백엔드 파드 다운 또는 Ingress 문제
> **Kafka Lag이 계속 증가하면?** → consumer 파드 중단 또는 처리 속도 저하

#### API 처리량 / 응답시간 차트

- **파란선 (RPS)**: 초당 요청 수. 급등하면 트래픽 폭증, 급감하면 서비스 장애 의심
- **보라선 (P95 Latency ms)**: 느린 요청 응답시간. **빨간 점선(100ms)** 을 넘으면 사용자 체감 속도 저하
- x축: 최근 1시간 (5분 단위)

#### 에러 건수 차트 (5xx / 4xx 스택 바)

- **빨간 막대 (5xx)**: 서버 오류 — 백엔드 버그·크래시·타임아웃. **즉각 대응 필요**
- **주황 막대 (4xx)**: 클라이언트 오류 — 잘못된 요청·인증 실패. 급증하면 API 오용 또는 클라이언트 버그 의심
- 차트 아래 **"5xx 발생 경로 Top 5"** 테이블: 어느 엔드포인트에서 에러가 가장 많이 나는지 표시

```
데이터 출처 (Mimir PromQL):
- error_5xx: sum(increase(http_requests_total{status=~"5.."}[5m]))
- error_4xx: sum(increase(http_requests_total{status=~"4.."}[5m]))
- top_5xx_endpoints: topk(5, sum(increase(...)) by (handler))
```

#### Kafka Consumer Lag 차트

- 면적 차트로 lag 추이 표시
- **lag이 높으면**: 뉴스 수집·인덱싱이 실시간을 따라가지 못해 사용자에게 노출되는 뉴스가 지연됨
- **lag이 0이면**: 정상 — consumer가 메시지를 실시간으로 소비 중

---

### 3.2 Infra 탭

Kubernetes 클러스터 인프라 상태를 보여주는 탭입니다.

#### 노드 현황 카드

- **cp1/cp2/cp3**: Control Plane 노드 — K8s API, 스케줄러, etcd 실행
- **worker1/2/3**: 앱·데이터 파드가 실제로 실행되는 노드
- CPU > 80% 또는 메모리 > 85%이면 게이지 바가 빨간색으로 변함 (Slack 알림 발송)
- 카드 클릭 → 해당 노드의 파드 목록으로 필터링됨

```
데이터 출처 (Mimir):
- CPU: avg(rate(node_cpu_seconds_total{mode!="idle"}[5m]))
- Memory: 1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
```

#### 24시간 CPU/메모리 시계열 그래프

- **CPU 탭** / **메모리 탭** 전환 가능
- 노드별 색상으로 구분하여 24시간 추이 확인
- 이상 패턴 예시:
  - CPU 주기적 스파이크 → 스크래핑 작업 (뉴스 수집) 시 정상적으로 발생 가능
  - 메모리 지속 증가 → 메모리 누수 또는 OOM 직전

#### 파드 상태 분포 (도넛 차트)

| 상태 | 의미 |
|---|---|
| **Running** (초록) | 정상 실행 중 |
| **Pending** (주황) | 스케줄링 대기 — 리소스 부족 또는 노드 선택 실패 |
| **Failed** (빨강) | CrashLoopBackOff, OOMKilled 등 — 즉시 로그 확인 필요 |
| **Evicted** (회색) | 노드 디스크/메모리 부족으로 강제 퇴출 |

#### 파드 목록 테이블

| 컬럼 | 설명 |
|---|---|
| 파드명 | 클릭 시 해당 파드 로그 탭으로 이동 |
| 네임스페이스 | tutum-app (앱), tutum-data (DB), tutum-infra (지원) |
| 상태 | Running / Pending / Failed 등 |
| 기동 시각 | 파드가 마지막으로 시작된 절대 시각 |
| 다운타임 | restartCount > 0인 경우, 마지막 재시작 직전 컨테이너가 중단된 시간 |

---

### 3.3 Pipeline 탭

뉴스·시세 데이터 파이프라인의 흐름과 데이터 레이어 상태를 보여줍니다.

#### 파이프라인 흐름

```
뉴스 파이프라인:
  news-producer (Einfomax 수집)
    → Kafka
    → news-consumer (MongoDB 저장)
    → elastic-consumer (ES 인덱싱)

시세 파이프라인:
  price-producer (거래소 API)
    → Kafka
    → price-consumer (MariaDB 저장)
```

- 각 워커의 상태(Running / 중단)와 기동 시각, 다운타임 표시
- 파이프라인이 중단되면 사용자에게 최신 뉴스/시세가 안 보임

#### 데이터 레이어 카드

| 카드 | 주요 지표 | 데이터 출처 |
|---|---|---|
| **MongoDB** | 전체 뉴스 수, 최근 1h 추가 수 | ES API 직접 쿼리 |
| **Elasticsearch** | 인덱스 문서 수, MongoDB 동기화율, JVM Heap % | ES API + elasticsearch-exporter → Mimir |
| **Redis** | 커넥션 수, Hit Rate %, 메모리 사용 | redis-exporter → Mimir |
| **Kafka** | Consumer Lag, 처리량/분 | kafka-exporter → Mimir |

**ES 동기화율**: MongoDB 뉴스 수 대비 ES 인덱스 문서 수 비율. 100%에 가까울수록 검색 최신성 양호.

**Redis Hit Rate**: 캐시 히트율. 낮으면(< 50%) 캐시 미스가 많아 DB 부하 증가.

**ES JVM Heap**: 85% 초과 시 Full GC 발생 → 검색 응답 지연. 95% 초과 시 OOM → ES 크래시.

---

### 3.4 Logs 탭

Loki에서 실시간으로 가져오는 애플리케이션 로그 탭입니다.

#### 에러 발생 이력 카드 (상단)

```
데이터 출처 (Loki LogQL):
{namespace="tutum-app"} |= "ERROR" [최근 1시간]
→ 파드별 에러 건수 집계 (많은 순 정렬)
```

- **파드명**: 클릭 시 해당 파드 로그만 필터링
- **건수**: 최근 1시간 동안 ERROR 레벨 로그 수
- **마지막 발생**: 가장 최근 에러 로그 시각
- **마지막 메시지**: 에러 내용 미리보기

#### 로그 스트림 (하단)

```
데이터 출처 (Loki LogQL):
{namespace="tutum-app"} [최근 10분]
→ 최신순 실시간 스트림 (10초 자동갱신)
```

- **필터**: 네임스페이스, 파드명, 로그 레벨(ALL/INFO/WARN/ERROR) 선택 가능
- **색상**: ERROR = 빨강, WARN = 주황, INFO = 파랑, DEBUG = 회색

---

### 3.5 Traces 탭

OpenTelemetry로 수집한 분산 트레이스 데이터를 보여줍니다.

> **트레이스(Trace)란?** 하나의 HTTP 요청이 백엔드 서버를 통과하는 경로 전체를 기록한 것.
> 어떤 함수에서 얼마나 시간이 걸렸는지, **어디서 에러로 끊겼는지** 파악 가능.

#### 데이터 흐름

```
사용자 요청
  → 백엔드 파드 (FastAPIInstrumentor 자동 계측)
  → OTLPSpanExporter (gRPC :4317)
  → Alloy DaemonSet
  → Tempo (192.168.0.230:4317)
  → 이 탭에서 조회
```

#### 3개 섹션

| 섹션 | 쿼리 (TraceQL) | 의미 |
|---|---|---|
| **서버 에러 트레이스 (5xx)** | `{span.http.status_code >= 500}` | 서버가 에러를 반환한 요청 — 어디서 끊겼는지 확인 |
| **클라이언트 에러 트레이스 (4xx)** | `{span.http.status_code >= 400 && < 500}` | 잘못된 요청·인증 실패 |
| **전체 트레이스 (50ms 이상)** | `{duration >= 50ms}` | 느린 요청 전체 |

#### Trace ID 클릭 시

Grafana Tempo로 이동 → **span 트리** 확인:
- 어떤 함수/DB 쿼리에서 시간이 얼마나 걸렸는지
- 어느 지점에서 에러가 발생해서 요청이 끊겼는지

---

### 3.6 AI 분석 탭

Claude AI가 현재 클러스터 상태를 종합 분석하여 이상 징후와 조치 방안을 제시합니다.

#### 클러스터 AI 진단

- **입력**: 노드 목록, 파드 상태, KPI 메트릭 (RPS, Latency, Error Rate, Kafka Lag)
- **출력**: Severity (OK / WARN / CRITICAL) + 이슈 목록 + 우선순위별 조치 권고
- "진단 실행" 버튼 클릭 → 약 5~10초 소요

#### 파이프라인 AI 진단

- **입력**: 워커 상태 + MongoDB/ES/Redis 지표
- **출력**: 데이터 흐름 이상 원인 + 해결 방안

---

## 4. 알림 기준

현재 Grafana Alerting을 통해 Slack `#alerts` 채널로 발송됩니다.

| 알림 | 조건 | 심각도 |
|---|---|---|
| **NodeCPUHigh** | 노드 CPU > 80%, 5분 지속 | WARN |
| **NodeMemoryHigh** | 노드 메모리 > 85%, 5분 지속 | WARN |
| **HighLatency** | P95 Latency > 100ms, 5분 지속 | CRITICAL |
| **KafkaLagHigh** | Consumer Lag > 1000 | WARN |

> Slack 알림이 오면 이 대시보드의 해당 탭을 먼저 확인하세요.

---

## 5. N/A 또는 데이터 없음 대처법

| 증상 | 가능한 원인 | 확인 방법 |
|---|---|---|
| Overview 전체 N/A | Mimir 연결 불가 또는 백엔드 파드 재시작 | `kubectl get pods -n tutum-app` |
| Traces 탭 "Tempo 연결 불가" | Tempo 서비스 다운 또는 OTel 미계측 | `curl http://192.168.0.230:3200/ready` |
| Logs 탭 비어있음 | Loki 연결 불가 또는 Alloy 미동작 | `kubectl get pods -n monitoring` |
| ES JVM Heap "exporter 미배포" | elasticsearch-exporter 파드 미기동 | `kubectl get pods -n tutum-data \| grep es-exporter` |
| Redis 메모리 GB 표시 | maxmemory 0 설정 (무제한) — 정상 | 별도 조치 불필요 |
| Kafka "메트릭 없음" | kafka-exporter 미기동 | `kubectl get pods -n tutum-data \| grep kafka-exporter` |

### 지표가 오래된 것 같을 때

헤더 우측 **"↺ 새로고침"** 버튼 클릭 — 전체 데이터 즉시 갱신.
자동 갱신 주기: 메트릭·파드·노드 30초, 로그 10초, 트레이스 60초.

---

## 참고 링크

- **Grafana**: `http://192.168.0.230:3000` (내부망 접속 필요)
- **Grafana Tempo Explore**: Traces 탭의 Trace ID 클릭 시 자동 이동
- **ArgoCD**: 파드 배포 상태 확인
- **관련 코드**:
  - 백엔드 API: [backend/app/routers/admin.py](../../backend/app/routers/admin.py)
  - 프론트엔드 UI: [frontend/app/admin/page.tsx](../../frontend/app/admin/page.tsx)
  - Alloy 설정: [k8s-manifests/step3-lgtm/alloy/00-alloy-configmap.yaml](../../k8s-manifests/step3-lgtm/alloy/00-alloy-configmap.yaml)
