# 2026-03-12 PROD EKS/EC2 Cost Check (Quick Audit)

## 목적
현재 월 누적 비용이 급증(250USD+)하고, 3/20 D-day를 앞두고 비용 원인을 확정하기 위해 PROD 클러스터 노드 상태를 빠르게 점검한다.

## 실행 전제
- AWS CLI 설치, 권한: EKS Describe/List, EC2 Describe
- 가능하면 `kubectl` 도 같이 설치된 cp-2 에서 실행
- `aws` 프로필은 CI에서 사용한 `ruby` 계정 기준

## 1) 즉시 실행 스크립트

```bash
chmod +x scripts/eks-prod-cost-audit.sh
AWS_PROFILE=ruby AWS_REGION=ap-northeast-2 \
  ./scripts/eks-prod-cost-audit.sh
```

기본 대상:
- `tutum-prd-eks`

NAT Gateway 비용까지 같이 보고 싶으면:

```bash
AWS_PROFILE=ruby AWS_REGION=ap-northeast-2 NAT_GATEWAY_COUNT=2 \
  ./scripts/eks-prod-cost-audit.sh
```

필요 시 대상 변경:

```bash
AWS_CLUSTER_NAME="tutum-prd-eks" ./scripts/eks-prod-cost-audit.sh
AWS_CLUSTER_LIST="tutum-prd-eks tutum-stg-eks" ./scripts/eks-prod-cost-audit.sh
```

## 2) 스크립트가 확인하는 항목

1. EKS 클러스터 상태
   - `ACTIVE` 여부
   - Kubernetes 버전/플랫폼
   - VPC ID
2. Managed NodeGroup 목록
   - min / desired / max
   - capacity type
3. 클러스터 태그 기반 EC2 인스턴스
   - `tag:kubernetes.io/cluster/<CLUSTER>=owned|shared` + `running,pending`
   - instance-id, type, AZ, nodegroup, nodepool
   - 등록된 인스턴스 타입 기준 시간당 대략 비용
4. (가능 시) kubectl 노드 목록
   - 인스턴스 타입, EKS nodegroup, Karpenter nodepool
5. 고정비 가정
   - EKS control plane
   - NAT Gateway (`NAT_GATEWAY_COUNT` 지정 시)
   - 추가 고정비 (`EXTRA_FIXED_HOURLY_USD` 지정 시)

## 3) 처리 판단 기준

- `tutum-prd-eks`에서 running 노드가 많고 `desired` 가 높으면 실제 과금 지속 중으로 판단
- Karpenter 라벨 노드가 많으면 `karpenter.sh/nodepool` 기준으로 먼저 정리 대상 확인
- 단가 미등록 인스턴스 타입이 있으면 스크립트의 `INSTANCE_RATES` 표에 추가 후 재실행
- 이 스크립트는 보고서만 출력하며 축소/삭제는 직접 하지 않음

## 4) SSH 실행 예시

같은 네트워크에서 cp-2 직접 접속:

```bash
ssh clouddx@192.168.0.221
```

NAT 포트포워딩으로 접속:

```bash
ssh -p 2221 clouddx@192.168.0.13
```

접속 후 실행:

```bash
cd /d/dev/tutum
git pull --ff-only origin develop
chmod +x scripts/eks-prod-cost-audit.sh
bash scripts/eks-prod-cost-audit.sh
```

NAT 비용까지 같이 포함:

```bash
cd /d/dev/tutum
NAT_GATEWAY_COUNT=2 bash scripts/eks-prod-cost-audit.sh
```

## 5) 비용 긴급 대응(수동 실행)

> 아래 명령은 운영 영향이 크므로 prod/stg 구분 후 승인 받고 실행.

1. 우선 확인
- `kubectl --context tutum-prd-eks-audit get nodes -o wide`
- `aws --profile ruby --region ap-northeast-2 eks list-nodegroups --cluster-name tutum-prd-eks`

2. 그 다음 판단
- managed nodegroup 과다: desired 축소 검토
- Karpenter 과다: nodepool 정책 / 워크로드 축소 검토
- prod 는 `scripts/eks-cost-down.sh` 를 바로 치지 말고 영향도 먼저 확인

## 6) 현재 로컬 환경 제약

이 저장소 로컬 환경에서는 AWS 실시간 조회를 수행하지 않았고, 실제 실행은 cp-2 같은 운영 VM에서 바로 수행해야 한다.
