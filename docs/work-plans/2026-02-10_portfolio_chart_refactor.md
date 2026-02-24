# Portfolio Chart Refactoring Plan

## 1. Goal Description
Refactor `/portfolio/chart` to fix KRW conversion bugs, complete timeframe support, and remove dead code.
Ensure consistency in KRW currency display across Sidebar and Chart. Maintain Red (Rise) / Blue (Fall) candlestick coloring.

## 2. Analysis

### Current State (코드 분석 결과)
- **`AdvancedChart.tsx`**: API 호출 로직이 이미 존재하지만 `generateChartData`는 사용되지 않는 데드 코드.
- **`AdvancedChart.tsx` KRW 변환 버그 (Critical)**:
    - Line 174-179에서 `rate` 변수를 올바르게 계산 (코인=1, 미국=1450 등)
    - 그러나 Line 182-186에서 `rate`를 사용하지 않고 별도 인라인 식을 사용
    - `selectedAsset.type === '코인'` 일 때 1450을 곱함 → **Upbit은 이미 KRW 반환하므로 1450배 부풀려짐**
- **Timeframe 매핑 불완전**: `1분`, `5분`, `1시간`만 매핑. `1일`은 기본값 "D"로 작동하나, `1주일`, `1달`, `1년`은 모두 "D"로 fallback.
- **Backend `get_market_history`**: crypto에서 `weeks`, `months` timeframe 미지원. `W`, `M`, `Y` 매핑 없음.
- **`ChartSidebar.tsx` `toKRW`**: 코인을 US 주식과 동일하게 1450 곱함 → mock data의 USD 가격 기준으로는 맞지만, 실시간 데이터(`formatLiveKRW`)가 우선 사용되므로 실질적 영향 없음.
- **Candlestick 색상**: 이미 올바르게 설정됨 (upColor: #ef4444, downColor: #2563eb).

### Requirements
- [x] ~~Mock Data 제거~~ → `generateChartData` 데드 코드 제거
- [x] ~~Red/Blue 캔들 색상~~ → 이미 구현됨
- [ ] KRW 변환 버그 수정 (Critical)
- [ ] 모든 Timeframe 지원: 1분, 5분, 1시간, 1일, 1주일, 1달, 1년
- [ ] Backend timeframe 매핑 완성 (weeks, months)
- [ ] Sidebar `toKRW` 코인 처리 수정

## 3. Proposed Changes

### 3-1. Frontend `AdvancedChart.tsx` (Critical Bug Fix)

**A. KRW 변환 수정** — `rate` 변수를 실제 변환에 사용
```diff
- open: d.open * ((selectedAsset.country === '🇺🇸' || selectedAsset.type === '코인') ? 1450 : 1),
+ open: d.open * rate,
```
- 코인 (Upbit): rate=1 (이미 KRW)
- 미국 주식: rate=1450 (USD→KRW)
- 한국 주식: rate=1 (이미 KRW)
- 일본/중국/유럽: 각 환율 적용

**B. Timeframe 매핑 완성**
```typescript
let tf = "D";
if (timeframe === "1분") tf = "1";
else if (timeframe === "5분") tf = "5";
else if (timeframe === "1시간") tf = "60";
else if (timeframe === "1일") tf = "D";
else if (timeframe === "1주일") tf = "W";
else if (timeframe === "1달") tf = "M";
else if (timeframe === "1년") tf = "Y";
```

**C. 데드 코드 제거**
- `generateChartData` 함수 삭제

### 3-2. Backend `market.py`

**Timeframe 매핑 확장**
```python
# Crypto (Upbit) 매핑
"D" → "days"
"W" → "weeks"
"M" → "months"
"Y" → "months" (count=12)
# 분봉은 기존 isdigit() 로직으로 처리됨

# Stock (KIS) 매핑
"D" → "D" (일봉)
"W" → "W" (주봉)
"M" → "M" (월봉)
"Y" → "M" (월봉, count=12)
# 분봉은 기존 로직 유지
```

### 3-3. Frontend `ChartSidebar.tsx`

**`toKRW` 코인 처리 수정**
- 코인은 mock data 가격이 USD 형식이므로 현재 로직 유지
- `formatLiveKRW`가 실시간 데이터에서 우선 적용되므로 실질적 문제 없음
- 단, 코인 조건을 US 주식과 분리하여 명확하게 처리

## 4. Verification Plan
- **Scenario 1**: BTC 차트 로드 → Y축 가격이 ~1억원대 (1450배 부풀려진 값이 아닌 정상 KRW)
- **Scenario 2**: AAPL 차트 로드 → Y축 가격이 ~33만원대 (USD * 1450)
- **Scenario 3**: `1주일`, `1달`, `1년` 타임프레임 클릭 → 차트가 올바르게 업데이트
- **Scenario 4**: Red 캔들 (상승), Blue 캔들 (하락) 확인

## 5. Implementation Order
1. `AdvancedChart.tsx` — KRW 변환 버그 수정 + generateChartData 제거 + timeframe 완성
2. `backend/app/routers/market.py` — weeks/months/year timeframe 추가
3. `ChartSidebar.tsx` — toKRW 코인 분리 처리
