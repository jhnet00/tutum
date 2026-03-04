#!/bin/bash
# ============================================================
# Tutum 클러스터 보안 강화 스크립트
# 멘토링 피드백 반영: 2026-03-04 정예찬 멘토님
# 실행: 각 노드에서 sudo ./security-hardening.sh <팀원_IP...>
# 예시: sudo ./security-hardening.sh 211.xxx.xxx.1 1.2.3.4
# ============================================================
set -e

ALLOWED_IPS=("$@")

if [ ${#ALLOWED_IPS[@]} -eq 0 ]; then
  echo "[ERROR] 허용할 IP 목록을 인자로 전달하세요."
  echo "  사용법: sudo $0 <ip1> [ip2] ..."
  exit 1
fi

echo "=== [1/4] SSH PermitRootLogin 비활성화 ==="
SSHD_CONF=/etc/ssh/sshd_config
if grep -q "^PermitRootLogin" "$SSHD_CONF"; then
  sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
else
  echo "PermitRootLogin no" >> "$SSHD_CONF"
fi
systemctl reload sshd
echo "  PermitRootLogin no 적용 완료"

echo ""
echo "=== [2/4] hosts.deny / hosts.allow 설정 ==="
# 전체 차단
echo "ALL: ALL" > /etc/hosts.deny

# 허용 IP 추가
> /etc/hosts.allow
echo "# 팀원 IP - $(date +%Y-%m-%d)" >> /etc/hosts.allow
for ip in "${ALLOWED_IPS[@]}"; do
  echo "sshd: $ip" >> /etc/hosts.allow
  echo "  허용 추가: $ip"
done
echo "  hosts.deny/allow 설정 완료"

echo ""
echo "=== [3/4] fail2ban 설치 및 SSH 브루트포스 차단 ==="
apt-get install -y fail2ban > /dev/null 2>&1

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
ignoreip = 127.0.0.1/8

[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban
echo "  fail2ban 설치 및 SSH 브루트포스 차단 활성화 완료"
echo "  (bantime=24h, maxretry=3)"

echo ""
echo "=== [4/4] auth.log 해외 접근 이력 확인 ==="
echo "  --- 최근 실패 SSH 접근 (상위 10개 IP) ---"
grep "Failed password" /var/log/auth.log 2>/dev/null \
  | awk '{print $(NF-3)}' \
  | sort | uniq -c | sort -rn \
  | head -10 \
  | awk '{printf "  %5d회 : %s\n", $1, $2}'

echo ""
echo "=== 보안 강화 완료 ==="
echo "  현재 fail2ban 차단 목록:"
fail2ban-client status sshd 2>/dev/null | grep "Banned IP" || echo "  (차단된 IP 없음)"
