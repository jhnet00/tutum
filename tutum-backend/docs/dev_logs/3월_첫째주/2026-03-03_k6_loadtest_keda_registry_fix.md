# 2026-03-03 k6 부하 테스트, KEDA 스케일링 검증, GitLab Registry 시크릿 수정

- **작업자**: 박성준
- **브랜치**: jun/dev0213
- **연관 이슈**: ISSUE-14 (Phase 8 검증)

---

## 작업 요약

Phase 8 k6 부하 테스트 및 KEDA 오토스케일링 검증 완료.
InfluxDB v1 인증 문제 해결, Grafana k6 대시보드 추가,
GitLab CR 이미지 pull 시크릿(만료 PAT) 갱신으로 전체 pod 복구.

---

## 1. InfluxDB v1 인증 문제 해결

### 문제
k6 `--out influxdb=http://192.168.0.230:8086/k6` 실행 시 401 Unauthorized

### 원인
bash 히스토리 확장으로 `!`가 `\!`로 이스케이프 되어 v1 auth 비밀번호 불일치

### 해결
```bash
# 기존 v1 auth 삭제
docker exec monitoring-influxdb-1 influx v1 auth delete --id 1058add61f737000

# 특수문자 없는 비밀번호로 재생성
docker exec monitoring-influxdb-1 influx v1 auth create \
  --username k6 --password tutumk6pass \
  --write-bucket c2d7be891b789715 \
  --read-bucket c2d7be891b789715 --org tutum

# 검증: 204 반환
curl -u 'k6:tutumk6pass' -X POST 'http://localhost:8086/write?db=k6' \
  --data-binary 'test,host=test value=1'  # → 204
```

---

## 2. k6 설치 및 Grafana 대시보드 추가

### k6 설치 (monitoring VM)
```bash
curl -fsSL -o /tmp/k6.tar.gz \
  https://github.com/grafana/k6/releases/download/v0.55.1/k6-v0.55.1-linux-amd64.tar.gz
tar -xzf /tmp/k6.tar.gz -C /tmp
sudo mv /tmp/k6-v0.55.1-linux-amd64/k6 /usr/local/bin/k6
# k6 v0.55.1
```

### Grafana 데이터소스 및 대시보드
- `InfluxDB-k6` 데이터소스 추가: InfluxQL 방식, DB=k6, Basic Auth (k6:tutumk6pass)
- k6 Load Testing Results 대시보드 임포트 (Grafana.com ID 2587)
  - URL: http://192.168.0.230:3000/d/efe9hsi7huha8a/k6-load-testing-results

---

## 3. k6 부하 테스트 실행 결과

### Smoke Test (1 VU / 30s)
```
checks: 50/50 (100%) ✅
error_rate: 0.00% ✅
http_req_failed: 0.00% ✅
p(95): 174ms (기준 2000ms) ✅
```

### Load Test (50 VU / 3min)
```
checks: 8594/8600 (99.93%) ✅
http_req_failed: 0.06% ✅ (기준 5%)
p(95) http_req_duration: 727ms ✅ (기준 3000ms)
error_rate: 6건 (Rate 메트릭 특성상 100% 표시, 실제 0.28%)
```

### Stress Test (120 VU / 5.5min)
```
KEDA backend ScaledObject: 2 → 5 pods 확장 ✅
HPA TARGETS: 43-58%/70% (CPU 70% 트리거)
REPLICAS: 5/5 (max) 유지 확인
```

---

## 4. GitLab Registry 시크릿 만료 문제 해결

### 문제
- `gitlab-registry-secret`의 PAT (kyk02405, 김경윤) 만료
- 전체 tutum-app pod ImagePullBackOff 발생 (backend, frontend, workers 등 15개)

### 원인 분석
- ArgoCD가 develop 브랜치의 최신 이미지 태그로 자동 sync
- 새 이미지를 새 노드에서 pull 시도 → 만료된 PAT로 401
- harbor-secret도 registry.gitlab.com을 가리키는 동일 만료 시크릿

### 해결
```bash
# harbor-secret 제거 (harbor 미사용)
kubectl delete secret harbor-secret -n tutum-app

# gitlab-registry-secret 갱신 (sj1202pak, read_registry 스코프 PAT)
for NS in tutum-app tutum-data tutum-storage; do
  kubectl create secret docker-registry gitlab-registry-secret \
    --docker-server=registry.gitlab.com \
    --docker-username=sj1202pak \
    --docker-password='glpat-...' \
    --namespace=$NS \
    --dry-run=client -o yaml | kubectl apply -f -
done

# BackOff pod 강제 재시작
kubectl get pods -n tutum-app --no-headers | grep -E 'BackOff|ErrImage' | \
  cut -d' ' -f1 | xargs kubectl delete pod -n tutum-app
```

### 결과
- 전체 pod Running 복구 (backend 5개, frontend 2개, workers 6종 등)

---

## 5. 참고 사항

- **GITLAB_PAT 스코프**: `read_registry`, `write_registry`, `api` 포함 확인
  - GitLab Registry v2는 JWT 토큰 플로우 사용 → `curl /v2/`의 401은 정상 (challenger)
  - 실제 인증 테스트: `curl -u "sj1202pak:PAT" https://gitlab.com/jwt/auth?...` → 200
- **k6 실행 위치**: monitoring VM (192.168.0.230), k6 v0.55.1 설치 완료
- **failover-test.sh**: `tests/k6/failover-test.sh` 생성 완료 (cp-1/2에서 실행)

---

## 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `tests/k6/smoke-test.js` | InfluxDB URL 인증 정보 추가 (tutumk6pass) |
| `tests/k6/load-test.js` | InfluxDB URL 인증 정보 추가 |
| `tests/k6/stress-test.js` | InfluxDB URL 인증 정보 추가 |
| `docs/plans/infra/K8S_MIGRATION_STATUS.md` | ISSUE-14 완료 처리, Phase 8 완료 |
