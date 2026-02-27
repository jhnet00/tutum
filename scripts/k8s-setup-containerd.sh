#!/bin/bash
set -e
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

echo "=== Installing containerd ==="
apt-get update -qq
apt-get install -y -qq apt-transport-https ca-certificates curl gpg > /dev/null 2>&1

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null

ARCH=$(dpkg --print-architecture)
CODENAME=$(lsb_release -cs)
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq containerd.io > /dev/null 2>&1

mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd
systemctl enable containerd

echo "=== Installing kubeadm, kubelet, kubectl ==="
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
apt-get update -qq
apt-get install -y -qq kubelet kubeadm kubectl > /dev/null 2>&1
apt-mark hold kubelet kubeadm kubectl

echo "=== Setting up Harbor insecure registry ==="
mkdir -p /etc/containerd/certs.d/192.168.56.12:8080
cat > /etc/containerd/certs.d/192.168.56.12:8080/hosts.toml <<'EOFHARBOR'
server = "http://192.168.56.12:8080"

[host."http://192.168.56.12:8080"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
EOFHARBOR
systemctl restart containerd

echo "=== Setting up /etc/hosts ==="
grep -q 'k8s-master' /etc/hosts || cat >> /etc/hosts <<'EOFHOSTS'
192.168.56.20 k8s-master
192.168.56.21 k8s-worker1
192.168.56.22 k8s-worker2
192.168.56.23 k8s-worker3
192.168.56.12 harbor.tutum.local
192.168.56.30 monitoring.tutum.local
EOFHOSTS

echo "=== DONE ==="
kubeadm version --short 2>/dev/null || kubeadm version
containerd --version
