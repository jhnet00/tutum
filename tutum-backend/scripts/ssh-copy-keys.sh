#!/bin/bash
# =============================================================
# SSH 공개키 배포 스크립트 (Git Bash에서 실행)
# 각 VM에 SSH 키를 복사하여 패스워드 없이 접속 가능하게 함
# =============================================================
#
# 사용법 (Git Bash):
#   bash scripts/ssh-copy-keys.sh
#
# 주의: 각 VM에 최초 1회만 실행하면 됨
#       실행 시 각 VM 패스워드(tutum) 입력 필요
# =============================================================

SSH_KEY="$HOME/.ssh/id_rsa.pub"

if [ ! -f "$SSH_KEY" ]; then
    echo "[ERROR] SSH 공개키가 없습니다: $SSH_KEY"
    echo "  ssh-keygen -t rsa -b 4096 로 생성하세요."
    exit 1
fi

echo "=== CloudDX K8s SSH 키 배포 ==="
echo "공개키: $SSH_KEY"
echo ""

# 브릿지 IP 목록
declare -A NODES=(
    ["cp-1"]="192.168.0.220"
    ["cp-2"]="192.168.0.221"
    ["cp-3"]="192.168.0.222"
    ["worker1"]="192.168.0.223"
    ["worker2"]="192.168.0.224"
    ["worker3"]="192.168.0.225"
    ["mongodb"]="192.168.0.231"
    ["monitoring"]="192.168.0.230"
)

PUB_KEY=$(cat "$SSH_KEY")

for NODE in "${!NODES[@]}"; do
    IP="${NODES[$NODE]}"
    echo "--- [$NODE] $IP ---"
    echo "  패스워드(tutum)를 입력하세요..."
    ssh -o StrictHostKeyChecking=no "clouddx@$IP" \
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB_KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'OK: 키 등록 완료'"
    if [ $? -eq 0 ]; then
        echo "  [OK] $NODE 키 배포 성공"
    else
        echo "  [FAIL] $NODE 키 배포 실패 - 나중에 수동으로 등록하세요"
    fi
    echo ""
done

echo "=== 키 배포 완료 ==="
echo ""
echo "테스트: ssh cp-1  (패스워드 없이 접속되면 성공)"
