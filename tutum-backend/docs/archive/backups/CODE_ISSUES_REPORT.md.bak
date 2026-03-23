# CloudDX 프로젝트 코드 이슈 리포트

> 작성일: 2026-02-10
> 분석 범위: Backend, Frontend, Services, Infrastructure

---

## 요약

| 심각도 | 개수 | 설명 |
|--------|------|------|
| Critical | 7개 | 즉시 수정 필요 - 기능 장애 또는 보안 취약점 |
| High | 6개 | 빠른 수정 권장 - 사용자 경험 저하 |
| Medium | 5개 | 중기 수정 - 안정성/성능 개선 |

---

## Critical Issues (즉시 수정 필요)

### 1. [Frontend] SellAssetDialog 하드코딩된 userId

**파일**: `frontend/components/SellAssetDialog.tsx:69`

**문제**:
```typescript
// TODO: Replace with actual user_id from auth context
const userId = "test_user_id";  // 테스트 값이 그대로 사용됨
```

**영향**: 매도 기능이 정상 작동하지 않음

**해결 방법**:
```typescript
const { user } = useAuth();
const userId = user?.id;
```

---

### 2. [Backend] AssetResponse profit_percent 중복 정의

**파일**: `backend/app/routers/assets.py:82-83`

**문제**:
```python
class AssetResponse(BaseModel):
    ...
    profit_percent: Optional[float] = None
    profit_percent: Optional[float] = None  # 중복!
```

**영향**: Pydantic 모델 오류, 타입 검증 실패 가능

**해결 방법**: 중복된 라인 삭제

---

### 3. [Backend] Transaction ID 항상 None 반환

**파일**: `backend/app/routers/assets.py:375-384`

**문제**:
```python
await transactions.insert_one(transaction_doc)

return {
    ...
    "transaction_id": str(transaction_doc["_id"])
    if "_id" in transaction_doc  # insert_one 전에 _id가 없음!
    else None,
}
```

**영향**: 클라이언트가 거래 ID를 받을 수 없음

**해결 방법**:
```python
result = await transactions.insert_one(transaction_doc)

return {
    ...
    "transaction_id": str(result.inserted_id),
}
```

---

### 4. [Backend] 매도 시 Race Condition

**파일**: `backend/app/routers/assets.py:337-390`

**문제**:
```python
asset = await assets.find_one({"_id": ObjectId(asset_id)})
# ... 검증 ...
new_quantity = asset["quantity"] - sell_data.quantity
# 동시 요청 시 음수 수량 가능!
await assets.update_one(...)
```

**영향**: 동시 매도 요청 시 음수 수량 발생 가능

**해결 방법**:
```python
result = await assets.find_one_and_update(
    {"_id": ObjectId(asset_id), "quantity": {"$gte": sell_data.quantity}},
    {"$inc": {"quantity": -sell_data.quantity}},
    return_document=True
)
if not result:
    raise HTTPException(status_code=400, detail="수량 부족")
```

---

### 5. [Backend] OAuth 콜백 URL 하드코딩

**파일**: `backend/app/routers/auth.py:354, 460, 583`

**문제**:
```python
response = RedirectResponse(
    url=f"http://localhost:3000/auth/callback?token={app_token}"
)
```

**영향**: 프로덕션 환경에서 리다이렉트 실패

**해결 방법**:
```python
# config.py에 추가
FRONTEND_URL: str = "http://localhost:3000"

# auth.py에서 사용
response = RedirectResponse(
    url=f"{settings.FRONTEND_URL}/auth/callback?token={app_token}"
)
```

---

### 6. [Frontend] API 호출에 Authorization 헤더 누락

**파일**: `frontend/context/AssetContext.tsx:107`

**문제**:
```typescript
const response = await fetch(`${API_BASE_URL}/api/v1/assets?user_id=${user.id}`);
// Authorization 헤더 없음, URL에 user_id 노출
```

**영향**: 보안 취약점 - 다른 사용자 ID로 접근 가능

**해결 방법**:
```typescript
const response = await fetch(`${API_BASE_URL}/api/v1/assets`, {
    headers: {
        "Authorization": `Bearer ${token}`,
    },
});
```

---

### 7. [Backend] Mock 데이터 프로덕션 반환

**파일**: `backend/app/routers/market.py:157-172`

**문제**:
```python
if not res.get("history"):
    print(f"[WARN] KIS {symbol} history is empty, providing mock fallback.")
    mock_history = [...]  # 가짜 데이터 생성
    return {"code": symbol, "history": mock_history, "mock": True}
```

**영향**: 잘못된 시세 정보 표시

**해결 방법**: 프로덕션에서는 에러 반환, 개발 환경에서만 Mock 허용

```python
if not res.get("history"):
    if settings.ENVIRONMENT == "development":
        return {"code": symbol, "history": mock_history, "mock": True}
    raise HTTPException(status_code=503, detail="시세 데이터를 가져올 수 없습니다")
```

---

## High Issues (빠른 수정 권장)

### 8. [Frontend] 로그아웃 API 호출 시 토큰 미포함

**파일**: `frontend/contexts/AuthContext.tsx:171-180`

**문제**:
```typescript
await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: "POST",
    // Authorization 헤더 없음!
});
```

**영향**: 백엔드에서 토큰 블랙리스트 등록 불가

**해결 방법**:
```typescript
await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
        "Authorization": `Bearer ${token}`,
    },
});
```

---

### 9. [Frontend] 401/403 응답 시 자동 로그아웃 없음

**파일**: Frontend 전체

**문제**: 토큰 만료 후에도 API 호출 계속 시도

**해결 방법**: API 인터셉터 또는 공통 fetch wrapper 추가
```typescript
async function fetchWithAuth(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        logout();
        throw new Error("세션이 만료되었습니다.");
    }
    return response;
}
```

---

### 10. [Frontend] 세션 만료 체크 1초마다 실행

**파일**: `frontend/contexts/AuthContext.tsx:201-212`

**문제**:
```typescript
const interval = setInterval(() => {
    if (Date.now() > sessionExpiry) {
        logout();
    }
}, 1000);  // 매초 실행 - CPU 부하
```

**해결 방법**: 60초 간격으로 변경
```typescript
}, 60000);  // 60초
```

---

### 11. [Backend] KIS API 토큰 Race Condition

**파일**: `backend/app/services/market_data.py:59-142`

**문제**: 동시 요청 시 여러 토큰 발급 요청 → API Rate Limit 초과 위험

**해결 방법**: asyncio.Lock 사용
```python
class KISClient:
    def __init__(self):
        self._token_lock = asyncio.Lock()

    async def _get_access_token(self):
        async with self._token_lock:
            # 토큰 발급 로직
```

---

### 12. [Backend] MongoDB 연결 실패 후 앱 동작

**파일**: `backend/app/database.py:23-38`

**문제**: 연결 실패해도 `database` 변수가 설정됨 → 모든 쿼리 실패

**해결 방법**:
```python
async def connect_to_mongodb():
    global client, database
    try:
        client = AsyncIOMotorClient(settings.MONGODB_URL)
        await client.admin.command("ping")
        database = client[settings.MONGODB_DB_NAME]
    except Exception as e:
        print(f"MongoDB 연결 실패: {e}")
        database = None  # 명시적으로 None 설정
```

---

### 13. [Backend] Kafka Worker 재연결 로직 없음

**파일**: `backend/workers/price_producer.py`, `news_producer.py`

**문제**: 연결 끊김 시 재연결 시도 없음 → 데이터 손실

**해결 방법**:
```python
async def main():
    while True:
        try:
            producer = AIOKafkaProducer(...)
            await producer.start()

            while True:
                await producer.send_and_wait(TOPIC, data)
                await asyncio.sleep(10)
        except Exception as e:
            print(f"Producer 오류, 5초 후 재연결: {e}")
            await asyncio.sleep(5)
```

---

## Medium Issues (중기 수정)

### 14. [Backend] Bedrock 호출 타임아웃 없음

**파일**: `backend/app/services/chat_service.py:349-365`

**문제**: AI 응답 지연 시 무한 대기

**해결 방법**: boto3 Config에 타임아웃 설정

---

### 15. [Backend] 환경 변수 검증 없음

**파일**: `backend/app/config.py`

**문제**: 민감한 설정이 빈 문자열 기본값

**해결 방법**: pydantic validator로 필수 환경 변수 검증

---

### 16. [Backend] 환율 계산 Division by Zero

**파일**: `backend/app/services/market_data.py:469-475`

**문제**:
```python
"JPY": float(usd_to_krw / usd_to_jpy),  # usd_to_jpy가 0이면?
```

**해결 방법**: 0 체크 추가

---

### 17. [Frontend] useCoins 무한 루프 가능성

**파일**: `frontend/lib/hooks/useCoins.ts`

**문제**: 의존성 배열 오류로 interval 재생성

**해결 방법**: useCallback 의존성 정리

---

### 18. [Backend] 비밀번호 복잡성 검증 없음

**파일**: `backend/app/routers/auth.py`

**문제**: 약한 비밀번호 허용

**해결 방법**: pydantic validator로 최소 길이, 특수문자 등 검증

---

## 수정 우선순위

### Phase 1: 즉시 수정 (1-2일)
- [ ] #1 SellAssetDialog userId
- [ ] #2 AssetResponse 중복 필드
- [ ] #3 Transaction ID 수정
- [ ] #6 API Authorization 헤더
- [ ] #8 로그아웃 토큰 포함

### Phase 2: 빠른 수정 (1주일)
- [ ] #4 매도 Race Condition
- [ ] #5 OAuth URL 설정화
- [ ] #9 401 자동 로그아웃
- [ ] #10 세션 체크 간격
- [ ] #11 KIS 토큰 Lock

### Phase 3: 중기 수정 (2주일)
- [ ] #7 Mock 데이터 처리
- [ ] #12 MongoDB 연결 처리
- [ ] #13 Kafka 재연결
- [ ] #14-18 나머지 이슈

---

## 참고사항

- 이 문서는 코드 리뷰를 통해 발견된 이슈들을 정리한 것입니다
- 각 이슈의 심각도는 기능 영향도와 보안 위험도를 기준으로 분류했습니다
- 수정 시 관련 테스트도 함께 작성하는 것을 권장합니다
