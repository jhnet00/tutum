# Tutum Backend

CloudDX(Tutum) 백엔드 API 서버입니다.
FastAPI 기반으로 인증, 자산/포트폴리오, 시세, 뉴스, 알림, AI 채팅 API를 제공합니다.

## 기술 스택

- Python 3.11+
- FastAPI / Uvicorn
- MongoDB (주요 도메인 데이터)
- MariaDB (회원/인증 연계)
- Redis (캐시)
- Kafka / Elasticsearch (파이프라인 연계)

## 실행 전 준비

백엔드는 시작 시 MongoDB, MariaDB, Redis 연결을 시도합니다.
로컬 실행 시 아래 서비스 접근 정보가 `.env`에 있어야 합니다.

필수 항목:

- `SECRET_KEY`
- `MARIADB_PASSWORD`
- `MONGODB_URL`
- `REDIS_URL`

기본 예시는 `backend/.env.example` 참고 후 `backend/.env`로 복사해 사용하세요.

## 로컬 실행

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

확인 URL:

- Swagger: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`
- Ready: `http://localhost:8000/ready`

## API 구조

기본 prefix:

- `/api/v1`

주요 라우터:

- `/api/v1/auth`
- `/api/v1/assets`
- `/api/v1/transactions`
- `/api/v1/portfolio`
- `/api/v1/market`
- `/api/v1/news`
- `/api/v1/notifications`
- `/api/v1/chat`
- `/api/v1/exchange-rate`

최근 추가:

- `GET /api/v1/market/search` (종목/코인 검색)

## 테스트/유틸 스크립트

백엔드 루트에 점검용 스크립트가 있습니다.

예시:

```bash
python test_local_api.py
python test_new_endpoints.py
python test_upbit_public.py
```

## Docker 실행

루트에서 전체 스택 실행:

```bash
docker compose up -d --build backend
```

또는 전체 서비스:

```bash
docker compose up -d --build
```

## 디렉토리 요약

```text
backend/
  app/
    main.py               FastAPI 엔트리
    config.py             환경 변수 설정
    routers/              API 라우터
    services/             비즈니스 로직
    models/               Pydantic 모델
    ocr-api/              OCR 전용 서비스
  workers/                Kafka/이메일 워커
  scripts/                DB 마이그레이션 스크립트
  requirements.txt
```

## 관련 문서

- 루트 개요: `../README.md`
- 프론트엔드 가이드: `../frontend/README.md`
- OCR API 가이드: `./app/ocr-api/README.md`
- 문서 인덱스: `../docs/README.md`
