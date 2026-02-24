# 🎉 Google Vision API OCR 실시간 테스트 가이드

## ✅ 현재 상태

| 서비스      | 포트 | 상태       | 기능                     |
| ----------- | ---- | ---------- | ------------------------ |
| **Next.js** | 3000 | ✅ 실행 중 | 프론트엔드 UI            |
| **OCR API** | 8002 | ✅ 실행 중 | **실제 Vision API 연동** |

### 🔥 주요 변경사항

- ✅ **Mock 데이터 제거**: 더 이상 고정된 응답 없음
- ✅ **실제 Vision API 호출**: 업로드한 이미지를 Google Vision API로 처리
- ✅ **실시간 텍스트 추출**: 이미지에서 실제 텍스트 인식
- ✅ **자동 파싱**: 추출된 텍스트에서 종목명/수량 자동 인식

---

## 🚀 테스트 시작하기

### 1단계: 브라우저 접속

```
http://localhost:3000/ocr-insert/upload
```

### 2단계: 테스트 이미지 준비

**옵션 A: 생성된 테스트 이미지 사용**

![한국 주식 포트폴리오](C:/Users/CloudDX/.gemini/antigravity/brain/0c6e22e7-b8e5-4a10-b8e1-fd0f3d713697/test_portfolio_screenshot_1769999152426.png)

**옵션 B: 직접 스크린샷 촬영**

- 증권사 앱 잔고 화면
- 엑셀 자산 목록
- 손글씨 메모

### 3단계: 이미지 업로드

1. **드래그 앤 드롭** 또는 **파일 선택**
2. 미리보기 확인
3. **"AI 분석 시작"** 클릭

### 4단계: Vision API 처리 확인

**로딩 중 (2초)**

- "AI 분석 중..." 표시
- 백엔드에서 Vision API 호출

**예상 로그 (OCR API 터미널):**

```
📝 Mock 업로드: demo-user/uuid/uuid.png (53333 bytes)
💾 이미지 메모리 저장: uuid
✅ Vision API 텍스트 추출 완료: 150 글자
📝 추출된 텍스트 (처음 200자):
보유 자산
종목명    보유량    평단가
삼성전자   15주    72,500원
SK하이닉스  8주    128,000원
현대차     10주    245,000원
...
🔍 파싱 시작: 8줄
  라인 0: 보유 자산
  라인 1: 종목명    보유량    평단가
  라인 2: 삼성전자   15주    72,500원
    ✅ 파싱 성공: 삼성전자 15주
  라인 3: SK하이닉스  8주    128,000원
    ✅ 파싱 성공: SK하이닉스 8주
  라인 4: 현대차     10주    245,000원
    ✅ 파싱 성공: 현대차 10주
✅ 파싱 완료: 3개 항목
```

### 5단계: 결과 확인

**Step 2: 정보 확인** 화면으로 자동 이동

**실제 추출된 데이터 표시:**

- Vision API가 인식한 텍스트
- 자동 파싱된 종목명/수량
- 편집 가능한 테이블

---

## 🔍 Vision API 동작 방식

### 처리 플로우

```
1. 사용자 이미지 업로드
   ↓
2. POST /import/ocr
   → 이미지를 메모리에 저장 (image_storage)
   → import_id 생성 및 반환
   ↓
3. 2초 대기 (프론트엔드)
   ↓
4. GET /import/draft/{import_id}
   → 메모리에서 이미지 가져오기
   → Google Vision API 호출
   → 텍스트 추출
   → 자동 파싱 (종목명/수량)
   → 결과 반환
   ↓
5. 프론트엔드 테이블 렌더링
```

### Vision API 호출 코드

```python
from app.workers.ocr_engine import extract_text_from_image_bytes

image_bytes = image_storage[import_id]
raw_text = extract_text_from_image_bytes(image_bytes)
```

### 파싱 로직 (MVP)

```python
# "삼성전자 15주" 패턴 찾기
if '주' in line:
    parts = line.split()
    symbol = parts[0]      # "삼성전자"
    amount = int(parts[1].replace('주', ''))  # 15
```

---

## 🧪 테스트 시나리오

### Scenario 1: 한글 텍스트 인식

**테스트 이미지**: 한국 주식 포트폴리오 스크린샷

**예상 결과**:

```json
{
  "raw_text": "보유 자산\n종목명 보유량 평단가\n삼성전자 15주 72,500원\n...",
  "items": [
    { "symbol": "삼성전자", "amount": 15 },
    { "symbol": "SK하이닉스", "amount": 8 },
    { "symbol": "현대차", "amount": 10 }
  ]
}
```

### Scenario 2: 영문 텍스트 인식

**테스트 이미지**: 영문 자산 목록

**예상 결과**:

```json
{
  "raw_text": "Stock Holdings\nApple 20 shares\nTesla 5 shares\n...",
  "items": [...]
}
```

### Scenario 3: 손글씨 인식

**테스트 이미지**: 손으로 쓴 자산 메모

**예상 결과**: Vision API가 손글씨도 인식 가능

---

## 🐛 트러블슈팅

### ❌ "OCR 처리 중 오류 발생"

**원인**: Vision API 인증 실패

**해결**:

```bash
# .env 파일 확인
GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# 환경변수 로드 확인
python backend/app/ocr-api/test_auth.py
```

### ❌ "인식된 텍스트 확인 필요" 항목만 표시

**원인**: 파싱 로직이 패턴을 찾지 못함

**해결**:

1. 브라우저 F12 → Console 탭
2. `raw_text` 확인
3. 실제 추출된 텍스트 검토

**예시**:

```javascript
{
  "raw_text": "실제 추출된 텍스트 확인",
  "items": [{"symbol": "인식된 텍스트 확인 필요", ...}]
}
```

### ⚠️ 파싱 정확도 낮음

**현재 파싱 로직**: 매우 간단한 MVP 버전

- "주" 키워드 기반 매칭
- 공백으로 분리

**개선 필요**:

- 정규표현식 패턴 매칭
- 테이블 구조 인식
- 숫자 포맷 처리 (1,000 → 1000)

---

## 📊 브라우저 개발자 도구 확인

### Console 탭

**업로드 성공**:

```javascript
✅ OCR 업로드 완료: {
  import_id: "uuid",
  status: "processing",
  message: "OCR 처리 요청이 접수되었습니다 (Vision API로 처리)",
  mock_mode: true
}
```

**Vision API 결과**:

```javascript
✅ OCR 결과: {
  import_id: "uuid",
  raw_text: "실제 추출된 텍스트...",
  items: [
    {symbol: "삼성전자", amount: 15, avg_price: null},
    {symbol: "SK하이닉스", amount: 8, avg_price: null}
  ],
  status: "DRAFT"
}
```

### Network 탭

1. **POST** `/import/ocr`
   - Status: 200 OK
   - Response Time: ~100ms

2. **GET** `/import/draft/{id}`
   - Status: 200 OK
   - Response Time: ~2-3초 (Vision API 호출 시간)

---

## ✅ 테스트 성공 기준

1. ✅ 이미지 업로드 성공
2. ✅ Vision API 호출 성공
3. ✅ 텍스트 추출 완료 (raw_text 확인)
4. ✅ 파싱 결과 표시 (items 배열)
5. ✅ 테이블에 데이터 렌더링

---

## 🎯 다음 단계

### 파싱 로직 개선

- [ ] 정규표현식 패턴 매칭
- [ ] 평단가 추출
- [ ] 테이블 구조 인식

### MongoDB 연동

- [ ] Draft 결과 실제 저장
- [ ] Confirm 시 holdings 반영

### 에러 핸들링

- [ ] Vision API 타임아웃 처리
- [ ] 재시도 로직
- [ ] 사용자 친화적 에러 메시지

---

## 🔑 Vision API 인증 정보

**API Key**: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

**제한사항**:

- API: Cloud Vision API만 허용
- IP: 팀원 IP 주소만 허용

**테스트 스크립트**:

```bash
cd backend/app/ocr-api
python test_auth.py
```

---

**🎉 실제 Google Vision API로 OCR 테스트 준비 완료!**

브라우저에서 `http://localhost:3000/ocr-insert/upload`로 접속하여 실제 이미지를 업로드하고 Vision API가 텍스트를 추출하는 것을 확인하세요!
