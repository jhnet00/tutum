# 온프레미스 VM Shutdown 체크리스트 (2026-03-12)

## 목적
- 기존 온프레미스 VM 8대를 한 번에 종료하지 않고, 위험도를 낮춰 단계적으로 철수한다.
- VM별 선행 조건과 확인 명령을 한 장으로 정리한다.

## 원칙
- `cp1~3`, `w1~3`는 현재 즉시 종료 금지다.
- `mongo`, `monitoring`만 조건부 종료 후보로 본다.
- 각 단계는 `중지 전 확인 -> stop -> 서비스 검증 -> 다음 단계` 순서로 진행한다.

## 종료 순서

| 순서 | 대상 | 현재 판단 | 이유 |
|---|---|---|---|
| 1 | `mongo` (`192.168.0.231`) | 조건부 종료 가능 | 앱 정본은 EKS Mongo로 넘어갔지만 hidden client audit 필요 |
| 2 | `monitoring` (`192.168.0.230`) | 조건부 종료 가능 | AWS monitoring EC2가 있으나 old VM 참조 제거 확인 필요 |
| 3 | `w1~3` | 종료 금지 | app/data/storage/ingress/runner/SonarQube가 잔존 |
| 4 | `cp1~3` | 종료 금지 | kubeadm control-plane 자체가 live |

## 1. mongodb VM 종료 체크리스트

### 종료 전 확인
- [ ] `backend/auth/ocr/news`가 모두 AWS EKS MongoDB를 사용 중인지 확인
- [ ] legacy Mongo VM 접속자가 더 없는지 확인
- [ ] 외부 배치/cron/백업 경로가 legacy VM을 보지 않는지 확인
- [ ] 최근 24시간 앱 기능 정상 여부 확인

### 확인 명령
```bash
kubectl -n tutum-app exec deploy/backend -- sh -lc 'python - <<"PY"
import os
print(os.getenv("MONGODB_URL"))
PY'

ssh mongo 'mongosh --quiet --eval "db.runCommand({ ping: 1 })"'
ssh mongo 'ss -lntp | grep 27017 || true'
```

### 중지 후 검증
- [ ] 로그인/회원 조회/AI 채팅/뉴스 API 정상
- [ ] `backend`, `auth`, `ocr` 로그에 Mongo 연결 오류 없음
- [ ] `kubectl logs -n tutum-app deploy/backend --tail=200 | grep -i mongo` 결과 치명 오류 없음

## 2. monitoring VM 종료 체크리스트

### 종료 전 확인
- [ ] Alloy가 old monitoring VM이 아니라 AWS monitoring EC2를 바라보는지 확인
- [ ] admin `Overview`, `Logs`, `Traces`, `Data`가 AWS monitoring 경로로 정상 동작하는지 확인
- [ ] old VM에서만 존재하는 Grafana/Tempo/Loki 의존이 없는지 확인

### 확인 명령
```bash
kubectl -n monitoring logs -l app=alloy --tail=100
kubectl -n tutum-app exec deploy/backend -- sh -lc 'python - <<"PY"
import os
for k in ["MIMIR_URL", "LOKI_URL", "TEMPO_URL", "GRAFANA_URL"]:
    print(k, os.getenv(k))
PY'

aws ec2 describe-instances --region ap-northeast-2 \
  --filters "Name=tag:Name,Values=tutum-monitoring" "Name=instance-state-name,Values=running"
```

### 중지 후 검증
- [ ] admin `Overview` KPI 정상
- [ ] admin `Logs` 수집 정상
- [ ] admin `Traces` 조회 정상
- [ ] backend 로그에 `Mimir/Loki/Tempo` 연결 오류 없음

## 3. worker1~3 종료 체크리스트

### 종료 전 확인
- [ ] on-prem `kubectl get pods -A -o wide`에서 앱/데이터/스토리지 파드가 0개인지 확인
- [ ] `cloudflared`, `sonarqube`, `gitlab-runner`, `minio`, `kafka`, `mongodb`, `redis`, `elasticsearch`가 모두 종료 또는 AWS 대체 완료인지 확인
- [ ] Ingress, DNS, Route53, ALB만으로 서비스 진입 가능한지 확인

### 확인 명령
```bash
ssh cp1 'kubectl get pods -A -o wide'
ssh cp1 'kubectl get svc -A'
kubectl get pods -A -o wide
```

### 중지 후 검증
- [ ] `tutum.my` 접속 정상
- [ ] 로그인/차트/AI/뉴스/관리자 페이지 정상
- [ ] GitLab Runner, ArgoCD, 배포 경로 정상

## 4. control-plane cp1~3 종료 체크리스트

### 종료 전 확인
- [ ] on-prem kubeadm 클러스터에 서비스 파드가 더 이상 없음
- [ ] 필요한 스냅샷(`kubectl get all -A`, `get pvc -A`, `get cm -A`) 추출 완료
- [ ] rollback 계획 없이도 운영 가능한 상태 확인

### 확인 명령
```bash
ssh cp1 'kubectl get nodes -o wide'
ssh cp1 'kubectl get pods -A -o wide'
ssh cp1 'kubectl get all -A -o wide > /tmp/onprem-all-$(date +%Y%m%d).txt'
```

### 중지 후 검증
- [ ] AWS EKS만으로 운영 경로 유지
- [ ] GitOps, ingress, storage, monitoring, auth 모두 정상

## 종료 승인 기준

아래 조건을 모두 만족해야 다음 단계로 넘어간다.

- [ ] 종료 대상 VM 기능에 대한 AWS 대체 경로가 실제로 live
- [ ] 종료 후 핵심 사용자 경로 검증 완료
- [ ] 로그상 치명 오류 없음
- [ ] rollback 방법이 정리돼 있음
