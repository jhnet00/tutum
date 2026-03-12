# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: staging API 장애를 유발한 backend 메모리 압박과 노드 재압축 문제를 완화하고, 현재 EKS 구조에 맞게 비용 절감/원상 복구 스크립트를 정리한다.

## 2. 상세 변경 사항
- `k8s-manifests/overlays/staging/replicas-patch.yaml`
  - backend 컨테이너 실행 인자를 `uvicorn --workers 4`에서 `uvicorn --workers 2`로 낮췄다.
  - backend Pod가 동일 노드에 몰리지 않도록 `requiredDuringSchedulingIgnoredDuringExecution` 기반 pod anti-affinity를 추가했다.
  - 기존 monitoring header 런타임 패치 로직은 유지했다.
- `k8s-manifests/overlays/staging/private-nodepools.yaml`
  - `private-general` NodePool의 `disruption.consolidateAfter`를 `30s`에서 `5m`으로 늘렸다.
  - 비용 절감용 `spot + on-demand`, `small|medium|large` 제한은 유지하면서도, 짧은 consolidation으로 인한 불안정 재배치를 줄이도록 조정했다.
- `scripts/eks-cost-down.sh`
  - 더 이상 base 배포 기준이 아닌 `tutum-storage/MinIO` scale-down 경로를 제거했다.
  - namespace 존재 여부를 확인한 뒤 scale하도록 정리했다.
  - legacy `istio-ingressgateway`는 존재할 때만 선택적으로 scale하도록 수정했다.
  - 단계/출력 메시지를 현재 staging 운영 절차에 맞게 정리했다.
- `scripts/eks-cost-up.sh`
  - 깨진 출력 문자열을 정리하고 검증 안내 문구를 다시 작성했다.
  - ArgoCD 복구, KEDA resume, 비-KEDA deployment 수동 복구 순서를 명확히 유지했다.
  - legacy `istio-ingressgateway`는 존재할 때만 선택적으로 복구하도록 수정했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `backend` API가 `503 no healthy upstream` 상태로 떨어졌고, `backend` Deployment가 `0/3 Available`까지 내려갔다.
- 대응:
  - `kubectl top nodes`, `kubectl top pod -A --sort-by=memory`, `kubectl describe pod`로 원인을 추적했다.
  - `backend` Pod 메모리 사용량이 700Mi~900Mi 수준으로 1Gi limit에 근접했고, `OOMKilled`, readiness 실패, `aws-cni failed to assign an IP address` 이벤트가 겹쳐 rollout이 흔들리는 것을 확인했다.
  - live cluster에 동일한 설정을 우선 적용해 `backend` worker 수를 줄이고 anti-affinity를 추가한 뒤 rollout을 재수렴시켰다.
  - 동시에 `private-general` NodePool consolidation 시간을 늘려 비용 절감 설정이 너무 공격적으로 동작하지 않게 조정했다.
- 이슈: 비용 절감 스크립트가 여전히 `tutum-storage/MinIO`와 예전 ingress 기준 설명을 포함하고 있었고, `eks-cost-up.sh`는 출력 문자열 일부가 깨져 있었다.
- 대응:
  - 현재 `Phase D D-1` 반영 상태를 기준으로 MinIO 의존 설명을 제거하고, 실제 복구 절차 기준으로 스크립트를 다시 정리했다.

## 4. 결과
- 검증 항목: `kubectl rollout status deployment/backend -n tutum-app --timeout=180s`
- 검증 결과: backend rollout이 정상 완료되었다.
- 검증 항목: `kubectl get deploy backend auth frontend -n tutum-app`
- 검증 결과: 확인 시점 기준 `backend 3/3`, `auth 2/2`, `frontend 2/2`로 수렴했다.
- 검증 항목: `curl https://tutum.my/api/v1/market/prices/stocks?symbols=AAPL`
- 검증 결과: ALB 경유 API 응답이 다시 반환되어 backend upstream health가 복구된 것을 확인했다.
- 검증 항목: `git diff --check`
- 검증 결과: patch 문법/공백 오류 없이 정리되었다.
- 검증 항목: `bash -n scripts/eks-cost-down.sh`, `bash -n scripts/eks-cost-up.sh`
- 검증 결과: 두 스크립트 모두 bash 문법 오류 없이 통과해야 하는 상태로 정리했다.

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12 00:00:00" --until="2026-03-12 23:59:59"
```

## 6. 후속 작업/리스크
- `backend` 메모리 limit 자체는 아직 1Gi이므로, 트래픽 증가 시 다시 OOM 압박이 생길 수 있다. 필요하면 request/limit 또는 VPA/HPA 기준을 추가 조정해야 한다.
- `private-general` NodePool은 여전히 `large` 이하 인스턴스만 허용하므로, backend/auth/frontend 동시 부하가 커지면 더 큰 인스턴스 허용 여부를 다시 검토해야 한다.
- 비용 절감 스크립트는 현재 staging 기준으로 정리했으므로, production에도 같은 운영 방식을 적용할 경우 별도 검토가 필요하다.
