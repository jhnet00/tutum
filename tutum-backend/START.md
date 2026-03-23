# 🚀 서버 시작 가이드

## 📋 사전 준비 (한 번만)

### 필수 설치
- Python 3.10+ 
- Node.js 18+
- Git

---

## 1️⃣ 백엔드 실행

### Terminal 1 (WSL 또는 Linux/Mac)

```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/backend

# 1. 가상환경 생성 (처음 한 번만)
python3 -m venv venv

# 2. 가상환경 활성화
source venv/bin/activate

# 3. pip 업그레이드 (처음 한 번만)
python -m pip install --upgrade pip

# 4. 의존성 설치 (처음 한 번만 또는 requirements.txt 변경 시)
pip install -r requirements.txt

# 5. 서버 실행
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**성공 메시지:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

**확인:**
- API 문서: http://localhost:8000/docs
- Health: http://localhost:8000/health

---

## 2️⃣ 프론트엔드 실행

### Terminal 2 (새 터미널 열기)

```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/frontend

# 1. 의존성 설치 (처음 한 번만)
npm install

# 2. 서버 실행
npm run dev
```

**성공 메시지:**
```
✓ Ready in 2.5s
○ Local: http://localhost:3000
```

**확인:**
- 웹사이트: http://localhost:3000
- CSV 업로드: http://localhost:3000/bulk-insert/upload

---

## 3️⃣ CSV 업로드 테스트

### 브라우저에서 http://localhost:3000/bulk-insert/upload 접속

1. **Step 1-2**: CSV 템플릿 다운로드 (선택사항)

2. **Step 3**: CSV 파일 준비
   ```csv
   symbol,name,quantity,average_price,currency,exchange_rate,transaction_type,transaction_date,account_name
   BTC,비트코인,0.5,50000000,KRW,1,매수,2024-01-01,업비트
   AAPL,애플,10,150,USD,1300,매수,2024-01-02,미국계좌
   005930,삼성전자,50,70000,KRW,1,매수,2024-01-03,한국투자증권
   ```

3. **파일 업로드** → 자동 파싱 → Step 4로 이동

4. **Step 4**: 데이터 확인/수정
   - 그리드에서 직접 편집 가능
   - 심볼 변경 시 자산 타입/통화 자동 감지
   - 행 추가/삭제 가능

5. **등록 버튼 클릭** → MongoDB Atlas에 저장 완료!

---

## 🗄️ 데이터 확인

### MongoDB Atlas UI
1. https://cloud.mongodb.com 로그인
2. **Browse Collections** 클릭
3. `clouddx` 데이터베이스 → `assets` 컬렉션 확인

### MongoDB Compass (GUI 도구)
1. Compass 다운로드: https://mongodb.com/products/compass
2. 연결 문자열 입력:
   ```
   mongodb+srv://tutum-admin:clouddx@tutum.odoeunm.mongodb.net/?appName=tutum
   ```
3. Connect → clouddx 데이터베이스 선택

---

## 🛑 서버 중지

### 백엔드 중지
- Terminal 1에서 `Ctrl + C`
- 가상환경 종료: `deactivate`

### 프론트엔드 중지  
- Terminal 2에서 `Ctrl + C`

---

## 🔄 다음번 실행 (간단)

### 백엔드
```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/backend
source venv/bin/activate
uvicorn app.main:app --reload
```

### 프론트엔드
```bash
cd /mnt/c/Users/CloudDX/Desktop/clouddx-project/frontend
npm run dev
```

---

## 🐛 문제 해결

### "ModuleNotFoundError: No module named 'xxx'"
```bash
# 가상환경 활성화 확인
which python  # venv/bin/python이어야 함

# 의존성 재설치
pip install -r requirements.txt
```

### "Port 8000 already in use"
```bash
# 기존 프로세스 종료
lsof -ti:8000 | xargs kill -9  # Linux/Mac
# Windows: netstat -ano | findstr :8000
```

### "MongoDB connection failed"
```bash
# .env 파일 확인
cat backend/.env

# 연결 문자열이 정확한지 확인
# MONGODB_URL=mongodb+srv://tutum-admin:clouddx@tutum.odoeunm.mongodb.net/?appName=tutum
```

### 프론트엔드 빌드 오류
```bash
cd frontend
rm -rf .next node_modules
npm install
npm run dev
```

---

## ✅ 체크리스트

- [ ] 백엔드 가상환경 생성 완료
- [ ] 백엔드 의존성 설치 완료
- [ ] 백엔드 서버 실행 성공 (http://localhost:8000/docs 접속 가능)
- [ ] 프론트엔드 의존성 설치 완료
- [ ] 프론트엔드 서버 실행 성공 (http://localhost:3000 접속 가능)
- [ ] CSV 업로드 페이지 접속 가능
- [ ] 테스트 데이터 업로드 성공
- [ ] MongoDB Atlas에서 데이터 확인 완료

---

**모든 준비 완료! 이제 개발을 시작하세요! 🎉**
