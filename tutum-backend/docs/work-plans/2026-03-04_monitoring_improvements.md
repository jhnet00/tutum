# Work Plan: 모니터링 대시보드 개선 (멘토링 피드백 반영)

> 작성일: 2026-03-04
> 브랜치: `develop`
> 근거: `docs/feedback/03.04_mentoring.md` (정예찬 멘토님 피드백)

---

## 멘토링 피드백 요약

### Overview / Error
- 에러율을 **%가 아닌 건수**로 표시
- 어떤 에러가 어디서 발생했는지 표시
- **시계열 그래프** — x축(시간) y축(에러 건수/종류)

### Traces
- 어떤 경로를 거쳤는지, **어디서 끊겼는지** 표시
- 개발자가 한눈에 보고 디버깅 가능해야 함

### Kafka / Redis 지표
- Kafka lag가 **왜 중요한지 근거** 준비 (발표 대비)
- Redis **커넥션 수** 추가 (Pipeline 탭)
- Redis 클라이언트 버퍼 / lag 확인 가능하도록
- Elasticsearch **메모리** 지표 추가 (Pipeline 탭)

### CPU / Memory 임계치 & 알림
- 레이턴시 100ms 이상 = 심각으로 간주
- CPU / Memory 임계치 초과 시 **알림(Slack 등)** 구조
- 스크래핑 작업 CPU 스파이크 예외 처리 고려

### Infra 탭
- 노드/파드 **시계열 그래프** (24시간 CPU/Memory 추이)
- 파드 목록에서 "나이(age)" → **"기동 시간(startTime)"** 으로 변경
- **재시작 횟수 제거** → **downtime** (파드가 죽어 있었던 시간) 추가

### Pipeline 탭
- Redis **커넥션 수** 표시
- Elasticsearch **메모리 사용량** 표시

### Logs / Traces 탭
- 에러 발생 시 **500 / 400 구분**
- 해당 에러 **이전 발생 이력** 표시
- **언제 끊겼는지, 어디서 끊겼는지** 명시

### 보안
- `/etc/hosts.allow` / `/etc/hosts.deny` 설정 (SSH 접근 제한)
- `fail2ban` 으로 해외 IP / 무차별 접근 차단
- SSH `PermitRootLogin no` 확인
- 비밀번호 정책 (특수문자, 길이 등) 설정
- 중국 IP 접근 이력 auth 로그에서 확인
- Ubuntu 22 EOL(2027년) 대비 계획 수립
- KISA 보안 점검 항목 참고

---

## Task 목록

### 🔴 Priority 1 — 빠르게 임팩트 있는 것

| # | 작업 | 파일 | 상태 |
|---|------|------|------|
| 1 | 에러율 % → **건수(Count)** 로 변경 | `admin.py`, `page.tsx` | `[x]` |
| 2 | 에러 시계열 그래프 추가 (x:시간, y:건수, 400/500 구분) | `admin.py`, `page.tsx` | `[x]` |
| 3 | 파드 목록 age → startTime(절대 시각) 으로 변경 | `admin.py`, `page.tsx` | `[x]` |
| 4 | 파드 downtime 추가 (restartCount > 0 이면 마지막 재시작 시각 기반) | `admin.py`, `page.tsx` | `[x]` |

### 🟡 Priority 2 — Pipeline 탭 지표 보강

| # | 작업 | 파일 | 상태 |
|---|------|------|------|
| 5 | Redis 커넥션 수 추가 (`redis INFO clients` → `connected_clients`) | `admin.py`, `page.tsx` | `[x]` |
| 6 | Elasticsearch 메모리 사용량 추가 (`/_nodes/stats` JVM heap) | `admin.py`, `page.tsx` | `[x]` |
| 7 | Kafka lag 표시에 **근거 코멘트** 추가 (UI 툴팁 or 발표 자료) | `page.tsx` / PPT | `[x]` |

### 🟡 Priority 3 — Infra 탭 시계열

| # | 작업 | 파일 | 상태 |
|---|------|------|------|
| 8 | 노드별 CPU/Memory **24시간 시계열 그래프** (Mimir query_range) | `admin.py`, `page.tsx` | `[x]` |
| 9 | 레이턴시 임계치 100ms 기준선 그래프에 표시 | `page.tsx` | `[x]` |

### 🟢 Priority 4 — 알림 (Alerting)

| # | 작업 | 파일 | 상태 |
|---|------|------|------|
| 10 | CPU/Memory 임계치 초과 시 Slack 알림 (Grafana Alerting or Alloy rule) | k8s-manifests / Grafana | `[x]` |
| 11 | P95 레이턴시 > 100ms 알림 | k8s-manifests / Grafana | `[x]` |

### 🔵 Priority 5 — 보안 강화

| # | 작업 | 상태 |
|---|------|------|
| 12 | 각 노드 `/etc/hosts.deny ALL:ALL` → 팀원 IP만 허용 | `[x]` |
| 13 | `fail2ban` 설치 및 SSH 브루트포스 차단 설정 | `[x]` |
| 14 | SSH `PermitRootLogin no` 확인 및 적용 | `[x]` |
| 15 | `/var/log/auth.log` 에서 중국 IP 접근 이력 확인 | `[x]` |
| 16 | Admin 대시보드 `/admin` 경로 인증 보호 (middleware + backend Depends) | `[x]` |

---

## 세부 구현 메모

### Task 1-2: 에러 건수 + 시계열

**백엔드 쿼리 추가** (`admin.py`):
```python
# 에러 건수 (2분 누적)
"error_count": (
    'sum(increase(http_requests_total{namespace="tutum-app",status=~"5.."}[2m]))'
),
# 400 에러 건수
"client_error_count": (
    'sum(increase(http_requests_total{namespace="tutum-app",status=~"4.."}[2m]))'
),
# 시계열: 지난 1시간 1분 단위 에러 건수
# → query_range로 step=60s
```

### Task 3-4: 파드 startTime / downtime

K8s SDK에서 `pod.status.start_time` 반환 가능.
downtime = `restartCount > 0` 일 때 `lastState.terminated.finishedAt` 활용.

### Task 5: Redis 커넥션

```python
import redis
r = redis.Redis(host="redis.tutum-data.svc.cluster.local", port=6379)
info = r.info("clients")
connected_clients = info["connected_clients"]
```

### Task 6: Elasticsearch 메모리

```
GET http://elasticsearch.tutum-data.svc.cluster.local:9200/_nodes/stats/jvm
→ nodes[*].jvm.mem.heap_used_in_bytes / heap_max_in_bytes
```

### Task 8: 노드 시계열 (Mimir)

```
query_range:
  query: avg(rate(node_memory_MemAvailable_bytes[5m])) by (instance)
  start: now-24h, end: now, step: 5m
```

---

## 참고 — Kafka Lag 중요성 근거 (발표용)

> Kafka Consumer Lag = 메시지 큐에 쌓인 미처리 메시지 수
 
| 상황 | 증상 | 결과 |
|------|------|------|
| lag 급증 | consumer가 처리 속도를 따라가지 못함 | 뉴스 수집 지연, ES 인덱싱 지연 |
| lag 0 | 정상 소비 | 실시간 파이프라인 동작 |
| lag 지속 고착 | consumer 장애 / OOM | 파이프라인 완전 중단 |

→ **lag이 높아지면 사용자에게 노출되는 뉴스 데이터가 지연됨**
→ 임계치(예: lag > 1000) 초과 시 알림 설정 권장
