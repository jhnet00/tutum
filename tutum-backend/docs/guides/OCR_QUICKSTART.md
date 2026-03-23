# 🚀 OCR 기능 빠른 시작 가이드

## 1️⃣ 환경 설정 (1분)

### .env 파일 확인

```bash
# 프로젝트 루트에 .env 파일이 있는지 확인
cat .env | grep GOOGLE_API_KEY

# 출력 예시:
# GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

✅ **이미 설정되어 있습니다!** 추가 작업 불필요.

---

## 2️⃣ 인증 테스트 (30초)

```bash
# OCR API 디렉토리로 이동
cd backend/app/ocr-api

# 테스트 실행
python test_auth.py
```

### 예상 결과

```
============================================================
Google Vision API 인증 설정 확인
============================================================

📋 환경변수 상태:
  - GOOGLE_API_KEY: ✅ 설정됨
    값: AIzaSyDpNa5olVThLb...IPZM
  - GOOGLE_APPLICATION_CREDENTIALS: ❌ 없음

============================================================

🔧 Vision API 클라이언트 생성 시도...
✅ 성공! Vision API 클라이언트가 정상적으로 생성되었습니다.
📌 사용된 인증 방식: API Key (권장)

============================================================
✅ 모든 인증 설정이 올바르게 구성되었습니다!
============================================================
```

---

## 3️⃣ OCR 서비스 실행

### Docker Compose로 실행 (권장)

```bash
# 프로젝트 루트에서
docker compose up -d ocr-api

# 로그 확인
docker logs -f tutum-ocr-api
```

### 로컬 개발 모드

```bash
# 의존성 설치
pip install -r backend/requirements.txt

# OCR API 서버 실행
cd backend/app/ocr-api
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

---

## 4️⃣ Health Check

```bash
# API 상태 확인
curl http://localhost:8002/health

# 예상 응답:
# {"status": "ok"}
```

---

## 5️⃣ OCR 테스트 (실제 이미지 업로드)

### 테스트 이미지 준비

```bash
# 스크린샷 또는 테스트 이미지 준비
# 예: test_screenshot.png
```

### OCR 요청

```bash
curl -X POST http://localhost:8002/import/ocr \
  -F "file=@test_screenshot.png" \
  -F "user_id=demo-user"
```

### 예상 응답

```json
{
  "import_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "OCR job submitted to Kafka"
}
```

---

## 🔍 트러블슈팅

### ❌ "PERMISSION_DENIED" 에러

**원인**: 현재 IP가 허용 목록에 없음

**해결**:

```bash
# 1. 현재 IP 확인
curl ifconfig.me

# 2. GCP Console에서 IP 추가
# https://console.cloud.google.com/apis/credentials?project=project-8f796580-5382-4090-b08
# ocr-api-tutum 편집 → IP addresses에 추가
```

### ❌ "ModuleNotFoundError: No module named 'dotenv'"

**해결**:

```bash
pip install python-dotenv
```

### ❌ "Vision API has not been used"

**해결**:

```bash
# Cloud Vision API 활성화
# https://console.cloud.google.com/apis/library/vision.googleapis.com?project=project-8f796580-5382-4090-b08
```

---

## 📊 현재 설정 요약

| 항목                | 값                             |
| ------------------- | ------------------------------ |
| **인증 방식**       | API Key (권장)                 |
| **API Key 이름**    | ocr-api-tutum                  |
| **API 제한**        | Cloud Vision API만 허용        |
| **IP 제한**         | 팀원 로컬 IP만 허용            |
| **Service Account** | 사용 안 함 (Org Policy 제약)   |
| **프로젝트 ID**     | project-8f796580-5382-4090-b08 |

---

## 📚 추가 문서

- [OCR API 전체 가이드](../../backend/app/ocr-api/README.md)
- [GCP Vision 설정 상세](./GCP_VISION_CONFIG.md)
- [OCR 인증 가이드](./OCR_AUTH_GUIDE.md)

---

## ✅ 체크리스트

- [ ] `.env` 파일에 `GOOGLE_API_KEY` 설정됨
- [ ] `python test_auth.py` 성공
- [ ] `docker compose up -d ocr-api` 실행
- [ ] `curl localhost:8002/health` 응답 확인
- [ ] 테스트 이미지로 OCR 요청 성공

---

**🎉 모든 설정이 완료되었습니다! OCR 기능을 사용할 준비가 되었습니다.**
