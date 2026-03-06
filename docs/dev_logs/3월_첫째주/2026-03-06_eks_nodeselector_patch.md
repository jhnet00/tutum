# 2026-03-06 EKS nodeSelector 제거 패치

## 작업자
박성준

## 작업 배경
ArgoCD에서 staging overlay 배포 시 Pod들이 Pending 상태 유지.
원인: base deployment YAML에 on-prem 전용 nodeSelector(`workload=app/data/consumer`)가 설정되어 있었으나
EKS Auto Mode 노드에는 해당 레이블이 존재하지 않아 스케줄링 불가 (0/4 nodes available).

## 해결 방법

### 파일 생성: `k8s-manifests/overlays/staging/remove-nodeselector-patch.yaml`
- Strategic Merge Patch 방식으로 nodeSelector를 `{}` (빈 값)으로 오버라이드
- 대상 리소스 (Deployment 9개 + StatefulSet 1개):
  - `backend`, `frontend` (tutum-app ns)
  - `price-producer`, `price-consumer` (tutum-app ns)
  - `news-producer`, `news-consumer` (tutum-app ns)
  - `elastic-consumer`, `email-worker`, `ocr` (tutum-app ns)
  - `elasticsearch` StatefulSet (tutum-data ns)

### 파일 수정: `k8s-manifests/overlays/staging/kustomization.yaml`
```yaml
patches:
  - path: replicas-patch.yaml
  - path: remove-nodeselector-patch.yaml   # 추가
```

## 기대 효과
- EKS Auto Mode 노드(Bottlerocket/Karpenter)에서 Pod 정상 스케줄링
- base의 on-prem 전용 nodeSelector를 staging 환경에서만 무력화
- production overlay에는 영향 없음 (별도 overlay 구조)

## 비고
- base deployment YAML의 nodeSelector 자체는 수정하지 않음 (on-prem 운영 환경과의 호환성 유지)
- staging에서만 EKS 대응 패치 적용 → GitOps 오버레이 패턴 준수
