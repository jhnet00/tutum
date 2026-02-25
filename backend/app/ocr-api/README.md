# OCR API Service

`backend/app/ocr-api`는 이미지에서 텍스트를 추출해 자산 정보를 파싱하는 OCR 전용 API입니다.
현재 FastAPI + Google Vision + MinIO 연계 구조로 동작합니다.

## 기본 정보

- 기본 포트: `8002`
- 엔트리: `ocr_app.main:app`
- 주요 기능:
  - 이미지 업로드
  - OCR 텍스트 추출
  - 파싱 결과(Draft) 조회

## 환경 변수

이 서비스는 실행 시 `backend/.env`를 로드합니다.

주요 변수:

- `MONGODB_URL`
- `KAFKA_BROKERS`
- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_OCR` (미설정 시 기본값 `ocr-images`)
- `MOCK_MODE` (`true`면 목업 결과 반환)
- `GOOGLE_API_KEY` 또는 `GOOGLE_APPLICATION_CREDENTIALS`

## 로컬 실행

```bash
cd backend/app/ocr-api
python -m venv .venv
# Windows
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn ocr_app.main:app --reload --port 8002
```

확인:

- Health: `http://localhost:8002/health`

## 인증 점검 스크립트

Google Vision 설정 확인:

```bash
cd backend/app/ocr-api
python test_auth.py
```

## API 엔드포인트

### 1) Health

```http
GET /health
```

### 2) OCR 업로드

```http
POST /import/ocr
Content-Type: multipart/form-data
```

필드:

- `file`: 이미지 파일
- `user_id`: 사용자 식별자

### 3) Draft 조회

```http
GET /import/draft/{import_id}
```

## 동작 방식 요약

1. 업로드 이미지 수신
2. MinIO 저장 시도(실패 시 메모리 fallback)
3. OCR 처리 후 결과 캐시 저장
4. `import_id`로 결과 조회

## 문제 해결

1. `Google Vision API 인증 설정이 필요합니다` 오류
- `GOOGLE_API_KEY` 또는 `GOOGLE_APPLICATION_CREDENTIALS` 확인

2. MinIO 저장 실패
- `MINIO_ENDPOINT`, 접근 키, 버킷 권한 확인
- 실패 시 메모리 fallback으로 동작할 수 있으나 재시작 시 데이터는 유지되지 않음

3. CORS/프론트 연동 오류
- 프론트 URL, 포트, 프록시 경로를 함께 점검

## 관련 문서

- 백엔드 개요: `../../../README.md`
- 백엔드 README: `../../README.md`
- 문서 인덱스: `../../../docs/README.md`
