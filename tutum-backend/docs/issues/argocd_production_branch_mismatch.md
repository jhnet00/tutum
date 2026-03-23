# [이슈] ArgoCD tutum-production이 main 브랜치를 추적 중

- 작성일: 2026-03-04
- 작성자: 박성준
- 상태: 미결 (의사결정 필요)

---

## 문제 상황

`tutum-production` ArgoCD Application이 `main` 브랜치를 추적하고 있으나,
팀은 현재 `develop` 브랜치만을 실제 작업 브랜치로 사용 중.

```
tutum-staging     → develop 브랜치 (자동 Sync) ✅
tutum-production  → main 브랜치    (수동 Sync) ⚠️
```

`main` 브랜치는 `develop` 대비 수십 커밋 뒤처져 있어
현재 production이 **OutOfSync / Degraded** 상태임.

### ArgoCD 현재 상태 (2026-03-04 확인)

| Application | Sync | Health |
|-------------|------|--------|
| tutum-staging | Synced | Healthy ✅ |
| tutum-production | OutOfSync | Degraded ❌ |

### main 브랜치 최신 커밋

```
8bc9c7d fix(ci): resolve backend lint and admin build errors
```

이후 적용된 변경사항(harbor-secret 제거, KEDA NetworkPolicy 수정 등)이 main에 반영되지 않아
production이 OutOfSync 상태.

---

## 선택지

### Option A: tutum-production도 develop 추적으로 변경

ArgoCD `tutum-production`의 `targetRevision`을 `main` → `develop`으로 수정.

- 장점: 단일 브랜치 운영, 관리 단순화
- 단점: staging/production 브랜치 분리 없어짐
- 추가 결정: 자동 Sync 여부 (staging은 자동, production은 현재 수동)

### Option B: develop → main 머지 워크플로우 유지

`develop` 검증 완료 후 `main`에 머지 → ArgoCD 자동 감지 → production 배포.

- 장점: staging 검증 후 production 배포하는 정석 워크플로우
- 단점: 머지 절차 추가, 현재 팀이 이 플로우를 사용하고 있지 않음
- 현재 OutOfSync 해소하려면 develop → main 머지 필요

### Option C: tutum-production 잠시 제거

EKS 마이그레이션 완료 시점에 재구성.

- 장점: on-prem K8s에서 production 운영 의미가 제한적인 경우 유효
- 단점: 클러스터 복구 기준점 손실

---

## 관련 파일

- `k8s-manifests/overlays/production/` — production overlay
- `k8s-manifests/overlays/staging/` — staging overlay
- `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md` — EKS 전환 계획
