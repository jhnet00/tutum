# Harbor 이미지 Push 검증 및 Node1 빌드 환경 구축

> **작성일**: 2026-02-16
> **작성자**: kyk02405
> **목적**: Docker 이미지를 Harbor에 push/pull 검증하고, Node1에서 직접 빌드→배포 파이프라인 구축
> **상태**: 완료

---

## 작업 개요

DEPLOYMENT_PLAN.md 기반으로 Docker 이미지가 Harbor 레지스트리에 정상적으로 push/pull 되는지 검증하고,
Node1에서 소스코드를 직접 관리하며 빌드→Harbor push까지 가능한 환경을 구축합니다.

---

## 완료된 작업

### 1. Harbor 레지스트리 검증
- [x] Harbor (Node2, 192.168.56.12:8080) 서비스 상태 확인 (모든 컴포넌트 healthy)
- [x] Node1/Node2/Node3 insecure-registry 설정 확인 (`/etc/docker/daemon.json`)
- [x] Node1, Node2에서 docker login 성공

### 2. Docker 이미지 Harbor Push
- [x] 로컬 PC → Node2 이미지 전송 (`docker save | ssh docker load`)
- [x] Node2에서 Harbor push 성공 (frontend, backend, workers :test 태그)
- [x] Node1에서 Harbor pull 검증 성공

### 3. Node1 빌드 환경 구축
- [x] Node1에 SSH key (ed25519) 생성
- [x] GitHub deploy key 등록 (write access)
- [x] Node1에서 git clone 성공 (`git@github.com:kyk02405/clouddx-project.git`)
- [x] Node1에서 직접 docker build → Harbor push 성공 (frontend, backend, workers :latest 태그)

### 4. 빌드 에러 수정
- [x] `/login`, `/auth/callback` 페이지에 `export const dynamic = 'force-dynamic'` 추가
  - Next.js가 `useSearchParams()` 사용 페이지를 정적 생성 시도하여 빌드 실패 → 동적 렌더링으로 강제

---

## 확립된 워크플로우

```
Node1: git pull → docker build → docker push → Harbor (Node2)
Node1/Node3: docker pull → docker compose up
```

### 명령어 요약

```bash
# Node1에서 빌드 & 배포
cd ~/clouddx-project
git pull origin develop
docker build -t 192.168.56.12:8080/tutum/frontend:latest ./frontend
docker build -t 192.168.56.12:8080/tutum/backend:latest ./backend
docker build -t 192.168.56.12:8080/tutum/workers:latest ./backend/workers
docker push 192.168.56.12:8080/tutum/frontend:latest
docker push 192.168.56.12:8080/tutum/backend:latest
docker push 192.168.56.12:8080/tutum/workers:latest
```

---

## 다음 단계

| 우선순위 | 작업 | 설명 |
|---------|------|------|
| 1 | Node1 docker-compose.yml | frontend + backend + nginx 서비스 구성 |
| 2 | 환경변수 파일 (.env) | VM별 환경변수 설정 |
| 3 | Nginx 프로덕션 설정 | SSL, 프록시 헤더, Rate limit |
| 4 | Backend 코드 수정 | CORS 하드코딩 제거, health check 강화 |
| 5 | 빌드/배포 스크립트 | build-and-push.sh, deploy-node{1,2,3}.sh |

---

## Harbor 이미지 현황

| 이미지 | 태그 | 비고 |
|--------|------|------|
| `tutum/frontend` | test, latest | Node1 빌드 |
| `tutum/backend` | test, latest | Node1 빌드 |
| `tutum/workers` | test, latest | Node1 빌드 |
| `tutum/producer` | test | 기존 |
| `tutum/consumer` | test | 기존 |

---

## 참고

- `DEPLOYMENT_PLAN.md` - 3-VM Docker 배포 계획서
- `docs/work-plans/2026-02-16_docker_k8s_prep.md` - Docker/K8s 준비 작업 계획
