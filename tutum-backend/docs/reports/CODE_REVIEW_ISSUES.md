# CloudDX 코드 전수 점검 결과

> 기준 코드: `develop` 브랜치 (2026-02-12, commit `12d882a`)
>
> 점검 범위: Backend (FastAPI) 전체 + Frontend (Next.js) 전체
>
> 총 발견 이슈: **55건** (Backend 28건 + Frontend 27건)

---

## 요약

| 심각도 | Backend | Frontend | 합계 |
|:------:|:-------:|:--------:|:----:|
| **Critical** | 4 | 9 | **13** |
| **High** | 8 | 14 | **22** |
| **Medium** | 11 | 4 | **15** |
| **Low** | 5 | 0 | **5** |
| **합계** | **28** | **27** | **55** |

---

## 1. CRITICAL — 즉시 수정 필요 (13건)

### Backend

#### B1. 헬스체크에서 Python Traceback 노출
- **파일**: `backend/app/main.py:106-111`
- **분류**: 보안
- **내용**: `/health` 에러 시 `traceback.format_exc()` 결과가 HTTP 응답에 그대로 포함됨
```python
return {
    "status": "error",
    "detail": str(e),
    "traceback": traceback.format_exc(),  # ← 내부 구조 노출
}
```
- **영향**: 공격자가 프레임워크 버전, 코드 구조, 내부 로직을 파악하여 표적 공격 가능
- **수정**: traceback 응답 제거, 내부 로그로만 기록

---

#### B2. OAuth 콜백 HTTP 타임아웃 없음
- **파일**: `backend/app/routers/auth.py:314, 375, 447`
- **분류**: 안정성 / K8s
- **내용**: Google/Kakao/Naver OAuth 콜백에서 `httpx.AsyncClient()`에 timeout 미지정
```python
async with httpx.AsyncClient() as client:  # ← timeout 없음
    token_res = await client.post(token_url, data=data)  # 무한 대기 가능
```
- **영향**: K8s Pod 종료 grace period 내 응답 불가 → 커넥션 쌓임 → Pod 비정상 종료
- **수정**: `httpx.AsyncClient(timeout=10.0)` 적용

---

#### B3. JWT Secret Key 하드코딩
- **파일**: `backend/app/config.py:58`
- **분류**: 보안
- **내용**: 기본 JWT 시크릿이 코드에 노출
```python
SECRET_KEY: str = "your-secret-key-change-in-production"
```
- **영향**: 코드 접근자 누구나 JWT 토큰을 위조하여 모든 사용자로 인증 가능
- **수정**: `.env` 파일에서만 로드, 기본값 제거 또는 앱 시작 시 검증 추가

---

#### B4. MongoDB/MariaDB ID 타입 불일치
- **파일**: `backend/app/routers/assets.py:103`, `transactions.py:45,120` 등 여러 라우터
- **분류**: 버그
- **내용**: MariaDB user_id(int→str) vs MongoDB asset_id(ObjectId→str) 혼용
```python
# auth.py: MariaDB int → str 변환
create_access_token({"sub": str(user_doc.id)})  # "123"

# assets.py: MongoDB에 str로 저장
{"user_id": current_user.id}  # "123" (문자열)

# assets.py: ObjectId로 조회
asset = await assets.find_one({"_id": ObjectId(asset_id), "user_id": user_id})
```
- **영향**: 크로스 컬렉션 쿼리 실패 가능, 데이터 불일치, ObjectId 생성 시 예외
- **수정**: user_id 타입 표준화 (문자열 통일 또는 int 통일), ObjectId 변환 전 검증 추가

---

### Frontend

#### F1. OAuth 콜백에서 URL 토큰 미검증
- **파일**: `frontend/app/auth/callback/page.tsx:17`
- **분류**: 보안
- **내용**: URL 파라미터의 토큰을 검증 없이 저장
```typescript
const token = searchParams.get('token');
sessionStorage.setItem('auth_token', token);  // 검증 없이 저장
document.cookie = `auth_token=${token}; path=/; SameSite=Lax`;
```
- **영향**: 공격자가 조작된 URL로 악성 토큰 주입 가능
- **수정**: 저장 전 Backend `/auth/me`로 토큰 유효성 검증

---

#### F2. 토큰이 여러 곳에 비안전하게 저장
- **파일**: `frontend/contexts/AuthContext.tsx:23-79`
- **분류**: 보안
- **내용**: 토큰이 sessionStorage + localStorage + cookie에 동시 저장, HttpOnly 없음
```typescript
sessionStorage.setItem('auth_token', token);
document.cookie = `auth_token=${token}; path=/; SameSite=Lax`;  // HttpOnly 없음
```
- **영향**: XSS 취약점이 하나라도 있으면 모든 저장소에서 토큰 탈취 가능
- **수정**: HttpOnly 쿠키 단일 저장으로 전환 (Backend에서 Set-Cookie)

---

#### F3. 쿠키 삭제 패턴 불완전
- **파일**: `frontend/contexts/AuthContext.tsx:75-83`
- **분류**: 보안
- **내용**: JS로 HttpOnly 쿠키 삭제 불가 → 로그아웃 후에도 토큰 잔존 가능
- **영향**: 로그아웃했는데 인증 쿠키가 남아있어 세션 하이재킹 위험
- **수정**: Backend `/auth/logout`에서 `Set-Cookie`로 쿠키 삭제 처리

---

#### F4. 인증 초기화 레이스 컨디션
- **파일**: `frontend/contexts/AuthContext.tsx:151-191`
- **분류**: 버그
- **내용**: `setToken()` 후 `fetchMe()` 비동기 실행 → 토큰 무효 시 상태 불일치
```typescript
if (savedToken) {
    setToken(savedToken);         // 즉시 실행
    await fetchMe(savedToken);    // 실패 가능 → 토큰은 이미 set됨
}
```
- **영향**: 만료된 토큰으로 인증된 것처럼 보이는 상태 발생
- **수정**: `fetchMe` 성공 후에만 `setToken` 호출

---

#### F5. 이벤트 리스너 미해제 (메모리 누수)
- **파일**: `frontend/app/confirm-input/page.tsx:84-85`
- **분류**: 버그
- **내용**: `mousemove`/`mouseup` 리스너가 cleanup 없이 계속 추가됨
```typescript
document.addEventListener('mousemove', onMouseMove);  // 해제 안 됨
document.addEventListener('mouseup', onMouseUp);       // 해제 안 됨
```
- **영향**: 리사이즈 반복 시 리스너 누적 → 점점 느려짐
- **수정**: `onMouseUp`에서 리스너 해제 또는 useEffect cleanup

---

#### F6. refreshPrices 무한 루프 가능
- **파일**: `frontend/context/AssetContext.tsx:329`
- **분류**: 버그
- **내용**: `refreshPrices`가 `holdings`에 의존하면서 `holdings`를 업데이트
```typescript
const refreshPrices = useCallback(async () => {
    // ... setHoldings(prev => ...) 호출
}, [holdings]);  // ← holdings 변경 → 콜백 재생성 → 무한 루프
```
- **영향**: 무한 API 호출 + 무한 재렌더링 → 브라우저 프리징
- **수정**: dependency에서 `holdings` 제거, `useRef`로 현재 값 참조

---

#### F7. 마크다운 렌더링 XSS 취약점
- **파일**: `frontend/components/chat/ChatMessages.tsx:40`
- **분류**: 보안
- **내용**: AI 응답을 sanitize 없이 마크다운 렌더링
```typescript
<ReactMarkdown>{content}</ReactMarkdown>  // HTML/스크립트 주입 가능
```
- **영향**: AI API 응답 조작 시 임의 스크립트 실행
- **수정**: `rehype-sanitize` 플러그인 추가

---

#### F8. 세션 만료 후에도 API 호출 계속됨
- **파일**: `frontend/contexts/AuthContext.tsx:227-238`
- **분류**: 인증
- **내용**: 타이머로 로그아웃하지만, 이미 진행 중인 API 호출은 취소되지 않음
- **영향**: 만료된 토큰으로 API 요청 계속 전송
- **수정**: AbortController로 진행 중인 요청 취소, 토큰 갱신 로직 추가

---

#### F9. OAuth CSRF 방어 없음
- **파일**: `frontend/app/login/page.tsx:98-115`
- **분류**: 보안
- **내용**: OAuth 리다이렉트에 `state` 파라미터 없음
```typescript
onClick={() => window.location.href = `${API_URL}/api/v1/auth/google/login`}
// state=<random_token> 없음
```
- **영향**: 공격자가 CSRF로 사용자의 OAuth 흐름을 조작 가능
- **수정**: 랜덤 state 토큰 생성 → 콜백에서 검증

---

## 2. HIGH — 프로덕션 배포 전 수정 (22건)

### Backend

| # | 파일 | 문제 | 설명 |
|---|------|------|------|
| B5 | `routers/assets.py:44` | asset_type Enum 미검증 | `str` 타입 → 임의 문자열 입력 가능. `Literal["stock","crypto","etf"]` 사용 필요 |
| B6 | `middleware/rate_limit.py:88` | Redis 다운 시 Rate Limit 우회 | `count is None → return True` (fail-open). fail-closed 또는 503 응답 필요 |
| B7 | `routers/auth.py:270` | OAuth 토큰 URL 쿼리 노출 | `?token=xxx` → 브라우저 히스토리, 리퍼러, 프록시 로그에 토큰 유출 |
| B8 | `routers/assets.py:335` | user_id 타입 불일치로 인가 우회 가능 | MongoDB 쿼리에서 타입 불일치 시 조건 미매칭 → null 반환 (인가 체크 무력화 가능) |
| B9 | `routers/portfolio.py:157-160` | ORM 속성 무제한 변경 | `**kwargs`로 `user_id`, `created_at` 등 보호 필드도 변경 가능 |
| B10 | `services/chat_service.py:375` | Bedrock 스트리밍 타임아웃 없음 | `invoke_model_with_response_stream`이 무한 블록 가능 → Pod hang |
| B26 | `main.py:86-112` | 헬스체크 Probe 미분리 | Liveness/Readiness 분리 필요. Redis 장애 시 전체 Pod unhealthy 판정됨 |
| B27 | `routers/chat.py:33-56` | SSE 스트리밍 graceful shutdown 없음 | Rolling update 시 진행 중인 채팅 스트림이 갑자기 끊김 |

### Frontend

| # | 파일 | 문제 | 설명 |
|---|------|------|------|
| F10 | `components/SellAssetDialog.tsx:77` | user_id URL 쿼리 노출 | `?user_id=xxx` → 개인정보 유출. Backend에서 JWT로 추출해야 함 |
| F11 | `app/confirm-input/page.tsx:149` | CSRF 토큰 없음 | 자산 등록 POST에 CSRF 방어 없음 |
| F12 | 여러 파일 | API URL 클라이언트 노출 | `NEXT_PUBLIC_API_URL`로 내부 인프라 정보 번들에 포함 |
| F13 | `contexts/AuthContext.tsx:196` | 로그인 Rate Limit 없음 | 클라이언트에서 무제한 로그인 시도 가능 (브루트포스) |
| F14 | `contexts/AuthContext.tsx:52-87` | 로그아웃 시 요청 미취소 | 진행 중인 fetch가 만료된 토큰으로 계속 전송됨 |
| F15 | 전체 fetch 호출 | **모든 fetch에 타임아웃 없음** | API 무응답 시 앱 프리징. `AbortSignal.timeout()` 필요 |
| F16 | `contexts/AuthContext.tsx` | Refresh Token 미구현 | 2시간 후 무조건 재로그인 → 작업 중 세션 끊김 |
| F17 | `app/login/page.tsx:26-35` | 로그인 후 라우터 에러 미처리 | `router.push()` 실패 시 로딩 상태에 머무름 |
| F18 | `app/portfolio/asset/page.tsx:15` | import 경로 불일치 | `context/AssetContext` vs `contexts/AuthContext` — 디렉토리명 불일치 |
| F19 | `components/MarketSnapshot.tsx:42-79` | API 에러를 데이터처럼 표시 | 시세 조회 실패 시 "Error" 텍스트가 가격처럼 표시됨 |
| F20 | `app/portfolio/asset/page.tsx:943` | 매도 후 하드 리로드 | `window.location.reload()` → `router.refresh()` + 데이터 refetch로 변경 필요 |
| F21 | `app/portfolio/trading-analysis/page.tsx:85` | response.ok 체크 없음 | 에러 응답을 정상 데이터로 처리 → UI에 에러 객체 표시 |
| F22 | `app/portfolio/asset/page.tsx:56-70` | JSON.parse try-catch 없음 | localStorage 데이터 손상 시 컴포넌트 크래시 |
| F23 | `components/MarketSnapshot.tsx:117-128` | 로딩/에러 UI 동일 | 로딩 중인지 에러인지 사용자가 구분 불가 |

---

## 3. MEDIUM (15건)

### Backend

| # | 파일 | 문제 |
|---|------|------|
| B11 | `services/exchange_rate.py:35` | 환율 하드코딩 (`USD: 1300.0`) — 실시간 아님 |
| B12 | `services/market_data.py:136` | Mock 데이터가 프로덕션에서 silent 반환 (사용자 인지 불가) |
| B13 | `services/chat_service.py:177` | 포트폴리오 조회 실패 시 빈 배열로 AI 전달 → 잘못된 분석 |
| B14 | `routers/assets.py` (BulkAssetCreate) | Bulk 등록 최대 개수 제한 없음 → DoS 가능 |
| B15 | `search.py:70` | ES 인덱스 `replicas=0` → 노드 장애 시 뉴스 검색 불가 |
| B16 | `services/alert_service.py:9` | 알림이 메모리에만 저장 → Pod 재시작 시 모두 소실 |
| B17 | `main.py:72-78` | CORS `allow_methods=["*"]` 과도하게 허용 |
| B18 | `routers/news.py:84-95` | 사용자 입력이 MongoDB `$regex`에 직접 삽입 → ReDoS 가능 |
| B19 | `main.py:53` | MarketMonitor 태스크 cancel 후 await 없음 → shutdown 레이스 |
| B28 | `mariadb.py:92` | `pool_size=5` → 프로덕션 트래픽에 부족할 수 있음 |

### Frontend

| # | 파일 | 문제 |
|---|------|------|
| F24 | 여러 파일 | 콘솔에 토큰/사용자 데이터 로깅 (DevTools에서 노출) |
| F25 | `components/MarketSnapshot.tsx:29` | API 실패 시 재시도 로직 없음 |
| F26 | 여러 파일 | API 포트(8000) 하드코딩 |
| F27 | `app/auth/callback/page.tsx:51` | OAuth 로딩 중 클릭 차단 없음 (이중 처리 가능) |
| F28 | `components/MarketSnapshot.tsx:117` | 로딩 스켈레톤과 에러 상태 UI가 동일 |

---

## 4. LOW (5건)

### Backend

| # | 파일 | 문제 |
|---|------|------|
| B20 | `routers/auth.py:32-38` | `REDIS_AVAILABLE` 플래그 정의 후 미사용 (Dead Code) |
| B21 | 여러 파일 | `print(f"DEBUG ...")` 문이 프로덕션 코드에 산재 |
| B22 | `database.py` | 주석 UTF-8 인코딩 깨짐 |
| B24 | `routers/portfolio.py:82-84` | MariaDB 에러 메시지가 클라이언트에 노출 |
| B25 | `models/transaction.py:40` | `transaction_date`에 미래 날짜 검증 없음 |

---

## 5. 즉시 조치 우선순위 TOP 10

| 순위 | 이슈 | 담당 | 작업 내용 | 난이도 |
|:---:|------|:----:|----------|:-----:|
| 1 | B3 | BE | JWT Secret `.env`에서만 로드, 기본값 제거, 앱 시작 시 검증 | 쉬움 |
| 2 | B1 | BE | 헬스체크 `traceback` 응답 제거 → 내부 로그만 | 쉬움 |
| 3 | B2 | BE | OAuth 콜백 `httpx.AsyncClient(timeout=10.0)` 추가 | 쉬움 |
| 4 | B6+B7 | BE | login/register Rate Limit 재적용 + OAuth 토큰 URL 노출 수정 | 보통 |
| 5 | F2+F3 | FE | 토큰 저장을 HttpOnly 쿠키 단일화 (Backend Set-Cookie 연동) | 보통 |
| 6 | F6 | FE | `refreshPrices` dependency에서 `holdings` 제거 | 쉬움 |
| 7 | F7 | FE | `ReactMarkdown`에 `rehype-sanitize` 추가 | 쉬움 |
| 8 | B26 | BE | `/health` (liveness) + `/ready` (readiness) 엔드포인트 분리 | 보통 |
| 9 | B9 | BE | portfolio update 허용 필드 화이트리스트 적용 | 쉬움 |
| 10 | B18 | BE | news 검색 쿼리 regex 특수문자 이스케이프 (`re.escape()`) | 쉬움 |

---

## 6. K8s 마이그레이션 전 필수 수정 사항

K8s 환경에서 특히 문제가 되는 항목들입니다.

| 이슈 | 문제 | K8s에서의 영향 |
|------|------|--------------|
| B2 | OAuth timeout 없음 | Pod graceful shutdown 실패 → 강제 종료 |
| B10 | Bedrock timeout 없음 | Pod hang → Probe 실패 → 재시작 루프 |
| B26 | 헬스체크 미분리 | Redis 장애 시 전체 Backend Pod unhealthy |
| B27 | SSE shutdown 없음 | Rolling update 시 채팅 중단 |
| B16 | 알림 메모리 저장 | Pod 재시작 시 데이터 소실 |
| B15 | ES replicas=0 | ES 노드 장애 시 뉴스 검색 전체 불가 |
| B19 | Monitor await 없음 | Shutdown 시 DB 쓰기 레이스 컨디션 |
| B28 | DB pool_size=5 | 트래픽 급증 시 커넥션 고갈 |
