# TUTUM OCR - Google Cloud Vision 설정 정보

## 🔐 프로젝트 정보

### GCP Organization

- **Organization Name**: rubyjeenkim-org
- **Organization ID**: 1038432125379

### GCP Project

- **Project ID**: project-8f796580-5382-4090-b08
- **Admin Service Account**: tutum-admin@project-8f796580-5382-4090-b08.iam.gserviceaccount.com

### API Key (OCR 전용)

- **Key Name**: ocr-api-tutum
- **API Key**: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

---

## 🛡️ 보안 설정

### API 제한 (API Restrictions)

- ✅ **Cloud Vision API만 허용**
- ❌ 다른 Google API 호출 차단

### 애플리케이션 제한 (Application Restrictions)

- ✅ **IP 주소 제한 활성화**
- 📍 팀원 로컬 개발 환경 IP만 허용
- 🚫 외부 IP 차단

---

## 📝 환경변수 설정

### .env 파일

```bash
# Google Vision API Key (API 제한 + IP 제한 설정됨)
GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Docker Compose

```yaml
services:
  ocr-api:
    environment:
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
```

---

## ✅ 인증 테스트

### 로컬 환경에서 테스트

```bash
# 1. 프로젝트 루트에서
cd backend/app/ocr-api

# 2. 의존성 설치 (필요시)
pip install -r ../../../requirements.txt
pip install python-dotenv

# 3. 인증 테스트 실행
python test_auth.py
```

### 예상 출력

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

## 🚨 트러블슈팅

### "PERMISSION_DENIED" 에러

**원인**: IP 주소가 허용 목록에 없음

**해결**:

1. GCP Console → Credentials → ocr-api-tutum 편집
2. Application restrictions → IP addresses 확인
3. 현재 IP 추가:
   ```bash
   curl ifconfig.me
   ```

### "API_KEY_INVALID" 에러

**원인**: API Key가 잘못되었거나 만료됨

**해결**:

1. `.env` 파일의 `GOOGLE_API_KEY` 값 확인
2. GCP Console에서 키 상태 확인
3. 필요시 새 키 생성

### "Cloud Vision API has not been used" 에러

**원인**: Cloud Vision API 미활성화

**해결**:

```bash
# GCP Console에서 활성화
https://console.cloud.google.com/apis/library/vision.googleapis.com?project=project-8f796580-5382-4090-b08
```

---

## 📊 사용량 모니터링

### API 사용량 확인

```bash
# GCP Console
https://console.cloud.google.com/apis/api/vision.googleapis.com/metrics?project=project-8f796580-5382-4090-b08
```

### 할당량 (Quota)

- **무료 할당량**: 월 1,000건
- **초과 시**: 건당 과금 ($1.50 / 1,000 units)

---

## 🔒 보안 체크리스트

- [x] API Key에 API 제한 설정 (Cloud Vision API만)
- [x] IP 주소 제한 활성화 (팀원 로컬만)
- [x] `.env` 파일 `.gitignore`에 포함
- [x] Service Account JSON 키 사용 안 함 (Organization Policy 준수)
- [ ] 프로덕션 배포 시 Secret Manager 사용 고려

---

## 📚 참고 링크

- [GCP Console - Project](https://console.cloud.google.com/home/dashboard?project=project-8f796580-5382-4090-b08)
- [API Credentials](https://console.cloud.google.com/apis/credentials?project=project-8f796580-5382-4090-b08)
- [Cloud Vision API](https://console.cloud.google.com/apis/library/vision.googleapis.com?project=project-8f796580-5382-4090-b08)
- [API Metrics](https://console.cloud.google.com/apis/api/vision.googleapis.com/metrics?project=project-8f796580-5382-4090-b08)
