# Staging Full Down 운영 가이드 (2026-03-13)

## 1. 목적

- 현재 공개 데모 경로는 `staging` 클러스터가 담당한다.
- 데모를 보여주지 않는 시간에는 staging 전체를 내려 비용을 줄이고,
- 다시 보여줘야 할 때 staging 전체를 복구하는 운영 절차를 정리한다.

대상 스크립트:
- `scripts/eks-cost-down.sh`
- `scripts/eks-cost-up.sh`

참고:
- `scripts/decommission-prod-eks.sh`는 일상 운영용이 아니다.
- 해당 스크립트는 `prod` 폐기용 1회성 정리 스크립트다.

## 2. 현재 전제

- `prod` 클러스터는 정리 완료
- 현재 남은 클러스터는 `tutum-stg-eks` 1개
- 공개 경로
  - `https://tutum.my/`
  - `https://sonar.tutum.my/`
  - `https://kiali.tutum.my/kiali/`
- 위 경로는 모두 staging ALB를 사용한다.

즉, `full down` 실행 시 공개 경로도 같이 내려간다.

## 3. 언제 사용해야 하는가

### 3.1 `full down` 사용 시점

다음 시간대에 사용한다.

- 밤에 아무도 데모를 보지 않을 때
- 주말/휴일에 미사용 상태일 때
- 외부 시연이 끝난 직후

### 3.2 `full up` 사용 시점

다음 시간대에 사용한다.

- 외부 데모 10~15분 전
- 팀원이 실제 검증을 시작하기 전
- admin / sonar / kiali까지 포함해 전체 확인이 필요할 때

## 4. 사용 전 확인

### 4.1 kubectl context 확인

반드시 현재 context가 `tutum-stg-eks`여야 한다.

```bash
kubectl config current-context
```

기대 결과 예시:

```bash
arn:aws:eks:ap-northeast-2:903913341620:cluster/tutum-stg-eks
```

스크립트 내부에도 context guard가 있어서 다른 context면 실행이 실패한다.

### 4.2 AWS CLI / kubectl 준비

다음 명령이 현재 환경에서 실행 가능해야 한다.

```bash
aws --version
kubectl version --client
```

Windows에서는 `aws.exe`, `kubectl.exe`도 자동 탐색하도록 스크립트를 보강해 두었다.

## 5. Full Down 실행

### 5.1 기본 실행

```bash
bash scripts/eks-cost-down.sh
```

### 5.2 이 스크립트가 하는 일

- `tutum-app` deployment/statefulset -> `replicas=0`
- `tutum-data` deployment/statefulset -> `replicas=0`
- `KEDA` scaled object pause
- `argocd` control plane scale down
- `external-secrets` scale down
- `kyverno` scale down
- `istio`, `kiali`, `gitlab-runner` scale down
- `aws-load-balancer-controller`, `metrics-server` scale down
- `tutum-monitoring` EC2 stop

즉, staging 전체를 사실상 정지시키는 흐름이다.

### 5.3 실행 후 영향

아래 경로가 정상 응답하지 않게 된다.

- `https://tutum.my/`
- `https://sonar.tutum.my/`
- `https://kiali.tutum.my/kiali/`

### 5.4 monitoring EC2는 유지하고 싶을 때

```bash
STOP_MONITORING=0 bash scripts/eks-cost-down.sh
```

이 경우:
- staging 클러스터는 내려가지만
- `tutum-monitoring` EC2 stop은 생략된다.

## 6. Full Up 실행

### 6.1 기본 실행

```bash
bash scripts/eks-cost-up.sh
```

### 6.2 이 스크립트가 하는 일

- `tutum-monitoring` EC2 start
- `kube-system`, `external-secrets`, `keda`, `kyverno`, `istio`, `kiali`, `gitlab-runner` 복구
- `argocd` control plane 복구
- ArgoCD 복구 완료까지 대기
- KEDA pause 해제
- `auth`, `email-worker`, `news-producer`, `price-producer`, `ocr`, exporter 일부 선복구
- 나머지 workload는 ArgoCD self-heal로 복구

### 6.3 복구 예상 시간

- control plane 복구: `2~4분`
- 노드 재할당: `3~6분`
- 전체 정상화: `8~15분`

즉, 실제 시연 10~15분 전에는 올리는 것이 맞다.

### 6.4 monitoring EC2는 이미 켜져 있을 때

```bash
START_MONITORING=0 bash scripts/eks-cost-up.sh
```

## 7. 실행 후 확인 명령

### 7.1 full down 후 확인

```bash
kubectl get pods -A
kubectl get nodepool
```

확인 포인트:
- app/data workload가 대부분 0 또는 종료 상태인지
- node 수가 점진적으로 줄어드는지

### 7.2 full up 후 확인

```bash
kubectl get app -n argocd tutum-staging
kubectl get pods -A
kubectl get ingress -A -o wide
```

외부 확인:

```bash
curl -I https://tutum.my/
curl -I https://sonar.tutum.my/
curl -I https://kiali.tutum.my/kiali/
```

기대:
- 모두 `200` 또는 로그인 리다이렉트 성격의 정상 응답

## 8. 실제 운영 예시

### 8.1 밤에 내리고 아침에 올리는 예시

밤:

```bash
bash scripts/eks-cost-down.sh
```

다음날 데모 15분 전:

```bash
bash scripts/eks-cost-up.sh
```

### 8.2 주말 내내 안 쓸 때

금요일 저녁:

```bash
bash scripts/eks-cost-down.sh
```

월요일 오전 데모 전:

```bash
bash scripts/eks-cost-up.sh
```

## 9. PowerShell에서 실행하는 방법

Git Bash가 잡혀 있다면 그대로:

```powershell
bash scripts/eks-cost-down.sh
bash scripts/eks-cost-up.sh
```

환경변수 옵션 포함 예시:

```powershell
$env:STOP_MONITORING="0"
bash scripts/eks-cost-down.sh
Remove-Item Env:STOP_MONITORING
```

```powershell
$env:START_MONITORING="0"
bash scripts/eks-cost-up.sh
Remove-Item Env:START_MONITORING
```

## 10. 주의사항

- `full down`은 staging 데모 경로 전체를 같이 내린다.
- 이 스크립트는 현재 `비용 절감 우선` 운영이다.
- 실행 중 누군가 접속 중이면 서비스가 끊긴다.
- full down 후에도 비용이 0이 되지는 않는다.

계속 남는 비용:
- staging EKS control plane
- staging NAT
- EBS / PVC
- RDS
- ALB
- Route53
- WAF
- CloudWatch

## 11. 권장 운영 원칙

1. 시연 10~15분 전 `full up`
2. 시연 종료 직후 `full down`
3. 사용 시간이 애매하면 monitoring EC2는 유지하고 cluster만 내리기
4. 첫 1주일은 수동 실행으로 복구 시간을 체감한 뒤 자동화 여부를 결정하기

## 12. 관련 파일

- [eks-cost-down.sh](C:\Users\CloudDX\Documents\GitHub\clouddx-project\scripts\eks-cost-down.sh)
- [eks-cost-up.sh](C:\Users\CloudDX\Documents\GitHub\clouddx-project\scripts\eks-cost-up.sh)
- [decommission-prod-eks.sh](C:\Users\CloudDX\Documents\GitHub\clouddx-project\scripts\decommission-prod-eks.sh)
- [2026-03-13_prod_decommission_and_staging_full_down_runbook.md](C:\Users\CloudDX\Documents\GitHub\clouddx-project\docs\dev_logs\3월_둘째주\2026-03-13_prod_decommission_and_staging_full_down_runbook.md)
