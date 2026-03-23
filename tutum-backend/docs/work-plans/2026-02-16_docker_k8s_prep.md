# Docker 패키징 완성 및 K8s Manifest 준비

> **작성일**: 2026-02-16  
> **작성자**: jun  
> **목적**: K8s 마이그레이션을 위한 Docker 패키징 완성 및 K8s Manifest 작성  
> **상태**: 진행 중

---

## 📋 작업 개요

팀원이 K8s 클러스터 VM을 구성하는 동안, 애플리케이션 Docker 패키징을 완성하고 K8s 배포를 위한 Manifest 파일을 준비합니다.

### 역할 분담
- **팀원**: K8s 클러스터 VM 설치 및 구성 (kubeadm, Calico, MetalLB, Istio)
- **나**: Docker 패키징 완성 + K8s Manifest 작성 + CI/CD 파이프라인 준비

---

## ✅ 작업 목록

### 1. Docker 패키징 완성

#### 1-1. Frontend Dockerfile 작성
- [ ] `frontend/Dockerfile` 생성
  - Next.js Standalone 빌드 방식 (프로덕션 최적화)
  - Multi-stage build로 이미지 크기 최소화
  - Node.js 20 Alpine 이미지 사용
  - 환경 변수: `NEXT_PUBLIC_API_URL`
  - 포트: 3000

#### 1-2. Backend Dockerfile 수정
- [ ] `backend/Dockerfile` 운영 환경 최적화
  - `--reload` 플래그 제거 (개발 모드 → 운영 모드)
  - 환경 변수로 호스트/포트 설정
  - 불필요한 주석 정리

#### 1-3. .dockerignore 파일 작성
- [ ] `frontend/.dockerignore` 생성
  - `node_modules`, `.next`, `.cache` 제외
  - `.git`, `.env.local` 제외
  - 테스트 파일, 문서 파일 제외

- [ ] `backend/.dockerignore` 생성
  - `.venv`, `__pycache__`, `.pytest_cache` 제외
  - `.git`, `.env` 제외
  - 테스트 파일, 문서 파일 제외

#### 1-4. 루트 docker-compose.yml 작성
- [ ] 프로젝트 루트에 `docker-compose.yml` 생성
  - 모든 서비스 통합 (Frontend, Backend, Workers, MongoDB, Redis, Kafka)
  - 네트워크 분리 (frontend-network, backend-network)
  - 볼륨 설정
  - 환경 변수 설정

---

### 2. K8s Manifest 파일 작성

#### 2-1. 디렉토리 구조 생성
- [ ] `k8s-manifests/` 디렉토리 생성
  ```
  k8s-manifests/
  ├── base/
  │   ├── kustomization.yaml
  │   ├── namespace.yaml
  │   ├── frontend/
  │   ├── backend/
  │   └── workers/
  ├── overlays/
  │   ├── staging/
  │   └── production/
  └── argocd/
  ```

#### 2-2. Base Manifests 작성
- [ ] `base/namespace.yaml` - tutum-app, tutum-data 네임스페이스
- [ ] `base/frontend/deployment.yaml` - Frontend Deployment
- [ ] `base/frontend/service.yaml` - Frontend Service
- [ ] `base/backend/deployment.yaml` - Backend Deployment
- [ ] `base/backend/service.yaml` - Backend Service
- [ ] `base/workers/price-producer.yaml` - Price Producer Deployment
- [ ] `base/workers/news-producer.yaml` - News Producer Deployment
- [ ] `base/workers/indexer-consumer.yaml` - Indexer Consumer Deployment
- [ ] `base/workers/price-consumer.yaml` - Price Consumer Deployment
- [ ] `base/kustomization.yaml` - Base Kustomization

#### 2-3. Overlays 작성
- [ ] `overlays/staging/kustomization.yaml` - Staging 환경 설정
- [ ] `overlays/staging/replicas-patch.yaml` - Staging 리소스 설정
- [ ] `overlays/production/kustomization.yaml` - Production 환경 설정
- [ ] `overlays/production/replicas-patch.yaml` - Production 리소스 설정

#### 2-4. ArgoCD Application 정의
- [ ] `argocd/staging-app.yaml` - Staging ArgoCD Application
- [ ] `argocd/production-app.yaml` - Production ArgoCD Application

---

### 3. CI/CD 파이프라인 준비

#### 3-1. GitLab CI 파이프라인 작성
- [ ] `.gitlab-ci.yml` 작성
  - stages: lint, test, scan, build, security, sign, deploy
  - SonarQube 연동
  - Trivy 이미지 스캔
  - Cosign 이미지 서명
  - Harbor Push
  - ArgoCD 배포 트리거

#### 3-2. SonarQube 설정 준비
- [ ] `sonar-project.properties` 작성 (Backend)
- [ ] `sonar-project.properties` 작성 (Frontend)

---

### 4. 검증 및 테스트

#### 4-1. Docker 이미지 빌드 테스트
- [ ] Frontend 이미지 빌드 및 Harbor Push
- [ ] Backend 이미지 빌드 및 Harbor Push
- [ ] Workers 이미지 빌드 및 Harbor Push

#### 4-2. 로컬 Docker Compose 테스트
- [ ] `docker compose up -d` 실행
- [ ] 모든 서비스 정상 동작 확인
- [ ] Frontend (3000), Backend (8000) 접속 확인

#### 4-3. K8s Manifest 검증
- [ ] `kubectl apply --dry-run=client` 문법 검증
- [ ] Kustomize 빌드 테스트 (`kustomize build`)

---

## 🎯 완료 기준

### Phase 0 완료 기준
- [x] 현재 프로젝트 상태 분석 완료
- [ ] Frontend Dockerfile 작성 완료
- [ ] Backend Dockerfile 운영 환경 최적화 완료
- [ ] 루트 docker-compose.yml 작성 완료
- [ ] .dockerignore 파일 작성 완료
- [ ] 모든 이미지 Harbor Push 성공
- [ ] 로컬 Docker Compose 테스트 통과

### K8s Manifest 완료 기준
- [ ] base/ 디렉토리 모든 manifest 작성 완료
- [ ] overlays/staging, production 작성 완료
- [ ] ArgoCD Application 정의 완료
- [ ] Kustomize 빌드 테스트 통과
- [ ] kubectl dry-run 검증 통과

### CI/CD 준비 완료 기준
- [ ] `.gitlab-ci.yml` 작성 완료
- [ ] SonarQube 설정 파일 작성 완료
- [ ] 파이프라인 문법 검증 통과

---

## 📅 예상 일정

| 작업 | 예상 소요 시간 | 우선순위 |
|------|---------------|---------|
| Frontend Dockerfile 작성 | 30분 | 높음 |
| Backend Dockerfile 수정 | 15분 | 높음 |
| .dockerignore 작성 | 15분 | 중간 |
| 루트 docker-compose.yml | 30분 | 높음 |
| K8s Base Manifests | 1시간 | 높음 |
| K8s Overlays | 30분 | 중간 |
| ArgoCD Application | 15분 | 중간 |
| .gitlab-ci.yml | 1시간 | 높음 |
| 검증 및 테스트 | 30분 | 높음 |
| **총계** | **약 4.5시간** | |

---

## 🚨 주의사항

1. **Harbor 레지스트리 주소**: `192.168.56.12:8080`
   - 모든 이미지는 `192.168.56.12:8080/tutum/` 경로로 Push

2. **Backend Dockerfile 운영 환경 최적화**
   - `--reload` 플래그 제거 필수
   - 환경 변수로 설정 가능하도록 변경

3. **K8s Manifest 이미지 경로**
   - Harbor 레지스트리 경로 사용
   - 예: `image: 192.168.56.12:8080/tutum/frontend:latest`

4. **환경 변수 관리**
   - 민감 정보는 K8s Secret으로 관리
   - ConfigMap과 Secret 분리

5. **리소스 요청/제한 설정**
   - Frontend: requests(200m CPU, 256Mi), limits(500m CPU, 512Mi)
   - Backend: requests(500m CPU, 512Mi), limits(1000m CPU, 1Gi)
   - Workers: requests(200m CPU, 256Mi), limits(500m CPU, 512Mi)

---

## 📝 참고 문서

- `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md` - 전체 K8s 구축 계획
- `docs/plans/infra/K8S_MIGRATION_PLAN.md` - K8s 마이그레이션 상세 계획
- `VM_SETUP_GUIDE.md` - 기존 VM 환경 설정
- `implementation_plan.md` - Phase 0 구현 계획

---

## 🔄 다음 단계

팀원의 K8s 클러스터 구성 완료 후:
1. kubeconfig 파일 받기
2. K8s Manifest 배포 테스트
3. ArgoCD 설치 및 연동
4. GitLab CI/CD 파이프라인 실행
5. LGTM 모니터링 스택 구축
