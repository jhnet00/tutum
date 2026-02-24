# 📅 개발 작업 완료 보고서 (2026-02-19)

## 📌 작업 개요
- **작성자**: `kyk02405` (Kyung Yoon Kim)
- **Jira Ticket**: `N/A`
- **Branch**: `kyk/recommended-portfolio` → `develop`
- **작업 내용**:
  - AI 채팅 전처리 런타임 에러 수정 (`name 're' is not defined`)
  - 메인 페이지 Bitcoin 카드의 잘못된 KRW 표시 이슈 수정
  - AI 채팅 응답의 마크다운(`**bold**`) 렌더링 적용

---

## 1. 🔧 주요 변경 사항

### 1-1. AI 채팅 전처리 에러 수정
- **문제**: 채팅 요청 시 backend 로그에 `Chat pre-processing failed: name 're' is not defined` 발생
- **원인**: `backend/app/services/chat_service.py`에서 `re.findall(...)` 사용 중 `import re` 누락
- **조치**: `import re` 추가

### 1-2. Bitcoin 카드 가격 단위 불일치 수정
- **문제**: 메인 페이지 Bitcoin 카드가 `₩59,020`처럼 비정상 값으로 노출
- **원인**:
  - Redis `price:BTC` 캐시에 Node3 mock producer의 USD 값이 저장됨
  - `/api/v1/market/price/crypto/{ticker}`가 해당 캐시를 우선 사용해 KRW 화면에 USD 값이 표시됨
- **조치** (`backend/app/routers/market.py`):
  - crypto 단건 조회에서 `asset_type/currency`가 KRW 규약과 맞지 않는 캐시를 skip
  - Upbit 실시간 응답을 우선 사용하도록 보정
  - 응답 기본 필드 `asset_type=crypto`, `currency=KRW` 보강

### 1-3. AI 채팅 마크다운 렌더링 적용
- **문제**: AI 응답 내 `**텍스트**`가 굵게 렌더링되지 않고 원문으로 노출
- **원인**: `AssistantMessage`가 plain text 출력만 수행
- **조치** (`frontend/components/chat/ChatMessages.tsx`):
  - `react-markdown` + `rehype-sanitize` 적용
  - assistant 응답을 안전한 마크다운으로 렌더링
  - 줄바꿈/리스트 가독성 스타일 보강

---

## 2. ✅ 검증 결과

### 2-1. AI 채팅
- backend 문법 체크: `python -m py_compile backend/app/services/chat_service.py` 통과
- 키워드 추출 함수 실행 시 `re` 관련 NameError 미발생 확인

### 2-2. Bitcoin 카드 API
- `GET /api/v1/market/price/crypto/KRW-BTC` 응답 확인
  - `price`가 KRW 실시간 값으로 반환
  - `currency=KRW`, `source=api` 확인

### 2-3. 채팅 UI
- frontend lint: `npm --prefix frontend run lint -- --file components/chat/ChatMessages.tsx` 통과
- 마크다운 응답(`**bold**`) 굵게 렌더링 확인

---

## 3. 📝 커밋 내역

```bash
ed0ef95 fix(market): prevent USD cache bleed into BTC KRW snapshot
e2e6aa7 fix(chat): import re for keyword extraction pre-processing
f317878 fix(chat-ui): render assistant responses as sanitized markdown
```

---

## 4. 결론
- AI 채팅 전처리 런타임 에러는 제거되어 응답이 정상 동작합니다.
- Bitcoin 카드의 단위/값 불일치 이슈는 캐시 필터링 로직으로 개선되었습니다.
- 채팅 응답의 마크다운 렌더링이 적용되어 `**bold**` 포맷이 UI에서 정상 표시됩니다.
