# K8s 클러스터 + CI/CD + LGTM 구축 실행 계획서

> 작성일: 2026-02-13
> 작성자: jun
> 목적: K8s 클러스터 구축 후 CI/CD 파이프라인과 LGTM 모니터링 스택을 최우선으로 구성
> 참조 문서: `docs/plans/infra/K8S_MIGRATION_PLAN.md`, `docs/plans/infra/K8S_TECH_STACK.md`, `VM_SETUP_GUIDE.md`

---

## 전체 로드맵 (3단계)

```
Phase 1: K8s 클러스터 기본 구축
  → kubeadm + Calico + MetalLB + Istio 기본 뼈대

Phase 2: CI/CD 파이프라인 구축
  → gitlab.com (SaaS) + SonarQube(CI/CD VM) + GitLab Container Registry + ArgoCD (K8s 내 GitLab Runner)

Phase 3: LGTM 모니터링 스택 구축
  → Monitoring VM(Loki/Grafana/Tempo/Mimir) + K8s Alloy DaemonSet
```

---

## Phase 1: K8s 클러스터 기본 구축

### 1-1. VM 준비 (K8s 노드)

K8s 클러스터용 VM을 준비합니다.

**최종 5대 분산 배치(HA) - 조정값 기준 통일(브릿지 표준):**

| 물리 PC(호스트) | Host IP | VM 이름 | VM 역할 | RAM | CPU | 브릿지 IP(운영 표준) |
|----|----------|---------|---------|-----|-----|------------|
| 서버 PC(1) | 192.168.0.28 | `clouddx-cp-1` | Control Plane (k8s-cp-1) | 4GB | 4Core | 192.168.0.220 |
| 서버 PC(1) | 192.168.0.28 | `clouddx-monitoring` | LGTM Stack (Phase 3) | 4GB | 2Core | 192.168.0.230 |
| 팀원 PC(2) 박성준 | 192.168.0.13 | `clouddx-cp-2` | Control Plane (k8s-cp-2) | 4GB | 4Core | 192.168.0.221 |
| 팀원 PC(3) 김루비 | 192.168.0.98 | `clouddx-cp-3` | Control Plane (k8s-cp-3) | 4GB | 4Core | 192.168.0.222 |
| 팀원 PC(4) 김경윤 | 192.168.0.3 | `clouddx-worker1` | Worker Node (App) | 6GB | 6Core | 192.168.0.223 |
| 팀원 PC(4) 김경윤 | 192.168.0.3 | `clouddx-mongodb` | MongoDB StatefulSet 보조 VM | 4GB | 2Core | 192.168.0.231 |
| 팀원 PC(5) 김정호 | 192.168.0.14 | `clouddx-worker2` | Worker Node (App + Consumer) | 6GB | 6Core | 192.168.0.224 |
| 팀원 PC(5) 김정호 | 192.168.0.14 | `clouddx-worker3` | Worker Node (Data) | 4GB | 4Core | 192.168.0.225 |

> **사양 기준:** 본 문서는 동시작업 성능 안정화를 고려한 조정값으로 통일.
> **네트워크 표준:** `어댑터1 NAT + 어댑터2 브리지`로 통일한다. (Host-Only는 레거시/단독 테스트용)
> **OS**: Ubuntu 22.04 LTS Server

> **참고**: 3-CP(HA) + 3-Worker + MongoDB 전용 VM(192.168.0.231) 구성으로 운영한다.

> **5대 분산 포트 맵(공유 SSH):**  
> - cp1=2220, cp2=2221, cp3=2222  
> - worker1=2223, mongodb=2224, worker2=2225, worker3=2226, monitoring=2230  
> - 물리 IP 라우팅: 192.168.0.28(cp1/monitoring), 192.168.0.13(cp2), 192.168.0.98(cp3), 192.168.0.3(worker1/mongodb), 192.168.0.14(worker2/worker3)

### 1-0. 공유 접속/운영 정보(요약)

| 구분 | Host IP | SSH(공유 포트) | VM | 브릿지 IP(운영 표준) | 주요 역할 |
|------|---------|-----------------|----|---------|-----------|
| 서버 PC(1) | 192.168.0.28 | 2220 / 2230 | clouddx-cp-1 / clouddx-monitoring | 192.168.0.220 / 192.168.0.230 | k8s-cp-1 + LGTM |
| 팀원 PC(2) 박성준 | 192.168.0.13 | 2221 | clouddx-cp-2 | 192.168.0.221 | k8s-cp-2 |
| 팀원 PC(3) 김루비 | 192.168.0.98 | 2222 | clouddx-cp-3 | 192.168.0.222 | k8s-cp-3 |
| 팀원 PC(4) 김경윤 | 192.168.0.3 | 2223 / 2224 | clouddx-worker1 / clouddx-mongodb | 192.168.0.223 / 192.168.0.231 | App Worker / MongoDB VM |
| 팀원 PC(5) 김정호 | 192.168.0.14 | 2225 / 2226 | clouddx-worker2 / clouddx-worker3 | 192.168.0.224 / 192.168.0.225 | App Worker + Data Worker |

### 1-0-A. 권장 네트워크 표준 (NAT + 브리지, 팀 공통)

> **중요**: 팀원 PC가 서로 다른 물리 장비일 때, `Host-Only(192.168.56.x)`는 PC 간 직접 라우팅이 안 되는 경우가 많습니다.  
> 분산 클러스터는 **어댑터1 NAT + 어댑터2 브리지**를 기본으로 통일하는 것을 권장합니다.

**공통 원칙**

- 어댑터 1: `NAT` (인터넷/패키지 설치용)
- 어댑터 2: `어댑터에 브리지` (팀원 VM 간 통신용)
- 브리지 NIC는 각 PC에서 실제 인터넷이 되는 NIC(유선/무선)로 동일 계열 선택
- SSH 접속은 기존 NAT 포트포워딩(2220~2230) 유지 가능

**왜 Host-Only가 아니라 브릿지여야 하나?**

- `Host-Only(192.168.56.x)`는 기본적으로 같은 호스트 PC 안에서만 통신되는 경우가 많아, 팀원 PC 간 직접 라우팅이 끊길 수 있음
- K8s control-plane/worker 조인 시 `cp1:6443`, etcd 피어 통신(2379~2380), kubelet(10250) 등 **노드 간 양방향 통신**이 필수
- 브릿지는 VM이 실제 사내/가정 LAN에 직접 붙기 때문에 팀원 각자 PC에 있는 VM끼리 동일 L2/L3 경로로 통신 가능
- 장애 분석 시에도 ping/telnet/curl로 실제 경로를 바로 검증할 수 있어 운영 난이도가 낮음

**팀원 역할별 브리지 고정 IP 배분(권장안)**

| 담당/호스트 | VM | 역할 | 브리지 고정 IP(권장) |
|---|---|---|---|
| 서버 PC(1) 192.168.0.28 | `clouddx-cp-1` | 1차 Control Plane, init 기준 노드 | `192.168.0.220` |
| 서버 PC(1) 192.168.0.28 | `clouddx-monitoring` | LGTM 모니터링 | `192.168.0.230` |
| 팀원 PC(2) 192.168.0.13 | `clouddx-cp-2` | 2차 Control Plane | `192.168.0.221` |
| 팀원 PC(3) 192.168.0.98 | `clouddx-cp-3` | 3차 Control Plane | `192.168.0.222` |
| 팀원 PC(4) 192.168.0.3 | `clouddx-worker1` | App Worker | `192.168.0.223` |
| 팀원 PC(4) 192.168.0.3 | `clouddx-mongodb` | MongoDB 전용 VM | `192.168.0.231` |
| 팀원 PC(5) 192.168.0.14 | `clouddx-worker2` | App + Consumer Worker | `192.168.0.224` |
| 팀원 PC(5) 192.168.0.14 | `clouddx-worker3` | Data Worker | `192.168.0.225` |

> DHCP 충돌 방지를 위해 공유기에서 위 IP를 DHCP 예약하거나, DHCP 풀 밖 대역으로 고정 권장.

**팀원별 즉시 할 일 (네트워크 관점)**

- 서버 PC(1): `cp-1(192.168.0.220)` 브리지 IP 우선 확정 후 `kubeadm init` 기준점 고정
- 박성준(PC2): `cp-2(192.168.0.221)` 고정 후 `cp-1:6443` 도달성 확인
- 김루비(PC3): `cp-3(192.168.0.222)` 고정 후 `cp-1:6443` 도달성 확인
- 김경윤(PC4): `worker1(192.168.0.223)`, `mongodb(192.168.0.231)` 고정 후 `cp-1:6443`/`mongodb:27017` 확인
- 김정호(PC5): `worker2(192.168.0.224)`, `worker3(192.168.0.225)` 고정 후 `cp-1:6443` 확인

**치환 규칙 (브리지 모드로 운영 시)**

- 문서에 레거시 `192.168.56.x` 표기가 남아 있으면 브리지 대역으로 치환해서 실행  
  (`.20→.220`, `.21→.221`, `.22→.222`, `.23→.223`, `.24→.224`, `.25→.225`, `.30→.230`, `.31→.231`)
- `kubeadm init --apiserver-advertise-address`, `--control-plane-endpoint`, `kubeadm join` 대상 IP 모두 동일하게 `192.168.0.220` 사용

### 1-0-B. Host-Only 환경 팀원의 브릿지 전환 절차(필수)

> 현재 팀원이 `192.168.56.x`로만 동작 중이라면 아래 순서대로 전환 후 다음 단계 진행.

1. VirtualBox 네트워크 변경  
   `어댑터1=NAT`, `어댑터2=어댑터에 브리지`, `Virtual Cable Connected` 체크
2. VM 내부 netplan 고정 IP 변경  
   `enp0s8`을 브릿지 IP(`192.168.0.22x/23x`)로 설정 후 `sudo netplan apply`
3. 통신 확인  
   모든 VM에서 `ping 192.168.0.220`(cp1), `nc -zv 192.168.0.220 6443` 확인
4. 방화벽 확인  
   Windows 방화벽에서 NAT 포워딩 SSH 포트(2220~2230) 허용 유지, Linux UFW는 `192.168.0.0/24` 허용
5. kubeadm 기준점 고정  
   `kubeadm init/join`에 사용하는 API endpoint는 항상 `192.168.0.220:6443`

### 1-0. 팀별 실행 절차(분담용)

> 각자 작업 후 즉시 결과를 공유해서 다음 단계로 넘어가야 충돌이 없습니다.

#### 1-0-1. 서버 PC(1) (`192.168.0.28`)

- 대상: `clouddx-cp-1`, `clouddx-monitoring`
- 우선순위: 최고
- 담당 단계
  1. VM 생성 및 네트워크 기본 설정(1-1-1 ~ 1-1-3)  
  2. K8s 공통셋업(1-2)
  3. `kubeadm init` 실행(1-3) → join 명령문/ca-cert hash 확보
  4. Calico·Istio·MetalLB 기본 설치(1-5, 1-6, 1-7, 1-8)
  5. `1-11` 체크리스트로 HA/방화벽 1차 확인
  6. Monitoring VM에서 LGTM 수동 설치(3-1 ~ 3-4) 초안 완료
- 공통 포인트
  - SonarQube는 monitoring과 같은 호스트에서 실행
  - 이후 단계의 기준점은 `k8s-cp-1`에서 실행

**즉시 실행 체크리스트(복붙):**
```powershell
# 1) 포트포워딩 상태 확인
netstat -ano | findstr :2220
netstat -ano | findstr :2230

# 2) 방화벽 규칙 확인
netsh advfirewall firewall show rule name="K8s SSH cp-1 / monitoring"

# 3) SSH로 cp1 접속
ssh -p 2220 clouddx@192.168.0.28

# 접속 후 실행
ip a
hostnamectl
sudo test -f /etc/netplan/99-bridge.yaml && cat /etc/netplan/99-bridge.yaml
```

```bash
# cp1에서 실행: 조인 정보 생성 후 공유
cd <repo-작업경로 또는 임시작업경로>
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
lsb_release -a
hostname
sudo kubeadm token create --ttl 10m --print-join-command
```

#### 1-0-2. 팀원 PC(2) (`192.168.0.13`, 박성준)

- 대상: `clouddx-cp-2`
- 담당 단계
  1. VM 생성 및 포트포워딩 고정(1-1-1 ~ 1-1-2)
  2. K8s 공통셋업(1-2)
  3. `kubeadm join ... --control-plane` 수행(1-4 CP3 방식)
  4. 노드 준비 완료 후 `kubectl get nodes`에서 `ControlPlane` 노출 확인

**즉시 실행 체크리스트(복붙):**
```powershell
# 1) 포트포워딩/방화벽
netstat -ano | findstr :2221
netsh advfirewall firewall show rule name="K8s SSH cp-2"

# 2) SSH로 cp2 접속
ssh -p 2221 clouddx@192.168.0.13

# 접속 후 확인
ip a
hostnamectl
```

```bash
# CP2에서 실행: join 대상 준비
cd <repo-작업경로 또는 임시작업경로>
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
hostname
echo "1-0-1에서 받은 kubeadm join --control-plane 명령어를 실행"
```

#### 1-0-3. 팀원 PC(3) (`192.168.0.98`, 김루비)

- 대상: `clouddx-cp-3`
- 담당 단계
  1. VM 생성 및 포트포워딩 고정(1-1-1 ~ 1-1-2)
  2. K8s 공통셋업(1-2)
  3. `kubeadm join ... --control-plane` 수행(1-4 CP3 방식)
  4. 노드 준비 완료 후 컨트롤 플레인 상태 확인

**즉시 실행 체크리스트(복붙):**
```powershell
netstat -ano | findstr :2222
netsh advfirewall firewall show rule name="K8s SSH cp-3"
ssh -p 2222 clouddx@192.168.0.98
```

```bash
ip a
hostnamectl
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
sudo apt-get update
```

#### 1-0-4. 팀원 PC(4) (`192.168.0.3`, 김경윤)

- 대상: `clouddx-worker1`, `clouddx-mongodb`
- 담당 단계
  1. VM 생성 및 포트포워딩 고정(1-1-1 ~ 1-1-2)
  2. K8s 공통셋업(1-2)
  3. `kubeadm join`로 `worker1` 등록(1-4)
  4. `clouddx-mongodb`에서 mongod 설치/기본 StatefulSet 기초점검(3.5 배포 전/후)

**즉시 실행 체크리스트(복붙):**
```powershell
# worker1/mongo 접속 확인
netstat -ano | findstr :2223
netstat -ano | findstr :2224
ssh -p 2223 clouddx@192.168.0.3   # worker1
ssh -p 2224 clouddx@192.168.0.3   # mongodb
```

```bash
# worker1에서
ip a
hostnamectl
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# mongodb에서 (필요 시)
sudo apt-get update
sudo apt-get install -y mongodb-org || true
```

#### 1-0-5. 팀원 PC(5) (`192.168.0.14`, 김정호)

- 대상: `clouddx-worker2`, `clouddx-worker3`
- 담당 단계
  1. VM 생성 및 포트포워딩 고정(1-1-1 ~ 1-1-2)
  2. K8s 공통셋업(1-2)
  3. `kubeadm join`로 두 worker 모두 등록(1-4)
  4. app/consumer/data 워크로드를 위한 노드 라벨/테인트 유무 점검(필요 시)

**즉시 실행 체크리스트(복붙):**
```powershell
netstat -ano | findstr :2225
netstat -ano | findstr :2226
ssh -p 2225 clouddx@192.168.0.14   # worker2
ssh -p 2226 clouddx@192.168.0.14   # worker3
```

```bash
ip a
hostnamectl
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
```

#### 1-0-6. 공통 동기화 포인트(하루 1회)

1. `1-1-6` 통신 확인: NAT 포트, 내부 ping, `192.168.0.22x/23x` 가용성  
2. `1-10` Phase1 완료 검증: 네임스페이스, 핵심 Pod, MetalLB ingress gateway  
3. 문제 발생 시 로그 수집: 대상 노드 `kubectl get nodes`, `kubectl describe node`, `journalctl -u kubelet`  

### 1-0-7. 조정 모드(동시작업 성능 안정화)

#### 1-0-7-1. 조정 근거

- 현재 사양 8Core/32GB x 5대로 3CP/3W+MongoDB+Monitoring 분산 배치는 **구성 자체는 가능**.
- 다만 실제 버벅임은 리소스 소진이 아니라 **동시 고부하 동작 집중**에서 생김(빌드, 테스트, 스캔, 인덱싱이 겹침).
- 특히 `192.168.0.14`(worker2/worker3 동시 운영)와 `192.168.0.28`(cp1+monitoring)이 피크 포인트.

#### 1-0-7-2. 조정 사양(통일 기준)

| Host | 적용 사양 |
|---|---|
| 192.168.0.28 (server) | cp1=4C/4GB, monitoring=2C/4GB |
| 192.168.0.13 (박성준) | cp2=4C/4GB |
| 192.168.0.98 (김루비) | cp3=4C/4GB |
| 192.168.0.3 (김경윤) | worker1=6C/6GB, mongodb=2C/4GB |
| 192.168.0.14 (김정호) | worker2=6C/6GB, worker3=4C/4GB |

> 조정 모드는 **통일 운영 기준**입니다. 부하 임계치 대응은 `1-0-7-3`의 규칙으로 처리합니다.

#### 1-0-7-3. 동시 작업 피크 억제 규칙(강제)

1. **동시 빌드/테스트 동작 2개 초과 금지(전체 공용)**
   - 빌드/테스트 job이 둘 이상 진행되면 우선순위가 높은 하나는 `interruptible`로 설정하고 나머지는 큐잉.

2. **Host 병목 회피 우선순위**
   - Step A: 192.168.0.14는 빌드 heavy job을 피크 시 1개로 제한
   - Step B: 192.168.0.28에서 SonarQube 스캔 + LGTM 대량 수집이 겹치면 신규 빌드 실행은 5분 지연 후 시작
   - Step C: MongoDB compaction/backup 구간엔 worker1 배치 워크로드를 줄임

3. **부하 임계치 (즉시 조치 기준)**
   - `kubectl top node`에서 `CPU > 80%`/`Memory > 85%` 유지 3분 이상 지속
   - 대상 노드에서 `load average > 8` 3회 연속
   - 조치: 해당 host 내 불필요 파드 스케일다운 또는 `kubectl cordon`/`drain`으로 비핵심 작업 분산

#### 1-0-7-4. 실행 체크(조정 모드 전환 시)

- 1단계: `kubectl get nodes` + `kubectl top node` 기준 30초 1회 수집, `1-12` 스크립트로 통신 점검
- 2단계: Phase1/2 핵심 작업 전후로 worker2/worker3 1회씩 롤링 점검
- 3단계: 동시작업 규칙 준수 후 24시간 동안 상태가 안정적이면 다음 단계 운영으로 전환
- 4단계: 문제 지속 시 `worker2/worker3 각각 1개 추가 vCPU`로 단계적 복구, 이후 안정 시 재평가

#### 1-0-7-6. 조정 모드 팀 공지 1페이지(복붙용)

```
[조정 운영] 기준
1) 현재 모드: 조정값 기준 통일(변경 금지)
2) 핵심 피크 구간: 19:00~23:00
3) 규칙:
   - 전체 동시 빌드/테스트 2개 초과 금지
   - 192.168.0.14(worker2/3)는 heavy 빌드 1개 제한
   - 192.168.0.28(cp1/monitoring)은 SonarQube+LGTM 동시 피크 시 신규 빌드 5분 지연
   - MongoDB compaction/backup 시 worker1 배치 경량 운영
4) 경고 임계치(즉시조치):
   - CPU > 80% 또는 Mem > 85%가 3분 연속 -> 스케일다운/이관
   - load average > 8 3회 연속 -> cordon/drain 또는 비핵심 작업 분산
5) 일일 점검:
   - kubectl get nodes / kubectl top node
   - worker2/worker3 pod 상태, cp-1~3 HA 상태
   - NAT 포트 체크(2230 포함), ping 192.168.0.{220,221,222,223,224,225,230,231}
6) 예외 승인:
   - 꼭 필요한 작업만 운영자 승인 후 예외 실행(요약 공유)
```

### 1-1-1. VirtualBox VM 생성 (수동, GUI 필요)

아래 방식으로 진행합니다.

**각 VM마다 반복:**

```
1. VirtualBox → "새로 만들기" 클릭
   - 이름: clouddx-cp-1 / clouddx-cp-2 / clouddx-cp-3 / clouddx-worker1 / clouddx-worker2 / clouddx-worker3 / clouddx-monitoring / clouddx-mongodb
   - 종류: Linux
   - 버전: Ubuntu (64-bit)

2. 메모리: 위 표 참고

3. 하드 디스크: VDI, 동적 할당, 위 표 참고

4. 설정 → 시스템 → 프로세서: 위 표 참고

5. 설정 → 네트워크
   - 어댑터 1: NAT (기본, 인터넷용)
   - 어댑터 2 활성화: **"어댑터에 브리지" (권장)**  
     (대안: Host-Only + SSH/VPN 터널)

6. 설정 → 저장소 → 광학 드라이브에 ubuntu-22.04 ISO 삽입

7. 시작 → Ubuntu Server 설치
   - 사용자: clouddx
   - 비밀번호: tutum
   - OpenSSH server: ✅ 반드시 체크
```

### 1-1-2. VirtualBox NAT 포트포워딩 설정 (SSH 접속용)

**방법 1: VirtualBox GUI**
```
각 VM → 설정 → 네트워크 → 어댑터 1 (NAT) → 고급 → 포트 포워딩

규칙 추가 (호스트 IP는 반드시 비워둘 것 — 127.0.0.1 입력 시 외부 접속 불가):
┌──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ 이름             │ 프로토콜  │ 호스트 IP │ 호스트 포트│ 게스트 IP │ 게스트 포트│
├──────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ cp-1           │ TCP      │ (비워둠) │ 2220     │          │ 22       │
│ cp-2           │ TCP      │ (비워둠) │ 2221     │          │ 22       │
│ cp-3           │ TCP      │ (비워둠) │ 2222     │          │ 22       │
│ worker1        │ TCP      │ (비워둠) │ 2223     │          │ 22       │
│ mongodb        │ TCP      │ (비워둠) │ 2224     │          │ 22       │
│ worker2        │ TCP      │ (비워둠) │ 2225     │          │ 22       │
│ worker3        │ TCP      │ (비워둠) │ 2226     │          │ 22       │
│ monitoring     │ TCP      │ (비워둠) │ 2230     │          │ 22       │
└──────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

**방법 2: VBoxManage CLI (해당 VM이 실행되는 물리 PC PowerShell에서, VM 꺼진 상태)**
```powershell
# VM 이름은 VirtualBox에서 설정한 이름과 정확히 일치해야 함 (VBoxManage list vms 로 확인)
VBoxManage modifyvm "clouddx-cp-1" --natpf1 "cp1-ssh,tcp,,2220,,22"
VBoxManage modifyvm "clouddx-cp-2" --natpf1 "cp2-ssh,tcp,,2221,,22"
VBoxManage modifyvm "clouddx-cp-3" --natpf1 "cp3-ssh,tcp,,2222,,22"
VBoxManage modifyvm "clouddx-worker1" --natpf1 "w1-ssh,tcp,,2223,,22"
VBoxManage modifyvm "clouddx-mongodb" --natpf1 "mongo-ssh,tcp,,2224,,22"
VBoxManage modifyvm "clouddx-worker2" --natpf1 "w2-ssh,tcp,,2225,,22"
VBoxManage modifyvm "clouddx-worker3" --natpf1 "w3-ssh,tcp,,2226,,22"
VBoxManage modifyvm "clouddx-monitoring" --natpf1 "lgtm-ssh,tcp,,2230,,22"
```

**방법 2-1: VM이 켜진 상태에서**
```powershell
VBoxManage controlvm "clouddx-cp-1" natpf1 "cp1-ssh,tcp,,2220,,22"
VBoxManage controlvm "clouddx-cp-2" natpf1 "cp2-ssh,tcp,,2221,,22"
VBoxManage controlvm "clouddx-cp-3" natpf1 "cp3-ssh,tcp,,2222,,22"
VBoxManage controlvm "clouddx-worker1" natpf1 "w1-ssh,tcp,,2223,,22"
VBoxManage controlvm "clouddx-mongodb" natpf1 "mongo-ssh,tcp,,2224,,22"
VBoxManage controlvm "clouddx-worker2" natpf1 "w2-ssh,tcp,,2225,,22"
VBoxManage controlvm "clouddx-worker3" natpf1 "w3-ssh,tcp,,2226,,22"
VBoxManage controlvm "clouddx-monitoring" natpf1 "lgtm-ssh,tcp,,2230,,22"
```

> K8s/운영 VM용 host 포트:
> - cp1=2220, cp2=2221, cp3=2222
> - worker1=2223, mongodb=2224, worker2=2225, worker3=2226, monitoring=2230

**물리 PC별 Windows 방화벽 (PowerShell 관리자 권한, 해당 PC에서만 실행):**
```powershell
# 서버 PC(1) / 192.168.0.28
netsh advfirewall firewall add rule name="K8s SSH cp-1 / monitoring" dir=in action=allow protocol=TCP localport=2220,2230

# 팀원 PC(2) / 192.168.0.13
netsh advfirewall firewall add rule name="K8s SSH cp-2" dir=in action=allow protocol=TCP localport=2221

# 팀원 PC(3) / 192.168.0.98
netsh advfirewall firewall add rule name="K8s SSH cp-3" dir=in action=allow protocol=TCP localport=2222

# 팀원 PC(4) / 192.168.0.3
netsh advfirewall firewall add rule name="K8s SSH worker1" dir=in action=allow protocol=TCP localport=2223
netsh advfirewall firewall add rule name="K8s SSH mongodb" dir=in action=allow protocol=TCP localport=2224

# 팀원 PC(5) / 192.168.0.14
netsh advfirewall firewall add rule name="K8s SSH worker2" dir=in action=allow protocol=TCP localport=2225
netsh advfirewall firewall add rule name="K8s SSH worker3" dir=in action=allow protocol=TCP localport=2226
```

> NAT 포트포워딩만으로는 외부 접속 불가. 각 물리 PC의 Windows 방화벽에서 각자 맡은 포트를 열어야 함.

**접속 방법 (외부 PC에서):**
```bash
ssh -p 2220 clouddx@192.168.0.28  # cp1 (k8s-cp-1)
ssh -p 2221 clouddx@192.168.0.13  # cp2 (k8s-cp-2)
ssh -p 2222 clouddx@192.168.0.98  # cp3 (k8s-cp-3)
ssh -p 2223 clouddx@192.168.0.3   # worker1
ssh -p 2224 clouddx@192.168.0.3   # mongodb
ssh -p 2225 clouddx@192.168.0.14  # worker2
ssh -p 2226 clouddx@192.168.0.14  # worker3
ssh -p 2230 clouddx@192.168.0.28  # monitoring (LGTM)
```

### 1-1-3. 고정 IP 설정 (각 VM에서 실행)

> 이 섹션은 **브릿지 표준 운영** 기준입니다. (`enp0s8`에 192.168.0.22x/23x 고정)
> 팀원 PC에 `99-host-only.yaml`이 남아 있다면 반드시 제거/교체합니다.

```bash
# 네트워크 인터페이스 확인
ip a
# enp0s3 = NAT (인터넷/패키지 설치)
# enp0s8 = 브릿지(팀원 VM 간 통신)
```

**clouddx-cp-1:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.220/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-cp-2:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.221/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-cp-3:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.222/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-worker1:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.223/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-mongodb:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.231/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-worker2:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.224/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-worker3:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.225/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

**clouddx-monitoring:**
```bash
sudo tee /etc/netplan/99-bridge.yaml <<EOF
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.0.230/24
EOF
sudo chmod 600 /etc/netplan/99-bridge.yaml
sudo rm -f /etc/netplan/99-host-only.yaml
sudo netplan generate
sudo netplan apply
```

### 1-1-4. SSH 접속 확인

**Windows PowerShell/Terminal에서:**
```powershell
# 브릿지 네트워크(운영 표준)로 직접 접속
ssh clouddx@192.168.0.220   # k8s-cp-1
ssh clouddx@192.168.0.221   # k8s-cp-2
ssh clouddx@192.168.0.222   # k8s-cp-3
ssh clouddx@192.168.0.223   # worker1
ssh clouddx@192.168.0.231   # mongodb
ssh clouddx@192.168.0.224   # worker2
ssh clouddx@192.168.0.225   # worker3
ssh clouddx@192.168.0.230   # monitoring

# 또는 NAT 포트포워딩으로 접속
ssh -p 2220 clouddx@127.0.0.1   # k8s-cp-1
ssh -p 2221 clouddx@127.0.0.1   # k8s-cp-2
ssh -p 2222 clouddx@127.0.0.1   # k8s-cp-3
ssh -p 2223 clouddx@127.0.0.1   # worker1
ssh -p 2224 clouddx@127.0.0.1   # mongodb
ssh -p 2225 clouddx@127.0.0.1   # worker2
ssh -p 2226 clouddx@127.0.0.1   # worker3
ssh -p 2230 clouddx@127.0.0.1   # monitoring

```

**편의를 위한 SSH config 추가 (`C:\Users\CloudDX\.ssh\config`):**
```
# === K8s VM ===
Host k8s-cp-1
    HostName 192.168.0.220
    User clouddx
    Port 22

Host k8s-cp-2
    HostName 192.168.0.221
    User clouddx
    Port 22

Host k8s-cp-3
    HostName 192.168.0.222
    User clouddx
    Port 22

Host k8s-worker1
    HostName 192.168.0.223
    User clouddx
    Port 22

Host k8s-mongodb
    HostName 192.168.0.231
    User clouddx
    Port 22

Host k8s-worker2
    HostName 192.168.0.224
    User clouddx
    Port 22

Host k8s-worker3
    HostName 192.168.0.225
    User clouddx
    Port 22

Host monitoring
    HostName 192.168.0.230
    User clouddx
    Port 22

```

이후 `ssh k8s-cp-1`, `ssh k8s-cp-2`, `ssh k8s-cp-3`, `ssh k8s-worker1`, `ssh k8s-worker2`, `ssh k8s-worker3`, `ssh monitoring` 으로 간편 접속.

### 1-1-5. UFW 방화벽 설정

**모든 K8s VM 공통:**
```bash
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
```

**k8s-cp-1 / k8s-cp-2 / k8s-cp-3 추가 규칙:**
```bash
# K8s API Server
sudo ufw allow 6443/tcp

# etcd
sudo ufw allow from 192.168.0.0/24 to any port 2379:2380 proto tcp

# kubelet API
sudo ufw allow from 192.168.0.0/24 to any port 10250 proto tcp

# kube-scheduler
sudo ufw allow from 192.168.0.0/24 to any port 10259 proto tcp

# kube-controller-manager
sudo ufw allow from 192.168.0.0/24 to any port 10257 proto tcp

# Calico BGP (CNI)
sudo ufw allow from 192.168.0.0/24 to any port 179 proto tcp

# Calico VXLAN
sudo ufw allow from 192.168.0.0/24 to any port 4789 proto udp

# ArgoCD NodePort
sudo ufw allow 30443/tcp

# MetalLB (memberlist)
sudo ufw allow from 192.168.0.0/24 to any port 7946 proto tcp
sudo ufw allow from 192.168.0.0/24 to any port 7946 proto udp
```

**k8s-worker1 / k8s-worker2 / k8s-worker3 추가 규칙:**
```bash
# kubelet API
sudo ufw allow from 192.168.0.0/24 to any port 10250 proto tcp

# NodePort 서비스 범위
sudo ufw allow 30000:32767/tcp

# Calico BGP (CNI)
sudo ufw allow from 192.168.0.0/24 to any port 179 proto tcp

# Calico VXLAN
sudo ufw allow from 192.168.0.0/24 to any port 4789 proto udp

# Istio Envoy Sidecar (앱 간 통신)
sudo ufw allow from 10.244.0.0/16 to any  # Pod CIDR

# MetalLB (memberlist)
sudo ufw allow from 192.168.0.0/24 to any port 7946 proto tcp
sudo ufw allow from 192.168.0.0/24 to any port 7946 proto udp

# GitLab Container Registry (registry.gitlab.com) + gitlab.com + SonarQube/CI-CD(192.168.0.28:9000) 접근
# HTTPS(443)이므로 insecure registry 설정 불필요
sudo ufw allow out to any port 443 proto tcp
```

**monitoring VM 추가 규칙:**
```bash
# SonarQube (192.168.0.28:9000) 접근용
sudo ufw allow out to 192.168.0.28/32 port 9000 proto tcp

# Grafana (웹 대시보드)
sudo ufw allow 3000/tcp

# Loki (로그 수신 - Alloy에서 push)
sudo ufw allow from 192.168.0.0/24 to any port 3100 proto tcp

# Tempo (트레이스 수신 - Alloy에서 push)
sudo ufw allow from 192.168.0.0/24 to any port 4317 proto tcp   # OTLP gRPC
sudo ufw allow from 192.168.0.0/24 to any port 4318 proto tcp   # OTLP HTTP
sudo ufw allow from 192.168.0.0/24 to any port 3200 proto tcp   # Tempo API

# Mimir (메트릭 수신 - Alloy에서 push)
sudo ufw allow from 192.168.0.0/24 to any port 9009 proto tcp

# InfluxDB (k6 결과)
sudo ufw allow from 192.168.0.0/24 to any port 8086 proto tcp

# Kibana (ES UI)
sudo ufw allow 5601/tcp

# Kiali (Istio UI)
sudo ufw allow 20001/tcp
``` 

**mongodb VM 추가 규칙:**
```bash
# MongoDB API (클러스터 내부에서 접근)
sudo ufw allow from 192.168.0.0/24 to any port 27017 proto tcp
```

**방화벽 상태 확인:**
```bash
sudo ufw status verbose
```

### 1-1-6. VM 간 통신 확인

```bash
# k8s-cp-1에서
ping 192.168.0.221   # → k8s-cp-2
ping 192.168.0.222   # → k8s-cp-3
ping 192.168.0.223   # → worker1
ping 192.168.0.224   # → worker2
ping 192.168.0.225   # → worker3
ping 192.168.0.231   # → mongodb
ping 192.168.0.230   # → monitoring

# monitoring에서
ping 192.168.0.220   # → k8s-cp-1
ping 192.168.0.221   # → k8s-cp-2
ping 192.168.0.222   # → k8s-cp-3
ping 192.168.0.223   # → k8s-worker1
ping 192.168.0.224   # → worker2
ping 192.168.0.225   # → worker3
ping 192.168.0.231   # → mongodb
```

> **여기까지 완료되면 SSH 접속 정보를 알려주세요.**
> 이후 1-2부터 (containerd, kubeadm, K8s 클러스터 구축 등) 전부 SSH로 원격 작업 가능합니다.

---

### 1-2. 모든 K8s 노드 공통 설정

**각 K8s 노드(master, worker1, worker2, worker3)에서 실행:**

```bash
# ─── 1) swap 비활성화 (K8s 필수) ───
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# ─── 2) 커널 모듈 로드 ───
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

# ─── 3) 커널 파라미터 설정 ───
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sudo sysctl --system

# ─── 4) containerd 설치 ───
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg

# Docker 공식 GPG 키 & 레포 추가
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y containerd.io

# containerd 기본 설정 생성 + SystemdCgroup 활성화
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd

# ─── 5) kubeadm, kubelet, kubectl 설치 ───
# K8s 공식 패키지 레포 추가 (v1.29 기준, 설치 시점 최신 안정 버전 확인)
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl

# ─── 6) /etc/hosts 설정 ───
# (GitLab Container Registry는 registry.gitlab.com으로 HTTPS 접근하므로 insecure registry 설정 불필요)
cat <<EOF | sudo tee -a /etc/hosts
192.168.0.220 k8s-cp-1
192.168.0.221 k8s-cp-2
192.168.0.222 k8s-cp-3
192.168.0.223 k8s-worker1
192.168.0.224 k8s-worker2
192.168.0.225 k8s-worker3
192.168.0.230 monitoring.tutum.local
EOF
```

### 1-3. Master 노드 초기화

**k8s-cp-1(192.168.0.220)에서만 실행:**

```bash
# ─── kubeadm init ───
# [브릿지 표준 모드]
#   --apiserver-advertise-address=192.168.0.220
#   --control-plane-endpoint=192.168.0.220:6443
sudo kubeadm init \
  --apiserver-advertise-address=192.168.0.220 \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12 \
  --control-plane-endpoint=192.168.0.220:6443

# ─── kubeconfig 설정 ───
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# ─── join 명령어 메모 ───
# 출력된 kubeadm join 명령어를 복사해둘 것!
# 예: kubeadm join 192.168.0.220:6443 --token xxxx --discovery-token-ca-cert-hash sha256:xxxx
```

### 1-4. Worker 노드 조인

**각 worker 노드(worker1, worker2, worker3)에서 실행:**

```bash
# master init 시 출력된 join 명령어 실행
# [브릿지 표준 모드]
# sudo kubeadm join 192.168.0.220:6443 --token <TOKEN> --discovery-token-ca-cert-hash sha256:<HASH>
sudo kubeadm join 192.168.0.220:6443 \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash sha256:<HASH>
```

**master에서 노드 확인:**

```bash
kubectl get nodes
# 모든 노드가 NotReady 상태 → CNI 설치 후 Ready로 전환됨
```

### 1-5. Calico CNI 설치

**k8s-cp-1에서 실행:**

```bash
# Calico operator 설치
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml

# Calico 커스텀 리소스 (pod CIDR 매칭)
cat <<EOF | kubectl apply -f -
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
    - cidr: 10.244.0.0/16
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()
EOF

# 설치 확인 (모든 노드 Ready까지 1~3분 소요)
watch kubectl get nodes
# NAME          STATUS   ROLES           AGE   VERSION
# k8s-cp-1    Ready    control-plane   5m    v1.29.x
# k8s-worker1   Ready    <none>          3m    v1.29.x
# k8s-worker2   Ready    <none>          3m    v1.29.x
```

### 1-6. MetalLB 설치 (Bare-Metal LoadBalancer)

```bash
# MetalLB 설치
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml

# MetalLB가 준비될 때까지 대기
kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=120s

# IP 풀 설정 (Istio Ingress Gateway용)
cat <<EOF | kubectl apply -f -
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: tutum-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.0.240-192.168.0.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: tutum-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - tutum-pool
EOF
```

> MetalLB가 192.168.0.240~250 범위에서 LoadBalancer IP를 할당합니다.
> Istio Ingress Gateway가 이 IP 중 하나를 받아 외부 트래픽을 수신합니다.

### 1-7. 네임스페이스 생성

```bash
# 애플리케이션 네임스페이스
kubectl create namespace tutum-app
kubectl create namespace tutum-data
kubectl create namespace tutum-storage

# 인프라 네임스페이스
kubectl create namespace monitoring
kubectl create namespace argocd
kubectl create namespace kyverno

# 네임스페이스 레이블 (NetworkPolicy용)
kubectl label namespace tutum-app name=tutum-app
kubectl label namespace tutum-data name=tutum-data
kubectl label namespace tutum-storage name=tutum-storage
kubectl label namespace monitoring name=monitoring

# Istio 사이드카 주입 설정
kubectl label namespace tutum-app istio-injection=enabled
kubectl label namespace tutum-data istio-injection=disabled
```

### 1-8. Istio 서비스 메시 설치

```bash
# istioctl 다운로드
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.21.0 sh -
sudo mv istio-1.21.0/bin/istioctl /usr/local/bin/

# Istio 설치 (default 프로파일 = istiod + ingress gateway)
istioctl install --set profile=default -y

# 설치 확인
kubectl get pods -n istio-system
# NAME                                    READY   STATUS
# istio-ingressgateway-xxxxx              1/1     Running
# istiod-xxxxx                            1/1     Running

# Istio Ingress Gateway에 MetalLB IP 할당 확인
kubectl get svc -n istio-system istio-ingressgateway
# EXTERNAL-IP 에 192.168.0.24x 가 보여야 함
```

### 1-9. Istio Gateway + VirtualService 기본 설정

```bash
cat <<'EOF' | kubectl apply -f -
# Istio Gateway - 외부 트래픽 진입
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: tutum-gateway
  namespace: tutum-app
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "*"
---
# mTLS 강제 적용
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: tutum-app
spec:
  mtls:
    mode: STRICT
EOF
```

### 1-10. Phase 1 완료 검증

```bash
# 전체 상태 확인 체크리스트
echo "=== 1. 노드 상태 ==="
kubectl get nodes -o wide

echo "=== 2. 시스템 Pod 상태 ==="
kubectl get pods -n kube-system
kubectl get pods -n calico-system
kubectl get pods -n istio-system
kubectl get pods -n metallb-system

echo "=== 3. 네임스페이스 ==="
kubectl get namespaces

echo "=== 4. MetalLB IP 할당 ==="
kubectl get svc -n istio-system istio-ingressgateway

echo "=== 5. Istio Gateway ==="
kubectl get gateway -n tutum-app

echo "=== 6. 인터넷 접근 테스트 (GitLab CR용) ==="
curl -s https://registry.gitlab.com/v2/ && echo "GitLab Container Registry 접근 OK" || echo "인터넷 접근 실패"
```

### 1-11. 5대 분산 운영(물리 PC 5대) 실행형 체크리스트

**A) 물리 PC(로컬) 접속/포트 점검 (각 관리자 PC에서 실행)**

```powershell
# 각 IP/포트 조합은 현재 토폴로지 기준
$targets = @{
  "server(192.168.0.28)" = 2220,2230
  "team2(192.168.0.13)" = 2221
  "team3(192.168.0.98)" = 2222
  "team4(192.168.0.3)"  = 2223,2224
  "team5(192.168.0.14)" = 2225,2226
}

Write-Host "=== NAT/방화벽 외부 노출 테스트 ==="
foreach ($entry in $targets.GetEnumerator()) {
  $ip = $entry.Key.Split("(")[1].TrimEnd(")")
  foreach ($port in $entry.Value) {
    $ok = Test-NetConnection -ComputerName $ip -Port $port -InformationLevel Quiet
    "{0} : {1} => {2}" -f $ip,$port,($(if($ok){"OPEN"}else{"CLOSE"}))
  }
}
```

```bash
# monitoring/CI-CD VM(192.168.0.28)에서 내부 VM 간 통신 확인
for ip in 192.168.0.220 192.168.0.221 192.168.0.222 192.168.0.223 192.168.0.224 192.168.0.225 192.168.0.230 192.168.0.231; do
  ping -c 1 "$ip" >/dev/null && echo "$ip OK" || echo "$ip FAIL"
done
```

**B) K8s 컨트롤 플레인(CP1 기준)에서 HA 구성 점검 (bash)**

```bash
cat <<'EOF' >/tmp/ha-verify.sh
echo "[1] Node Ready / Roles"
kubectl get nodes -o wide

echo "[2] etcd health (CP 3대)"
for ep in 192.168.0.220 192.168.0.221 192.168.0.222; do
  curl -sk "http://$ep:2379/health" | head -c 120 || echo "etcd[$ep] FAIL"
  echo
done

echo "[3] Control plane ports on local net"
for p in 6443 2379 2380 10250 10257 10259; do
  ss -ltnp | grep -w ":$p" >/dev/null && echo "  :$p OPEN" || echo "  :$p CLOSE"
done

echo "[4] namespace/service existence"
kubectl get ns tutum-app tutum-data tutum-storage monitoring istio-system argocd kyverno || true

echo "[5] MetalLB, Istio, Kube-system 핵심 Pod 상태"
kubectl -n kube-system get pod -l k8s-app=kube-proxy -o wide
kubectl -n calico-system get pod -o wide
kubectl -n metallb-system get pod -o wide
kubectl -n istio-system get pod -o wide
kubectl -n monitoring get pod -o wide || true

echo "[6] API/Ingress 동작"
kubectl get svc -n istio-system istio-ingressgateway
kubectl get pods -n monitoring | head
EOF

sudo bash /tmp/ha-verify.sh
```

**C) MongoDB/mongodb VM 가용성 (선택)**

```bash
kubectl -n tutum-data get pod -l app=mongodb || true
```

### 1-12. 실행 스크립트로 점검하기(권장)

```powershell
# Windows(관리자 계정)에서
cd d:\dev\tutum
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
powershell -ExecutionPolicy Bypass -File .\scripts\ha-verify.ps1
```

```bash
# Monitoring VM 또는 SSH로 cp1에 접근 가능한 Linux에서
cd /d/dev/tutum
chmod +x scripts/ha-verify.sh
bash scripts/ha-verify.sh
```

**Phase 1 완료 기준:**
- [ ] 모든 노드 `Ready` 상태
- [ ] Calico Pod 전부 `Running`
- [ ] Istio istiod + ingressgateway `Running`
- [ ] MetalLB가 Ingress Gateway에 External IP 할당
- [ ] 네임스페이스 6개 생성 완료 (tutum-app, tutum-data, tutum-storage, monitoring, argocd, kyverno)
- [ ] 인터넷 접근 가능 (GitLab Container Registry: registry.gitlab.com)

---

## Phase 2: CI/CD 파이프라인 구축

> **중요**: CI/CD는 **gitlab.com (SaaS)** + **SonarQube(192.168.0.28:9000)** + **GitLab Container Registry**를 사용합니다.
> GitLab Runner는 K8s 클러스터 내에 Helm chart로 설치하고, SonarQube는 CI/CD VM(192.168.0.28)에서 운영합니다.
> 기존 Docker Compose 3-tier VM(node1~3)은 K8s 마이그레이션 후 폐기 대상이므로 절대 사용하지 않습니다.

### 2-0. 사전 준비 (gitlab.com + SonarQube 설정)

**2-0-1. gitlab.com 설정 (웹 브라우저에서):**
```
1. https://gitlab.com 에서 무료 가입 (또는 GitHub/Google 계정 연동)

2. 그룹 생성: "tutum-project"
   → gitlab.com → Groups → New group → Group name: tutum-project

3. 하위 그룹(서브그룹) 생성:
   - gitlab.com → tutum-project → New group → Group name: tutum-app

4. 프로젝트 생성:
   - tutum-project/tutum-app/tutum-backend
   - tutum-project/tutum-app/tutum-frontend
   - tutum-project/k8s-manifests (GitOps 레포)
   → 각각의 프로젝트 페이지 → New project → Create blank project

5. Container Registry 활성화 확인:
   → 각 프로젝트(tutum-backend / tutum-frontend) → Settings → General → Visibility → Container registry: Enabled (기본값)
```

**2-0-2. SonarQube 설정 (CI/CD VM에서):**
```
1. 브라우저에서 http://192.168.0.28:9000 접속

2. 관리자 계정 초기 비밀번호 변경

3. 프로젝트 2개 생성:
   - tutum-backend (Python)
   - tutum-frontend (TypeScript/JavaScript)
   - SonarQube 프로젝트 Key는 아래로 고정
     - backend: `tutum-backend`
     - frontend: `tutum-frontend`

4. My Account → Security → Generate Token
   → 생성한 토큰을 GitLab CI Variables의 SONAR_TOKEN으로 등록

5. Quality Gate 설정:
   - Coverage >= 60%
   - Duplications < 5%
   - New Bugs = 0
   - New Vulnerabilities = 0
   - Maintainability Rating = A
```

### 2-0-3. HA 운영 원칙 (현재 프로젝트 최적안)

온프레미스 제약을 고려해 HA는 내부/외부 구분 없이 실효성 위주로 적용합니다.

- GitLab SaaS + Registry는 외부 HA로 이미 충족.
- 애플리케이션/CI는 장애 흡수 가능한 구성 우선:
  - GitLab Runner는 최소 2개 Pod(Replica) 운영
  - Runner는 `interruptible`/`resource_group`으로 파이프라인 동시성 제어
  - 배포 단계는 `manual` + `rollback` 경로를 명시
- SonarQube는 CI/CD VM 단일 운영(예산/운영 부담 고려).
  - 다만 백업 주기: 설정/DB 스냅샷 주기 백업 + 월 1회 복구 리허설 의무화.
  - 장애 시 운영runbook에 따라 수동 전환 가능하도록 문서화.

> 목표: 완전 HA보다 **평균 장애시간(RTO) 단축 + 데이터 보존성(RPO) 확보**가 더 현실적입니다.

### 2-1. 코드 Push (로컬 → gitlab.com)

**개발 PC(Windows)에서 실행:**

```bash
# 백엔드 레포 push
cd C:\Users\CloudDX\Desktop\clouddx-backend
git remote add gitlab https://gitlab.com/tutum-project/tutum-app/tutum-backend.git
git push -u gitlab --all

# 프론트엔드 레포 push
cd C:\Users\CloudDX\Desktop\clouddx-frontend
git remote add gitlab https://gitlab.com/tutum-project/tutum-app/tutum-frontend.git
git push -u gitlab --all

# k8s-manifests 레포 생성 + push (별도 디렉토리에서)
mkdir k8s-manifests && cd k8s-manifests
git init
git remote add origin https://gitlab.com/tutum-project/k8s-manifests.git
# (2-7에서 디렉토리 구조 작성 후 push)
```

> gitlab.com 접속: `https://gitlab.com/tutum-project`
> Container Registry: `registry.gitlab.com/tutum-project/tutum-app/tutum-backend`, `registry.gitlab.com/tutum-project/tutum-app/tutum-frontend`

### 2-2. GitLab Runner 설치 (K8s 클러스터 내 Helm chart)

GitLab Runner를 K8s 클러스터에 설치하면 CI/CD 실행 시간 제한 없이 사용 가능합니다.

**k8s-cp-1에서 실행:**

```bash
# Helm repo 추가
helm repo add gitlab https://charts.gitlab.io
helm repo update

# Runner namespace 생성
kubectl create namespace gitlab-runner

# Runner Helm values 작성
cat <<'EOF' > gitlab-runner-values.yaml
replicas: 2
gitlabUrl: https://gitlab.com
runnerToken: "<RUNNER_TOKEN>"  # gitlab.com → tutum-project → Settings → CI/CD → Runners → New group runner 에서 토큰 확인

rbac:
  create: true

runners:
  config: |
    [[runners]]
      [runners.kubernetes]
        namespace = "gitlab-runner"
        image = "docker:24-dind"
        privileged = true
        [[runners.kubernetes.volumes.empty_dir]]
          name = "docker-certs"
          mount_path = "/certs/client"
          medium = "Memory"
  tags: "k8s,tutum"
  name: "tutum-k8s-runner"

resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
EOF

# Runner 설치
helm install gitlab-runner gitlab/gitlab-runner \
  -n gitlab-runner \
  -f gitlab-runner-values.yaml

# 설치 확인
kubectl get pods -n gitlab-runner
```

> Runner 등록 확인: gitlab.com → tutum-project → Settings → CI/CD → Runners 에서 Online 상태 확인
> Runner는 K8s 내에서 실행되므로 별도 VM 불필요

### 2-3. CI/CD Variables 설정 (gitlab.com 웹 UI)

gitlab.com → tutum-project/tutum-app → Settings → CI/CD → Variables:

```
SONAR_TOKEN        = (SonarQube에서 발급한 토큰)
SONAR_HOST_URL     = http://192.168.0.28:9000
COSIGN_PASSWORD    = (Cosign 키 비밀번호)
COSIGN_KEY         = (Cosign private key, File 타입)
DEPLOY_TOKEN       = (k8s-manifests 레포 접근용 Project Access Token)
```

> **참고**: GitLab Container Registry 인증은 CI/CD 내장 변수 `$CI_REGISTRY`, `$CI_REGISTRY_USER`, `$CI_REGISTRY_PASSWORD`로 자동 처리됩니다.
> Harbor 관련 변수(HARBOR_*)는 더 이상 필요 없습니다.

> 서브그룹(`tutum-project/tutum-app`)에 변수 등록하면 backend/frontend 프로젝트가 공통으로 사용합니다.  
> 기본은 `SONAR_TOKEN` 하나만 쓰고, 필요하면 프로젝트별로 각각 `SONAR_TOKEN_BACKEND`, `SONAR_TOKEN_FRONTEND`를 분리 등록해도 됩니다.
> `Protected` + `Masked`는 권장.

### 2-4. Trivy (CI pipeline 컨테이너 - 변경 없음)

Trivy는 CI Runner에서 직접 실행하므로 별도 설치가 필요 없습니다.
`.gitlab-ci.yml`에서 `aquasec/trivy` 이미지를 사용합니다.

```yaml
# .gitlab-ci.yml의 security 스테이지
trivy:backend:
  stage: security
  image:
    name: aquasec/trivy:0.50.0
    entrypoint: [""]
  script:
    - trivy image --exit-code 1 --severity CRITICAL,HIGH --no-progress
        $CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHORT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  needs: ["build:backend"]

trivy:frontend:
  stage: security
  image:
    name: aquasec/trivy:0.50.0
    entrypoint: [""]
  script:
    - trivy image --exit-code 1 --severity CRITICAL,HIGH --no-progress
        $CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHORT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  needs: ["build:frontend"]
```

### 2-5. Cosign 이미지 서명 설정

**k8s-cp-1 또는 개발 PC에서 키 쌍 생성:**
```bash
# Cosign 설치 (Linux)
curl -sSL -o cosign https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
sudo mv cosign /usr/local/bin/
sudo chmod +x /usr/local/bin/cosign

# 키 쌍 생성
cosign generate-key-pair
# → cosign.key (private, GitLab CI Variables에 COSIGN_KEY File 타입으로 등록)
# → cosign.pub (public, K8s Kyverno 정책에 사용)
```

```yaml
# .gitlab-ci.yml의 sign 스테이지
cosign:backend:
  stage: sign
  image: bitnami/cosign:latest
  script:
    - echo "$COSIGN_KEY" > /tmp/cosign.key
    - cosign sign --key /tmp/cosign.key --yes
        $CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHORT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  needs: ["trivy:backend"]

cosign:frontend:
  stage: sign
  image: bitnami/cosign:latest
  script:
    - echo "$COSIGN_KEY" > /tmp/cosign.key
    - cosign sign --key /tmp/cosign.key --yes
        $CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHORT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  needs: ["trivy:frontend"]
```

### 2-6. ArgoCD 설치 (K8s 클러스터 내)

```bash
# k8s-cp-1에서 실행

# ArgoCD 설치
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.10.0/manifests/install.yaml

# ArgoCD 서버 외부 접근 설정 (NodePort)
kubectl patch svc argocd-server -n argocd -p '{"spec": {"type": "NodePort", "ports": [{"port": 443, "nodePort": 30443}]}}'

# 초기 admin 비밀번호 확인
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
echo

# ArgoCD CLI 설치
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/download/v2.10.0/argocd-linux-amd64
sudo mv argocd /usr/local/bin/
sudo chmod +x /usr/local/bin/argocd

# ArgoCD 로그인
argocd login 192.168.0.220:30443 --insecure --username admin --password <위에서_확인한_비밀번호>

# gitlab.com 레포 등록 (Deploy Token 사용)
argocd repo add https://gitlab.com/tutum-project/k8s-manifests.git \
  --username <DEPLOY_TOKEN_NAME> \
  --password <DEPLOY_TOKEN>
```

> ArgoCD 접속: `https://192.168.0.220:30443`
> ID: admin / PW: 위에서 확인한 비밀번호
> GitLab URL: `https://gitlab.com/tutum-project/k8s-manifests.git` (인터넷 경유)

### 2-7. K8s 매니페스트 레포 생성 (GitOps)

**디렉토리 구조:**

```
k8s-manifests/
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── backend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── workers/
│       ├── price-producer.yaml
│       ├── news-producer.yaml
│       ├── indexer-consumer.yaml
│       └── price-consumer.yaml
├── overlays/
│   ├── staging/
│   │   ├── kustomization.yaml
│   │   └── replicas-patch.yaml
│   └── production/
│       ├── kustomization.yaml
│       └── replicas-patch.yaml
└── argocd/
    ├── staging-app.yaml
    └── production-app.yaml
```

**base/frontend/deployment.yaml 예시:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: tutum-app
  labels:
    app: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      imagePullSecrets:
        - name: gitlab-registry-secret
      containers:
        - name: frontend
          image: registry.gitlab.com/tutum-project/tutum-app/frontend:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
```

**imagePullSecrets 설정 (K8s가 GitLab Container Registry에서 이미지 pull):**

```bash
# GitLab에서 Deploy Token 생성 (read_registry scope):
# gitlab.com → tutum-project/tutum-app → Settings → Repository → Deploy tokens
# → Name: k8s-pull, Scopes: read_registry

# K8s Secret 생성 (각 namespace에서)
kubectl create secret docker-registry gitlab-registry-secret \
  --docker-server=registry.gitlab.com \
  --docker-username=<DEPLOY_TOKEN_NAME> \
  --docker-password=<DEPLOY_TOKEN> \
  -n tutum-app

kubectl create secret docker-registry gitlab-registry-secret \
  --docker-server=registry.gitlab.com \
  --docker-username=<DEPLOY_TOKEN_NAME> \
  --docker-password=<DEPLOY_TOKEN> \
  -n tutum-data
```

**ArgoCD Application 등록:**

```yaml
# argocd/staging-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: tutum-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://gitlab.com/tutum-project/k8s-manifests.git
    targetRevision: main
    path: overlays/staging
  destination:
    server: https://kubernetes.default.svc
    namespace: tutum-app
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

```bash
kubectl apply -f argocd/staging-app.yaml
```

### 2-8. Kyverno 설치 + Cosign 정책

```bash
# Kyverno 설치
kubectl apply -f https://github.com/kyverno/kyverno/releases/download/v1.11.4/install.yaml

# Cosign public key를 K8s Secret으로 등록
kubectl create secret generic cosign-pub-key \
  -n kyverno \
  --from-file=cosign.pub=cosign.pub

# 미서명 이미지 차단 정책
cat <<'EOF' | kubectl apply -f -
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - tutum-app
      verifyImages:
        - imageReferences:
            - "registry.gitlab.com/tutum-project/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      <cosign.pub 내용 붙여넣기>
                      -----END PUBLIC KEY-----
EOF
```

### 2-9. 전체 CI/CD 파이프라인 (.gitlab-ci.yml)

지금은 레포가 분리되었으므로 아래는 각 프로젝트 루트에 개별 `.gitlab-ci.yml`로 둡니다.

#### 공통 (공통 변수)

```yaml
variables:
  SONAR_HOST_URL: "http://192.168.0.28:9000"
```

#### 백엔드 repo (`tutum-backend`) .gitlab-ci.yml 예시

```yaml
stages:
  - scan
  - build
  - security

sonarqube:
  stage: scan
  image:
    name: sonarsource/sonar-scanner-cli:11
    entrypoint: [""]
  script:
    - sonar-scanner
      -Dsonar.projectKey=tutum-backend
      -Dsonar.sources=.
      -Dsonar.host.url="${SONAR_HOST_URL}"
      -Dsonar.login="${SONAR_TOKEN}"
      -Dsonar.qualitygate.wait=true
  rules:
    - if: $CI_COMMIT_BRANCH == "main" || $CI_PIPELINE_SOURCE == "merge_request_event"
```

#### 프론트엔드 repo (`tutum-frontend`) .gitlab-ci.yml 예시

```yaml
stages:
  - scan
  - build
  - security

sonarqube:
  stage: scan
  image:
    name: sonarsource/sonar-scanner-cli:11
    entrypoint: [""]
  script:
    - sonar-scanner
      -Dsonar.projectKey=tutum-frontend
      -Dsonar.sources=.
      -Dsonar.host.url="${SONAR_HOST_URL}"
      -Dsonar.login="${SONAR_TOKEN}"
      -Dsonar.qualitygate.wait=true
  rules:
    - if: $CI_COMMIT_BRANCH == "main" || $CI_PIPELINE_SOURCE == "merge_request_event"
```

### 2-10. Phase 2 완료 검증

### 2-10A. 프론트엔드-백엔드 연결 즉시 점검 (현재 토폴로지 기준)

> 아래 체크리스트는 `k8s-cp-1`에서만 실행합니다.

#### 1) 앱 매니페스트 한 번에 적용

```bash
# REPO_ROOT=D:\dev\tutum 처럼 실제 저장소 루트로 변경
REPO_ROOT=/path/to/repo

# base 배포(앞단/백단 Deployment + 서비스)
kubectl apply -k $REPO_ROOT/k8s-manifests/base

# Frontend용 ingress + Ingress Controller
kubectl apply -f $REPO_ROOT/k8s-manifests/step2-ingress/01-nginx-ingress-controller.yaml
kubectl apply -f $REPO_ROOT/k8s-manifests/step2-ingress/02-app-ingress.yaml
```

#### 2) 서비스명/포트 즉시 정합성 확인

```bash
kubectl -n tutum-app get svc frontend-svc backend-svc
kubectl -n tutum-app get pod -l app=frontend -o wide
kubectl -n tutum-app get pod -l app=backend -o wide
kubectl -n tutum-app get pods
```

- ingress에서 기대한 서비스는 `frontend-svc:80`, `backend-svc:8000` 입니다.
- `frontend`/`backend` 이름은 과거 레거시 서비스명입니다. 현재 기준(`조정값`)에서는 `-svc` 이름이 표준입니다.

#### 3) /api/proxy 라우팅 확인 (핵심)

```bash
INGRESS_IP=$(kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Ingress IP: $INGRESS_IP"

curl -sS "http://$INGRESS_IP/api/proxy/health" | cat
curl -sS "http://$INGRESS_IP/api/proxy/api/v1/health" | cat
curl -sS "http://$INGRESS_IP/api/" | head
```

정상 동작 시 `health` 응답은 백엔드에서 200/JSON 형태로 와야 합니다.

#### 4) frontend 직접 확인

브라우저: `http://<Ingress_IP>/`  
로그인/관리 페이지에서 API 호출이 안 되면 2-10A-2/3에서 결과를 기준으로 `frontend-svc`/`backend-svc`/Ingress 규칙을 먼저 점검하세요.

**gitlab.com 웹 UI에서:**
```
1. gitlab.com → tutum-project/tutum-app → CI/CD → Pipelines → Run pipeline
   → 모든 스테이지(lint → test → scan → build → security → sign → deploy) 통과 확인

2. gitlab.com → tutum-project/tutum-app → Packages & Registries → Container Registry
   → backend, frontend 이미지가 push되어 있는지 확인

3. SonarQube (http://192.168.0.28:9000) → 프로젝트 결과 확인
   → 코드 분석 결과 확인, Quality Gate 통과 여부
```

**k8s-cp-1에서 실행:**
```bash
# 1. GitLab Runner 상태
kubectl get pods -n gitlab-runner

# 2. ArgoCD 상태
kubectl get pods -n argocd
argocd app list

# 3. Kyverno 상태
kubectl get pods -n kyverno

# 4. GitLab Container Registry 이미지 pull 테스트
crictl pull registry.gitlab.com/tutum-project/tutum-app/backend:latest 2>&1 || echo "이미지 없으면 정상 에러"
```

**Phase 2 완료 기준:**
- [ ] gitlab.com에 tutum-project 그룹 + 프로젝트 2개(tutum-app, k8s-manifests) 생성 완료
- [ ] 코드 push 완료 (`git push gitlab --all`)
- [ ] SonarQube 프로젝트 2개(backend/frontend) 생성 + Quality Gate 설정
- [ ] GitLab Runner가 K8s 클러스터에서 Running 상태
- [ ] CI Variables 등록 완료 (SONAR_TOKEN, COSIGN_KEY, COSIGN_PASSWORD, DEPLOY_TOKEN)
- [ ] Cosign 키 쌍 생성 + public key Kyverno 정책 적용
- [ ] ArgoCD 설치 + gitlab.com 레포 연동 + Application(staging) 생성
- [ ] imagePullSecrets 설정 (K8s → GitLab Container Registry)
- [ ] Kyverno 미서명 이미지 차단 정책 적용
- [ ] 테스트 파이프라인 전체 스테이지 통과 (최소 lint → build → push)
- [ ] `k8s-manifests` 레포 생성 + base/overlays 구조 작성

---

## Phase 3: LGTM 모니터링 스택 구축

### 3-1. Monitoring VM 준비

**monitoring VM(192.168.0.230) 기본 설정:**

```bash
# Docker 설치 (VM_SETUP_GUIDE.md 참조)
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# /etc/hosts 설정
cat <<EOF | sudo tee -a /etc/hosts
192.168.0.220 k8s-cp-1
192.168.0.221 k8s-cp-2
192.168.0.222 k8s-cp-3
192.168.0.223 k8s-worker1
192.168.0.224 k8s-worker2
192.168.0.225 k8s-worker3
192.168.0.230 monitoring
EOF

# 디렉토리 구조 생성
sudo mkdir -p /opt/monitoring/{loki,tempo,mimir,grafana/provisioning/datasources,grafana/provisioning/dashboards}
```

### 3-2. LGTM Docker Compose 배포

```bash
cat <<'EOF' > /opt/monitoring/docker-compose.yml
services:
  # ── Loki (로그 저장) ──
  loki:
    image: grafana/loki:3.0.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki/config.yml:/etc/loki/config.yml
      - loki_data:/loki
    command: -config.file=/etc/loki/config.yml
    restart: unless-stopped

  # ── Tempo (트레이스 저장) ──
  tempo:
    image: grafana/tempo:2.4.0
    ports:
      - "4317:4317"    # OTLP gRPC (Alloy → Tempo)
      - "4318:4318"    # OTLP HTTP
      - "3200:3200"    # Tempo API (Grafana 쿼리용)
    volumes:
      - ./tempo/config.yml:/etc/tempo/config.yml
      - tempo_data:/var/tempo
    command: -config.file=/etc/tempo/config.yml
    restart: unless-stopped

  # ── Mimir (메트릭 저장) ──
  mimir:
    image: grafana/mimir:2.12.0
    ports:
      - "9009:9009"
    volumes:
      - ./mimir/config.yml:/etc/mimir/config.yml
      - mimir_data:/data
    command:
      - -config.file=/etc/mimir/config.yml
    restart: unless-stopped

  # ── Grafana (대시보드) ──
  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=tutum2026!
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - loki
      - tempo
      - mimir
    restart: unless-stopped

  # ── InfluxDB (k6 부하테스트 결과 저장) ──
  influxdb:
    image: influxdb:2.7
    ports:
      - "8086:8086"
    volumes:
      - influxdb_data:/var/lib/influxdb2
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=tutum2026!
      - DOCKER_INFLUXDB_INIT_ORG=tutum
      - DOCKER_INFLUXDB_INIT_BUCKET=k6
    restart: unless-stopped

volumes:
  loki_data:
  tempo_data:
  mimir_data:
  grafana_data:
  influxdb_data:
EOF
```

### 3-3. LGTM 설정 파일 작성

**Loki 설정:**

```bash
cat <<'EOF' > /opt/monitoring/loki/config.yml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  retention_period: 30d
  ingestion_rate_mb: 10
  ingestion_burst_size_mb: 20

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
EOF
```

**Tempo 설정:**

```bash
cat <<'EOF' > /opt/monitoring/tempo/config.yml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: "0.0.0.0:4317"
        http:
          endpoint: "0.0.0.0:4318"

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces
    wal:
      path: /var/tempo/wal

metrics_generator:
  registry:
    external_labels:
      source: tempo
      cluster: tutum
  storage:
    path: /var/tempo/generator/wal
    remote_write:
      - url: http://mimir:9009/api/v1/push
        send_exemplars: true

overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics]
EOF
```

**Mimir 설정:**

```bash
cat <<'EOF' > /opt/monitoring/mimir/config.yml
multitenancy_enabled: false

server:
  http_listen_port: 9009

blocks_storage:
  backend: filesystem
  filesystem:
    dir: /data/blocks
  tsdb:
    dir: /data/tsdb
  bucket_store:
    sync_dir: /data/bucket-sync

compactor:
  data_dir: /data/compactor

distributor:
  ring:
    kvstore:
      store: memberlist

ingester:
  ring:
    kvstore:
      store: memberlist
    replication_factor: 1

store_gateway:
  sharding_ring:
    replication_factor: 1

limits:
  max_global_series_per_user: 500000
  ingestion_rate: 10000
  ingestion_burst_size: 200000

ruler_storage:
  backend: filesystem
  filesystem:
    dir: /data/rules
EOF
```

**Grafana 데이터소스 자동 프로비저닝:**

```bash
cat <<'EOF' > /opt/monitoring/grafana/provisioning/datasources/datasources.yml
apiVersion: 1
datasources:
  - name: Mimir
    type: prometheus
    access: proxy
    url: http://mimir:9009/prometheus
    isDefault: true
    jsonData:
      httpMethod: POST

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "traceID=(\\w+)"
          name: TraceID
          url: "$${__value.raw}"

  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    uid: tempo
    jsonData:
      tracesToLogs:
        datasourceUid: loki
        tags: ["service.name"]
      nodeGraph:
        enabled: true

  - name: InfluxDB
    type: influxdb
    access: proxy
    url: http://influxdb:8086
    jsonData:
      version: Flux
      organization: tutum
      defaultBucket: k6
    secureJsonData:
      token: "${INFLUXDB_TOKEN}"
EOF
```

### 3-4. LGTM 스택 시작

```bash
cd /opt/monitoring
docker compose up -d

# 상태 확인
docker compose ps
# 모든 컨테이너 healthy/running 확인

# 각 서비스 접근 테스트
curl -s http://localhost:3100/ready     # Loki
curl -s http://localhost:3200/ready     # Tempo
curl -s http://localhost:9009/ready     # Mimir
curl -s http://localhost:3000/api/health # Grafana
```

> Grafana 접속: `http://192.168.0.230:3000`
> ID: admin / PW: tutum2026!

### 3-5. Grafana Alloy 설치 (K8s 클러스터 내 DaemonSet)

**k8s-cp-1에서 실행:**

```bash
# Alloy ConfigMap 작성
cat <<'EOF' > alloy-config.alloy
// ============================================
// 1. Kubernetes 서비스 디스커버리
// ============================================
discovery.kubernetes "pods" {
  role = "pod"
}

discovery.kubernetes "nodes" {
  role = "node"
}

// ============================================
// 2. Metrics → Mimir (192.168.0.230:9009)
// ============================================
prometheus.scrape "k8s_pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [prometheus.remote_write.mimir.receiver]
  scrape_interval = "30s"
}

prometheus.scrape "node_metrics" {
  targets    = discovery.kubernetes.nodes.targets
  forward_to = [prometheus.remote_write.mimir.receiver]
  scrape_interval = "30s"
}

prometheus.remote_write "mimir" {
  endpoint {
    url = "http://192.168.0.230:9009/api/v1/push"
  }
}

// ============================================
// 3. Logs → Loki (192.168.0.230:3100)
// ============================================
loki.source.kubernetes "k8s_logs" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://192.168.0.230:3100/loki/api/v1/push"
  }
}

// ============================================
// 4. Traces → Tempo (192.168.0.230:4317)
// ============================================
otelcol.receiver.otlp "default" {
  grpc { endpoint = "0.0.0.0:4317" }
  http { endpoint = "0.0.0.0:4318" }
  output {
    traces = [otelcol.exporter.otlp.tempo.input]
  }
}

otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "192.168.0.230:4317"
    tls { insecure = true }
  }
}
EOF

# Helm으로 Alloy 설치
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

kubectl create configmap alloy-config \
  --from-file=config.alloy=alloy-config.alloy \
  -n monitoring

helm install alloy grafana/alloy \
  --namespace monitoring \
  --set alloy.configMap.create=false \
  --set alloy.configMap.name=alloy-config \
  --set alloy.configMap.key=config.alloy

# DaemonSet 확인 (모든 노드에 1개씩 실행되어야 함)
kubectl get pods -n monitoring -o wide
```

### 3-6. Grafana 대시보드 구성

Grafana UI에서 아래 대시보드를 Import 합니다:

| 대시보드 | Grafana ID | 데이터소스 | 용도 |
|---------|------------|----------|------|
| Kubernetes Cluster | 15520 | Mimir | 클러스터 전체 상태 |
| Node Exporter | 1860 | Mimir | 노드별 CPU/Memory/Disk |
| Kubernetes Pods | 15760 | Mimir | Pod별 리소스 사용량 |
| Istio Mesh | 7639 | Mimir | 서비스 메시 트래픽 |
| Loki Logs | 13639 | Loki | 로그 탐색 |

**커스텀 대시보드:**
- **CloudDX Overview**: Backend API 응답시간, 에러율, Kafka Lag, Redis 히트율
- **k6 Load Test**: 부하 테스트 결과 시각화 (InfluxDB 데이터소스)

### 3-7. 알림 규칙 설정

Grafana UI → Alerting → Alert rules 에서 설정:

```yaml
# 주요 알림 규칙
- BackendDown: up{job="backend"} == 0 (1분 지속 시 Critical)
- HighErrorRate: rate(http_5xx[5m]) > 5% (5분 지속 시 Critical)
- KafkaConsumerLag: kafka_consumer_group_lag > 1000 (10분 지속 시 Warning)
- RedisMemoryHigh: redis_memory_used > 80% (5분 지속 시 Warning)
- HighLatency: p95 응답시간 > 2초 (5분 지속 시 Warning)
- NodeDiskFull: disk_used > 85% (Warning)
```

### 3-8. Phase 3 완료 검증

```bash
# 1. Monitoring VM 서비스 상태
curl -s http://192.168.0.230:3100/ready && echo "Loki: OK"
curl -s http://192.168.0.230:3200/ready && echo "Tempo: OK"
curl -s http://192.168.0.230:9009/ready && echo "Mimir: OK"
curl -s http://192.168.0.230:3000/api/health && echo "Grafana: OK"

# 2. K8s Alloy DaemonSet 상태
kubectl get pods -n monitoring

# 3. Grafana에서 데이터 확인
# Grafana UI → Explore → Mimir → up 쿼리 → K8s 노드/Pod 메트릭이 보여야 함
# Grafana UI → Explore → Loki → {namespace="tutum-app"} → 앱 로그가 보여야 함

# 4. K8s → Monitoring VM 네트워크 확인
kubectl run test-curl --image=curlimages/curl --rm -it --restart=Never -- \
  curl -s http://192.168.0.230:3100/ready
```

**Phase 3 완료 기준:**
- [ ] Monitoring VM에 Loki, Tempo, Mimir, Grafana, InfluxDB 전부 `running`
- [ ] Grafana 로그인 + 데이터소스 4개(Mimir, Loki, Tempo, InfluxDB) 연결 확인
- [ ] K8s Alloy DaemonSet이 모든 노드에서 `Running`
- [ ] Grafana에서 K8s 메트릭 조회 가능 (Mimir)
- [ ] Grafana에서 K8s 로그 조회 가능 (Loki)
- [ ] 기본 대시보드 5개 이상 Import 완료
- [ ] 알림 규칙 5개 이상 설정 완료

---

## 전체 완료 후 검증 시나리오

### E2E 테스트: 코드 Push → 자동 배포 → 모니터링

```
1. GitLab에 코드 push
   → GitLab CI 트리거

2. CI 파이프라인 실행
   → lint → test → sonarqube → build → trivy → cosign → GitLab CR push

3. deploy 스테이지
   → k8s-manifests 레포의 이미지 태그 업데이트

4. ArgoCD Auto Sync
   → k8s-manifests 변경 감지 → K8s 클러스터에 새 버전 배포

5. Kyverno 검증
   → Cosign 서명 확인 → 통과 시 배포, 미서명 시 차단

6. 모니터링 확인
   → Grafana에서 새 Pod 메트릭/로그 확인
   → 배포 후 에러율 대시보드 모니터링
```

---

## 네트워크 포트 정리

| 서비스 | 호스트 | IP | 포트 | 접근 대상 |
|--------|--------|------|------|----------|
| **GitLab** | gitlab.com (SaaS) | - | 443 (HTTPS) | 브라우저, CI Runner, ArgoCD |
| **SonarQube** | CI/CD VM(합침: monitoring host) | 192.168.0.28 | 9000 (HTTP) | 브라우저, CI Runner |
| **GitLab Runner** | K8s 클러스터 (gitlab-runner ns) | - | - | gitlab.com에서 Job 수신 |
| **GitLab Container Registry** | registry.gitlab.com (SaaS) | - | 443 (HTTPS) | CI Runner, K8s |
| K8s API | k8s-cp-1 | 192.168.0.220 | 6443 | kubectl, ArgoCD |
| ArgoCD | k8s-cp-1 (NodePort) | 192.168.0.220 | 30443 | 브라우저 |
| Istio Gateway | MetalLB VIP | 192.168.0.240~250 | 80/443 | 사용자 |
| Grafana | monitoring VM | 192.168.0.230 | 3000 | 브라우저 |
| Loki | monitoring VM | 192.168.0.230 | 3100 | Alloy |
| Tempo | monitoring VM | 192.168.0.230 | 4317/3200 | Alloy |
| Mimir | monitoring VM | 192.168.0.230 | 9009 | Alloy |
| InfluxDB | monitoring VM | 192.168.0.230 | 8086 | k6, Grafana |

> **CI/CD 도구 접근 경로 정리:**
> - 브라우저 → GitLab: `https://gitlab.com/tutum-project` (인터넷)
> - 브라우저 → SonarQube: `http://192.168.0.28:9000`
> - K8s Runner → GitLab/SonarQube/Registry: 인터넷 경유 (HTTPS)
> - ArgoCD(K8s) → GitLab: `https://gitlab.com/tutum-project/k8s-manifests.git` (인터넷 경유)
> - K8s → GitLab Container Registry: `registry.gitlab.com` (인터넷 경유, imagePullSecrets 필요)

---

## 주의사항

1. **기존 Docker Compose 3-tier VM(node1~3, 192.168.56.11~13)은 K8s 마이그레이션 후 폐기 대상** — 절대 사용하지 않음
2. **CI/CD 핵심은 monitoring 호스트(192.168.0.28)의 SonarQube + GitLab Registry 연동** — GitLab Runner는 K8s와 연동
3. **GitLab Runner는 K8s 클러스터 내 Helm chart로 설치** — 별도 VM 불필요, CI/CD 실행 시간 무제한
4. **imagePullSecrets 필수** — K8s가 GitLab Container Registry(registry.gitlab.com)에서 이미지 pull하려면 Deploy Token + K8s Secret 필요
5. **K8s 노드에서 인터넷 접근 필수** — gitlab.com, registry.gitlab.com, 192.168.0.28:9000 접근
6. **MariaDB는 외부 서버** — K8s에 포함하지 않음, 학원 온프레미스 서버에서 IP:Port 접속
7. **MongoDB Atlas → K8s StatefulSet 전환**은 이 계획 범위 밖 (데이터 레이어 마이그레이션은 별도 계획)
8. **KEDA는 운영 기본 적용**, Karpenter는 실험/최적화 단계에서 별도 검토 — 기본 범위는 K8s 클러스터 기본 뼈대 + CI/CD + LGTM
9. **Istio는 기본 설치만** — Gateway + mTLS까지만 설정, Canary/Blue-Green 배포 전략은 별도 계획
10. **K8s 버전**: 설치 시점 기준 최신 안정 버전 확인 (현재 기준 v1.29)

---

> 이 계획서는 다른 세션의 Claude가 읽고 그대로 실행할 수 있도록 작성되었습니다.
> 각 Phase는 독립적이나 순서대로 진행해야 합니다 (Phase 1 → 2 → 3).
> Phase 2의 ArgoCD와 Phase 3의 Alloy는 K8s 클러스터가 반드시 필요하므로 Phase 1 완료 후 진행합니다.








