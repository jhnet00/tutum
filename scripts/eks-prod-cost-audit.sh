#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-ruby}"
REGION="${AWS_REGION:-ap-northeast-2}"
ACTION="${ACTION:-report}"
if [[ -n "${AWS_CLUSTER_LIST:-}" ]]; then
  IFS=' ' read -r -a CLUSTERS <<< "${AWS_CLUSTER_LIST}"
else
  CLUSTERS=(tutum-stg-eks tutum-prd-eks)
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required"
  exit 1
fi

TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[${TS}] profile=${PROFILE}, region=${REGION}, action=${ACTION}"
echo ""

for CLUSTER in "${CLUSTERS[@]}"; do
  [[ -z "${CLUSTER}" ]] && continue

  echo "======================================================"
  echo "Cluster: ${CLUSTER}"

  if ! CLUSTER_INFO=$(aws --profile "${PROFILE}" --region "${REGION}" eks describe-cluster \
      --name "${CLUSTER}" \
      --query 'join(` `, [cluster.status, cluster.version, cluster.platformVersion])' \
      --output text 2>/dev/null); then
    echo "  - eks describe-cluster failed (check profile/region/cluster name)"
    continue
  fi
  read -r STATUS VERSION PLATFORM <<< "${CLUSTER_INFO}"
  echo "  - status: ${STATUS}, version: ${VERSION}, platform: ${PLATFORM}"

  NODEGROUPS=$(aws --profile "${PROFILE}" --region "${REGION}" eks list-nodegroups --cluster-name "${CLUSTER}" --query 'nodegroups' --output text)
  if [[ -z "${NODEGROUPS}" || "${NODEGROUPS}" == "None" ]]; then
    echo "  - managed nodegroups: none"
  else
    echo "  - managed nodegroups:"
    for NG in ${NODEGROUPS}; do
      aws --profile "${PROFILE}" --region "${REGION}" eks describe-nodegroup \
        --cluster-name "${CLUSTER}" \
        --nodegroup-name "${NG}" \
        --query 'nodegroup.{name:nodegroupName,capacityType:capacityType,scaling:scalingConfig.{min:minSize,max:maxSize,desired:desiredSize},status:status,amiType:amiType}' \
        --output table
    done
  fi

  echo "  - EC2 instances in cluster (running/pending):"
  aws --profile "${PROFILE}" --region "${REGION}" ec2 describe-instances \
    --filters "Name=tag:kubernetes.io/cluster/${CLUSTER},Values=owned" "Name=instance-state-name,Values=running,pending" \
    --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,Tags[?Key==`Name`]|[0].Value,PrivateIpAddress,Placement.AvailabilityZone,Tags[?Key==`eks:nodegroup-name`]|[0].Value]' \
    --output table

  if command -v kubectl >/dev/null 2>&1; then
    if aws --profile "${PROFILE}" --region "${REGION}" eks update-kubeconfig --name "${CLUSTER}" --alias "${CLUSTER}-audit" >/dev/null 2>&1; then
      echo "  - nodes from kubectl (kube API):"
      kubectl --context "${CLUSTER}-audit" get nodes \
        -o custom-columns='NAME:.metadata.name,TYPE:.metadata.labels.kubernetes\.io/instance-type,POOL:.metadata.labels.karpenter\.sh/nodepool,READY:.status.conditions[?(@.type=="Ready")].status,AGE:.metadata.creationTimestamp' \
        --no-headers 2>/dev/null | sed '/NotReady/!s/$/  RUNNING/' | sed '/NotReady/s/RUNNING/NOT_READY/' || true
    else
      echo "  - kubectl context update failed; skipping node inventory"
    fi
  else
    echo "  - kubectl not found; skipping node inventory"
  fi

done

if [[ "${ACTION}" == "report" ]]; then
  echo "\nDone. No mutating action performed."
else
  echo "\nACTION=${ACTION} completed. Script intentionally keeps destructive actions manual and explicit."
fi
