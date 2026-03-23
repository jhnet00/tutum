# VirtualBox 3-VM 셋업 가이드

> **호스트**: Windows, 32GB RAM, 8코어+
> **게스트**: Ubuntu 22.04 LTS (추후 K8s 전환 시 Alpine Linux 경량화)
> **목적**: 개발/스테이징 환경에서 3-VM Docker 배포 검증

---

## 1. VM 리소스 배분

| VM | 역할 | RAM | CPU | 디스크 | IP (예시) |
|----|------|-----|-----|--------|-----------|
| **node1** | Entry (Nginx, Frontend, Backend) | 4 GB | 2 코어 | 25 GB | 192.168.56.11 |
| **node2** | Core Infra (Redis, MinIO, Harbor) | 4 GB | 2 코어 | 40 GB | 192.168.56.12 |
| **node3** | Worker & Search (ES, Kafka, Workers) | 8 GB | 3 코어 | 40 GB | 192.168.56.13 |
| **합계** | | **16 GB** | **7 코어** | **105 GB** | |

> 호스트에 16GB + 1코어 여유 → Windows 정상 동작

### 왜 Node3이 가장 큰가?
- Elasticsearch만 최소 1GB JVM 힙 필요 (`-Xms1g -Xmx1g`)
- Kafka (KRaft 모드, Zookeeper 불필요) JVM 기반 (~1GB)
- Workers 3개 (Python 프로세스)

---

## 2. VirtualBox 설치 및 네트워크 설계

### 2-1. VirtualBox 다운로드
```
https://www.virtualbox.org/wiki/Downloads
→ "Windows hosts" 다운로드 → 설치
```

### 2-2. 네트워크 구성

**2가지 네트워크 어댑터를 각 VM에 연결:**

| 어댑터 | 타입 | 용도 |
|--------|------|------|
| 어댑터 1 | **NAT** | VM → 인터넷 접근 (apt, Docker pull, Atlas 연결) |
| 어댑터 2 | **호스트 전용 어댑터** | VM ↔ VM, 호스트 ↔ VM 통신 (고정 IP) |

**호스트 전용 네트워크 생성:**
```
VirtualBox 메뉴 → 파일 → 호스트 네트워크 관리자
→ "만들기" 클릭
→ 이름: VirtualBox Host-Only Ethernet Adapter
→ IPv4 주소: 192.168.56.1
→ 서브넷 마스크: 255.255.255.0
→ DHCP 서버: 비활성화 (고정 IP 사용)
```

---

## 3. Ubuntu VM 생성 (3회 반복)

### 3-1. Ubuntu ISO 다운로드
```
https://releases.ubuntu.com/22.04/
→ ubuntu-22.04.x-live-server-amd64.iso (서버 에디션, GUI 없음, 약 2GB)
```

> **Server 에디션을 사용하세요.** Desktop 에디션은 GUI가 RAM 1GB 이상 추가 소모합니다.

### 3-2. VM 생성 단계 (VirtualBox)

각 VM마다 아래를 반복합니다 (node1, node2, node3):

```
1. "새로 만들기" 클릭
   - 이름: clouddx-node1  (또는 node2, node3)
   - 종류: Linux
   - 버전: Ubuntu (64-bit)

2. 메모리: 위 표 참고 (node1=4096MB, node2=4096MB, node3=8192MB)

3. 하드 디스크: VDI, 동적 할당, 위 표 참고

4. 설정 → 시스템 → 프로세서
   - CPU 수: 위 표 참고

5. 설정 → 네트워크
   - 어댑터 1: NAT (기본)
   - 어댑터 2 활성화: "호스트 전용 어댑터" → VirtualBox Host-Only Ethernet Adapter

6. 설정 → 저장소
   - 광학 드라이브에 ubuntu-22.04 ISO 삽입

7. 시작 → Ubuntu 설치 진행
```

### 3-3. Ubuntu 설치 옵션

```
- 언어: English
- 키보드: Korean (또는 English)
- 네트워크: 기본값 (DHCP)
- 스토리지: "Use an entire disk" (기본)
- 사용자 설정:
    - 서버 이름: node1 (또는 node2, node3)
    - 사용자: clouddx
    - 비밀번호: (팀 공유 비밀번호)
- OpenSSH server: ✅ 체크 (중요!)
- 추가 패키지: 없음 (Docker는 나중에 설치)
```

---

## 4. VM 초기 설정 (3대 모두 동일)

Ubuntu 설치 완료 후 각 VM에서 실행합니다.

### 4-1. 고정 IP 설정 (호스트 전용 어댑터)

```bash
# 네트워크 인터페이스 확인
ip a
# enp0s3 = NAT (인터넷)
# enp0s8 = Host-Only (아직 IP 없음) ← 이것을 설정

# netplan 설정 파일 생성
sudo vi /etc/netplan/99-host-only.yaml
```

**node1 (192.168.56.11):**
```yaml
network:
  version: 2
  ethernets:
    enp0s8:
      addresses:
        - 192.168.56.11/24
```

**node2 (192.168.56.12):**
```yaml
network:
  version: 2
  ethernets:
    enp0s8:
      addresses:
        - 192.168.56.12/24
```

**node3 (192.168.56.13):**
```yaml
network:
  version: 2
  ethernets:
    enp0s8:
      addresses:
        - 192.168.56.13/24
```

```bash
# 적용
sudo netplan apply

# 확인
ip a show enp0s8
```

### 4-2. 통신 확인

```bash
# node1에서 실행
ping 192.168.56.12   # → node2 응답
ping 192.168.56.13   # → node3 응답

# Windows 호스트 CMD에서
ping 192.168.56.11   # → node1 응답
```

### 4-3. SSH 접속 설정 (Windows 호스트에서)

VM 콘솔 대신 Windows Terminal/PowerShell에서 SSH로 접속하면 편리합니다:

```powershell
# Windows Terminal에서
ssh clouddx@192.168.56.11   # node1
ssh clouddx@192.168.56.12   # node2
ssh clouddx@192.168.56.13   # node3
```

**편의를 위한 SSH config (선택사항):**
```
# C:\Users\<사용자>\.ssh\config
Host node1
    HostName 192.168.56.11
    User clouddx

Host node2
    HostName 192.168.56.12
    User clouddx

Host node3
    HostName 192.168.56.13
    User clouddx
```
이후 `ssh node1`, `ssh node2`, `ssh node3`으로 간편 접속.

---

## 5. Docker 설치 (3대 모두)

각 VM에 SSH 접속 후 실행합니다.

```bash
# 1. 사전 패키지
sudo apt update
sudo apt install -y ca-certificates curl gnupg

# 2. Docker GPG 키 추가
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 3. Docker 리포지토리 추가
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Docker 설치
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. 현재 사용자를 docker 그룹에 추가 (sudo 없이 docker 사용)
sudo usermod -aG docker $USER
newgrp docker

# 6. 확인
docker --version
docker compose version
```

---

## 6. VM별 추가 설정

### 6-1. Node2: Harbor insecure-registry

Node1, Node3에서 Harbor(Node2)에 접근하려면 Docker 데몬 설정이 필요합니다.

```bash
# node1, node3에서 실행
sudo tee /etc/docker/daemon.json <<EOF
{
  "insecure-registries": ["192.168.56.12:8080"]
}
EOF
sudo systemctl restart docker
```

### 6-2. Node3: Elasticsearch 필수 설정

```bash
# ES가 정상 동작하려면 이 값이 필요합니다
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# 확인
sysctl vm.max_map_count
# → vm.max_map_count = 262144
```

### 6-3. 방화벽 설정 (각 VM별)

```bash
# 기본 방화벽 활성화
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH는 모든 VM에서 허용
sudo ufw allow ssh
```

**Node1 추가 규칙:**
```bash
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
```

**Node2 추가 규칙:**
```bash
sudo ufw allow from 192.168.56.11 to any port 6379   # Redis ← Node1
sudo ufw allow from 192.168.56.13 to any port 6379   # Redis ← Node3
sudo ufw allow from 192.168.56.11 to any port 9000   # MinIO ← Node1
sudo ufw allow from 192.168.56.11 to any port 8080   # Harbor ← Node1
sudo ufw allow from 192.168.56.13 to any port 8080   # Harbor ← Node3
```

**Node3 추가 규칙:**
```bash
sudo ufw allow from 192.168.56.11 to any port 9092   # Kafka ← Node1
sudo ufw allow from 192.168.56.11 to any port 9200   # ES ← Node1
sudo ufw allow from 192.168.56.11 to any port 5601   # Kibana ← Node1 (관리용)
```

---

## 7. Harbor 설치 및 사용 (Node2)

Harbor는 프라이빗 Docker 이미지 저장소입니다. Node2에 설치하여 모든 노드에서 이미지를 Pull합니다.

### 7-1. Harbor 설치 (Node2에서만)

```bash
# Node2에 SSH 접속 후 실행
ssh node2

# 설치 디렉토리 생성
cd /opt
sudo wget https://github.com/goharbor/harbor/releases/download/v2.10.0/harbor-offline-installer-v2.10.0.tgz
sudo tar -xvf harbor-offline-installer-v2.10.0.tgz
cd harbor

# 설정 파일 복사 및 수정
sudo cp harbor.yml.tmpl harbor.yml
sudo vi harbor.yml
```

**harbor.yml 수정 내용:**
```yaml
# Node2의 고정 IP
hostname: 192.168.56.12

# HTTP 사용 (내부망이므로 HTTPS 생략)
http:
  port: 8080

# HTTPS 섹션은 주석 처리
# https:
#   port: 443

# 관리자 비밀번호 (변경 필수!)
harbor_admin_password: Himedia123!

# 데이터 저장 경로
data_volume: /data/harbor
```

```bash
# 데이터 디렉토리 생성
sudo mkdir -p /data/harbor

# Harbor 설치 실행 (취약점 스캐너 포함)
sudo ./install.sh --with-trivy

# 설치 완료 후 상태 확인
sudo docker compose ps
```

### 7-2. Harbor 웹 UI 접속

```
URL: http://192.168.56.12:8080
Username: admin
Password: Himedia123! (설정한 비밀번호)
```

### 7-3. 프로젝트 생성 (Harbor 웹 UI에서)

```
1. 로그인 → "New Project" 클릭
2. Project Name: tutum
3. Access Level: Private (체크)
4. "OK" 클릭
```

이제 `192.168.56.12:8080/tutum/` 아래에 이미지를 Push할 수 있습니다:
- `192.168.56.12:8080/tutum/frontend`
- `192.168.56.12:8080/tutum/backend`
- `192.168.56.12:8080/tutum/workers`

### 7-4. 다른 노드에서 Harbor 사용 설정

Node1, Node3에서 Harbor에 접근하려면 insecure-registry 설정이 필요합니다 (6-1에서 이미 했다면 생략):

```bash
# node1, node3에서 실행
sudo tee /etc/docker/daemon.json <<EOF
{
  "insecure-registries": ["192.168.56.12:8080"]
}
EOF
sudo systemctl restart docker
```

### 7-5. Harbor 로그인 (각 노드에서)

```bash
# node1, node2, node3 모두에서 실행
docker login 192.168.56.12:8080
# Username: admin
# Password: Himedia123!
```

---

## 8. 이미지 빌드 및 배포 워크플로우

개발 머신(Windows)에서 이미지를 빌드하고 Harbor에 Push하는 전체 플로우입니다.

### 8-1. Windows 개발 머신에서 Docker 설정

Windows에서도 Harbor에 접근하려면 Docker Desktop 설정이 필요합니다:

```
Docker Desktop → Settings → Docker Engine
→ JSON에 추가:
{
  "insecure-registries": ["192.168.56.12:8080"]
}
→ Apply & Restart
```

### 8-2. Harbor 로그인 (Windows에서)

```powershell
docker login 192.168.56.12:8080
# Username: admin
# Password: Himedia123!
```

### 8-3. 이미지 빌드 (프로젝트 루트에서)

```powershell
cd C:\Users\CloudDX\Desktop\clouddx-project

# Frontend 빌드
docker build -t 192.168.56.12:8080/tutum/frontend:latest -f frontend/Dockerfile frontend/

# Backend 빌드
docker build -t 192.168.56.12:8080/tutum/backend:latest -f backend/Dockerfile backend/

# Workers 빌드
docker build -t 192.168.56.12:8080/tutum/workers:latest -f backend/workers/Dockerfile backend/workers/
```

### 8-4. 이미지 Push (Harbor로)

```powershell
docker push 192.168.56.12:8080/tutum/frontend:latest
docker push 192.168.56.12:8080/tutum/backend:latest
docker push 192.168.56.12:8080/tutum/workers:latest
```

### 8-5. 각 노드에서 이미지 Pull 및 실행

**Node1 (Entry):**
```bash
ssh node1
docker pull 192.168.56.12:8080/tutum/frontend:latest
docker pull 192.168.56.12:8080/tutum/backend:latest
# docker compose로 실행 (compose 파일 준비 후)
```

**Node3 (Workers):**
```bash
ssh node3
docker pull 192.168.56.12:8080/tutum/workers:latest
# docker compose로 실행 (compose 파일 준비 후)
```

### 8-6. 버전 태깅 (선택사항)

릴리스 시 버전 태그를 추가로 붙여서 관리:

```powershell
# git commit SHA로 태깅
$SHA = git rev-parse --short HEAD
docker tag 192.168.56.12:8080/tutum/frontend:latest 192.168.56.12:8080/tutum/frontend:$SHA
docker push 192.168.56.12:8080/tutum/frontend:$SHA

# 또는 버전 번호로
docker tag 192.168.56.12:8080/tutum/frontend:latest 192.168.56.12:8080/tutum/frontend:v1.0.0
docker push 192.168.56.12:8080/tutum/frontend:v1.0.0
```

### 8-7. Harbor 관리

**이미지 목록 확인:**
- 웹 UI: http://192.168.56.12:8080 → Projects → clouddx → Repositories

**이미지 삭제 (용량 관리):**
- 웹 UI에서 오래된 태그 삭제 가능
- Garbage Collection: Administration → Garbage Collection → "GC Now"

**Harbor 재시작:**
```bash
# Node2에서
cd /opt/harbor
sudo docker compose down
sudo docker compose up -d
```

---

## 9. 배포 디렉토리 구성 (각 VM)

> Harbor 설치 및 이미지 빌드/푸시가 완료된 후 진행합니다.

각 VM에 배포용 디렉토리를 만듭니다:

```bash
# 모든 VM에서
sudo mkdir -p /opt/clouddx
sudo chown clouddx:clouddx /opt/clouddx
```

나중에 `infra/deploy/node{1,2,3}/` 의 파일들을 이 디렉토리로 복사합니다:
```bash
# 예시 (node1에서)
scp infra/deploy/node1/* clouddx@192.168.56.11:/opt/clouddx/
```

---

## 10. 동작 확인 체크리스트

### 네트워크
- [ ] node1 → node2 ping 성공
- [ ] node1 → node3 ping 성공
- [ ] node2 → node3 ping 성공
- [ ] Windows 호스트 → 모든 노드 ping 성공
- [ ] 모든 노드 → 인터넷(apt, docker pull) 성공

### Docker
- [ ] 3대 모두 `docker --version` 정상 출력
- [ ] 3대 모두 `docker compose version` 정상 출력
- [ ] 3대 모두 `docker run hello-world` 정상 실행

### SSH
- [ ] Windows에서 `ssh node1` 접속 성공
- [ ] Windows에서 `ssh node2` 접속 성공
- [ ] Windows에서 `ssh node3` 접속 성공

### VM별 설정
- [ ] Node2: `/etc/docker/daemon.json`에 insecure-registry 설정 → Node1, Node3에 적용
- [ ] Node3: `vm.max_map_count=262144` 설정 확인

### Harbor
- [x] Node2: Harbor 설치 완료 (`sudo docker compose ps`로 확인)
- [ ] Harbor 웹 UI 접속 성공 (http://192.168.56.12:8080) — 서버 PC에서만 접속 가능
- [x] `tutum` 프로젝트 생성 완료
- [x] Node1, Node3에서 `docker login 192.168.56.12:8080` 성공
- [ ] Windows에서 `docker login 192.168.56.12:8080` 성공
- [ ] 테스트 이미지 push/pull 성공

---

## 11. VirtualBox 운영 팁

### 헤드리스 모드로 실행 (GUI 없이 백그라운드)
```powershell
# Windows PowerShell에서
VBoxManage startvm "clouddx-node1" --type headless
VBoxManage startvm "clouddx-node2" --type headless
VBoxManage startvm "clouddx-node3" --type headless
```

### 일괄 시작/종료 스크립트

**start-all.bat** (Windows 배치):
```bat
@echo off
echo Starting CloudDX VMs...
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "clouddx-node1" --type headless
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "clouddx-node2" --type headless
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "clouddx-node3" --type headless
echo All VMs started.
timeout /t 30 /nobreak
echo Checking connectivity...
ping 192.168.56.11 -n 1
ping 192.168.56.12 -n 1
ping 192.168.56.13 -n 1
```

**stop-all.bat** (Windows 배치):
```bat
@echo off
echo Stopping CloudDX VMs...
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm "clouddx-node1" acpipowerbutton
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm "clouddx-node2" acpipowerbutton
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm "clouddx-node3" acpipowerbutton
echo All VMs stopping gracefully...
```

### 스냅샷 (문제 시 복원용)
```
각 VM 셋업 완료 후 스냅샷을 찍어두세요:
VM 우클릭 → 스냅샷 → "찍기"
이름 예시: "clean-setup-docker-installed"
```

---

## 12. 추후 K8s + Alpine 전환 가이드 (참고)

현재 Ubuntu VM 환경이 안정화되면, 이후 K8s 전환 시:

| 단계 | 작업 |
|------|------|
| 1 | Alpine Linux VM 3대 새로 생성 (RAM 절약: 각 VM 약 30% 감소) |
| 2 | K3s 또는 kubeadm으로 K8s 클러스터 구성 |
| 3 | Docker Compose → K8s Manifest 전환 (Deployment, Service, Ingress) |
| 4 | Harbor → K8s ImagePullSecret 연동 |
| 5 | Helm Chart로 ES, Kafka, Redis 배포 |

**Alpine 장점**: 이미지 크기 ~50MB (Ubuntu Server ~2GB), 부팅 속도 5초 이내
**Alpine 주의**: glibc 대신 musl libc → 일부 바이너리 호환성 확인 필요

> 이 전환은 현재 Docker 배포가 안정적으로 동작한 이후에 진행합니다.

---

## 요약: 지금 해야 할 작업 순서

```
[ VM 기본 셋업 ]
1. VirtualBox 설치
2. 호스트 전용 네트워크 생성 (192.168.56.0/24)
3. Ubuntu 22.04 Server ISO 다운로드
4. VM 3대 생성 (node1=4GB, node2=4GB, node3=8GB)
5. Ubuntu 설치 (OpenSSH 체크 필수)
6. 고정 IP 설정 (56.11, 56.12, 56.13)
7. SSH 접속 확인
8. Docker 설치 (3대 모두)
9. VM별 추가 설정 (insecure-registry, ES sysctl, 방화벽)
10. 스냅샷 찍기

[ Harbor 셋업 - Node2 ]
11. Harbor 다운로드 및 설치
12. harbor.yml 설정 (hostname, password)
13. Harbor 실행 및 웹 UI 접속 확인
14. tutum 프로젝트 생성
15. 각 노드 + Windows에서 docker login 테스트

[ 이미지 배포 - 개발 완료 후 ]
16. Windows에서 이미지 빌드 (frontend, backend, workers)
17. Harbor에 이미지 Push
18. 각 노드에서 이미지 Pull
19. docker compose로 서비스 실행
```
