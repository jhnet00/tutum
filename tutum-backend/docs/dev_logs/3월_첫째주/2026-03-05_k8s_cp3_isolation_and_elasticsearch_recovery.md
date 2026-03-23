# CP-3 격리 및 Elasticsearch 복구 작업 (2026-03-05)

**날짜**: 2026-03-05
**작업자**: 김경윤
**브랜치**: develop

---

## 1. 작업 요약

- 마이그레이션 이후 K8s 클러스터 안정성 재점검
- `cp-3` 영향 격리 및 staging/production 앱 가용성 복구
- ArgoCD repo-server 크래시 및 데이터플레인 Redis 장애 복구
- Elasticsearch 스케줄링/프로브 정책 GitOps 소스에 안정화 반영

---

## 2. 상세 변경 내용

### 런타임 작업 (클러스터)

- `cp-3` 코든(cordon) + control-plane taint 복원 → 신규 워크로드 배치 차단
- `cp-3`에 남아있던 앱 파드 강제 축출(evict) → worker 노드로 재스케줄
- `argocd-repo-server` init 컨테이너의 symlink 명령 수정 (`ln -s` → `ln -sf`) 후 롤아웃 재시작
- `redis-1` CrashLoop 복구: StatefulSet 스케일 사이클로 AOF 손상 경로 재생성
- `tutum-app`, `tutum-prod-app` 워크로드 파드를 정상 worker 노드에서 재생성

### Git 변경

**`k8s-manifests/base/data/elasticsearch.yaml`**

- `nodeSelector.workload`: `data` → `app` (현재 worker 노드 레이블 기준 맞춤)
- 기동 프로브 창 확대 (Elasticsearch 기동 지연 대응):

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| `readinessProbe.initialDelaySeconds` | 20 | 60 |
| `readinessProbe.failureThreshold` | 3 | 6 |
| `livenessProbe.initialDelaySeconds` | 30 | 120 |
| `livenessProbe.failureThreshold` | 3 | 6 |

**`k8s-manifests/overlays/staging/kustomization.yaml`**

- staging 이미지 태그를 `2df8d9da`로 고정 (backend, frontend, workers)
- 목적: 현재 검증된 실행 이미지와 일치시켜 Kyverno 서명 강제 정책 sync 블록 해소

---

## 3. 장애 및 해결

### cp-3 NotReady로 인한 부분 가용성 저하

**증상**: `cp-3`가 NotReady 상태로 구 워크로드 파드를 유지 → 가용성 편중 및 readiness 왜곡

**조치**: 스케줄링 격리 + 영향 파드 강제 축출 → worker1/2/3으로 재배치

---

### ArgoCD repo-server init 컨테이너 실패

**증상**: `ln: Already exists` 오류로 init 컨테이너 실패 → Argo 앱 Unknown/Progressing 상태

**조치**: init 명령을 멱등 symlink 생성(`ln -sf`)으로 패치 후 Deployment 재시작

---

### Kyverno 이미지 서명 검증으로 staging auto-sync 차단

**증상**: 서명되지 않은 태그 `48cb5aa1`에 대해 Kyverno `verify-image-signature` 정책 차단

**조치**: staging Kustomize 이미지 태그를 서명된 실행 태그 `2df8d9da`로 업데이트

---

### redis-1 AOF 손상으로 CrashLoop

**증상**: `Bad file format ... appendonly.aof` 오류로 `redis-1` 반복 재시작

**조치**: StatefulSet 스케일 사이클 + PVC 재생성 경로로 복제본 재구축

---

### Elasticsearch 기동 불안정

**증상**: 현재 클러스터 제약 및 프로브 타이밍 문제로 Elasticsearch 정착 실패

**조치**: GitOps 매니페스트에 스케줄링 호환성 + 기동 헬스체크 창 확대 반영

---

## 4. 결과 (검증 포함)

```bash
kubectl get nodes -o wide
# cp-1/cp-2/worker1/worker2/worker3 Ready, cp-3 NotReady,SchedulingDisabled

kubectl -n tutum-app get deploy
# elastic-consumer 제외 전체 Ready (Elasticsearch 안정화 대기)

kubectl -n tutum-prod-app get deploy
# backend/email-worker/frontend/price-consumer/price-producer 전체 Ready

kubectl -n tutum-data get sts
# kafka 3/3, mongodb 3/3, redis 3/3, elasticsearch 안정화 대기

kubectl -n argocd get applications.argoproj.io
# tutum-production OutOfSync/Healthy
# tutum-staging OutOfSync/Progressing

curl -I http://192.168.0.240/
# 200

curl -I http://192.168.0.240/api/v1/market/price/crypto/KRW-BTC
# 200
```

---

## 5. 후속 과제 / 리스크

- [ ] `cp-3` 호스트 수준 SSH/kubelet/containerd 복구 후 Ready 복귀 → **금일 수동 재기동으로 해소**
- [ ] develop 브랜치 푸시 이후 Argo staging 앱 Synced/Healthy 확인
- [ ] Elasticsearch 완전 안정화 후 `elastic-consumer` Ready 전환 확인
- [ ] 노드 역할/레이블 정책(`workload=app|data`) 재정립 → 향후 셀렉터 충돌 방지
