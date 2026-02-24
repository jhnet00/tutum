# 개발 작업 완료 보고서 (2026-02-13)

## 작업 개요
**작성자**: `kyk02405`
**Branch**: `kyk/0213`
**작업 내용**: 코드 리뷰 잔여 이슈 수정 및 trailing slash 통일, OAuth/프록시/AI 채팅 오류 해결

---

## 1. 주요 변경 사항

### 1-1. 코드 리뷰 이슈 수정 (CODE_ISSUES_REPORT.md 기반)

| 이슈 | 상태 | 수정 내용 |
|------|------|-----------|
| F22 JSON.parse 오류 처리 | 완료 | localStorage 파싱 실패 시 corrupted 데이터 삭제 |
| #18 비밀번호 복잡도 검증 | 완료 | Pydantic field_validator 추가 (대소문자/숫자/특수문자 필수) |
| #13 Kafka Producer 재연결 | 완료 | exponential backoff 재연결 로직, print -> logger 전환 |
| #15 환경변수 유효성 검사 | 완료 | model_validator로 SECRET_KEY, MARIADB_PASSWORD 필수 검증 |

#### F22 상세 - JSON.parse 오류 시 localStorage 정리
- `frontend/context/FavoritesContext.tsx` - `tutum_favorites` 제거
- `frontend/app/direct-input/page.tsx` - `pending_assets` finally 블록에서 제거
- `frontend/app/confirm-input/page.tsx` - `pending_assets` catch 블록에서 제거
- `frontend/app/portfolio/asset/page.tsx` - `tutum_dashboard_order` 제거

#### #18 상세 - 비밀번호 복잡도
- `backend/app/routers/auth.py`의 `UserCreate` 모델에 `field_validator` 추가
- 규칙: 8~128자, 대문자/소문자/숫자/특수문자 각 1자 이상 필수

#### #13 상세 - Kafka Producer 재연결
- `backend/workers/price_producer.py`, `backend/workers/news_producer.py`
- `create_producer()` 함수 추가 (exponential backoff, MAX_RECONNECT_DELAY=60s)
- 전체 `print()` -> `logging.getLogger(__name__)` 전환

#### #15 상세 - 환경변수 검증
- `backend/app/config.py`의 `Settings` 클래스에 `model_validator(mode="after")` 추가
- 필수: `SECRET_KEY`, `MARIADB_PASSWORD` (미설정 시 ValueError)
- 경고: AWS 키, OAuth Client ID 등 (미설정 시 warning 로그)

---

### 1-2. Trailing Slash 통일 (무한 리다이렉트 루프 해결)

**문제**: Next.js는 308로 trailing slash를 제거하고, FastAPI는 307로 다시 추가하여 무한 루프 발생

**해결**:
1. `backend/app/main.py` - `redirect_slashes=False` 설정
2. 모든 백엔드 라우터 `"/"` -> `""` 변경:
   - `backend/app/routers/portfolio.py` (GET, POST)
   - `backend/app/routers/chat.py` (POST)
   - `backend/app/routers/assets.py` (GET, POST)
   - `backend/app/routers/news.py` (GET)
   - `backend/app/routers/notifications.py` (GET)
   - `backend/app/routers/transactions.py` (GET, POST)
3. 프론트엔드 API 호출 trailing slash 제거:
   - `frontend/context/AssetContext.tsx` - `/api/v1/portfolio/` -> `/api/v1/portfolio`
   - `frontend/hooks/useChat.ts` - `/api/v1/chat/` -> `/api/v1/chat`
   - `frontend/app/api/public/news/route.ts` - `/api/v1/news/` -> `/api/v1/news`

---

### 1-3. OAuth 로그인 수정

**문제 1**: API Proxy에서 `redirect: "follow"` 사용 시 Google OAuth 리다이렉트를 프록시가 내부적으로 따라가 200(HTML)을 반환

**문제 2**: 프록시 경유 OAuth 시 state 쿠키가 `localhost:3000`에 설정되나, Google 콜백은 `localhost:8000`으로 돌아와 쿠키 불일치

**해결**:
- `frontend/app/api/proxy/[...path]/route.ts`
  - `redirect: "manual"` 유지 + 내부/외부 리다이렉트 분기 처리
  - 내부 리다이렉트: `/api/proxy` 경로로 rewrite
  - 외부 리다이렉트 (OAuth provider): 그대로 pass-through
- `frontend/app/login/page.tsx`
  - OAuth URL을 `BACKEND_URL`(localhost:8000)로 직접 이동하도록 변경
  - state 쿠키가 backend 도메인에 정상 설정됨

---

### 1-4. 기타 버그 수정

- `backend/app/services/alert_service.py`
  - `logger = logging.getLogger(__name__)` 누락으로 인한 `NameError` 수정
  - 서버 shutdown 시 크래시 방지

---

## 2. 버그 수정 이력

| 증상 | 원인 | 해결 |
|------|------|------|
| Google OAuth 클릭 시 `net::ERR_FAILED 200` | 프록시가 redirect를 follow하여 Google HTML 반환 | `redirect: "manual"` + 외부 리다이렉트 pass-through |
| Google 계정 선택 후 `OAuth state 불일치` | state 쿠키 도메인 불일치 (3000 vs 8000) | OAuth URL을 백엔드 직접 호출로 변경 |
| 포트폴리오 `Failed to fetch` | Next.js 308 <-> FastAPI 307 무한 루프 | `redirect_slashes=False` + 라우터/프론트 trailing slash 통일 |
| AI 채팅 응답 없음 | `chat.py`의 `@router.post("/")` 미매칭 | `""` 로 변경 + 프론트 trailing slash 제거 |
| 서버 shutdown 시 NameError 크래시 | `alert_service.py`에 logger 미정의 | logger 인스턴스 추가 |

---

## 3. UI 스크린샷

> UI 변경 없음 (백엔드/인프라/API 수정 위주)

---

## 4. 커밋 내역

```
a8ddd97 fix: 코드 리뷰 이슈 수정 및 trailing slash 통일
```

---

## 5. 검증 결과

- `/api/v1/news` (trailing slash 없음) -> 200 OK
- `/api/v1/assets` -> 401 (인증 필요, 라우트 매칭 정상)
- `/api/v1/portfolio` -> 401 (인증 필요, 라우트 매칭 정상)
- `/api/v1/chat` -> 401 (인증 필요, 라우트 매칭 정상)
- OAuth 로그인 -> 백엔드 직접 이동, state 쿠키 정상

---

**결론**: 코드 리뷰 잔여 이슈(F22, #13, #15, #18) 해결 완료. Trailing slash 정책 통일로 Next.js-FastAPI 간 무한 리다이렉트 루프 해결. OAuth 로그인 흐름을 프록시 경유에서 백엔드 직접 호출로 전환하여 state 쿠키 문제 해결.
