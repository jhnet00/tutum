# 2026-02-27 Grafana 대시보드 데이터 미표시 문제 수정

## 작업자
박성준

## 작업 유형
Infra / 모니터링 버그 수정

## 배경
Grafana (`http://192.168.0.230:3000`) 접속 시 CloudDX Overview 대시보드 패널 대부분이 "No data"로 표시되는 문제 발견. InfluxDB 데이터소스 연결 오류도 확인됨.

---

## 전체 진단 결과

### 데이터소스 Health Check (수정 전)
| 데이터소스 | 상태 | 원인 |
|-----------|------|------|
| Mimir | ✅ OK | - |
| Loki | ✅ OK | - |
| Tempo | ⚠️ Method not implemented | Grafana health check 미지원 (Tempo 정상 동작) |
| **InfluxDB** | ❌ ERROR | 토큰 미설정 (secureJsonFields 비어있음) |

### CloudDX Overview 패널별 상태 (수정 전)
| 패널 | 쿼리 | 원인 | 결과 |
|------|------|------|------|
| Panel 1: Backend API RPS | `rate(http_requests_total{job=~".*backend.*"}[5m])` | job 레이블 불일치 | **No Data** |
| Panel 2: Error Rate (5xx) | `rate(http_requests_total{status=~"5.."}[5m]) / rate(...)` | 5xx 없을 때 numerator 빈값 → No Data | **No Data** |
| Panel 3: P95 Latency | `histogram_quantile(0.95, ...)` | 정상 (필터 없음) | ✅ 정상 |
| Panel 4: Kafka Consumer Lag | `kafka_consumer_group_lag` | Kafka exporter 미설치 | **No Data** |
| Panel 5: Redis Hit Ratio | `redis_keyspace_hits_total / ...` | Redis exporter 미설치 | **No Data** |

---

## 원인 상세

### 1. InfluxDB 토큰 미설정
- Grafana datasource의 `secureJsonFields`가 비어있어 모든 InfluxDB 쿼리 401 Unauthorized
- k6 Load Testing Results 대시보드 전체 불가
- **해결**: InfluxDB session 로그인으로 admin token 획득, Grafana API로 datasource 업데이트

### 2. Panel 1 - job 레이블 불일치
- Alloy가 K8s pod scrape 시 붙이는 job 레이블: `prometheus.scrape.k8s_pods`
- 대시보드 쿼리에 `job=~".*backend.*"` 필터 → 매칭 없음
- Backend pod 식별 방법: instance 포트가 `:8000` (frontend는 `:3000`)

### 3. Panel 2 - Error Rate 빈값 처리 미흡
- `status=~"5.."` regex는 "5xx" 레이블 형식과 매칭되나
- 현재 5xx 에러 없음 → numerator empty → Grafana "No Data" 표시
- **해결**: `or on() vector(0)` 추가로 5xx 없을 때 0 반환

### 4. Kafka / Redis exporter 미설치
- Kafka Consumer Lag, Redis Hit Ratio 패널은 별도 exporter 필요
- Kafka: JMX exporter 또는 kafka-lag-exporter 필요
- Redis: redis-exporter (oliver006/redis_exporter) 필요
- **현재 미조치** — 별도 인프라 작업으로 처리 예정

---

## 수정 내용

### 1. InfluxDB 데이터소스 토큰 업데이트 (Grafana API)
```bash
TOKEN="GSW6Ppk3SLDt5zM54jIXI1rrb0g4yU9mdMaMpIf342nV0S69NAO9a2cGdYclNUmeoMC32APrTlXbdxXVBXGQtg=="

curl -X PUT -u admin:tutum2026! \
  "http://192.168.0.230:3000/api/datasources/4" \
  -H "Content-Type: application/json" \
  -d '{"secureJsonData": {"token": "'"$TOKEN"'"}}'
```

### 2. CloudDX Overview 대시보드 쿼리 수정 (Grafana API, dashboard version 1 → 3)

#### Panel 1 (Backend API RPS)
```promql
# 수정 전
rate(http_requests_total{job=~".*backend.*"}[5m])

# 수정 후
rate(http_requests_total{job="prometheus.scrape.k8s_pods",instance=~".*:8000"}[5m])
```

#### Panel 2 (Error Rate 5xx)
```promql
# 수정 전
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# 수정 후
(sum(rate(http_requests_total{status="5xx",job="prometheus.scrape.k8s_pods",instance=~".*:8000"}[5m])) or on() vector(0))
/ sum(rate(http_requests_total{job="prometheus.scrape.k8s_pods",instance=~".*:8000"}[5m]))
```

#### Panel 3 (P95 Latency)
```promql
# 수정 후 (필터 추가)
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="prometheus.scrape.k8s_pods",instance=~".*:8000"}[5m])))
```

---

## 수정 결과

### 데이터소스 상태 (수정 후)
| 데이터소스 | 상태 |
|-----------|------|
| Mimir | ✅ OK |
| Loki | ✅ OK |
| Tempo | ⚠️ "Method not implemented" (트레이스 기능 자체는 정상) |
| InfluxDB | ✅ OK — 3 buckets found |

### CloudDX Overview 패널 상태 (수정 후)
| 패널 | 상태 |
|------|------|
| Panel 1: Backend API RPS | ✅ 실시간 API 요청 데이터 표시 |
| Panel 2: Error Rate (5xx) | ✅ 0% 표시 (현재 에러 없음) |
| Panel 3: P95 Latency | ✅ 정상 |
| Panel 4: Kafka Consumer Lag | ❌ No Data (exporter 미설치 — 후속 작업) |
| Panel 5: Redis Hit Ratio | ❌ No Data (exporter 미설치 — 후속 작업) |

---

## Tempo "Method not implemented" 설명
Grafana의 Tempo 데이터소스 health check는 `/api/v1/health` 등의 엔드포인트를 호출하지만, Tempo 백엔드는 이를 미구현 상태로 응답함. 이는 Grafana-Tempo 플러그인의 알려진 동작으로, 실제 트레이스 쿼리와 Loki/Metrics 연동은 정상 동작. 에러 표시에 현혹되지 않아야 함.

---

## 후속 작업 필요 항목

### Kafka exporter 설치
- **방식 A**: Kafka 파드에 JMX exporter 사이드카 추가 (`jmx_prometheus_javaagent`)
- **방식 B**: kafka-lag-exporter (IBM/kafka-lag-exporter 또는 seglo/kafka-lag-exporter) 별도 Deployment
- Alloy에 scrape job 추가 후 `kafka_consumer_group_lag` 메트릭 수집

### Redis exporter 설치
- **방식**: `oliver006/redis_exporter` 사이드카 또는 별도 Deployment
- Redis Pod에 `redis_exporter_connection_string: redis://redis-master.tutum-data.svc:6379` 설정
- Alloy에 scrape job 추가 후 `redis_keyspace_hits_total`, `redis_keyspace_misses_total` 수집

---

## 수정 파일
- Grafana 데이터소스 (API): InfluxDB datasource ID:4 토큰 업데이트
- Grafana 대시보드 (API): CloudDX Overview UID `cfe9hn687abk0e` v1 → v3
