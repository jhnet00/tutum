# OCR 기능 테스트 가이드

## 🎯 테스트 목표

프론트엔드(Next.js) → OCR API → MinIO → Kafka → OCR Worker 전체 플로우 검증

---

## 📋 사전 준비

### 1. 필수 서비스 실행

```bash
# MinIO (포트 9000)
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"

# Kafka (포트 9092)
# docker-compose.yml 사용 또는 별도 실행

# MongoDB (포트 27017)
docker run -d -p 27017:27017 --name mongo mongo:latest
```

### 2. 환경변수 확인

```bash
# .env 파일 확인
cat .env

# 필수 환경변수:
# GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# MINIO_ENDPOINT=localhost:9000
# KAFKA_BROKERS=localhost:9092
# MONGO_URI=mongodb://localhost:27017/tutum
```

---

## 🚀 서비스 실행

### 1. OCR API 서버 실행 (포트 8002)

```bash
# OCR API 디렉토리로 이동
cd backend/app/ocr-api

# 의존성 설치
pip install -r requirements.txt

# 서버 실행
python -m app.main

# 또는 uvicorn으로 실행
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

**예상 출력**:

```
🚀 OCR API 서버 시작 중...
✅ MinIO 버킷 확인: uploads
✅ Kafka 연결: localhost:9092
✅ OCR API 서비스 준비 완료
INFO:     Uvicorn running on http://0.0.0.0:8002
```

### 2. 프론트엔드 실행 (포트 3000)

```bash
# 프론트엔드 디렉토리로 이동
cd frontend

# 개발 서버 실행
npm run dev
```

**예상 출력**:

```
▲ Next.js 14.x.x
- Local:        http://localhost:3000
- Ready in 2.3s
```

---

## 🧪 테스트 시나리오

### Scenario 1: Health Check

```bash
# OCR API 상태 확인
curl http://localhost:8002/health

# 예상 응답:
{
  "status": "ok",
  "service": "ocr-api",
  "minio": "connected",
  "kafka": "connected"
}
```

### Scenario 2: 이미지 업로드 (cURL)

```bash
# 테스트 이미지 업로드
curl -X POST http://localhost:8002/import/ocr \
  -F "file=@test_screenshot.png" \
  -F "user_id=demo-user"

# 예상 응답:
{
  "import_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "OCR 처리 요청이 접수되었습니다",
  "object_key": "demo-user/550e8400.../550e8400....png"
}
```

### Scenario 3: Draft 결과 조회

```bash
# import_id를 위 응답에서 복사
curl http://localhost:8002/import/draft/550e8400-e29b-41d4-a716-446655440000

# 예상 응답 (Mock):
{
  "import_id": "550e8400-e29b-41d4-a716-446655440000",
  "raw_text": "삼성전자 15주\nSK하이닉스 8주",
  "items": [
    {"symbol": "삼성전자", "amount": 15, "avg_price": 72500},
    {"symbol": "SK하이닉스", "amount": 8, "avg_price": 128000}
  ],
  "status": "DRAFT"
}
```

### Scenario 4: 프론트엔드 E2E 테스트

1. **브라우저 접속**

   ```
   http://localhost:3000/ocr-insert/upload
   ```

2. **이미지 업로드**
   - 드래그 앤 드롭 또는 파일 선택
   - 테스트 이미지: 증권사 잔고 스크린샷 또는 임의 이미지

3. **AI 분석 시작 클릭**
   - 로딩 스피너 확인
   - 2초 대기 (OCR Worker 처리 시뮬레이션)

4. **결과 확인**
   - Step 2로 자동 이동
   - 테이블에 인식된 자산 정보 표시
   - 종목명, 보유량, 평단가 편집 가능

5. **등록하기 클릭**
   - `/portfolio/asset`로 리다이렉트

---

## 🔍 디버깅 포인트

### 1. MinIO 업로드 확인

```bash
# MinIO 웹 콘솔 접속
http://localhost:9001

# 로그인:
# Username: minioadmin
# Password: minioadmin

# uploads 버킷 확인
# 경로: demo-user/{import_id}/{filename}
```

### 2. Kafka 메시지 확인

```bash
# Kafka 토픽 메시지 확인
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic asset.import.request \
  --from-beginning

# 예상 메시지:
{
  "import_id": "...",
  "user_id": "demo-user",
  "object_key": "uploads/demo-user/...",
  "type": "OCR_IMAGE"
}
```

### 3. OCR API 로그 확인

```bash
# 터미널에서 실시간 로그 확인
# 업로드 시 출력:
✅ MinIO 업로드 완료: demo-user/550e8400.../550e8400....png
✅ Kafka 메시지 발행: 550e8400-e29b-41d4-a716-446655440000
```

### 4. 브라우저 개발자 도구

```javascript
// Console 탭에서 확인
✅ OCR 업로드 완료: {import_id: "...", status: "processing", ...}
✅ OCR 결과: {import_id: "...", items: [...], status: "DRAFT"}
```

---

## ⚠️ 트러블슈팅

### ❌ "MinIO 서비스 사용 불가"

**원인**: MinIO 미실행 또는 연결 실패

**해결**:

```bash
# MinIO 상태 확인
docker ps | grep minio

# MinIO 재시작
docker restart minio

# 연결 테스트
curl http://localhost:9000
```

### ❌ "Kafka 서비스 사용 불가"

**원인**: Kafka 미실행

**해결**:

```bash
# Kafka 상태 확인
docker ps | grep kafka

# Kafka 재시작 (docker-compose 사용 시)
docker-compose restart kafka
```

### ❌ "CORS 에러"

**원인**: 프론트엔드에서 OCR API 호출 시 CORS 차단

**해결**:

```python
# app/main.py에서 CORS 설정 확인
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# .env 파일에 추가
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### ❌ "이미지 파일만 업로드 가능합니다"

**원인**: 잘못된 파일 타입

**해결**:

- PNG, JPG, JPEG 파일 사용
- 파일 확장자 확인

---

## 📊 테스트 체크리스트

- [ ] MinIO 실행 및 연결 확인
- [ ] Kafka 실행 및 연결 확인
- [ ] MongoDB 실행 확인
- [ ] OCR API 서버 실행 (`http://localhost:8002/health` 응답)
- [ ] 프론트엔드 서버 실행 (`http://localhost:3000`)
- [ ] cURL로 이미지 업로드 성공
- [ ] MinIO 버킷에 파일 업로드 확인
- [ ] Kafka 토픽에 메시지 발행 확인
- [ ] Draft 결과 조회 성공
- [ ] 프론트엔드에서 이미지 업로드 성공
- [ ] Step 2에서 OCR 결과 표시 확인

---

## 🎉 성공 기준

1. ✅ 이미지 업로드 → MinIO 저장 완료
2. ✅ Kafka 메시지 발행 완료
3. ✅ Draft 결과 조회 성공
4. ✅ 프론트엔드에서 결과 표시

---

## 📚 다음 단계

- [ ] OCR Worker 실제 구현 (Google Vision API 연동)
- [ ] MongoDB draft_assets 컬렉션 저장
- [ ] 최종 confirm 엔드포인트 구현
- [ ] holdings 컬렉션 반영
- [ ] 에러 핸들링 강화
