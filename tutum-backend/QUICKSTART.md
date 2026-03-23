# ⚡ CloudDX 프로젝트 빠른 시작

## 🎯 5분 안에 시작하기

### 1️⃣ MongoDB Atlas 클러스터 생성 (1회만)

> **팀 리더만 수행** (팀원은 2️⃣부터 시작)

1. https://mongodb.com/cloud/atlas/register 가입
2. **Create Cluster** (무료 M0 선택)
3. **Database Access**: 사용자 생성 (`clouddx_admin`)
4. **Network Access**: `0.0.0.0/0` 허용 (개발 단계)
5. **Connect** → 연결 문자열 복사
6. 팀원들에게 연결 문자열 공유 (DM)

**자세한 가이드**: `MONGODB_ATLAS_SETUP.md` 참고

---

### 2️⃣ 프로젝트 설정

```bash
# 프로젝트 클론
git clone <repository-url> clouddx-project
cd clouddx-project

# 환경 변수 설정
cp .env.example backend/.env

# backend/.env 파일 수정
nano backend/.env
# MONGODB_URL을 Atlas 연결 문자열로 교체
```

**예시:**
```env
MONGODB_URL=mongodb+srv://clouddx_admin:YOUR_PASSWORD@clouddx-dev.abc123.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=clouddx
```

---

### 3️⃣ 백엔드 실행

**Terminal 1:**
```bash
cd backend

# 가상환경 생성 (처음 한 번만)
python3 -m venv venv

# 활성화
source venv/bin/activate  # Linux/Mac/WSL
# Windows: .\venv\Scripts\Activate.ps1

# 의존성 설치
pip install -r requirements.txt

# 서버 실행
uvicorn app.main:app --reload
```

**확인**: http://localhost:8000/docs

---

### 4️⃣ 프론트엔드 실행

**Terminal 2:**
```bash
cd frontend

# 의존성 설치
npm install

# 서버 실행
npm run dev
```

**확인**: http://localhost:3000

---

### 5️⃣ CSV 업로드 테스트

1. 브라우저: http://localhost:3000/bulk-insert/upload
2. CSV 템플릿 다운로드
3. 샘플 데이터 입력:
   ```csv
   symbol,name,quantity,average_price,currency
   BTC,비트코인,0.5,50000000,KRW
   AAPL,애플,10,150,USD
   ```
4. 업로드 → 데이터 확인 → 등록!

---

## 📚 더 알아보기

- **팀 협업 가이드**: `TEAM_SETUP_GUIDE.md`
- **Atlas 상세 설정**: `MONGODB_ATLAS_SETUP.md`
- **서버 실행 가이드**: `START_SERVERS.md`

---

## 🆘 문제 발생 시

```bash
# MongoDB 연결 테스트
curl localhost:8000/health

# 백엔드 로그 확인
cd backend && uvicorn app.main:app --reload --log-level debug

# 프론트엔드 캐시 삭제
cd frontend && rm -rf .next node_modules && npm install
```

---

**완료! 이제 개발을 시작하세요! 🚀**
