# 🧪 OCR 기능 브라우저 테스트 가이드

## ✅ 서비스 실행 상태

| 서비스                 | 포트 | 상태       | 모드          |
| ---------------------- | ---- | ---------- | ------------- |
| **Next.js 프론트엔드** | 3000 | ✅ 실행 중 | -             |
| **OCR API**            | 8002 | ✅ 실행 중 | **Mock 모드** |

### OCR API Health Check 결과

```json
{
  "status": "ok",
  "service": "ocr-api",
  "mock_mode": true,
  "minio": "disconnected",
  "kafka": "disconnected"
}
```

---

## 🎯 테스트 시나리오

### 1단계: OCR 업로드 페이지 접속

**브라우저에서 다음 URL로 접속하세요:**

```
http://localhost:3000/ocr-insert/upload
```

### 2단계: 테스트 이미지 다운로드

테스트용 한국 주식 포트폴리오 스크린샷이 생성되었습니다:

![테스트 이미지](C:/Users/CloudDX/.gemini/antigravity/brain/0c6e22e7-b8e5-4a10-b8e1-fd0f3d713697/test_portfolio_screenshot_1769999152426.png)

**이미지 내용:**

- 삼성전자: 15주, 평단가 72,500원
- SK하이닉스: 8주, 평단가 128,000원
- 현대차: 10주, 평단가 245,000원

### 3단계: 이미지 업로드

**방법 A: 드래그 앤 드롭**

1. 위 이미지를 마우스로 드래그
2. 페이지의 점선 영역에 드롭

**방법 B: 파일 선택**

1. "파일 선택하기" 버튼 클릭
2. 위 이미지 파일 선택

### 4단계: AI 분석 시작

1. 이미지 미리보기 확인
2. "AI 분석 시작" 버튼 클릭
3. 로딩 스피너 확인 (약 2초)

### 5단계: 결과 확인

**Step 2: 정보 확인** 화면으로 자동 이동

**예상 결과 테이블:**
| # | 종목명 | 보유량 | 평단가 | 상태 |
|---|--------|--------|--------|------|
| 1 | 삼성전자 | 15 | 72,500 | 인식 성공 |
| 2 | SK하이닉스 | 8 | 128,000 | 인식 성공 |
| 3 | 현대차 | 10 | 245,000 | 인식 성공 |

---

## 🔍 확인 사항

### UI 체크리스트

- [ ] 페이지 로딩 정상
- [ ] 왼쪽 사이드바 표시 (2단계 프로세스)
- [ ] 드래그 앤 드롭 영역 표시
- [ ] 다크모드 토글 작동

### 업로드 체크리스트

- [ ] 이미지 선택 시 미리보기 표시
- [ ] X 버튼으로 이미지 제거 가능
- [ ] "AI 분석 시작" 버튼 활성화

### OCR 처리 체크리스트

- [ ] 로딩 스피너 표시
- [ ] "AI 분석 중..." 문구 표시
- [ ] 2초 후 Step 2로 자동 이동

### 결과 표시 체크리스트

- [ ] 테이블에 3개 항목 표시
- [ ] 종목명, 보유량, 평단가 정확
- [ ] 각 필드 편집 가능
- [ ] "인식 성공" 뱃지 표시

---

## 🐛 트러블슈팅

### "OCR 처리 중 오류가 발생했습니다"

**원인**: OCR API 서버 미실행 또는 연결 실패

**해결**:

```bash
# OCR API 로그 확인
# 터미널에서 다음 메시지 확인:
✅ OCR API 서비스 준비 완료
INFO:     Uvicorn running on http://0.0.0.0:8002
```

### 이미지 업로드 후 반응 없음

**원인**: JavaScript 콘솔 에러

**해결**:

1. F12 → Console 탭 확인
2. 에러 메시지 확인
3. 네트워크 탭에서 `/import/ocr` 요청 확인

### CORS 에러

**원인**: OCR API CORS 설정 문제

**해결**: OCR API 재시작

```bash
# Ctrl+C로 종료 후 재실행
python -m app.main
```

---

## 📊 Mock 모드 동작 방식

### 업로드 플로우 (Mock)

```
1. 사용자 이미지 선택
   ↓
2. POST /import/ocr (Mock 업로드)
   → MinIO 실제 저장 없음
   → Kafka 메시지 발행 없음
   → import_id만 생성
   ↓
3. 2초 대기
   ↓
4. GET /import/draft/{import_id}
   → Mock 데이터 반환
   ↓
5. 프론트엔드 테이블 렌더링
```

### Mock 응답 데이터

```json
{
  "import_id": "uuid",
  "raw_text": "삼성전자 15주\nSK하이닉스 8주\n현대차 10주",
  "items": [
    { "symbol": "삼성전자", "amount": 15, "avg_price": 72500 },
    { "symbol": "SK하이닉스", "amount": 8, "avg_price": 128000 },
    { "symbol": "현대차", "amount": 10, "avg_price": 245000 }
  ],
  "status": "DRAFT"
}
```

---

## 🎬 브라우저 개발자 도구 확인

### Console 탭 예상 로그

```javascript
✅ OCR 업로드 완료: {import_id: "...", status: "processing", mock_mode: true}
✅ OCR 결과: {import_id: "...", items: [...], status: "DRAFT"}
```

### Network 탭 확인

1. **POST** `http://localhost:8002/import/ocr`
   - Status: 200 OK
   - Response: `{import_id: "...", mock_mode: true}`

2. **GET** `http://localhost:8002/import/draft/{import_id}`
   - Status: 200 OK
   - Response: `{items: [...]}`

---

## ✅ 테스트 성공 기준

1. ✅ 이미지 업로드 성공
2. ✅ Mock 모드로 처리 완료
3. ✅ Step 2로 자동 이동
4. ✅ 테이블에 3개 항목 표시
5. ✅ 각 필드 편집 가능

---

## 🚀 다음 단계

Mock 모드 테스트 성공 후:

1. **실제 OCR 연동**
   - Google Vision API 연동
   - 실제 이미지 텍스트 추출

2. **MinIO/Kafka 연동**
   - Docker로 서비스 실행
   - 실제 파일 저장 및 메시지 큐 테스트

3. **MongoDB 연동**
   - Draft 결과 실제 저장
   - Confirm 시 holdings 반영

---

**🎉 Mock 모드로 전체 플로우 테스트 준비 완료!**

브라우저에서 `http://localhost:3000/ocr-insert/upload`로 접속하여 테스트를 시작하세요!
