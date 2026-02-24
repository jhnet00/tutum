# ============================================
# Harbor 설치 가이드 (Node2용)
# ============================================

## 개요
Harbor는 Docker 이미지 저장소(Private Registry)입니다.
Node2에 호스트로 설치하여 모든 노드에서 이미지를 Pull합니다.

## 운영 환경 설치 (권장)

### 1. Harbor 설치 패키지 다운로드
```bash
# Node2에서 실행
cd /opt
wget https://github.com/goharbor/harbor/releases/download/v2.10.0/harbor-offline-installer-v2.10.0.tgz
tar -xvf harbor-offline-installer-v2.10.0.tgz
cd harbor
```

### 2. 설정 파일 수정
```bash
cp harbor.yml.tmpl harbor.yml
vi harbor.yml
```

**필수 수정 항목:**
```yaml
# hostname: Node2의 IP 또는 도메인
hostname: 192.168.x.x  # Node2 IP

# http 포트 (HTTPS 사용 시 주석 처리)
http:
  port: 8080

# 관리자 비밀번호
harbor_admin_password: 강력한비밀번호

# 데이터 저장 경로
data_volume: /data/harbor
```

### 3. 설치 실행
```bash
./install.sh --with-trivy  # 취약점 스캐너 포함
```

### 4. 접속 확인
- URL: http://192.168.x.x:8080
- 기본 계정: admin / Harbor12345

---

## 다른 노드에서 Harbor 사용

### 1. Docker 데몬에 insecure-registry 추가
```bash
# /etc/docker/daemon.json
{
  "insecure-registries": ["192.168.x.x:8080"]
}
sudo systemctl restart docker
```

### 2. Harbor 로그인
```bash
docker login 192.168.x.x:8080
# Username: admin
# Password: 설정한 비밀번호
```

### 3. 이미지 Push/Pull
```bash
# 태깅
docker tag my-app:latest 192.168.x.x:8080/clouddx/my-app:latest

# Push
docker push 192.168.x.x:8080/clouddx/my-app:latest

# Pull (다른 노드에서)
docker pull 192.168.x.x:8080/clouddx/my-app:latest
```

---

## 프로젝트 저장소 생성

Harbor 웹 UI에서 다음 프로젝트 생성:
- `clouddx/frontend` - Next.js 이미지
- `clouddx/backend` - FastAPI 이미지
- `clouddx/workers` - Kafka 워커 이미지
