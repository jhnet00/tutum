# 2026-02-16 개발 로그: Harbor Push 검증 및 Node1 빌드 파이프라인 구축

## 1. 작업 요약

- **Harbor 레지스트리 push/pull 검증**: 로컬 PC에서 빌드한 Docker 이미지를 Harbor(Node2)에 push하고 Node1에서 pull 성공
- **Node1 빌드 환경 구축**: GitHub SSH deploy key 설정, git clone, 직접 빌드→Harbor push 파이프라인 완성
- **빌드 에러 수정**: Next.js 정적 생성 실패 문제 해결 (`force-dynamic` 추가)

## 2. 상세 내용

### 2-1. Harbor 접속 경로 문제 해결

**문제**: 개발 PC(`192.168.0.3`)에서 Harbor(`192.168.56.12:8080`)에 직접 접근 불가
- `192.168.56.0/24`는 서버 PC(`192.168.0.28`) VirtualBox Host-Only 네트워크
- SSH 터널(`localhost:18080 → 192.168.56.12:8080`) 시도했으나, Docker Desktop이 WSL2 내부에서 실행되어 호스트의 터널에 접근 불가

**해결**: `docker save | ssh docker load` 방식으로 이미지 전송
```bash
# 로컬 → Node2로 이미지 파이프 전송
docker save 192.168.56.12:8080/tutum/frontend:test | ssh -p 2212 clouddx@192.168.0.28 "docker load"
```

### 2-2. Node1 GitHub 연동

1. Node1에서 SSH key 생성 (`ssh-keygen -t ed25519`)
2. GitHub deploy key 등록 (write access 포함)
3. `git clone git@github.com:kyk02405/clouddx-project.git` 성공
4. git pull / push 모두 가능 확인

### 2-3. Node1 빌드 → Harbor Push

```bash
# Node1에서 직접 빌드 및 push
cd ~/clouddx-project && git checkout develop
docker build -t 192.168.56.12:8080/tutum/frontend:latest ./frontend
docker build -t 192.168.56.12:8080/tutum/backend:latest ./backend
docker build -t 192.168.56.12:8080/tutum/workers:latest ./backend/workers
docker push 192.168.56.12:8080/tutum/frontend:latest
docker push 192.168.56.12:8080/tutum/backend:latest
docker push 192.168.56.12:8080/tutum/workers:latest
```

- Node1 디스크 부족 (12GB 중 11GB 사용) → `docker system prune -af`로 2.4GB 확보 후 빌드 성공

### 2-4. Frontend 빌드 에러 수정

**에러**: `npm run build` 시 `/login`과 `/auth/callback` 페이지 prerender 실패
```
Error: useSearchParams() should be wrapped in a suspense boundary at page "/login"
Export encountered errors on following paths: /auth/callback/page, /login/page
```

**원인**: 두 페이지 모두 `<Suspense>`로 감싸져 있었지만, Next.js가 정적 생성을 시도하면서 실패

**수정**: 두 파일에 `export const dynamic = 'force-dynamic'` 추가
- `frontend/app/login/page.tsx`
- `frontend/app/auth/callback/page.tsx`

## 3. 인프라 현황

### 노드별 설정 상태

| 항목 | Node1 | Node2 | Node3 |
|------|-------|-------|-------|
| insecure-registry | O | O | O |
| docker login Harbor | O | O | - |
| git clone (소스코드) | O | - | - |
| SSH deploy key | O (write) | - | - |

### Harbor 이미지 목록

| 이미지 | 태그 |
|--------|------|
| tutum/frontend | test, latest |
| tutum/backend | test, latest |
| tutum/workers | test, latest |
| tutum/producer | test |
| tutum/consumer | test |

## 4. 트러블슈팅 기록

| 문제 | 원인 | 해결 |
|------|------|------|
| Docker Desktop → Harbor 로그인 실패 | WSL2 VM에서 호스트 SSH 터널 접근 불가 | `docker save \| ssh docker load` 방식 전환 |
| Docker Desktop 종료 멈춤 | Engine stopping 상태에서 무응답 | `taskkill /F /IM "Docker Desktop.exe"` 강제 종료 |
| Node1 빌드 시 디스크 부족 | 12GB 중 11GB 사용 (이미지+캐시) | `docker system prune -af`로 정리 |
| Frontend 빌드 실패 | useSearchParams() 정적 생성 불가 | `export const dynamic = 'force-dynamic'` 추가 |
| GitHub clone 인증 실패 | Private repo, HTTPS 인증 불가 | SSH deploy key 방식으로 전환 |

## 5. 커밋 정보

- **브랜치**: `develop`
- **커밋**: `aaf2e9e` - fix: add force-dynamic to login and auth/callback pages for Docker build
- **변경 파일**: `frontend/app/login/page.tsx`, `frontend/app/auth/callback/page.tsx`
