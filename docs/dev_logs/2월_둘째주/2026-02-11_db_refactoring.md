# DB 리팩토링: auth.py MongoDB → MariaDB 전환 (2026-02-11)

## 작업 개요
- **작성자**: `kyk02405`
- **Branch**: `kyk/0211-DB-refactoring`
- **작업 내용**: 회원 인증 시스템을 MongoDB에서 MariaDB로 전환

---

## 1. 배경 및 문제점

### 기존 문제
- 회원 데이터가 MongoDB에 저장되어 `user_id`가 ObjectId 문자열 (예: `"507f1f77bcf86cd799439011"`)
- MariaDB 기반 Portfolio API에서 `int(user_id)` 호출 시 타입 불일치 에러
- `database.py`에 `get_users_collection()`, `get_db()` 함수 미정의 → import 에러

### 해결 방향
- **정형 데이터** (회원, 포트폴리오) → MariaDB
- **비정형 데이터** (뉴스, 거래 로그, 자산) → MongoDB
- `user_id`를 MariaDB 정수 기반 (`"123"`)으로 통일

---

## 2. 주요 변경 사항

### A. database.py - 누락 함수 추가
- `get_users_collection()` 추가 (deprecated 표시, 전환 기간 안전망)
- `get_db()` 추가 (assets.py에서 사용 중인 별칭)

### B. auth.py - MongoDB → MariaDB 전환 (핵심)

**제거된 의존성:**
- `from bson import ObjectId`
- `from ..database import get_users_collection`

**추가된 의존성:**
- `from ..mariadb import (get_user_by_email, get_user_by_id, create_user, update_user)`

**엔드포인트별 변경:**

| 엔드포인트 | 변경 전 (MongoDB) | 변경 후 (MariaDB) |
|---|---|---|
| `POST /register` | `users.insert_one()` | `mariadb_create_user()` |
| `POST /login` | `users.find_one({email})` | `get_user_by_email(email, "email")` |
| `GET /me` | ObjectId로 MongoDB 조회 | `get_user_by_id(int(sub))` |
| `Google callback` | MongoDB find/insert | `_oauth_find_or_create()` 공통 헬퍼 |
| `Kakao callback` | MongoDB find/insert | 동일 패턴 |
| `Naver callback` | MongoDB find/insert | 동일 패턴 |

**OAuth 리팩토링:**
- 3개 OAuth 콜백의 중복 코드를 공통 헬퍼 2개로 추출:
  - `_oauth_find_or_create(email, nickname, login_type)`: MariaDB 조회/생성
  - `_oauth_issue_token_and_redirect(user_id, email)`: JWT 발급 + 리다이렉트

---

## 3. user_id 흐름 (변경 후)

```
MariaDB User.id (int 123) → JWT sub="123" → current_user.id="123"
  → portfolio.py: int("123") = 123 ✅
  → assets.py: user_id="123" (MongoDB string) ✅
  → transactions.py: user_id="123" ✅
  → chat_service.py: int("123") = 123 ✅
```

---

## 4. 기존 토큰 호환

- 기존 MongoDB ObjectId 형식 JWT 토큰 → `int("507f1f...")` 실패 → 401 반환
- 사용자는 재로그인하면 새로운 MariaDB 기반 토큰 발급

---

## 5. 변경 파일 목록

| 파일 | 변경 유형 |
|------|-----------|
| `backend/app/database.py` | 수정 (누락 함수 2개 추가) |
| `backend/app/routers/auth.py` | 전면 개편 (MongoDB → MariaDB) |

---

## 6. 검증

- `py_compile` 문법 체크: auth.py, database.py, assets.py 모두 통과
- 서버 시작: `Application startup complete` (import 에러 없음)
- `GET /api/v1/auth/me`: 401 `{"detail":"Not authenticated"}` 정상 응답

---

**결론**: 회원 인증 시스템을 MongoDB에서 MariaDB로 성공적으로 전환. OAuth 콜백 코드 중복 제거 및 user_id 타입 통일(정수 문자열)로 Portfolio/Chat 등 하위 서비스와의 호환성 확보.
