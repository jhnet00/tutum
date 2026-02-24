# CloudDX (Tutum)

AI 기반 자산관리 플랫폼 프로젝트입니다.
국내/해외 주식, 코인, 뉴스, 알림, AI 분석을 하나의 서비스 흐름으로 통합하는 것을 목표로 합니다.

## 주요 구성

- 프론트엔드: Next.js 14 + TypeScript + Tailwind (`frontend`)
- 백엔드: FastAPI + MongoDB + MariaDB + Redis + Kafka 연계 (`backend`)
- OCR API: Google Vision 기반 자산 인식 서비스 (`backend/app/ocr-api`)
- 인프라: Docker Compose, Harbor/Kibana/MinIO 운영 파일 (`infra`, `scripts`)
- 문서: 정책/가이드/계획/리포트/개발로그 (`docs`)

## 빠른 시작 (로컬)

### 1. 저장소 클론

```bash
git clone https://github.com/kyk02405/clouddx-project.git
cd clouddx-project
```

### 2. 백엔드 실행

```bash
cd backend
python -m venv .venv
# Windows
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env  # macOS/Linux: cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

- Swagger: `http://localhost:8000/docs`
- 상태 확인: `http://localhost:8000/health`, `http://localhost:8000/ready`

### 3. 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

- 접속: `http://localhost:3000`

### 4. OCR API 실행(선택)

```bash
cd backend/app/ocr-api
python -m venv .venv
# Windows
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn ocr_app.main:app --reload --port 8002
```

## Docker Compose 실행

루트에서 전체 스택 실행:

```bash
docker compose up -d --build
```

기본 포트:

- Frontend: `3000`
- Backend: `8000`
- MongoDB: `27017`
- Redis: `6379`
- Kafka: `9092`
- MinIO API/Console: `9000` / `9001`

## 디렉토리 요약

```text
clouddx-project/
  frontend/              Next.js 앱
  backend/               FastAPI 백엔드
  backend/app/ocr-api/   OCR 전용 API
  infra/                 인프라 설정(Harbor/Kibana/MinIO)
  scripts/               배포/정리 스크립트
  docs/                  프로젝트 문서
  docker-compose.yml     통합 로컬 실행 파일
```

## 문서 바로가기

- 문서 인덱스: `docs/README.md`
- 협업 규칙: `docs/policies/00_COLLABORATION_RULES.md`
- 작업 계획: `docs/work-plans/`
- 개발 로그: `docs/dev_logs/`

## 주의 사항

1. 실제 비밀번호/키는 `.env`에만 보관하고 Git에 커밋하지 않습니다.
2. Docker/VM 운영 환경의 IP/계정 정보는 README 대신 별도 보안 채널에서 관리합니다.
3. 서버 내부 코드 직접 수정 대신 로컬 수정 → 커밋 → 배포 흐름을 사용합니다.
