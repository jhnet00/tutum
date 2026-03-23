# OCR 인증 설정 가이드 (Quick Reference)

## 🎯 결론

**API Key 방식을 사용하세요.** Service Account JSON 키는 조직 정책으로 막힐 가능성이 높습니다.

---

## ✅ 권장: API Key 방식

### 1단계: API Key 생성

```bash
# GCP Console에서
1. https://console.cloud.google.com/apis/credentials 접속
2. "Create Credentials" → "API Key" 클릭
3. 생성된 키 복사
4. (선택) "Edit API Key" → "API restrictions" → "Cloud Vision API" 선택
```

### 2단계: 환경변수 설정

```bash
# .env 파일에 추가
GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 3단계: 완료

이제 `secrets/gcp_sa.json` 파일 없이도 OCR이 동작합니다.

---

## 🔧 옵션: Service Account JSON 방식

> ⚠️ **경고**: Organization Policy 제약으로 키 생성이 막힐 수 있습니다.

### 언제 사용?

- 조직 보안 정책상 API Key 사용이 금지된 경우
- 특정 IAM 권한 관리가 필요한 경우
- Workload Identity를 사용할 수 없는 환경

### 설정 방법

```bash
# 1. 서비스 계정 키 생성 (가능한 경우)
# GCP Console → IAM & Admin → Service Accounts → Keys → Add Key

# 2. JSON 파일 저장
mkdir -p secrets
mv ~/Downloads/your-project-xxxxx.json secrets/gcp_sa.json

# 3. 환경변수 설정
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp_sa.json

# 4. Docker Compose 볼륨 마운트
# docker-compose.yml에 추가:
#   volumes:
#     - ./secrets:/app/secrets:ro
```

---

## 🔍 인증 방식 우선순위

코드는 다음 순서로 자동 선택합니다:

```
1. GOOGLE_API_KEY 있음?
   → API Key 방식 사용 ✅

2. GOOGLE_APPLICATION_CREDENTIALS 있음?
   → Service Account JSON 방식 사용 🔧

3. 둘 다 없음?
   → 에러 발생 ❌
```

---

## 🚨 트러블슈팅

### "iam.disableServiceAccountKeyCreation" 에러

**원인**: 조직 정책으로 서비스 계정 키 생성 금지

**해결**: **API Key 방식** 사용 (위 권장 방법 참고)

### "Vision API error: PERMISSION_DENIED"

**원인**:

- Cloud Vision API 미활성화
- API Key 권한 부족

**해결**:

```bash
# 1. API 활성화
https://console.cloud.google.com/apis/library/vision.googleapis.com

# 2. API Key 제한 확인
# Console → Credentials → API Key 편집 → API restrictions 확인
```

### "Google Vision API 인증 설정이 필요합니다" 에러

**원인**: 환경변수 미설정

**해결**:

```bash
# .env 파일 확인
cat .env | grep GOOGLE_API_KEY

# 없으면 추가
echo "GOOGLE_API_KEY=your-key-here" >> .env
```

---

## 📝 체크리스트

- [ ] Cloud Vision API 활성화됨
- [ ] API Key 생성 완료
- [ ] `.env` 파일에 `GOOGLE_API_KEY` 추가
- [ ] Docker Compose 재시작 (`docker compose restart ocr-api`)
- [ ] Health check 확인 (`curl localhost:8002/health`)

---

## 📚 참고 링크

- [Cloud Vision API 문서](https://cloud.google.com/vision/docs)
- [API Key 생성 가이드](https://cloud.google.com/docs/authentication/api-keys)
- [Organization Policy 제약](https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints)
