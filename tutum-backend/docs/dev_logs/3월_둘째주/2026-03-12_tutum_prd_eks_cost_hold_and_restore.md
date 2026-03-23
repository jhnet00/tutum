# Dev Log: tutum-prd-eks 비용 절감 시도 후 안정 상태 정리 (2026-03-12)

> 날짜: 2026-03-12  
> 작성자: Ruby Kim  
> 브랜치: `develop`

## 1. 작업 요약

- `tutum-prd-eks`의 불필요한 비용 원인을 점검하고, 서비스 유지형 축소를 시도했다.
- 실패 상태의 managed nodegroup `ng-prd-general`은 삭제 단계로 진입했고, 관련 `m6i.large` 2대가 `shutting-down` 상태임을 확인했다.
- prod 앱은 완전 정지가 아니라 `backend/frontend` 최소 유지 상태로 조정했고, Karpenter `general-purpose` NodePool은 복구해 현재 상태를 유지하기로 확정했다.
- 결과적으로 managed nodegroup 비용은 줄였고, prod 서비스는 유지되지만 추가적인 노드 감축은 보류하는 방향으로 정리했다.

## 2. 오늘 확인한 핵심 상태

### 2.1 EKS / NodeGroup 상태
- Cluster: `tutum-prd-eks`
- Cluster status: `ACTIVE`
- Kubernetes version: `1.35`
- Managed nodegroup `ng-prd-general`: `DELETING`
- 관련 EC2 인스턴스:
  - `i-0afed1b00786d9b89` `m6i.large` `shutting-down`
  - `i-0642c522727250a4b` `m6i.large` `shutting-down`

### 2.2 현재 유지 중인 Karpenter 노드
- `system` nodepool: `c6g.large` 2대
- `general-purpose` nodepool: `c5a.large` 3대
- 추가 복구 과정에서 새 NodeClaim이 생성되었고, 최소 서비스 유지용 일반 노드 3대가 필요한 상태임을 확인했다.

### 2.3 현재 prod 앱 상태
namespace: `tutum-app`

유지 중:
- `backend` 1 Running
- `frontend` 1 Running

중지 또는 축소:
- `elastic-consumer` 0
- `email-worker` 0
- `news-consumer` 0
- `news-producer` 0
- `ocr` 0
- `price-consumer` 0
- `price-producer` 0
- `cloudflared` 0

추가 관찰:
- `backend` / `frontend`의 새 replica 일부는 Pending 상태였다.
- `istiod`가 `general-purpose` 노드 한 대에 단독으로 올라가 있었고, PDB 때문에 drain이 불가능했다.

## 3. 수행한 조치와 결과

### 3.1 비용 절감 성공 구간
- `ng-prd-general` 삭제 진입 확인
- 실패한 managed nodegroup의 `m6i.large` 2대 종료 시작 확인
- 워커류/비핵심 앱 replica 축소 확인

### 3.2 보류한 구간
- `general-purpose`를 2대로 더 줄이려는 시도는 중단
- 이유:
  - `istiod` 단일 replica + PDB로 drain 불가
  - `argocd`, `keda`, `istio`, 앱 일부가 `general-purpose`에 남아 있음
  - 무리하게 줄이면 서비스 유지보다 장애 가능성이 더 커짐

### 3.3 복구 조치
- 삭제했던 `general-purpose` NodePool을 다시 생성
- `i-0814fd83b965ed32e` 노드를 `uncordon`
- 현재는 `general-purpose` 3대 상태를 유지하는 것이 가장 안전하다고 판단

## 4. 현재 결론

- managed nodegroup 비용은 실제로 줄어드는 중이다.
- 그러나 prod는 아직 `backend/frontend/istio/argocd/keda`를 포함한 최소 운영 세트를 사용하고 있어, `general-purpose` 3대를 더 줄이기는 어렵다.
- 따라서 현재 최적 상태는 다음과 같다.
  - managed nodegroup 제거 유지
  - `system` 2대 유지
  - `general-purpose` 3대 유지
  - `backend/frontend` 최소 replica 유지
  - 나머지 비핵심 워커는 0 유지

## 5. 비용 관점 요약

이미 반영된 절감:
- `m6i.large` 2대 제거 진행
- 예상 절감: 하루 약 `$5.66/day`

현재 유지 비용(대략):
- `general-purpose` `c5a.large` 3대
- `system` `c6g.large` 2대
- 대략 compute 기준 하루 약 `$9.89/day`

해석:
- 현재는 서비스 유지와 비용 절감 사이에서 안정 우선으로 멈춘 상태다.
- 추가 절감은 가능하지만, 구조 분리 없이 강행하면 장애 위험이 커진다.

## 6. 시스템 상태 점검 요약

현재 시스템 전체 판단:
- staging 중심 운영은 계속 가능
- prod는 “완전 중지”가 아니라 “최소 유지 상태”
- ArgoCD / KEDA / Istio / 앱 워크로드가 일반 노드에 혼재돼 있어, 인프라용 노드와 앱 노드 분리가 아직 불완전함
- 프론트 `Cost` 탭 관련 코드는 반영됐지만, frontend 배포는 GitLab 보호 변수/브랜치 정책 때문에 아직 미완료

## 7. 다음 작업 우선순위

1. prod 인프라 파드(`argocd`, `keda`, `istio`)와 앱 파드를 분리할 수 있도록 NodePool / taint / selector 전략 정리
2. frontend GitLab 보호 브랜치/보호 변수 정책 정리 후 admin Cost 탭 실제 배포
3. prod 쪽 `tutum-stg-ingress` 등 네이밍 드리프트 자원 정리
4. 필요 시 prod 최소 운영 기준 문서화
   - 무엇을 1 replica로 유지할지
   - 무엇을 0으로 유지할지
   - 비용 홀드 시 실행 순서

## 8. 관련 문서

- `D:\dev\tutum-backend\docs\ruby\aws_settings\2026-03-12_tutum_prd_eks_cost_hold_and_restore_steps.md`

## 9. 커밋 로그

```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```
