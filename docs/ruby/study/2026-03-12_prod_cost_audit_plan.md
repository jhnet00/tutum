# 2026-03-12 PROD EKS/EC2 Cost Check (Quick Audit)

## 목적
현재 월 누적 비용이 급증(250USD+)하고, 3/20 D-day를 앞두고 비용 원인을 확정하기 위해 STG/PRD 클러스터 노드 상태를 확인한다.

## 실행 전제
- AWS CLI 설치, 권한: EKS Describe/List, EC2 Describe
- `aws` 프로필은 CI에서 사용한 `ruby` 계정 기준으로 설정

## 1) 즉시 실행 스크립트

```bash
chmod +x scripts/eks-prod-cost-audit.sh
AWS_PROFILE=ruby AWS_REGION=ap-northeast-2 ACTION=report \
  ./scripts/eks-prod-cost-audit.sh
```

기본 대상:
- `tutum-stg-eks`
- `tutum-prd-eks`

필요 시 대상 변경:

```bash
AWS_CLUSTER_LIST="tutum-prd-eks" ./scripts/eks-prod-cost-audit.sh
```

## 2) 스크립트가 확인하는 항목

1. EKS 클러스터 상태
   - `ACTIVE` 여부
   - Kubernetes 버전/플랫폼
2. Managed NodeGroup 목록
   - min / max / desired
3. 클러스터 태그 기반 EC2 인스턴스
   - `tag:kubernetes.io/cluster/<CLUSTER>=owned` + running/pending
   - instance-id, type, name, AZ, nodegroup 태그
4. (가능 시) kubectl 노드 목록
   - 인스턴스 타입, Karpenter nodepool 라벨

## 3) 처리 판단 기준

- `tutum-prd-eks`에서 `managed nodegroup`이 존재하고 노드가 다수 구동 중이면
  - 서비스 영향도를 먼저 확인한 뒤 **스케일 다운/노드 고갈 점검** 수행
- Karpenter 라벨 노드가 다수 존재한다면
  - `karpenter.sh/nodepool` 라벨 기준으로 사용량/비용 분리
  - spot / on-demand 비중 산정
- 위 명령에서 NodeGroup이 `0`이면 EC2 비용은 대개 Karpenter/스팟/직접생성 인스턴스 비중을 봐야 함

## 4) 비용 긴급 대응(수동 실행)

> 아래 명령은 운영 영향이 큼. 반드시 **stg/prd 분리** 확인 후 실행.

1) stg/단일 작업 확인
- `kubectl get nodes -o wide`
- 대형 배치 파드(consumer, mongodb, kafka, elastic) 축소 후
- `scripts/eks-cost-down.sh` 사용은 prod 기준으로 재검토 후 실행

2) prod 노드만 선별 감축 (선택)
- 현재는 이 스크립트에서 자동 삭제/축소를 수행하지 않음.
- 점검 결과를 기준으로 별도 승인 후 `NodeGroup desired/0` 또는 Karpenter 정책 변경 절차 실행.

## 5) 현재 환경에서 실행한 결과

이 저장소에서 로컬 실행 환경은
- `aws` 미설치
- `kubectl` 클러스터 컨텍스트 없음
으로 인해 실시간 조회를 수행할 수 없으므로, 위 스크립트와 절차를 실제 운영 VM/관리자 계정에서 즉시 수행 필요.

