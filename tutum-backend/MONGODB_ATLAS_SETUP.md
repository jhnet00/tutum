# 🌐 MongoDB Atlas 설정 가이드

> **팀 전체가 하나의 클라우드 MongoDB를 사용합니다.**

---

## 🎯 왜 Atlas인가?

- ✅ 무료 티어 제공 (512MB, 팀 개발용 충분)
- ✅ 모든 팀원이 동일한 DB 접근 (설정 필요 없음)
- ✅ 자동 백업, 모니터링, 보안 기본 제공
- ✅ 로컬 MongoDB/Docker 설치 불필요

---

## 📋 Atlas 계정 생성 및 클러스터 설정

### 1️⃣ Atlas 가입

1. https://www.mongodb.com/cloud/atlas/register 접속
2. Google/GitHub 계정으로 가입 (또는 이메일)
3. 무료 플랜 선택 (Free Tier - M0)

### 2️⃣ 클러스터 생성

1. **Create a New Cluster** 클릭
2. 설정:
   - **Cloud Provider**: AWS (추천)
   - **Region**: Seoul (ap-northeast-2) 또는 Tokyo (ap-northeast-1)
   - **Cluster Tier**: M0 Sandbox (FREE)
   - **Cluster Name**: `clouddx-dev` (또는 원하는 이름)
3. **Create Cluster** 클릭 (생성까지 1-3분 소요)

### 3️⃣ 데이터베이스 사용자 생성

1. 좌측 메뉴: **Database Access** 클릭
2. **Add New Database User** 클릭
3. 설정:
   - **Authentication Method**: Password
   - **Username**: `clouddx_admin`
   - **Password**: 강력한 비밀번호 생성 (복사해두기!)
   - **Database User Privileges**: `Atlas admin` 또는 `Read and write to any database`
4. **Add User** 클릭

### 4️⃣ 네트워크 접근 허용

1. 좌측 메뉴: **Network Access** 클릭
2. **Add IP Address** 클릭
3. 옵션 선택:
   - **개발 중**: `Allow Access from Anywhere` (0.0.0.0/0) - 간편하지만 보안 주의
   - **보안 강화**: 팀원들의 IP만 추가 (각 팀원 IP를 개별 등록)
4. **Confirm** 클릭

### 5️⃣ 연결 문자열(Connection String) 복사

1. **Clusters** 메뉴로 돌아가기
2. 클러스터 이름 옆 **Connect** 버튼 클릭
3. **Connect your application** 선택
4. **Driver**: Python / **Version**: 3.6 or later 선택
5. **Connection String** 복사:
   ```
   mongodb+srv://clouddx_admin:<password>@clouddx-dev.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. `<password>` 부분을 실제 비밀번호로 교체

**예시:**
```
mongodb+srv://clouddx_admin:MySecurePass123!@clouddx-dev.abc123.mongodb.net/?retryWrites=true&w=majority
```

---

## 🔧 프로젝트에 Atlas 연결 설정

### 백엔드 `.env` 파일 수정

```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/backend
nano .env  # 또는 VSCode로 열기
```

**변경:**
```env
# MongoDB Atlas Configuration
MONGODB_URL=mongodb+srv://clouddx_admin:YOUR_PASSWORD@clouddx-dev.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=clouddx

# 나머지 설정은 그대로...
```

**중요**: 
- `YOUR_PASSWORD`를 실제 비밀번호로 교체
- `clouddx-dev.xxxxx.mongodb.net` 부분은 Atlas에서 복사한 URL 사용

### `.env.example` 업데이트

팀원들이 참고할 수 있도록:

```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project
nano .env.example
```

```env
# MongoDB Atlas (팀 공용)
# 연결 문자열은 팀 리더/DM에게 문의
MONGODB_URL=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=clouddx
```

---

## ✅ 연결 테스트

### Python으로 테스트

```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/backend

# pymongo 설치 (아직 안 했다면)
pip install pymongo dnspython

# 연결 테스트
python3 << 'EOF'
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
url = os.getenv("MONGODB_URL")

try:
    client = MongoClient(url, serverSelectionTimeoutMS=5000)
    client.admin.command('ping')
    print("✅ MongoDB Atlas 연결 성공!")
    print(f"데이터베이스 목록: {client.list_database_names()}")
except Exception as e:
    print(f"❌ 연결 실패: {e}")
EOF
```

**예상 출력:**
```
✅ MongoDB Atlas 연결 성공!
데이터베이스 목록: ['admin', 'local', 'clouddx']
```

### 백엔드 서버 실행 테스트

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

**확인:**
- 서버 시작 로그에 에러가 없어야 함
- http://localhost:8000/docs 접속 가능
- API 엔드포인트가 정상 작동

---

## 👥 팀원 공유 방법

### 옵션 1: 연결 문자열 직접 공유 (간단)

**안전하게 공유:**
- Slack/Discord DM으로 전송 (공개 채널 금지)
- 비밀번호 관리 도구 사용 (1Password, Bitwarden 등)

**팀원 작업:**
1. 프로젝트 클론
2. `backend/.env` 파일 생성
3. 받은 연결 문자열 붙여넣기
4. 백엔드/프론트엔드 실행

### 옵션 2: 환경변수로 주입 (보안 강화)

```bash
# 연결 문자열을 직접 파일에 저장하지 않고 환경변수로
export MONGODB_URL="mongodb+srv://..."
uvicorn app.main:app --reload
```

### 옵션 3: 각 팀원별 계정 생성 (최고 보안)

1. Atlas에서 각 팀원별로 Database User 생성
2. 읽기 전용, 읽기/쓰기 권한 분리
3. 각자 자신의 계정으로 연결

---

## 🗄️ 데이터베이스 관리

### Atlas UI에서 데이터 확인

1. Atlas 대시보드 → **Clusters** → **Browse Collections**
2. `clouddx` 데이터베이스 선택
3. 컬렉션(테이블) 목록 및 데이터 확인

### MongoDB Compass로 연결 (GUI 도구)

1. https://www.mongodb.com/products/compass 다운로드
2. Compass 실행 → 연결 문자열 붙여넣기
3. 데이터 시각화, 쿼리, 인덱스 관리 가능

### mongosh (CLI)로 연결

```bash
mongosh "mongodb+srv://clouddx_admin:PASSWORD@clouddx-dev.xxxxx.mongodb.net/"

# 연결 후
> use clouddx
> db.assets.find().pretty()
> db.assets.countDocuments()
```

---

## 📊 초기 데이터 설정 (선택사항)

### 시드 데이터 삽입

```bash
cd backend
python3 << 'EOF'
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
client = MongoClient(os.getenv("MONGODB_URL"))
db = client[os.getenv("MONGODB_DB_NAME")]

# 테스트 데이터 삽입
sample_assets = [
    {
        "symbol": "BTC",
        "name": "비트코인",
        "asset_type": "crypto",
        "quantity": 0.5,
        "average_price": 50000000,
        "currency": "KRW"
    },
    {
        "symbol": "AAPL",
        "name": "애플",
        "asset_type": "stock",
        "quantity": 10,
        "average_price": 150,
        "currency": "USD"
    }
]

db.assets.insert_many(sample_assets)
print(f"✅ {len(sample_assets)}개 자산 추가 완료")
print(f"총 자산 수: {db.assets.count_documents({})}")
EOF
```

---

## 🛡️ 보안 권장사항

### ✅ 해야 할 것

- 강력한 비밀번호 사용 (16자 이상, 특수문자 포함)
- `.env` 파일을 `.gitignore`에 추가 (이미 되어 있음)
- 정기적으로 비밀번호 변경 (3개월마다)
- 프로덕션용 클러스터는 별도로 분리

### ❌ 하지 말아야 할 것

- 연결 문자열을 Git에 커밋
- 공개 채널에 비밀번호 공유
- `0.0.0.0/0` IP 허용 후 방치 (프로덕션 금지)
- Atlas admin 계정을 모든 작업에 사용

---

## 💰 비용 관리

### Free Tier 제한

- **저장 공간**: 512MB
- **RAM**: 공유
- **동시 연결**: 제한 있음
- **백업**: 없음 (수동 export 필요)

**초과 시:**
- M2 (공유, $9/월) 또는 M10 (전용, $57/월)로 업그레이드 필요

### 사용량 모니터링

1. Atlas 대시보드 → **Metrics** 탭
2. 저장 공간, 연결 수, 작업량 확인
3. 알림 설정: 80% 도달 시 이메일

---

## 🔄 환경 분리 전략 (향후)

```
개발 (현재):
  └─ clouddx-dev 클러스터 (Free Tier)
     └─ clouddx 데이터베이스

스테이징 (배포 전 테스트):
  └─ clouddx-dev 클러스터
     └─ clouddx_staging 데이터베이스 (동일 클러스터 내 DB 분리)

프로덕션 (실서비스):
  └─ clouddx-prod 클러스터 (별도 유료 클러스터)
     └─ clouddx 데이터베이스
```

---

## 🚀 다음 단계

1. ✅ Atlas 클러스터 생성
2. ✅ 연결 문자열 획득
3. ✅ `backend/.env` 파일 수정
4. ✅ 연결 테스트 성공
5. ⏭️ 백엔드/프론트엔드 서버 실행
6. ⏭️ CSV 업로드 기능 테스트
7. ⏭️ 팀원들에게 연결 정보 공유

---

**이제 로컬 MongoDB 설치 없이 바로 개발 시작! 🎉**
