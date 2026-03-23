# Dev Log: 모니터링 알림 규칙 + 보안 강화

> 작성일: 2026-03-04
> 작성자: kyungyoonkim
> 브랜치: `develop`
> 근거: `docs/work-plans/2026-03-04_monitoring_improvements.md` (Priority 4-5)

---

## 1. Grafana Alert Rules 완료 (Priority 4)

### 1-1. NodeCPUHigh 알림 추가
- **쿼리**: `100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80`
- **조건**: 5분 이상 CPU > 80% 유지 시 `slack-alerts` 채널로 알림
- **근거**: node-exporter DaemonSet에서 수집된 실제 노드 CPU 메트릭 활용

### 1-2. NodeMemoryHigh 알림 추가
- **쿼리**: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85`
- **조건**: 5분 이상 메모리 > 85% 유지 시 `slack-alerts` 채널로 알림
- **근거**: worker3 메모리 92% 사태 재발 방지 (Kibana/SonarQube 이전 후 54%로 안정화)

### 1-3. HighLatency 임계치 수정
- **변경**: `> 2s` → `> 0.1s (100ms)`
- **근거**: 멘토 피드백 — "레이턴시 100ms 이상이면 심각한 수준"

### 버전 관리
- `k8s-manifests/step3-lgtm/monitoring-vm/grafana/provisioning/alerting/alert-rules.yml` 신규 생성
- 기존 6개 + 신규 2개 = 총 8개 alert rule 코드로 관리

---

## 2. 보안 강화 (Priority 5)

### 2-1. fail2ban 설치 (전체 6개 노드)
- **대상**: cp-1, cp-2, cp-3, worker1, worker2, worker3
- **설정** (`/etc/fail2ban/jail.local`):
  ```ini
  [DEFAULT]
  bantime  = 1h
  findtime = 10m
  maxretry = 5
  backend  = systemd

  [sshd]
  enabled  = true
  port     = ssh
  maxretry = 5
  bantime  = 24h
  ```
- **방법**: K8s DaemonSet (privileged + hostPID + host volume mount) 사용하여 일괄 적용
- **결과**: 전 노드 `fail2ban status: active` 확인

### 2-2. PermitRootLogin no (전체 6개 노드)
- `/etc/ssh/sshd_config`의 `#PermitRootLogin prohibit-password` → `PermitRootLogin no`로 변경
- `sshd -t && systemctl reload sshd`로 설정 검증 후 적용
- **결과**: 전 노드 적용 확인

### 2-3. auth.log 중국 IP 접근 이력 조사
- `/var/log/auth.log` 전체 검색 결과: **외부 IP 접근 시도 없음**
- 모든 실패 로그는 내부 LAN (192.168.0.3, 192.168.0.13) — 팀원 SSH 테스트
- **이유**: 클러스터가 사설망(192.168.0.x/24)에 위치, 인터넷 직접 노출 없음
- **발표 포인트**: 사설망 격리 + fail2ban 이중 방어 구조로 어필

### 2-4. hosts.allow/deny — 보류 판단
- 현재 클러스터가 사설망 내부에 있어 외부 SSH 접근이 원천 차단됨
- TCP wrapper(hosts.allow/deny)는 추가 이중 방어지만 잘못 설정 시 팀원 lockout 위험
- → fail2ban으로 충분히 커버됨. hosts.allow/deny는 퍼블릭 IP 노출 환경에서 재검토

---

## 3. 현재까지 work-plan 진행 현황

| Priority | 작업 | 상태 |
|----------|------|------|
| P1 | 에러 건수(5xx/4xx) + 시계열 그래프 | ✅ |
| P1 | 파드 startTime / downtime | ✅ |
| P2 | Redis 커넥션 수 + ES JVM Heap | ✅ |
| P3 | 노드 24시간 CPU/Memory 시계열 | ✅ |
| P4 | NodeCPUHigh / NodeMemoryHigh Slack 알림 | ✅ |
| P4 | HighLatency 임계치 100ms 수정 | ✅ |
| P5 | fail2ban 설치 (전체 노드) | ✅ |
| P5 | PermitRootLogin no | ✅ |
| P5 | auth.log 조사 | ✅ |
| P2 | Kafka lag UI 툴팁/코멘트 | ✅ |
| P3 | 레이턴시 100ms 기준선 그래프 표시 | ✅ |
| P5 | Admin `/admin` 경로 인증 보호 | ✅ |

---

## 참고: 보안 발표 어필 포인트

```
"내부 방화벽은 fail2ban + sshd PermitRootLogin no로,
외부 방화벽은 사설망 격리로 설정했습니다.
auth.log 확인 결과 외부 공격 시도는 없었으며,
fail2ban으로 SSH brute force를 자동 차단하는 구조입니다."
```
