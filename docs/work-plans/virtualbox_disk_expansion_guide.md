# VirtualBox VM 디스크 확장 가이드

> **작성일**: 2026-02-16
> **대상**: Node1, Node2, Node3 VM 디스크 확장
> **현재 용량**: 12GB → **목표 용량**: 30-50GB
> **OS**: Ubuntu Linux

---

## ⚠️ 사전 주의사항

### 1. 백업 필수!
```bash
# VM 전체 스냅샷 생성 (VirtualBox GUI에서)
# 또는 중요 데이터 백업
cd ~/clouddx-project
git push origin develop  # 코드 백업
docker images > docker-images-backup.txt  # 이미지 목록 백업
```

### 2. 작업 전 확인사항
- ✅ VM이 **완전히 종료**되어 있어야 함 (실행 중이면 안됨!)
- ✅ 스냅샷이 **없는 상태** 권장 (있으면 복잡해짐)
- ✅ VDI 파일 위치 확인
- ✅ 충분한 호스트 디스크 공간 확인

---

## 📋 전체 작업 흐름

```
Step 1: VirtualBox에서 VDI 파일 확장 (Windows/Mac/Linux 호스트)
   ↓
Step 2: VM 부팅 후 파티션 확장 (Ubuntu 내부)
   ↓
Step 3: 파일시스템 확장 (Ubuntu 내부)
   ↓
완료: df -h로 확인
```

---

## Step 1: VirtualBox VDI 파일 확장

### 1-1. VM 완전 종료
```bash
# VirtualBox GUI에서 VM을 완전히 종료 (저장된 상태 X)
# 또는 VM 내부에서
sudo shutdown -h now
```

### 1-2. VDI 파일 위치 확인

**Windows 기준:**
```powershell
# 기본 경로 (예시)
C:\Users\<사용자명>\VirtualBox VMs\Node1\Node1.vdi
```

**Mac/Linux 기준:**
```bash
# 기본 경로 (예시)
~/VirtualBox VMs/Node1/Node1.vdi
```

**GUI에서 확인:**
1. VirtualBox 관리자 열기
2. VM 선택 → 설정 → 저장소
3. 하드 디스크 클릭 → 위치 확인

### 1-3. VBoxManage 명령으로 디스크 확장

**Windows (PowerShell 또는 CMD):**
```powershell
# VirtualBox 설치 디렉토리로 이동
cd "C:\Program Files\Oracle\VirtualBox"

# 디스크 확장 (12GB → 50GB = 51200MB)
.\VBoxManage.exe modifymedium disk "C:\Users\<사용자명>\VirtualBox VMs\Node1\Node1.vdi" --resize 51200

# 또는 30GB로
.\VBoxManage.exe modifymedium disk "C:\Users\<사용자명>\VirtualBox VMs\Node1\Node1.vdi" --resize 30720
```

**Mac/Linux:**
```bash
# 디스크 확장 (12GB → 50GB = 51200MB)
VBoxManage modifymedium disk "$HOME/VirtualBox VMs/Node1/Node1.vdi" --resize 51200

# 또는 30GB로
VBoxManage modifymedium disk "$HOME/VirtualBox VMs/Node1/Node1.vdi" --resize 30720
```

**크기 계산:**
- 30GB = 30 × 1024 = 30720 MB
- 50GB = 50 × 1024 = 51200 MB

### 1-4. 확장 성공 확인
```bash
# VirtualBox GUI에서
# VM 설정 → 저장소 → 하드 디스크 → 크기 확인
```

---

## Step 2: VM 부팅 후 파티션 확장

### 2-1. VM 부팅 및 SSH 접속
```bash
# VM 시작 후 접속
ssh clouddx@192.168.56.11  # Node1 기준
```

### 2-2. 현재 디스크 상태 확인
```bash
# 디스크 전체 크기 확인 (이미 50GB로 보여야 함)
sudo fdisk -l /dev/sda

# 파티션 사용량 확인 (아직 12GB로 보임)
df -h
```

### 2-3. 파티션 확장 - LVM 사용 여부 확인

**먼저 LVM 사용 여부 확인:**
```bash
sudo lsblk
```

출력 예시를 보고 판단:

**Case A: LVM 사용 (ubuntu-lv 등이 보임)**
```
sda                         8:0    0   50G  0 disk
├─sda1                      8:1    0    1M  0 part
├─sda2                      8:2    0  1.5G  0 part /boot
└─sda3                      8:3    0 10.5G  0 part
  └─ubuntu--vg-ubuntu--lv 253:0    0   10G  0 lvm  /
```
→ **LVM 방식 사용** (Step 2-4로)

**Case B: 일반 파티션 (ext4 직접 마운트)**
```
sda      8:0    0   50G  0 disk
├─sda1   8:1    0   49G  0 part /
└─sda2   8:2    0    1G  0 part [SWAP]
```
→ **일반 파티션** (Step 2-5로)

### 2-4. LVM 방식 파티션 확장

```bash
# 1. 물리 파티션 확장 (sda3 예시)
sudo growpart /dev/sda 3

# 2. PV (Physical Volume) 확장
sudo pvresize /dev/sda3

# 3. LV (Logical Volume) 확장
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv

# 4. 파일시스템 확장
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv

# 5. 확인
df -h
```

### 2-5. 일반 파티션 확장 (LVM 없는 경우)

```bash
# 1. parted 설치 (없는 경우)
sudo apt-get update
sudo apt-get install -y parted

# 2. 파티션 확장
sudo parted /dev/sda
  (parted) print free          # 현재 상태 확인
  (parted) resizepart 1 100%   # 파티션 1을 100%로 확장
  (parted) quit

# 3. 파일시스템 확장
sudo resize2fs /dev/sda1

# 4. 확인
df -h
```

---

## Step 3: 확인 및 마무리

### 3-1. 최종 확인
```bash
# 디스크 사용량 확인
df -h

# 예상 결과:
# Filesystem                         Size  Used Avail Use% Mounted on
# /dev/ubuntu-vg/ubuntu-lv            48G  9.5G   36G  21% /
```

### 3-2. Docker 디스크 확인
```bash
docker system df
```

### 3-3. 성공!
```bash
echo "✅ 디스크 확장 완료!"
```

---

## 🔧 트러블슈팅

### 문제 1: "no space left on device" (확장 중 발생)
```bash
# 임시 파일 정리
sudo apt-get clean
sudo journalctl --vacuum-size=100M
df -h
```

### 문제 2: growpart 명령어 없음
```bash
# cloud-utils 설치
sudo apt-get update
sudo apt-get install -y cloud-guest-utils
```

### 문제 3: VBoxManage 명령어 없음 (Windows)
```powershell
# 환경변수에 VirtualBox 경로 추가
$env:Path += ";C:\Program Files\Oracle\VirtualBox"

# 또는 직접 경로 사용
cd "C:\Program Files\Oracle\VirtualBox"
```

### 문제 4: 파티션 확장 후에도 용량 안늘어남
```bash
# resize2fs를 다시 실행
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv

# 또는 xfs 파일시스템인 경우
sudo xfs_growfs /dev/ubuntu-vg/ubuntu-lv
```

---

## 📊 Node1/Node2/Node3 확장 체크리스트

| VM | 현재 용량 | 목표 용량 | 상태 | 비고 |
|----|----------|----------|------|------|
| Node1 | 12GB | 50GB | ⬜ | 빌드 전용, 여유 필요 |
| Node2 | 12GB | 30GB | ⬜ | Harbor만 운영 |
| Node3 | 12GB | 30GB | ⬜ | 배포 환경 |

---

## 🎯 권장사항

1. **Node1**: 50GB (빌드 작업 많음)
2. **Node2**: 30GB (Harbor 이미지 저장소)
3. **Node3**: 30GB (운영 환경)

---

## 📝 작업 후 할 일

```bash
# 1. Docker 디스크 정리 (더 이상 급하지 않지만)
./scripts/cleanup-docker.sh

# 2. 빌드 테스트
cd ~/clouddx-project
./scripts/build-and-push.sh

# 3. 여유 공간 확인
df -h
docker system df
```

---

## 🔗 참고 링크

- [VirtualBox 공식 문서 - VBoxManage modifymedium](https://www.virtualbox.org/manual/ch08.html#vboxmanage-modifymedium)
- [Ubuntu LVM 디스크 확장 가이드](https://ubuntu.com/server/docs/device-mapper-multipathing-introduction)

---

## 💡 추가 팁

### 스냅샷이 있는 경우
- 스냅샷을 모두 삭제하거나
- 스냅샷을 병합한 후 진행
- 또는 새 VDI를 만들어 복제

### 동적 할당 vs 고정 크기
- 기존이 동적 할당이면 확장 후에도 동적
- 성능을 위해서는 고정 크기 권장 (하지만 호스트 디스크 많이 사용)

### 확장 실패 시 복구
```bash
# VirtualBox 스냅샷으로 복구
# 또는 백업한 VDI 파일로 교체
```

---

**작성자**: Claude Code
**마지막 업데이트**: 2026-02-16
