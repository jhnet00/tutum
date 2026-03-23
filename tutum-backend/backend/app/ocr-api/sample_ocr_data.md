# OCR 샘플 데이터 - Vision API 결과 캐싱

## 샘플 1: 업비트 포트폴리오 (코인)

**파일명**: `upbit_portfolio.png`

**Vision API 추출 텍스트**:

```
보유 자산
코인        보유수량    매수평균가      매수금액
BTC         1.5        50,000,000     75,000,000
ETH         10.0       2,500,000      25,000,000
XRP         5000       1,200          6,000,000
```

**매핑 결과**:

```json
[
  {
    "symbol": "BTC",
    "amount": 1.5,
    "avg_price": 50000000,
    "currency": "KRW",
    "recognized": true
  },
  {
    "symbol": "ETH",
    "amount": 10.0,
    "avg_price": 2500000,
    "currency": "KRW",
    "recognized": true
  },
  {
    "symbol": "XRP",
    "amount": 5000,
    "avg_price": 1200,
    "currency": "KRW",
    "recognized": true
  }
]
```

---

## 샘플 2: 삼성증권 포트폴리오 (주식)

**파일명**: `samsung_securities.png`

**Vision API 추출 텍스트**:

```
보유 종목
종목명          보유수량    매수평균가      매수금액
삼성전자        15         72,500         1,087,500
SK하이닉스      8          128,000        1,024,000
현대차          10         245,000        2,450,000
```

**매핑 결과**:

```json
[
  {
    "symbol": "삼성전자",
    "amount": 15,
    "avg_price": 72500,
    "currency": "KRW",
    "recognized": true
  },
  {
    "symbol": "SK하이닉스",
    "amount": 8,
    "avg_price": 128000,
    "currency": "KRW",
    "recognized": true
  },
  {
    "symbol": "현대차",
    "amount": 10,
    "avg_price": 245000,
    "currency": "KRW",
    "recognized": true
  }
]
```

---

## 필드 매핑 규칙

### 스크린샷 텍스트 → 우리 필드명

| 스크린샷 텍스트 | 우리 필드명   | 설명          |
| --------------- | ------------- | ------------- |
| 보유수량        | amount        | 보유 개수/주  |
| 보유량          | amount        | 동일          |
| 수량            | amount        | 동일          |
| 매수평균가      | avg_price     | 평단가        |
| 평단가          | avg_price     | 동일          |
| 평균단가        | avg_price     | 동일          |
| 매수금액        | total_cost    | 총 매수금액   |
| 평가금액        | current_value | 현재 평가금액 |

---

## 사용 방법

### 1. 새 샘플 추가 시

1. 실제 거래소/증권사 스크린샷 촬영
2. Vision API로 1회 텍스트 추출
3. 이 파일에 결과 추가
4. 이후 테스트는 캐싱된 데이터 사용

### 2. Mock 모드 테스트

```python
# OCR API에서 샘플 데이터 로드
SAMPLE_OCR_RESULTS = {
    "upbit_portfolio": {
        "raw_text": "...",
        "items": [...]
    },
    "samsung_securities": {
        "raw_text": "...",
        "items": [...]
    }
}
```

### 3. Vision API 호출 최소화

- 개발/테스트: 캐싱된 데이터 사용
- 실제 사용자: Vision API 호출
- 예산 절약: $300 limit 보호
