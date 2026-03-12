# Dev Log: tutum-prd-eks 비용 홀드 상태 점검 및 재가동 절차 정리 (2026-03-12)

> 날짜: 2026-03-12  
> 작성자: Ruby Kim  
> 브랜치: `develop`

## 1. 작업 요약

- `tutum-prd-eks` 현재 비용 소모 상태를 재점검했다.
- `ng-prd-general` managed nodegroup은 삭제 완료 상태임을 확인했다.
- 다만 prod 클러스터는 완전히 비워진 상태가 아니며, Karpenter `general-purpose` 노드 3대와 `system` 노드 2대가 계속 떠 있는 상태를 확인했다.
- prod namespace는 `tutum-prod-app`가 아니라 `tutum-app` 기준으로 실제 파드가 남아 있었고, Pending 파드가 추가 노드 확장을 다시 유발할 수 있는 상태였다.
- 이후 다시 prod를 올릴 때 참고할 수 있도록 비용 홀드 절차와 복구 절차를 별도 AWS 설정 문서로 정리했다.

## 2. 상세 변경 사항

- 프론트엔드 repo에서 `NEXT_PUBLIC_ADMIN_COST_TAB` 플래그를 GitLab CI/CD 변수에서 Docker build arg로 전달하도록 반영했다.
- 프론트엔드 pipeline이 `lint:frontend` 단계에서 runner 메모리 부족으로 중단되는 문제를 줄이기 위해 Kubernetes memory request/limit을 추가했다.
- AWS API와 Kubernetes API 기준으로 prod cluster 상태를 재조회했다.

## 3. 점검 결과

### 3.1 EKS / NodeGroup 상태
- Cluster: `tutum-prd-eks`
- Cluster status: `ACTIVE`
- Kubernetes version: `1.35`
- Managed nodegroup: 없음
- 결론: 이전에 비용 이슈를 일으키던 `ng-prd-general` (`m6i.large` 2대)는 제거된 상태

### 3.2 현재 살아 있는 prod 노드
- `system` nodepool: `c6g.large` 2대
- `general-purpose` nodepool: `c5a.large` 3대
- 전부 `on-demand`

### 3.3 현재 남아 있는 주요 prod 워크로드
- namespace: `tutum-app`
- Running:
  - `backend` 2
  - `frontend` 1
  - `price-consumer` 1
  - `istiod` 1
  - `metrics-server` 2
  - `amazon-guardduty-agent` 각 노드 배치
- Pending:
  - `elastic-consumer`
  - `email-worker`
  - `frontend` 1
  - `news-consumer`
  - `news-producer`
  - `ocr`
  - `price-producer`

### 3.4 비용 관점 결론
- managed nodegroup 삭제로 1차 절감은 이미 반영됨
- 하지만 prod 앱 파드와 Pending 파드 때문에 `general-purpose` 노드 3대가 계속 유지되고 있음
- 따라서 prod를 실제로 사용하지 않는 기간이라면, 추가 비용 절감을 위해 `tutum-app` 쪽 replica와 autoscaling/Argo 동작까지 함께 내려야 함

## 4. 이슈 및 대응

- 이슈: `ng-prd-general`은 `CREATE_FAILED` 상태라 `update-nodegroup-config`로 0대로 줄일 수 없었음
- 대응: nodegroup 삭제가 정답이었고, 현재 삭제 완료 상태 확인

- 이슈: prod 앱이 안 쓰이는 줄 알았지만 `tutum-app` namespace에 실제 파드가 살아 있었음
- 대응: 단순히 nodepool만 삭제하면 서비스 장애가 발생할 수 있으므로, 먼저 `tutum-app` scale-down 여부를 운영 판단 후 실행해야 함

- 이슈: Pending 파드가 존재해 Karpenter가 노드를 다시 만들 수 있음
- 대응: 비용 홀드 시 KEDA/Argo/self-heal 여부까지 같이 정리해야 함

## 5. 결과

- prod cluster는 완전 정지 상태가 아님
- 현재 과금 주원인:
  - `general-purpose` on-demand 노드 3대
  - `system` on-demand 노드 2대
  - EKS control plane / NAT / EBS 등 고정비
- 문서화 결과:
  - `docs/ruby/aws_settings/2026-03-12_tutum_prd_eks_cost_hold_and_restore_steps.md`

## 6. 커밋 로그

```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

## 7. 후속 작업 / 리스크

1. prod를 실제로 당분간 쓰지 않는다면 `tutum-app` 배포를 0대로 내리고 `general-purpose` nodepool까지 제거하는 비용 홀드 절차 수행
2. prod를 다시 켤 때는 ArgoCD/KEDA/배포 replica 복구 순서를 지켜야 함
3. frontend pipeline은 코드 문제가 아니라 runner 메모리 이슈였으므로, 이번 리소스 설정 반영 후 재검증 필요
