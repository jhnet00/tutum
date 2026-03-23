# CloudDX 3-VM Docker 배포 계획서

> **작성일**: 2026-02-05
> **상태**: 계획 수립 완료 / 구현 대기 (프론트엔드/백엔드 개발 완료 후 진행)
> **선행 조건**: 인증 시스템 완성, 핵심 기능 구현 완료

---

## 1. 개요

현재 단일 `docker-compose.yml`로 로컬 개발 환경을 운영하고 있습니다.
운영 환경에서는 **3대의 VM에 Docker로 서비스를 분산 배치**하여 안정성과 확장성을 확보합니다.

### 결정 사항

| 항목 | 결정 | 근거 |
|------|------|------|
| Compose 전략 | 기존 파일 → `docker-compose.dev.yml` 이동, VM별 compose 신규 생성 | 개발/운영 분리 |
| MongoDB | **Atlas(클라우드) 유지** | Node2에 로컬 MongoDB 불필요 |
| SSL/TLS | **포함** (Let's Encrypt + 자체 인증서 대안) | HTTPS 필수 |
| VM 상태 | 미준비 → 설정 파일/스크립트 먼저 생성 | VM 생성 시 즉시 적용 가능 |

---

## 1-1. 접속 정보

### SSH 접속

| VM | 접속 명령 | Host-Only IP |
|----|-----------|-------------|
| **Node1** | `ssh -p 2211 clouddx@192.168.0.28` | 192.168.56.11 |
| **Node2** | `ssh -p 2212 clouddx@192.168.0.28` | 192.168.56.12 |
| **Node3** | `ssh -p 2213 clouddx@192.168.0.28` | 192.168.56.13 |

- **서버 PC (NAT Host)**: `192.168.0.28`
- **VM 사용자**: `clouddx`
- **VM 비밀번호**: `tutum`
- **sudo 비밀번호**: `tutum` (동일)
- **네트워크**: VirtualBox Host-Only `192.168.56.0/24` (노드 간 통신)

### Harbor (컨테이너 레지스트리)

| 항목 | 값 |
|------|-----|
| **URL** | `http://192.168.56.12:8080` (Node2) |
| **관리자 ID** | `admin` |
| **관리자 비밀번호** | `Himedia123` |
| **프로젝트** | `tutum` |
| **이미지 형식** | `192.168.56.12:8080/tutum/<이미지명>:<태그>` |

**Docker 로그인:**
```bash
echo 'Himedia123' | docker login 192.168.56.12:8080 -u admin --password-stdin
```

**insecure-registry 설정** (`/etc/docker/daemon.json`):
```json
{"insecure-registries": ["192.168.56.12:8080"]}
```

> Harbor는 HTTP 모드로 운영 중이므로 모든 Docker 클라이언트 노드에 insecure-registry 설정 필요

---

## 2. 3-VM 토폴로지

```
                    ┌─────────────────────────────────────┐
                    │          VM1 / Node1                │
                    │       Entry & Stateless             │
                    │                                     │
   사용자 ──HTTPS──→│  Nginx (80/443)                     │
                    │    ├─→ Frontend (Next.js :3000)     │
                    │    └─→ Backend  (FastAPI :8000)     │
                    └──────────┬──────────┬───────────────┘
                               │          │
                    ┌──────────▼──┐  ┌────▼──────────────────────┐
                    │ VM2 / Node2 │  │ VM3 / Node3               │
                    │ Core Infra  │  │ Worker & Search            │
                    │             │  │                            │
                    │ Redis :6379 │  │ Elasticsearch :9200        │
                    │ MinIO :9000 │  │ Kibana        :5601        │
                    │ Harbor:8080 │  │ Kafka(KRaft)  :9092/9093   │
                    │             │  │ Kafka         :9092        │
                    │             │  │ Price Producer             │
                    │             │  │ News Producer              │
                    └─────────────┘  │ Indexer Consumer           │
                                     └───────────────────────────┘
                    ┌─────────────┐
                    │ MongoDB     │
                    │ Atlas Cloud │  ← 인터넷 경유 (모든 노드 접근)
                    └─────────────┘
```

### VM별 서비스 구성

| VM | 역할 | 서비스 | 포트 |
|----|------|--------|------|
| **Node1** | Entry & Stateless | Nginx, Frontend(Next.js), Backend(FastAPI) | 80, 443, 3000, 8000 |
| **Node2** | Core Infra | Redis Master, MinIO, Harbor Registry | 6379, 9000, 9001, 8080 |
| **Node3** | Worker & Search | ES, Kibana, Kafka(KRaft), Workers x3 | 9200, 5601, 9092, 9093 |
| **Cloud** | Database | MongoDB Atlas | 27017 (SRV) |

---

## 3. 크로스-VM 통신 구조

```
Node1(Backend) ──→ Atlas Cloud        (MongoDB, 인터넷 경유)
Node1(Backend) ──→ Node2:6379         (Redis, 호스트 IP)
Node1(Backend) ──→ Node2:9000         (MinIO, 호스트 IP)
Node1(Backend) ──→ Node3:9200         (Elasticsearch, 호스트 IP)
Node1(Backend) ──→ Node3:9092         (Kafka EXTERNAL, 호스트 IP)

Node3(Workers) ──→ Node3:29092       (Kafka INTERNAL, Docker DNS)
Node3(Workers) ──→ Node3:9200        (Elasticsearch, Docker DNS)
Node3(Indexer) ──→ Atlas Cloud        (MongoDB, 필요 시)

Node1(Nginx)   ──→ Node1:3000        (Frontend, Docker DNS)
Node1(Nginx)   ──→ Node1:8000        (Backend, Docker DNS)
```

### Kafka 듀얼 리스너 구조

Kafka는 같은 VM(Node3) 내 통신과 다른 VM(Node1)에서의 접근을 모두 지원해야 합니다:

| 리스너 | 주소 | 용도 |
|--------|------|------|
| INTERNAL | `kafka:29092` | Node3 내부 (Workers, Indexer) |
| EXTERNAL | `${NODE3_IP}:9092` | Node1 Backend에서 접근 |

---

## 4. 방화벽 규칙

| VM | 개방 포트 | 소스 제한 |
|----|-----------|-----------|
| Node1 | 80, 443 | 모든 IP (Public) |
| Node1 | 3000, 8000 | Node1 내부만 (Docker network) |
| Node2 | 6379, 9000, 9001 | Node1 IP, Node3 IP만 |
| Node2 | 8080, 4443 | Node1 IP, Node3 IP만 (Harbor) |
| Node3 | 9092, 9200 | Node1 IP만 |
| Node3 | 5601 | 관리자 IP만 (Kibana) |
| Node3 | 9093, 29092 | Node3 내부만 (KRaft Controller + Internal) |

---

## 5. 구현 단계 (총 9단계, 25개 파일)

### Step 1: 기존 파일 정리

| 작업 | 설명 |
|------|------|
| `docker-compose.yml` → `docker-compose.dev.yml` | 기존 개발용 compose 파일 이름 변경 |
| 디렉토리 구조 생성 | `infra/deploy/node{1,2,3}/`, `scripts/`, `ssl/` |

**생성할 디렉토리 구조:**
```
infra/
  deploy/
    node1/
      docker-compose.yml
      .env.node1.example
    node2/
      docker-compose.yml
      .env.node2.example
    node3/
      docker-compose.yml
      .env.node3.example
    scripts/
      setup-vm.sh
      build-and-push.sh
      deploy-node1.sh
      deploy-node2.sh
      deploy-node3.sh
      healthcheck.sh
    ssl/
      init-letsencrypt.sh
      self-signed.sh
```

---

### Step 2: Frontend Dockerfile 생성

> 현재 **Frontend Dockerfile이 존재하지 않음** — 가장 높은 우선순위

**생성할 파일:**
- `frontend/next.config.js` — `output: 'standalone'` 필수
- `frontend/Dockerfile` — 3-stage 멀티스테이지 빌드
- `frontend/.dockerignore`

**Dockerfile 설계:**
```
Stage 1 (deps)    : node:18-alpine → npm ci (의존성만 설치)
Stage 2 (builder) : 소스 복사 → npm run build (standalone 빌드)
Stage 3 (runner)  : 최소 이미지 → node server.js (실행만)
```

**next.config.js 핵심 설정:**
```javascript
const nextConfig = {
  output: 'standalone',   // Docker용 독립 실행 모드
}
```

**주의 사항:**
- `NEXT_PUBLIC_API_URL`은 빌드 타임에 결정됨 → Docker build-arg로 전달 필요
- 운영 환경에서는 Nginx 도메인(예: `https://clouddx.com`)을 값으로 설정

---

### Step 3: Backend/Workers Dockerfile 프로덕션 전환

**수정할 파일:**
- `backend/Dockerfile` — 멀티스테이지 + 프로덕션 모드
- `backend/.dockerignore` (신규)
- `backend/workers/Dockerfile` — 동일 패턴
- `backend/workers/.dockerignore` (신규)

**현재 → 변경:**
| 항목 | 현재 (개발) | 변경 (운영) |
|------|-------------|-------------|
| 빌드 | 단일 스테이지 | 2-stage 멀티스테이지 |
| CMD | `uvicorn ... --reload` | `uvicorn ... --workers 4` |
| 사용자 | root | non-root (appuser) |
| gcc | 최종 이미지에 포함 | 빌더에서만 사용 |
| 볼륨 | `./backend:/app` 마운트 | 소스 코드 COPY (마운트 없음) |

---

### Step 4: Backend 코드 수정

> **파일**: `backend/app/main.py`

**4-1. CORS 하드코딩 제거 (line 63)**
```python
# 현재 (하드코딩)
allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"]

# 변경 (설정에서 읽기 — config.py:53에 이미 정의됨)
allow_origins=settings.CORS_ORIGINS
```

**4-2. Health Check 강화 (line 75-99)**
- 현재: 항상 HTTP 200 반환, traceback 노출
- 변경: 비정상 시 HTTP 503 반환, traceback 제거

**4-3. DEBUG 모드 분기**
- `DEBUG=False`일 때 `/docs`, `/redoc` 비활성화 옵션

---

### Step 5: Nginx 프로덕션 설정 + SSL

> **파일**: `nginx/nginx.conf` (수정)

**현재 (26줄, 기본 설정):**
```nginx
# proxy_set_header 없음, SSL 없음, Rate limiting 없음
location / { proxy_pass http://frontend; }
location /api/ { proxy_pass http://backend; }
```

**추가할 설정:**

| 기능 | 설명 |
|------|------|
| SSL 서버 블록 | 443 포트, Let's Encrypt 인증서 마운트 |
| HTTP→HTTPS 리다이렉트 | 80포트 접속 시 443으로 |
| proxy_set_header | X-Real-IP, X-Forwarded-For, X-Forwarded-Proto |
| Static 캐싱 | `/_next/static/` → `Cache-Control: immutable, 1년` |
| Rate limiting | `/api/` → `30r/s`, burst 50 |
| WebSocket | `/ws/` → Upgrade 헤더 지원 |
| 보안 헤더 | X-Frame-Options, X-Content-Type-Options 등 |
| 업로드 크기 | `client_max_body_size 50m` |
| certbot 경로 | `/.well-known/acme-challenge/` |

---

### Step 6: VM별 Docker Compose 파일

**Node1 (`infra/deploy/node1/docker-compose.yml`):**
```yaml
services:
  nginx:        # SSL + 리버스 프록시 (80/443)
  certbot:      # Let's Encrypt 인증서 자동 갱신
  frontend:     # Harbor에서 pull
  backend:      # Harbor에서 pull, .env.node1 사용
```
- 이미지: `${HARBOR_REGISTRY}/clouddx/frontend:${IMAGE_TAG}`
- backend env: Atlas(MongoDB), Node2 IP(Redis, MinIO), Node3 IP(ES, Kafka)

**Node2 (`infra/deploy/node2/docker-compose.yml`):**
```yaml
services:
  redis:        # --requirepass, --maxmemory 512mb, AOF
  minio:        # 프로덕션 credentials
  # Harbor는 별도 compose (infra/harbor/docker-compose.yml)
  # MongoDB Atlas 사용으로 로컬 MongoDB 불필요
```

**Node3 (`infra/deploy/node3/docker-compose.yml`):**
```yaml
services:
  elasticsearch:   # single-node, 1GB JVM
  kibana:          # ES 연동, 한국어
  kafka:           # KRaft 모드 (Controller + Broker, INTERNAL + EXTERNAL)
  price-producer:  # Harbor에서 pull
  news-producer:   # Harbor에서 pull
  indexer-consumer: # Harbor에서 pull
```

---

### Step 7: 환경 변수 파일

**프로덕션 템플릿** (`infra/deploy/.env.production.template`):
```bash
# VM IPs
NODE1_IP=192.168.x.x
NODE2_IP=192.168.x.x
NODE3_IP=192.168.x.x

# Harbor Registry
HARBOR_REGISTRY=${NODE2_IP}:8080
IMAGE_TAG=latest

# MongoDB Atlas (클라우드)
MONGODB_URL=mongodb+srv://user:pass@cluster/clouddx

# Redis (Node2)
REDIS_PASSWORD=<strong-password>
REDIS_URL=redis://:${REDIS_PASSWORD}@${NODE2_IP}:6379

# Elasticsearch (Node3)
ELASTICSEARCH_URL=http://${NODE3_IP}:9200

# Kafka (Node3)
KAFKA_BOOTSTRAP_SERVERS=${NODE3_IP}:9092

# MinIO (Node2)
MINIO_ENDPOINT=${NODE2_IP}:9000
MINIO_ROOT_USER=<admin>
MINIO_ROOT_PASSWORD=<strong-password>

# JWT
SECRET_KEY=<openssl rand -hex 64로 생성>
ALGORITHM=HS256

# CORS
CORS_ORIGINS=https://<DOMAIN>

# Debug
DEBUG=false
```

---

### Step 8: VM 초기 셋업 스크립트

> **파일**: `infra/deploy/scripts/setup-vm.sh`

VM이 아직 미준비이므로 아래를 자동화:
- Docker Engine + Docker Compose V2 플러그인 설치
- 방화벽(ufw) 규칙 설정 (VM 역할별로 다르게)
- Harbor insecure-registry 설정 (`/etc/docker/daemon.json`)
- sysctl 최적화 (`vm.max_map_count=262144` — ES 필수)
- swap 설정

---

### Step 9: 빌드/배포 스크립트

| 스크립트 | 용도 |
|----------|------|
| `build-and-push.sh` | 3개 이미지 빌드 → git SHA 태깅 → Harbor push |
| `deploy-node1.sh` | Node1: `docker compose pull` → `up -d` → 헬스체크 |
| `deploy-node2.sh` | Node2: Redis/MinIO 시작 → 헬스체크 |
| `deploy-node3.sh` | Node3: ES/Kafka/Workers 시작 → 헬스체크 |
| `healthcheck.sh` | 전체 VM 서비스 상태 일괄 확인 |
| `init-letsencrypt.sh` | certbot 초기 SSL 인증서 발급 |
| `self-signed.sh` | 자체 서명 인증서 생성 (내부망 대안) |

### 배포 플로우

```
개발 머신                  Node2 (Harbor)           각 VM
   │                          │                      │
   ├── docker build ──────────┤                      │
   ├── docker tag ────────────┤                      │
   ├── docker push ──────────→│ (이미지 저장)        │
   │                          │                      │
   │   deploy-node{1,2,3}.sh ─┤──────────────────────┤
   │                          │  docker compose pull ←┤
   │                          │                      ├── docker compose up -d
   │                          │                      ├── healthcheck
   │                          │                      └── 완료
```

---

## 6. 파일 변경 전체 목록

| # | 파일 경로 | 액션 | 단계 |
|---|-----------|------|------|
| 1 | `docker-compose.yml` → `docker-compose.dev.yml` | 이름변경 | Step 1 |
| 2 | `frontend/next.config.js` | **신규** | Step 2 |
| 3 | `frontend/Dockerfile` | **신규** | Step 2 |
| 4 | `frontend/.dockerignore` | **신규** | Step 2 |
| 5 | `backend/Dockerfile` | 수정 | Step 3 |
| 6 | `backend/.dockerignore` | **신규** | Step 3 |
| 7 | `backend/workers/Dockerfile` | 수정 | Step 3 |
| 8 | `backend/workers/.dockerignore` | **신규** | Step 3 |
| 9 | `backend/app/main.py` | 수정 | Step 4 |
| 10 | `nginx/nginx.conf` | 수정 | Step 5 |
| 11 | `infra/deploy/node1/docker-compose.yml` | **신규** | Step 6 |
| 12 | `infra/deploy/node2/docker-compose.yml` | **신규** | Step 6 |
| 13 | `infra/deploy/node3/docker-compose.yml` | **신규** | Step 6 |
| 14 | `infra/deploy/.env.production.template` | **신규** | Step 7 |
| 15 | `infra/deploy/node1/.env.node1.example` | **신규** | Step 7 |
| 16 | `infra/deploy/node2/.env.node2.example` | **신규** | Step 7 |
| 17 | `infra/deploy/node3/.env.node3.example` | **신규** | Step 7 |
| 18 | `infra/deploy/scripts/setup-vm.sh` | **신규** | Step 8 |
| 19 | `infra/deploy/scripts/build-and-push.sh` | **신규** | Step 9 |
| 20 | `infra/deploy/scripts/deploy-node1.sh` | **신규** | Step 9 |
| 21 | `infra/deploy/scripts/deploy-node2.sh` | **신규** | Step 9 |
| 22 | `infra/deploy/scripts/deploy-node3.sh` | **신규** | Step 9 |
| 23 | `infra/deploy/scripts/healthcheck.sh` | **신규** | Step 9 |
| 24 | `infra/deploy/ssl/init-letsencrypt.sh` | **신규** | Step 9 |
| 25 | `infra/deploy/ssl/self-signed.sh` | **신규** | Step 9 |

> **합계**: 신규 21개 + 수정 3개 + 이름변경 1개 = **25개 파일**

---

## 7. 현재 상태 vs 필요 상태

| 항목 | 현재 상태 | 필요 상태 | 해당 Step |
|------|-----------|-----------|-----------|
| Frontend Dockerfile | 없음 | 3-stage 멀티스테이지 빌드 | Step 2 |
| next.config.js | 없음 | `output: 'standalone'` | Step 2 |
| Backend Dockerfile | 단일스테이지, --reload | 멀티스테이지, --workers 4 | Step 3 |
| Workers Dockerfile | 단일스테이지, root | 멀티스테이지, non-root | Step 3 |
| .dockerignore | 없음 (3곳 모두) | node_modules, __pycache__ 등 제외 | Step 2,3 |
| CORS | 하드코딩 localhost | settings.CORS_ORIGINS 사용 | Step 4 |
| Health Check | 항상 200, traceback 노출 | 503 반환, traceback 제거 | Step 4 |
| Nginx | 기본 26줄 | SSL, 프록시 헤더, 캐싱, Rate limit | Step 5 |
| VM별 Compose | 없음 | Node1/2/3 각각 compose 파일 | Step 6 |
| 환경변수 | .env.example만 | VM별 .env + 프로덕션 템플릿 | Step 7 |
| VM 셋업 | 미준비 | Docker/방화벽/sysctl 자동화 | Step 8 |
| 배포 자동화 | 없음 | build-push-deploy 스크립트 | Step 9 |

---

## 8. 진행 시점

이 계획은 다음 조건이 충족된 후 실행합니다:

- [ ] 인증 시스템 완성 (로드맵 Phase 1)
- [ ] 핵심 프론트엔드 기능 완성
- [ ] 핵심 백엔드 API 완성
- [ ] 3대 VM 확보 및 네트워크 구성

---

## 9. 검증 체크리스트

### 로컬 검증 (VM 배포 전)
- [ ] `docker-compose.dev.yml`로 기존 개발환경 정상 동작
- [ ] `docker build`로 3개 이미지 빌드 성공
- [ ] 빌드된 이미지로 `docker run` 단독 테스트
- [ ] Next.js standalone 빌드 정상 동작

### VM 배포 검증
- [ ] `setup-vm.sh`로 Docker 설치 완료 (3대 모두)
- [ ] Harbor 이미지 push/pull 성공
- [ ] Node2: `redis-cli ping` → PONG
- [ ] Node2: MinIO 콘솔 접속 (`:9001`)
- [ ] Node3: `curl localhost:9200/_cluster/health` → green/yellow
- [ ] Node3: Kafka 토픽 리스트 조회 성공
- [ ] Node1: `curl https://<domain>/health` → `{"status": "healthy"}`
- [ ] Node1: 브라우저 → 프론트엔드 정상 렌더링
- [ ] `healthcheck.sh` → 전체 서비스 OK
