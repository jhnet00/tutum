# MongoDB 데이터베이스 설정 가이드

> CloudDX Asset Management Platform - 데이터베이스 구축 및 운영 지침

---

## 1. 개요

### 1.1 데이터베이스 정보

| 항목 | 값 |
|------|-----|
| **Provider** | MongoDB Atlas |
| **Cluster** | `tutum` |
| **Database** | `clouddx` |
| **Connection** | `mongodb+srv://tutum-admin:***@tutum.odoeunm.mongodb.net/` |

### 1.2 컬렉션 목록

```
clouddx/
├── users          # 사용자 계정
├── assets         # 보유 자산
├── portfolios     # 포트폴리오
├── news           # 뉴스 피드
├── transactions   # 거래 내역 (예정)
└── sessions       # 로그인 세션 (Redis 권장)
```

---

## 2. 컬렉션 스키마

### 2.1 users (사용자)

```javascript
{
  _id: ObjectId,
  email: String,              // unique, required
  password_hash: String,      // 소셜 로그인은 null
  nickname: String,           // required
  login_type: String,         // "email" | "google" | "kakao" | "naver"
  oauth_id: String,           // 소셜 로그인 ID
  marketing_opt_in: Boolean,  // default: false
  created_at: Date,
  updated_at: Date
}
```

### 2.2 assets (자산)

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,          // users._id 참조
  symbol: String,             // "005930", "BTC" 등
  name: String,               // "삼성전자"
  asset_type: String,         // "stock" | "crypto" | "etf"
  quantity: Number,
  average_price: Number,
  currency: String,           // "KRW" | "USD"
  exchange: String,           // "KRX" | "NASDAQ" | "Upbit"
  created_at: Date,
  updated_at: Date
}
```

### 2.3 portfolios (포트폴리오)

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,
  name: String,
  description: String,
  asset_ids: [ObjectId],      // assets._id 배열
  created_at: Date,
  updated_at: Date
}
```

### 2.4 news (뉴스)

```javascript
{
  _id: ObjectId,
  title: String,              // required
  body: String,               // 본문 (우선)
  content: String,            // 본문 (대체)
  source: String,             // 출처
  url: String,                // 원본 링크
  section: String,            // "증권" | "코인" | "경제"
  published_at: Date,
  created_at: Date
}
```

### 2.5 transactions (거래 내역) - 추가 예정

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,
  asset_id: ObjectId,
  type: String,               // "buy" | "sell"
  quantity: Number,
  price: Number,
  total_amount: Number,
  transaction_date: Date,
  created_at: Date
}
```

---

## 3. 인덱스 생성

### 3.1 MongoDB Shell 명령어

```javascript
use clouddx

// users 컬렉션
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ oauth_id: 1, login_type: 1 }, { unique: true, sparse: true })

// assets 컬렉션
db.assets.createIndex({ user_id: 1 })
db.assets.createIndex({ user_id: 1, symbol: 1 }, { unique: true })

// portfolios 컬렉션
db.portfolios.createIndex({ user_id: 1 })

// news 컬렉션
db.news.createIndex({ published_at: -1 })
db.news.createIndex({ section: 1 })

// transactions 컬렉션 (생성 시)
db.transactions.createIndex({ user_id: 1, transaction_date: -1 })
db.transactions.createIndex({ asset_id: 1 })
```

### 3.2 인덱스 확인

```javascript
db.users.getIndexes()
db.assets.getIndexes()
db.news.getIndexes()
```

---

## 4. 초기 설정

### 4.1 불필요한 데이터베이스 정리

```javascript
// MongoDB Shell
use sample_mflix
db.dropDatabase()
```

> [!WARNING]  
> `admin`, `local` 데이터베이스는 시스템용이므로 삭제하지 마세요.

### 4.2 환경 변수 설정

```bash
# backend/.env
MONGODB_URL=mongodb+srv://tutum-admin:clouddx@tutum.odoeunm.mongodb.net/?appName=tutum
MONGODB_DB_NAME=clouddx
```

---

## 5. 백엔드 코드 연동

### 5.1 database.py 구조

```python
# backend/app/database.py

def get_users_collection():
    return database["users"]

def get_assets_collection():
    return database["assets"]

def get_portfolios_collection():
    return database["portfolios"]

def get_news_collection():
    return database["news"]

# 추가 예정
def get_transactions_collection():
    return database["transactions"]
```

### 5.2 컬렉션 접근 패턴

```python
# 예시: 사용자 조회
from app.database import get_users_collection

users_col = get_users_collection()
user = await users_col.find_one({"email": email})
```

---

## 6. 데이터 마이그레이션

### 6.1 기존 tutum DB → clouddx DB 이전

```javascript
// 뉴스 데이터 이전 (필요시)
use tutum
db.news.find().forEach(function(doc) {
    db.getSiblingDB("clouddx").news.insertOne(doc);
});
```

### 6.2 데이터 검증

```javascript
use clouddx

// 각 컬렉션 문서 수 확인
db.users.countDocuments()
db.assets.countDocuments()
db.news.countDocuments()
```

---

## 7. 운영 가이드

### 7.1 백업

- **자동 백업**: MongoDB Atlas에서 Continuous Backup 활성화 (유료)
- **수동 백업**: `mongodump` 사용

```bash
mongodump --uri="mongodb+srv://..." --out=./backup_$(date +%Y%m%d)
```

### 7.2 모니터링

- **Atlas Dashboard**: 실시간 메트릭 확인
- **주요 지표**: 연결 수, 쿼리 성능, 스토리지 사용량

### 7.3 보안 체크리스트

- [ ] IP Whitelist 설정
- [ ] 사용자별 권한 분리 (readWrite, read)
- [ ] 비밀번호 주기적 변경
- [ ] 접근 로그 모니터링

---

## 8. 문제 해결

### 8.1 연결 오류

```
MongoServerError: bad auth
```

→ 비밀번호 또는 사용자명 확인, Atlas에서 IP Whitelist 확인

### 8.2 인덱스 중복 오류

```
E11000 duplicate key error
```

→ 해당 필드에 중복 데이터 존재, 정리 후 인덱스 재생성

### 8.3 속도 저하

1. `explain()` 으로 쿼리 분석
2. 누락된 인덱스 추가
3. 불필요한 필드 projection에서 제외

---

## 변경 이력

| 날짜 | 작성자 | 내용 |
|------|--------|------|
| 2026-02-03 | AI Assistant | 최초 작성 |
