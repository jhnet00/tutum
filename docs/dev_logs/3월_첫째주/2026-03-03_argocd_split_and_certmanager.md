# 2026-03-03 ArgoCD Staging/Production 분리 및 Cert-Manager 설치

## 작업자
박성준

## 작업 범위
- ISSUE-11: ArgoCD 앱 구조 단일→2개 분리 (tutum-staging / tutum-production)
- ISSUE-09: Cert-Manager v1.16.2 Helm 설치
- CI/CD deploy 잡 백엔드 레포 직접 push 방식으로 개선
- backend OOMKilled 원인 분석 및 메모리 한도 상향

---

## 1. ArgoCD Staging/Production 분리 (ISSUE-11)

### 기존 구조 문제점
- `tutum-app-gitops` 단일 앱이 `k8s-manifests/base` 를 직접 감시
- staging/production 환경 구분 없이 develop 브랜치 변경이 바로 배포됨
- `k8s-manifests/argocd/*.yaml`은 존재하지 않는 별도 레포 (`tutum-project/k8s-manifests.git`)를 참조

### 개선 내용

**ArgoCD 앱 재구성**:
```
삭제: tutum-app-gitops (k8s-manifests/base 감시)
생성: tutum-staging   (auto-sync, develop, k8s-manifests/overlays/staging)
생성: tutum-production (manual sync, main, k8s-manifests/overlays/production)
```

**배포 흐름**:
```
develop 브랜치 push
  → CI build/test/scan/sign
  → deploy:staging 잡: overlays/staging/kustomization.yaml newTag 업데이트
  → git push to develop [skip ci]
  → ArgoCD tutum-staging auto-sync → tutum-app 네임스페이스 배포

main 브랜치 push (PR merge)
  → CI deploy:production 잡 (when: manual 수동 실행)
  → overlays/production/kustomization.yaml newTag 업데이트
  → git push to main [skip ci]
  → ArgoCD tutum-production 수동 sync → tutum-app 네임스페이스 배포
```

**수정 파일**:
- `k8s-manifests/argocd/staging-app.yaml`: repoURL → backend.git, targetRevision → develop
- `k8s-manifests/argocd/production-app.yaml`: repoURL → backend.git, targetRevision → main
- `k8s-manifests/overlays/staging/kustomization.yaml`: `namePrefix: stg-` 제거
- `.gitlab-ci.yml`: `K8S_MANIFESTS_REPO` → backend.git, push 브랜치 fix, `[skip ci]` 추가

### CI Variable 등록 필요 (사용자 직접)
- `K8S_MANIFESTS_TOKEN`: GitLab PAT (`write_repository` 권한) → deploy 잡이 overlay 파일 push에 사용

---

## 2. Backend OOMKilled 디버깅 및 수정

### 원인
ArgoCD tutum-staging 적용 후 새 backend 파드가 `CrashLoopBackOff`.
```
exitCode: 137 (OOMKilled)
```
경윤님이 추가한 OpenTelemetry SDK(`opentelemetry-sdk`, `exporter-otlp-proto-grpc`)가 기존 staging overlay의 메모리 한도(512Mi)를 초과.

### 수정 (`k8s-manifests/overlays/staging/replicas-patch.yaml`)
```yaml
# 변경 전
requests.memory: 256Mi
limits.memory:   512Mi

# 변경 후
requests.memory: 384Mi
limits.memory:   768Mi
```

### 부수 발견 이슈
- `ocr` Deployment 크래시: `ImportError: cannot import name 'vision' from 'google.cloud'`
  - `google-cloud-vision` 패키지가 `requirements.txt`에 없음 → 경윤님이 추가한 OCR 기능, 코드 수정 필요

---

## 3. Cert-Manager 설치 (ISSUE-09)

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.16.2 \
  --set crds.enabled=true
```

**결과**: 3개 파드 모두 Running
```
cert-manager            1/1 Running
cert-manager-cainjector 1/1 Running
cert-manager-webhook    1/1 Running
```

**다음 단계**: Let's Encrypt ClusterIssuer 생성 + Istio Gateway HTTPS 포트(443) 전환

---

## 변경된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `k8s-manifests/argocd/staging-app.yaml` | repoURL, targetRevision, path 수정 |
| `k8s-manifests/argocd/production-app.yaml` | repoURL, path 수정 |
| `k8s-manifests/overlays/staging/kustomization.yaml` | namePrefix 제거, newTag latest |
| `k8s-manifests/overlays/staging/replicas-patch.yaml` | backend 메모리 512Mi→768Mi |
| `.gitlab-ci.yml` | K8S_MANIFESTS_REPO, 브랜치 fix, [skip ci] 추가 |
| `docs/plans/infra/K8S_MIGRATION_STATUS.md` | ISSUE-09, 11 완료 체크 |

## K8s 클러스터 직접 변경 사항

- `tutum-app-gitops` Application 삭제
- `tutum-staging` Application 생성 (auto-sync)
- `tutum-production` Application 생성 (manual sync)
- Helm: cert-manager v1.16.2 (cert-manager ns)

---

## 현재 서비스 상태

| 앱 | 상태 |
|----|------|
| tutum-staging | ArgoCD 등록, 실서비스 Running |
| tutum-production | ArgoCD 등록, main 브랜치 준비 대기 |
| cert-manager | Running (HTTPS 전환 준비 완료) |
| backend | 2 파드 Running (OOM 수정 완료) |
| ocr | CrashLoopBackOff (google-cloud-vision 누락, 별도 수정 필요) |

---

## 다음 작업

1. **사용자 필수**: `K8S_MANIFESTS_TOKEN` GitLab PAT 등록 (deploy 잡 동작 필수)
2. `ocr` 이슈: `requirements.txt`에 `google-cloud-vision` 추가 및 이미지 재빌드
3. HTTPS 전환: Let's Encrypt ClusterIssuer + Istio Gateway 443 포트 설정
4. Phase 4 CI/CD 전체 파이프라인 end-to-end 실행 확인
