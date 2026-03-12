#!/bin/bash
# ============================================================
#  eks-prod-cost-audit.sh - PROD EKS/EC2 비용 점검 스크립트
#  실행 위치: cp-2 (kubectl + aws CLI 준비된 운영 VM)
#  사용법:
#    bash scripts/eks-prod-cost-audit.sh
#    AWS_PROFILE=ruby AWS_CLUSTER_NAME=tutum-prd-eks bash scripts/eks-prod-cost-audit.sh
#    NAT_GATEWAY_COUNT=2 bash scripts/eks-prod-cost-audit.sh
#    AWS_CLUSTER_LIST="tutum-prd-eks tutum-stg-eks" bash scripts/eks-prod-cost-audit.sh
#
#  목적:
#    - 현재 prod 클러스터에서 실제 비용이 나는 노드/노드그룹 확인
#    - 대략적인 시간당 / 하루 예상 비용 계산
#    - scale down / delete 는 수행하지 않고 보고서만 출력
#
#  주의:
#    - 인스턴스 단가는 ap-northeast-2 기준의 "대략값"이다.
#    - EKS control plane 은 포함한다.
#    - NAT Gateway, ALB, EBS, 데이터 전송, CloudWatch 등은 기본적으로 미포함이다.
#    - NAT 비용을 같이 보고 싶으면 NAT_GATEWAY_COUNT 값을 직접 넣어 실행한다.
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
info()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $*" >&2; }

PROFILE="${AWS_PROFILE:-ruby}"
REGION="${AWS_REGION:-ap-northeast-2}"
CONTROL_PLANE_HOURLY_USD="${CONTROL_PLANE_HOURLY_USD:-0.10}"
NAT_GATEWAY_HOURLY_USD="${NAT_GATEWAY_HOURLY_USD:-0.045}"
NAT_GATEWAY_COUNT="${NAT_GATEWAY_COUNT:-0}"
EXTRA_FIXED_HOURLY_USD="${EXTRA_FIXED_HOURLY_USD:-0}"
RUN_KUBECTL_CHECK="${RUN_KUBECTL_CHECK:-true}"

if [[ -n "${AWS_CLUSTER_LIST:-}" ]]; then
  IFS=' ' read -r -a CLUSTERS <<< "${AWS_CLUSTER_LIST}"
else
  CLUSTERS=("${AWS_CLUSTER_NAME:-tutum-prd-eks}")
fi

declare -A INSTANCE_RATES=(
  ["t3.medium"]="0.052"
  ["t3.large"]="0.104"
  ["m5.large"]="0.120"
  ["m5.xlarge"]="0.240"
  ["m6i.large"]="0.128"
  ["m6i.xlarge"]="0.256"
  ["m6i.2xlarge"]="0.512"
  ["c6i.large"]="0.108"
  ["c6i.xlarge"]="0.216"
  ["c6i.2xlarge"]="0.432"
  ["r6i.large"]="0.168"
  ["r6i.xlarge"]="0.336"
)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    error "필수 명령 없음: $1"
    exit 1
  }
}

aws_cli() {
  aws --profile "${PROFILE}" --region "${REGION}" "$@"
}

float_add() {
  awk -v a="${1:-0}" -v b="${2:-0}" 'BEGIN { printf "%.3f", a + b }'
}

float_mul() {
  awk -v a="${1:-0}" -v b="${2:-0}" 'BEGIN { printf "%.3f", a * b }'
}

lookup_rate() {
  local instance_type="${1:-}"
  echo "${INSTANCE_RATES[$instance_type]:-}"
}

require_cmd aws

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl 이 없어 kube API 확인은 생략됨"
  RUN_KUBECTL_CHECK="false"
fi

# ============================================================
# STEP 1: AWS 계정 / 기본 설정 확인
# ============================================================
log "[1/5] AWS 계정 및 실행 설정 확인"
CALLER_ARN="$(aws_cli sts get-caller-identity --query 'Arn' --output text)"
ACCOUNT_ID="$(aws_cli sts get-caller-identity --query 'Account' --output text)"
info "  계정: ${ACCOUNT_ID}"
info "  ARN : ${CALLER_ARN}"
info "  region=${REGION}, profile=${PROFILE}"
info "  대상 클러스터: ${CLUSTERS[*]}"

if [[ "${NAT_GATEWAY_COUNT}" == "0" ]]; then
  warn "  NAT_GATEWAY_COUNT=0 이므로 NAT 비용은 현재 보고서에 포함되지 않음"
else
  info "  NAT 비용 가정: ${NAT_GATEWAY_COUNT} x ${NAT_GATEWAY_HOURLY_USD}/hr"
fi

echo ""

for CLUSTER in "${CLUSTERS[@]}"; do
  [[ -z "${CLUSTER}" ]] && continue

  COMPUTE_HOURLY_USD="0"
  FIXED_HOURLY_USD="$(float_add "${CONTROL_PLANE_HOURLY_USD}" "$(float_add "$(float_mul "${NAT_GATEWAY_HOURLY_USD}" "${NAT_GATEWAY_COUNT}")" "${EXTRA_FIXED_HOURLY_USD}")")"
  UNKNOWN_TYPES=()

  echo "============================================================"
  log "Cluster: ${CLUSTER}"

  # ==========================================================
  # STEP 2: EKS 클러스터 / Managed NodeGroup 확인
  # ==========================================================
  log "[2/5] EKS 클러스터 상태 확인"

  CLUSTER_DESC="$(aws_cli eks describe-cluster \
    --name "${CLUSTER}" \
    --query 'join(`|`, [cluster.status, cluster.version, cluster.platformVersion, cluster.resourcesVpcConfig.vpcId])' \
    --output text 2>/dev/null || true)"

  if [[ -z "${CLUSTER_DESC}" || "${CLUSTER_DESC}" == "None" ]]; then
    warn "  eks describe-cluster 실패: 클러스터명 / 권한 / region 확인 필요"
    echo ""
    continue
  fi

  IFS='|' read -r CLUSTER_STATUS CLUSTER_VERSION CLUSTER_PLATFORM CLUSTER_VPC_ID <<< "${CLUSTER_DESC}"
  info "  status=${CLUSTER_STATUS}, version=${CLUSTER_VERSION}, platform=${CLUSTER_PLATFORM}, vpc=${CLUSTER_VPC_ID}"

  NODEGROUPS_RAW="$(aws_cli eks list-nodegroups --cluster-name "${CLUSTER}" --query 'nodegroups' --output text 2>/dev/null || true)"
  if [[ -z "${NODEGROUPS_RAW}" || "${NODEGROUPS_RAW}" == "None" ]]; then
    warn "  Managed NodeGroup 없음"
  else
    info "  Managed NodeGroup 목록"
    printf "    %-24s %-10s %-10s %-8s %-8s %-8s %-20s\n" "NAME" "STATUS" "CAPACITY" "MIN" "DES" "MAX" "INSTANCE_TYPES"
    for NG in ${NODEGROUPS_RAW}; do
      NG_DESC="$(aws_cli eks describe-nodegroup \
        --cluster-name "${CLUSTER}" \
        --nodegroup-name "${NG}" \
        --query 'join(`|`, [nodegroup.nodegroupName, nodegroup.status, nodegroup.capacityType, to_string(nodegroup.scalingConfig.minSize), to_string(nodegroup.scalingConfig.desiredSize), to_string(nodegroup.scalingConfig.maxSize), join(`,`, nodegroup.instanceTypes)])' \
        --output text 2>/dev/null || true)"

      if [[ -z "${NG_DESC}" || "${NG_DESC}" == "None" ]]; then
        warn "    - ${NG}: describe-nodegroup 실패"
        continue
      fi

      IFS='|' read -r NG_NAME NG_STATUS NG_CAPACITY NG_MIN NG_DESIRED NG_MAX NG_TYPES <<< "${NG_DESC}"
      printf "    %-24s %-10s %-10s %-8s %-8s %-8s %-20s\n" \
        "${NG_NAME}" "${NG_STATUS}" "${NG_CAPACITY}" "${NG_MIN}" "${NG_DESIRED}" "${NG_MAX}" "${NG_TYPES}"
    done
  fi

  # ==========================================================
  # STEP 3: 실제 과금 중인 EC2 노드 확인
  #   - running / pending 상태만 출력
  #   - 클러스터 태그 기준 owned/shared 인스턴스 조회
  # ==========================================================
  log "[3/5] EC2 노드 인벤토리 및 대략 비용 계산"
  EC2_ROWS="$(aws_cli ec2 describe-instances \
    --filters \
      "Name=tag:kubernetes.io/cluster/${CLUSTER},Values=owned,shared" \
      "Name=instance-state-name,Values=running,pending" \
    --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PrivateIpAddress,Placement.AvailabilityZone,Tags[?Key==`Name`]|[0].Value,Tags[?Key==`eks:nodegroup-name`]|[0].Value,Tags[?Key==`karpenter.sh/nodepool`]|[0].Value]' \
    --output text 2>/dev/null || true)"

  if [[ -z "${EC2_ROWS}" || "${EC2_ROWS}" == "None" ]]; then
    warn "  running / pending 상태의 클러스터 EC2 노드 없음"
  else
    printf "    %-19s %-12s %-8s %-15s %-12s %-18s %-16s %-16s %-8s\n" \
      "INSTANCE_ID" "TYPE" "STATE" "PRIVATE_IP" "AZ" "NAME" "NODEGROUP" "NODEPOOL" "USD/HR"

    while IFS=$'\t' read -r INSTANCE_ID INSTANCE_TYPE INSTANCE_STATE PRIVATE_IP AZ NAME_TAG NODEGROUP_TAG NODEPOOL_TAG; do
      [[ -z "${INSTANCE_ID:-}" ]] && continue

      RATE="$(lookup_rate "${INSTANCE_TYPE}")"
      if [[ -z "${RATE}" ]]; then
        RATE="-"
        UNKNOWN_TYPES+=("${INSTANCE_TYPE}")
      else
        COMPUTE_HOURLY_USD="$(float_add "${COMPUTE_HOURLY_USD}" "${RATE}")"
      fi

      [[ -z "${PRIVATE_IP:-}" || "${PRIVATE_IP}" == "None" ]] && PRIVATE_IP="-"
      [[ -z "${NAME_TAG:-}" || "${NAME_TAG}" == "None" ]] && NAME_TAG="-"
      [[ -z "${NODEGROUP_TAG:-}" || "${NODEGROUP_TAG}" == "None" ]] && NODEGROUP_TAG="-"
      [[ -z "${NODEPOOL_TAG:-}" || "${NODEPOOL_TAG}" == "None" ]] && NODEPOOL_TAG="-"

      printf "    %-19s %-12s %-8s %-15s %-12s %-18s %-16s %-16s %-8s\n" \
        "${INSTANCE_ID}" "${INSTANCE_TYPE}" "${INSTANCE_STATE}" "${PRIVATE_IP}" "${AZ}" "${NAME_TAG}" "${NODEGROUP_TAG}" "${NODEPOOL_TAG}" "${RATE}"
    done <<< "${EC2_ROWS}"
  fi

  # ==========================================================
  # STEP 4: kubectl 기준 노드 확인
  #   - kube API 에 보이는 실제 노드 라벨 확인
  #   - update-kubeconfig 로 ${CLUSTER}-audit context 를 만든다
  # ==========================================================
  log "[4/5] kubectl 기준 노드 확인"
  if [[ "${RUN_KUBECTL_CHECK}" == "true" ]]; then
    KUBE_CONTEXT="${CLUSTER}-audit"
    if aws_cli eks update-kubeconfig --name "${CLUSTER}" --alias "${KUBE_CONTEXT}" >/dev/null 2>&1; then
      kubectl --context "${KUBE_CONTEXT}" get nodes \
        -o custom-columns='NAME:.metadata.name,TYPE:.metadata.labels.kubernetes\.io/instance-type,NODEGROUP:.metadata.labels.eks\.amazonaws\.com/nodegroup,NODEPOOL:.metadata.labels.karpenter\.sh/nodepool,READY:.status.conditions[?(@.type=="Ready")].status' \
        --no-headers 2>/dev/null || warn "  kubectl get nodes 실패"
    else
      warn "  update-kubeconfig 실패 - kubectl 노드 확인 생략"
    fi
  else
    warn "  RUN_KUBECTL_CHECK=false 이므로 생략"
  fi

  # ==========================================================
  # STEP 5: 비용 요약 / 다음 수동 조치 안내
  # ==========================================================
  log "[5/5] 비용 요약"
  TOTAL_HOURLY_USD="$(float_add "${COMPUTE_HOURLY_USD}" "${FIXED_HOURLY_USD}")"
  TOTAL_DAILY_USD="$(float_mul "${TOTAL_HOURLY_USD}" "24")"
  COMPUTE_DAILY_USD="$(float_mul "${COMPUTE_HOURLY_USD}" "24")"
  FIXED_DAILY_USD="$(float_mul "${FIXED_HOURLY_USD}" "24")"

  echo "  compute hourly : \$${COMPUTE_HOURLY_USD}"
  echo "  compute daily  : \$${COMPUTE_DAILY_USD}"
  echo "  fixed hourly   : \$${FIXED_HOURLY_USD}  (EKS control plane + NAT + extra fixed)"
  echo "  fixed daily    : \$${FIXED_DAILY_USD}"
  echo "  total hourly   : \$${TOTAL_HOURLY_USD}"
  echo "  total daily    : \$${TOTAL_DAILY_USD}"

  if [[ "${#UNKNOWN_TYPES[@]}" -gt 0 ]]; then
    warn "  단가 미등록 인스턴스 타입 있음: $(printf '%s ' "${UNKNOWN_TYPES[@]}" | xargs)"
    warn "  필요 시 INSTANCE_RATES 표에 추가 후 다시 실행"
  fi

  info "  보고서만 출력함. 자동 축소/삭제는 수행하지 않음"
  info "  다음 수동 확인 명령:"
  echo "    kubectl --context ${CLUSTER}-audit get nodes -o wide"
  echo "    aws --profile ${PROFILE} --region ${REGION} eks list-nodegroups --cluster-name ${CLUSTER}"
  echo "    aws --profile ${PROFILE} --region ${REGION} ec2 describe-instances --filters Name=tag:kubernetes.io/cluster/${CLUSTER},Values=owned,shared"
  echo ""
done

warn "참고: 이 스크립트는 ALB, EBS, S3, Route53, CloudWatch, 데이터 전송 비용을 계산하지 않음"
