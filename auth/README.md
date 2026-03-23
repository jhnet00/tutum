# TUTUM Auth Service

이 저장소는 기존 `tutum-backend`에서 분리된 인증/계정 관련 API를 운영합니다.

## 포함 범위

- `/api/v1/auth/*` 라우팅
- 회원가입/로그인/로그아웃
- JWT 토큰 발급 및 갱신
- 소셜 로그인(구글/카카오/네이버)
- 이메일 인증
- 프로필 조회/수정/비밀번호 변경

## 실행

```bash
cd auth
cp .env.example .env
python -m venv .venv
. .venv/Scripts/Activate.ps1   # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
curl http://localhost:8000/health
```

## 폴더 구조

- `app/main.py` : FastAPI app + 라이프사이클
- `app/routers/auth.py` : 인증 엔드포인트
- `app/config.py` : 설정
- `app/mariadb.py` : 사용자/포트폴리오 테이블 접근(회원 데이터)
- `app/database.py` : MongoDB 연결
- `app/cache.py` : Redis 연결/캐시 유틸
- `app/services/*` : 이메일/큐 연동
- `app/middleware/rate_limit.py` : 인증 라우트 제한

## 주의

- 기존 모놀리식 백엔드에서 `/api/v1/auth` 라우터는 제거되고,
  인증 클레임/사용자 식별은 토큰 기반으로 처리됩니다.
