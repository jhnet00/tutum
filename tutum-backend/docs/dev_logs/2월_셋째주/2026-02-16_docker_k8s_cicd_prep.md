# 📅 개발 작업 완료 보고서 (2026-02-16)

## 📌 작업 개요
**작성자**: kyk02405
**Branch**: `kyk/0216-node1`
**작업 내용**: Docker 패키징 완성, K8s Manifest 작성, CI/CD 파이프라인 템플릿 준비

---

## 1. 🔧 주요 변경 사항

### 1-1. Frontend Dockerfile 작성
- `frontend/Dockerfile` 신규 생성
  - Node 20 Alpine 기반 Multi-stage build (deps → builder → runner)
  - Next.js Standalone 모드로 이미지 크기 최소화
  - non-root user (nextjs:nodejs) 실행
- `frontend/next.config.mjs` 수정
  - `output: "standalone"` 설정 추가

### 1-2. Backend Dockerfile 운영 환경 최적화
- `backend/Dockerfile` 수정
  - `--reload` 플래그 제거 (개발 모드 → 운영 모드)
  - `--workers 4` 추가 (멀티 프로세스)

### 1-3. .dockerignore 파일 작성
- `frontend/.dockerignore` 신규 생성 (node_modules, .next, .env.local 등 제외)
- `backend/.dockerignore` 신규 생성 (.venv, __pycache__, tests 등 제외)

### 1-4. 루트 docker-compose.yml 작성
- 프로젝트 루트에 `docker-compose.yml` 신규 생성
- 전체 서비스 통합: Frontend, Backend, MongoDB, Redis, MinIO, Kafka, Workers
- 네트워크 분리: frontend-network, backend-network
- 기존 `frontend/docker-compose.yml` 대비 경로 수정 및 Workers 서비스 추가

### 2-1. K8s Manifest 파일 작성
- `k8s-manifests/` 디렉토리 구조 생성
  ```
  k8s-manifests/
  ├── base/
  │   ├── kustomization.yaml
  │   ├── namespace.yaml (tutum-app, tutum-data)
  │   ├── frontend/deployment.yaml, service.yaml
  │   ├── backend/deployment.yaml, service.yaml
  │   └── workers/price-producer.yaml, price-consumer.yaml, email-worker.yaml
  ├── overlays/
  │   ├── staging/ (replicas: 1, 리소스 축소, tag: staging)
  │   └── production/ (replicas: 2, 풀 리소스, tag: stable)
  └── argocd/
      ├── staging-app.yaml (develop 브랜치, auto-sync)
      └── production-app.yaml (main 브랜치, manual sync)
  ```
- Harbor 이미지 경로: `192.168.56.12:8080/tutum/`
- 리소스 설정: Frontend(200m~500m CPU), Backend(500m~1CPU), Workers(200m~500m CPU)

### 3-1. CI/CD 파이프라인 템플릿
- `.gitlab-ci.yml` 신규 생성 (템플릿)
  - 7단계: lint → test → scan → build → security → sign → deploy
  - SonarQube, Trivy, Cosign, Harbor Push, ArgoCD 연동 구조
- `frontend/sonar-project.properties` 신규 생성
- `backend/sonar-project.properties` 신규 생성

---

## 2. 📝 변경 파일 목록

| 파일 | 상태 | 설명 |
|------|------|------|
| `frontend/Dockerfile` | 신규 | Next.js Standalone Multi-stage build |
| `frontend/.dockerignore` | 신규 | Docker 빌드 제외 목록 |
| `frontend/next.config.mjs` | 수정 | standalone output 추가 |
| `frontend/sonar-project.properties` | 신규 | SonarQube 설정 |
| `backend/Dockerfile` | 수정 | 운영 환경 최적화 |
| `backend/.dockerignore` | 신규 | Docker 빌드 제외 목록 |
| `backend/sonar-project.properties` | 신규 | SonarQube 설정 |
| `docker-compose.yml` | 신규 | 루트 통합 Compose |
| `.gitlab-ci.yml` | 신규 | CI/CD 파이프라인 템플릿 |
| `k8s-manifests/**` | 신규 | K8s Manifest 전체 |

---

## 3. 📝 커밋 내역
```
git log --oneline --since="2026-02-16" --until="2026-02-16 23:59:59"
```

---

**✅ 결론**: K8s 마이그레이션을 위한 Docker 패키징, K8s Manifest, CI/CD 파이프라인 템플릿 작성 완료. 팀원의 K8s 클러스터 구성 완료 후 이미지 빌드 → Harbor Push → 배포 테스트 진행 예정.

---

## 4. 🚀 추가 진행 내용 (오후 4:00 ~ 5:00)

### 4-1. Docker 패키징 완료 (Phase 0)
- **WSL2 설치**: Docker Desktop 백엔드용 Ubuntu 설치 완료 (wsl --install)
- **Dockerfile 검증**: Frontend(235MB), Backend(786MB), Workers(530MB) 빌드 성공
- **docker-compose.yml**: 로컬 통합 테스트용 작성 및 검증 완료 (.dockerignore 포함)

### 4-2. 트러블슈팅: Harbor 접속 불가 (Network)
- **증상**: `localhost:8080` 및 `192.168.56.12` 접속 실패 (Connection Refused/Timeout)
- **원인**: Windows 호스트의 `VirtualBox Host-Only Ethernet Adapter` 설정 유실 확인
- **조치**:
  1. VirtualBox 네트워크 관리자에서 어댑터 재생성 (`192.168.56.1`)
  2. Ping 테스트 완료 (`192.168.56.12` 응답 확인 필요)
  3. **VM 재부팅 및 Harbor 이미지 Push 완료** (수동 진행)

### 4-3. 향후 계획 (Phase 1)
- 팀원에게 K8s 클러스터 배포 요청 (`k8s-manifests` 활용)
