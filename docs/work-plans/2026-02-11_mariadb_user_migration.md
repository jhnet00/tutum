# MariaDB 회원 정보 마이그레이션 계획

## 목표

현재 MongoDB에 저장된 모든 데이터를 분리:
- **MariaDB**: 회원 정보 (학원 제공 서버 활용)
- **MongoDB**: 뉴스 데이터 유지 (Bedrock RAG용)

## User Review Required

> [!IMPORTANT]
> **Breaking Changes**
> - 기존 MongoDB의 회원 데이터를 MariaDB로 마이그레이션해야 합니다
> - 마이그레이션 중 서비스 중단이 발생할 수 있습니다
> - **기존 JWT 토큰 전부 무효화**: `sub` 필드가 ObjectId → 정수 ID로 변경되므로, 기존 사용자는 반드시 재로그인 필요
> - Redis 세션 키 형식 변경: `session:507f1f77...` → `session:1`
> - 프론트엔드에서 localStorage 등에 저장된 `user_id`가 있다면 형식이 달라짐에 유의

> [!WARNING]
> **보안 주의사항**
> - MariaDB 접속 정보는 `.env` 파일에만 저장
> - `docs/guides/MariaDB.md`와 `.env` 파일은 절대 Git에 커밋하지 않도록 주의
> - 접속 정보는 `.env` 파일 및 DBeaver 참고 (이 문서에 비밀번호를 기록하지 말 것)

> [!CAUTION]
> **데이터 백업 필수**
> - MariaDB 마이그레이션 전 MongoDB 회원 데이터 백업 필요
> - 마이그레이션 실패 시 롤백 전략 필요

## Proposed Changes

### Backend - Database Layer

#### [NEW] [mariadb.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/mariadb.py)

**목적**: MariaDB 연결 및 SQLAlchemy 설정

```python
# SQLAlchemy 비동기 설정
# - AsyncEngine, AsyncSession 설정
# - User 테이블 모델 정의
# - 연결 초기화/종료 함수
```

**User 테이블 스키마**:
```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) DEFAULT NULL,  -- bcrypt hash (소셜 로그인은 NULL)
    nickname VARCHAR(100) NOT NULL,
    marketing_opt_in BOOLEAN DEFAULT FALSE,
    login_type ENUM('email', 'google', 'kakao', 'naver') DEFAULT 'email',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_login_type (login_type)
);
```

---

#### [MODIFY] [config.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/config.py)

**변경 내용**:
- MariaDB 연결 정보 추가
  ```python
  MARIADB_HOST: str = "211.46.52.153"
  MARIADB_PORT: int = 15432
  MARIADB_USER: str = "team3"
  MARIADB_PASSWORD: str
  MARIADB_DATABASE: str = "team3"
  ```

---

#### [MODIFY] [database.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/database.py)

**변경 내용**:
- `get_users_collection()` 함수 **제거** (MariaDB로 이동)
- MongoDB는 뉴스, 자산, 포트폴리오 데이터만 관리
- 주석 업데이트: "회원 정보는 MariaDB 사용"

---

### Backend - Authentication Layer

#### [MODIFY] [auth.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/routers/auth.py)

**변경 내용**:

1. **Import 변경**
   ```python
   # 제거
   from bson import ObjectId                    # MongoDB ObjectId 더 이상 불필요
   from ..database import get_users_collection

   # 추가
   from ..mariadb import get_user_by_email, create_user, update_user, get_user_by_id
   ```

2. **회원가입 (`/register`)**
   - MongoDB `insert_one()` → MariaDB `create_user()`
   - ObjectId → Auto Increment ID (정수)

3. **로그인 (`/login`)**
   - MongoDB `find_one()` → MariaDB `get_user_by_email()`

4. **현재 사용자 조회 (`get_current_user`)**
   - MongoDB `find_one({"_id": ObjectId(user_id)})` → MariaDB `get_user_by_id(int(user_id))`
   - `ObjectId()` 변환 제거, `int()` 변환으로 교체

5. **OAuth 콜백 (Google/Kakao/Naver)**
   - MongoDB `find_one()` → MariaDB `get_user_by_email()`
   - MongoDB `insert_one()` → MariaDB `create_user()`
   - MongoDB `update_one()` → MariaDB `update_user()`

6. **user_id 형식 통일**
   - `str(result.inserted_id)` (ObjectId) → `str(new_user.id)` (정수 문자열)
   - JWT `sub` 필드에 저장되는 값: `"507f1f77..."` → `"1"`, `"2"`, ...
   - `user_doc["_id"]` → `user.id` (SQLAlchemy 모델 속성)

---

### Backend - Dependencies

#### [MODIFY] [requirements.txt](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/requirements.txt)

**추가**:
```txt
# MariaDB
aiomysql==0.2.0              # MySQL/MariaDB 비동기 드라이버
sqlalchemy[asyncio]==2.0.25  # ORM
```

---

### Backend - Application Lifecycle

#### [MODIFY] [main.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/app/main.py)

**변경 내용**:

> 현재 코드는 `lifespan` async context manager 패턴을 사용하고 있음
> (`@app.on_event`는 deprecated이므로 사용하지 않음)

```python
from .mariadb import connect_to_mariadb, close_mariadb_connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시 연결
    await connect_to_mongodb()
    await connect_to_mariadb()   # 추가
    await connect_to_redis()
    # ... 기존 코드 ...
    yield
    # 종료 시 정리
    await close_mongodb_connection()
    await close_mariadb_connection()  # 추가
    await close_redis_connection()
```

---

### Data Migration

#### [NEW] [scripts/migrate_users_to_mariadb.py](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/scripts/migrate_users_to_mariadb.py)

**목적**: MongoDB 회원 데이터를 MariaDB로 마이그레이션

**기능**:
1. MongoDB `users` 컬렉션 전체 조회
2. MariaDB `users` 테이블에 INSERT
3. ObjectId → Auto Increment ID 매핑 딕셔너리 출력 (로그)
4. MongoDB `assets`, `portfolios` 컬렉션의 `user_id` 필드가 ObjectId를 참조하고 있다면, 새 정수 ID로 갱신 필요 여부 확인
5. 마이그레이션 결과 검증 (건수 비교, 이메일 일치 확인)

> **주의**: `assets`, `portfolios` 컬렉션이 `user_id`로 사용자를 참조하는 경우,
> 해당 필드도 새 MariaDB ID로 업데이트해야 합니다. 마이그레이션 전 반드시 확인할 것.

**실행 방법**:
```bash
cd backend
python -m scripts.migrate_users_to_mariadb
```

---

### Environment Variables

#### [MODIFY] [.env](file:///c:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/.env)

**추가**:
```env
# MariaDB (학원 제공 서버)
MARIADB_HOST=211.46.52.153
MARIADB_PORT=15432
MARIADB_USER=team3
MARIADB_PASSWORD=<docs/guides/MariaDB.md 또는 DBeaver 참고>
MARIADB_DATABASE=team3
```

> [!CAUTION]
> **절대 Git에 커밋하지 마세요!** `.gitignore`에 `.env` 포함 확인 필수

---

## Verification Plan

### 1. MariaDB 연결 테스트

**수동 테스트**:
```bash
# DBeaver에서 이미 연결 완료 (사용자 확인)
# 추가로 Python에서 연결 테스트
cd backend
python -c "from app.mariadb import connect_to_mariadb; import asyncio; asyncio.run(connect_to_mariadb())"
```

**예상 결과**: `SUCCESS: Connected to MariaDB: team3@211.46.52.153:15432`

---

### 2. User 테이블 생성 확인

**수동 테스트**:
```bash
# DBeaver에서 SQL 실행
SHOW TABLES;
DESCRIBE users;
```

**예상 결과**: `users` 테이블이 존재하고, 스키마가 계획대로 생성됨

---

### 3. 회원가입 API 테스트

**수동 테스트**:
```bash
# 백엔드 서버 실행
cd backend
uvicorn app.main:app --reload

# 다른 터미널에서 API 호출
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpass123",
    "nickname": "테스트유저",
    "marketing_opt_in": false
  }'
```

**예상 결과**: 
- 응답 200 OK
- MariaDB `users` 테이블에 데이터 INSERT 확인

---

### 4. 로그인 API 테스트

**수동 테스트**:
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpass123"
  }'
```

**예상 결과**:
- 응답 200 OK
- JWT 토큰 발급 확인

---

### 5. 데이터 마이그레이션 테스트

**수동 테스트**:
```bash
# 마이그레이션 스크립트 실행
cd backend
python -m scripts.migrate_users_to_mariadb

# MariaDB에서 확인
# DBeaver에서 SQL 실행
SELECT COUNT(*) FROM users;
```

**예상 결과**:
- MongoDB `users` 컬렉션 개수 == MariaDB `users` 테이블 개수
- 이메일, 닉네임 등 데이터 일치 확인

---

### 6. 프론트엔드 통합 테스트

**수동 테스트**:
1. 프론트엔드 실행: `cd frontend && npm run dev`
2. 브라우저에서 `http://localhost:3000` 접속
3. 회원가입 → 로그인 → 로그아웃 플로우 테스트
4. Google/Kakao/Naver OAuth 로그인 테스트

**예상 결과**:
- 모든 인증 플로우가 정상 작동
- MariaDB에 사용자 데이터 저장 확인

---

## 롤백 계획

마이그레이션 실패 시:
1. MongoDB `users` 컬렉션 백업 복원
2. `auth.py`에서 MariaDB 코드 제거, MongoDB 코드 복원
3. `database.py`에서 `get_users_collection()` 복원

---

## 참고 사항

- **MongoDB는 뉴스 데이터만 유지**: Bedrock RAG용으로 활용
- **MariaDB는 회원 정보만 관리**: 학원 제공 서버 활용
- **Redis는 그대로 유지**: 세션 캐싱, Rate Limiting, 토큰 블랙리스트

---

**작성자**: AI Assistant  
**작성일**: 2026-02-11
