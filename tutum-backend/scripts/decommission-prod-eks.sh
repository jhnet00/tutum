#!/bin/bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PROD_CLUSTER_NAME="${PROD_CLUSTER_NAME:-tutum-prd-eks}"
PROD_VPC_ID="${PROD_VPC_ID:-vpc-032e15f57dbd8898b}"
PROD_LOG_GROUP="${PROD_LOG_GROUP:-/aws/eks/tutum-prd-eks/cluster}"
CONFIRM_DELETE_PROD="${CONFIRM_DELETE_PROD:-}"
DRY_RUN="${DRY_RUN:-1}"
AWS_BIN="${AWS_BIN:-$(command -v aws 2>/dev/null || command -v aws.exe 2>/dev/null || true)}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $*" >&2; exit 1; }

normalize_words() {
  tr '\t\r\n' '   ' | xargs
}

require_confirm() {
  [[ "${CONFIRM_DELETE_PROD}" == "${PROD_CLUSTER_NAME}" ]] || fail "Set CONFIRM_DELETE_PROD=${PROD_CLUSTER_NAME} to execute destructive deletion"
}

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "DRY_RUN> $*"
  else
    eval "$@"
  fi
}

require_confirm

[[ -n "${AWS_BIN}" ]] || fail "aws CLI not found in PATH"

log "[1/8] Delete EKS prod cluster"
run "\"${AWS_BIN}\" eks delete-cluster --name ${PROD_CLUSTER_NAME} --region ${AWS_REGION}"

if [[ "${DRY_RUN}" != "1" ]]; then
  log "Waiting for ${PROD_CLUSTER_NAME} to disappear"
  for _ in $(seq 1 60); do
    if ! "${AWS_BIN}" eks describe-cluster --name "${PROD_CLUSTER_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
      break
    fi
    sleep 15
  done
fi

log "[2/8] Terminate prod worker instances"
instance_ids=$("${AWS_BIN}" ec2 describe-instances \
  --region "${AWS_REGION}" \
  --filters "Name=tag:kubernetes.io/cluster/${PROD_CLUSTER_NAME},Values=owned,shared" "Name=instance-state-name,Values=running,stopped,pending,stopping" \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text | normalize_words)
if [[ -n "${instance_ids}" ]]; then
  run "\"${AWS_BIN}\" ec2 terminate-instances --region ${AWS_REGION} --instance-ids ${instance_ids}"
fi

if [[ "${DRY_RUN}" != "1" && -n "${instance_ids}" ]]; then
  log "Waiting for prod instances to terminate"
  "${AWS_BIN}" ec2 wait instance-terminated --region "${AWS_REGION}" --instance-ids ${instance_ids}
fi

log "[3/8] Delete prod NAT gateways"
nat_ids=$("${AWS_BIN}" ec2 describe-nat-gateways \
  --region "${AWS_REGION}" \
  --filter "Name=vpc-id,Values=${PROD_VPC_ID}" \
  --query 'NatGateways[?State!=`deleted`].NatGatewayId' \
  --output text | normalize_words)
eip_allocs=$("${AWS_BIN}" ec2 describe-nat-gateways \
  --region "${AWS_REGION}" \
  --filter "Name=vpc-id,Values=${PROD_VPC_ID}" \
  --query 'NatGateways[?State!=`deleted`].NatGatewayAddresses[].AllocationId' \
  --output text | normalize_words)
for nat_id in ${nat_ids}; do
  run "\"${AWS_BIN}\" ec2 delete-nat-gateway --region ${AWS_REGION} --nat-gateway-id ${nat_id}"
done

if [[ "${DRY_RUN}" != "1" ]]; then
  for nat_id in ${nat_ids}; do
    "${AWS_BIN}" ec2 wait nat-gateway-deleted --region "${AWS_REGION}" --nat-gateway-ids "${nat_id}"
  done
fi

log "[4/8] Delete prod VPC endpoints"
vpce_ids=$("${AWS_BIN}" ec2 describe-vpc-endpoints \
  --region "${AWS_REGION}" \
  --filters "Name=vpc-id,Values=${PROD_VPC_ID}" \
  --query 'VpcEndpoints[].VpcEndpointId' \
  --output text | normalize_words)
if [[ -n "${vpce_ids}" ]]; then
  run "\"${AWS_BIN}\" ec2 delete-vpc-endpoints --region ${AWS_REGION} --vpc-endpoint-ids ${vpce_ids}"
fi

if [[ "${DRY_RUN}" != "1" && -n "${vpce_ids}" ]]; then
  log "Waiting for prod VPC endpoints to disappear"
  for _ in $(seq 1 40); do
    remaining_vpce=$("${AWS_BIN}" ec2 describe-vpc-endpoints \
      --region "${AWS_REGION}" \
      --filters "Name=vpc-id,Values=${PROD_VPC_ID}" \
      --query 'VpcEndpoints[?State!=`deleted`].VpcEndpointId' \
      --output text | normalize_words)
    [[ -z "${remaining_vpce}" ]] && break
    sleep 10
  done
fi

if [[ "${DRY_RUN}" != "1" ]]; then
  log "Waiting for prod ENIs to drain"
  for _ in $(seq 1 60); do
    remaining_enis=$("${AWS_BIN}" ec2 describe-network-interfaces \
      --region "${AWS_REGION}" \
      --filters "Name=vpc-id,Values=${PROD_VPC_ID}" \
      --query 'NetworkInterfaces[?InterfaceType!=`nat_gateway` && InterfaceType!=`vpc_endpoint`].NetworkInterfaceId' \
      --output text | normalize_words)
    [[ -z "${remaining_enis}" ]] && break
    sleep 15
  done
fi

log "[5/8] Delete route-table associations, subnets, and internet gateway"
igw_ids=$("${AWS_BIN}" ec2 describe-internet-gateways \
  --region "${AWS_REGION}" \
  --filters "Name=attachment.vpc-id,Values=${PROD_VPC_ID}" \
  --query 'InternetGateways[].InternetGatewayId' \
  --output text | normalize_words)
route_table_ids=$("${AWS_BIN}" ec2 describe-route-tables \
  --region "${AWS_REGION}" \
  --filters "Name=vpc-id,Values=${PROD_VPC_ID}" \
  --query 'RouteTables[?Associations[?Main!=`true`]].RouteTableId' \
  --output text | normalize_words)
subnet_ids=$("${AWS_BIN}" ec2 describe-subnets \
  --region "${AWS_REGION}" \
  --filters "Name=vpc-id,Values=${PROD_VPC_ID}" \
  --query 'Subnets[].SubnetId' \
  --output text | normalize_words)

for igw_id in ${igw_ids}; do
  run "\"${AWS_BIN}\" ec2 detach-internet-gateway --region ${AWS_REGION} --internet-gateway-id ${igw_id} --vpc-id ${PROD_VPC_ID}"
  run "\"${AWS_BIN}\" ec2 delete-internet-gateway --region ${AWS_REGION} --internet-gateway-id ${igw_id}"
done

for subnet_id in ${subnet_ids}; do
  run "\"${AWS_BIN}\" ec2 delete-subnet --region ${AWS_REGION} --subnet-id ${subnet_id}"
done

for route_table_id in ${route_table_ids}; do
  run "\"${AWS_BIN}\" ec2 delete-route-table --region ${AWS_REGION} --route-table-id ${route_table_id}"
done

log "[6/8] Release NAT Elastic IPs"
for alloc_id in ${eip_allocs}; do
  run "\"${AWS_BIN}\" ec2 release-address --region ${AWS_REGION} --allocation-id ${alloc_id}"
done

log "[7/8] Delete CloudWatch prod control-plane log group"
run "\"${AWS_BIN}\" logs delete-log-group --region ${AWS_REGION} --log-group-name ${PROD_LOG_GROUP}"

log "[8/8] Delete prod VPC"
run "\"${AWS_BIN}\" ec2 delete-vpc --region ${AWS_REGION} --vpc-id ${PROD_VPC_ID}"

echo
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "Dry run completed. Re-run with DRY_RUN=0 CONFIRM_DELETE_PROD=${PROD_CLUSTER_NAME} to execute."
else
  echo "Prod decommission sequence requested."
  echo "Verify Route53 and staging service health before removing any remaining IAM-only artifacts."
fi
