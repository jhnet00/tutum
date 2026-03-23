# Direct Asset Input UX Improvements

## Goal
Improve the usability of the Direct Asset Registration page (`/direct-input`) based on user feedback.

## User Requests
1. **Number Formatting**: Display numbers with commas (e.g., `123,123`) in input fields.
2. **Edit/Delete in Preview**: Allow editing and deleting assets directly from the "Current Assets" preview list.
3. **Cash Entry UX**: Simplify cash entry by removing the manual exchange rate field and showing the estimated KRW value instead.

## Plan

### 1. Frontend Logic (`frontend/app/direct-input/page.tsx`)

#### A. Number Formatting
- Change `Input type="number"` to `type="text"` for `price` and `quantity`.
- Implement `formatNumber(value: string)` helper to add commas.
- Implement `parseNumber(value: string)` helper to remove commas for state/submission.
- Apply this to both the main input form and the editable table inputs.

#### B. Edit Mode for Cart Items
- **Selection**: Clicking an item in the "Mini Cart Preview" (bottom right) populates the form with that item's data.
- **State**: Add `editingItemId` state to track if we are updating an existing item.
- **Button**: Change "Add to List" to "Update Asset" when editing.
- **Delete**: Add a small `X` button to each item in the Mini Cart Preview (top-right absolute position).

#### C. Cash Tab UX Improvement
- **Integration**: `useAsset` hook to access `exchangeRates` (`frontend/context/AssetContext.tsx`).
- **Logic**:
    - When a Currency asset (e.g., USD) is selected, auto-fill `Price` (Exchange Rate) using `exchangeRates[symbol]`.
    - Display "Estimated KRW: X,XXX KRW" below the input.
    - Make the "Exchange Rate" field optional or secondary (read-only or pre-filled).
    - If user modifies the rate, update the estimated value.

### 2. Implementation Steps
1. **Destructure Exchange Rates**:
   ```typescript
   const { addHoldings, exchangeRates } = useAsset();
   ```
2. **Create Helpers**:
   ```typescript
   const formatNumber = (num: string | number) => Number(num).toLocaleString('en-US');
   const parseNumber = (str: string) => str.replace(/,/g, '');
   ```
3. **Update State Management**:
   - `selectedAsset` selection should reset `editingItemId`.
   - Clicking Mini Cart Item sets `selectedAsset` AND `editingItemId`.
4. **Update Render**:
   - Inputs use `value={formatNumber(formValues.price)}`.
   - `onChange` uses `parseNumber(e.target.value)`.
   - Show "Estimated KRW: ..." block if `selectedAsset.type === 'currency'`.

## Verification Scenarios (Browsing)
1. **Formatting Test**: Type "10000" -> Input shows "10,000".
2. **Edit Test**: Add Samsung Electronics (10 shares). Click it in the bottom-right list. Change quantity to 20. Click "Update". List shows 20.
3. **Delete Test**: Add Bitcoin. Click 'X' on the card. Bitcoin disappears.
4. **Cash Test**: Select "USD". "Exchange Rate" auto-fills (e.g. 1450). Enter "100". Text shows "≈ 145,000 KRW".

## Refinements by Claude
1. **Type Safety**:
    - `quantity` and `price` in `formValues` are currently strings to handle empty inputs. Ensure `parseFloat` handles `NaN` gracefully (default to 0).
    - `CartItem` uses `number` for these fields. Conversion happens at `handleAddToCart` or `updateCartItem`.
2. **UX Edge Case**:
    - When editing an item, if the user changes the "Asset Type" (e.g., Stock -> Coin), the form should either reset or warn. For now, assume users simply update Price/Quantity.
    - If `editingItemId` matches an item in `cart`, the "Add" button changes to "Update" (Green color).
3. **Cash Logic Detail**:
    - `exchangeRates` keys (e.g. "USD") must match `selectedAsset.symbol`. Ensure casing matches.
    - If `selectedAsset` is KRW, hide "Exchange Rate" or disable it with value "1".


---

## Refinements by Claude

**검증일**: 2026-02-04
**검증 대상**: `frontend/app/direct-input/page.tsx`, `frontend/context/AssetContext.tsx`

### 1. 계획 이행 가능성: APPROVED (조건부)

전체적으로 계획이 현재 코드베이스와 잘 맞습니다. 아래 보완사항을 반영하면 구현에 문제가 없습니다.

### 2. 보완사항

#### A. Number Formatting 관련

- **문제**: `formatNumber`에서 빈 문자열이나 `"0"` 입력 시 `Number("")`는 `0`이 되어 사용자가 필드를 비울 수 없음.
- **수정안**:
  ```typescript
  const formatNumber = (value: string) => {
    if (!value || value === '') return '';
    const num = Number(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US');
  };
  ```
- **추가 고려**: `type="text"`로 변경 시 한글/특수문자 입력 방지를 위해 `inputMode="numeric"` 속성 추가 필요. 모바일 키보드에서 숫자 키패드가 뜨도록 보장함.
- **Step 2 테이블에도 적용 필요**: 현재 Step 2(확인 단계)의 테이블에서 `quantity` 필드는 `type="number"`를 사용 중 (line 543-548, line 660-665). 이것도 동일하게 포맷팅 적용 대상임.

#### B. Edit Mode 관련

- **현재 구조 확인**: `handleRemoveFromCart` (line 157-159)와 `updateCartItem` (line 161-163) 함수가 이미 존재함. 삭제 기능은 Step 2 테이블에서만 가능하고 Mini Cart Preview에는 없으므로 계획대로 `X` 버튼 추가가 적절함.
- **추가 필요 로직**: 편집 모드에서 "Update Asset" 클릭 시 기존 `handleAddToCart` 로직을 분기해야 함. 현재 `handleAddToCart`는 항상 새 `uid`를 생성하므로 (line 144), 편집 시에는 기존 `uid`의 아이템을 교체하는 로직이 필요:
  ```typescript
  if (editingItemId) {
    setCart(cart.map(item => item.uid === editingItemId
      ? { ...item, ...selectedAsset, quantity: parseFloat(formValues.quantity), price: parseFloat(formValues.price) }
      : item
    ));
    setEditingItemId(null);
  } else {
    // 기존 추가 로직
  }
  ```
- **편집 취소**: 편집 모드 진입 후 다른 자산을 클릭하면 편집이 취소되어야 함. `handleSelect`에서 `setEditingItemId(null)` 호출 추가 필요.

#### C. Cash Tab UX 관련

- **AssetContext 확인 완료**: `exchangeRates`가 이미 Context에서 제공되고 있음 (AssetContext.tsx line 29, 90-97). 기본값으로 `USD: 1450, JPY: 9.5, CNY: 200, EUR: 1550, KRW: 1`이 설정되어 있고, API(`/api/v1/market/exchange-rate`)에서 실시간 데이터를 가져옴.
- **주의**: `handleSelect`에서 currency 선택 시 KRW만 특수 처리하고 있음 (line 132-136). USD/JPY/CNY 선택 시에도 `exchangeRates[asset.id]`로 price를 자동 채워야 함:
  ```typescript
  if (asset.type === 'currency') {
    setFormValues({ quantity: "", price: String(exchangeRates[asset.id] || "") });
  }
  ```
  이렇게 하면 KRW는 `exchangeRates['KRW'] = 1`이 자동으로 적용되어 기존 KRW 특수 처리 분기를 제거할 수 있음.

#### D. 누락된 고려사항

1. **소수점 입력**: 코인(BTC 0.45개)이나 환율(JPY 9.5) 등 소수점이 필요한 경우가 있음. `parseNumber`에서 소수점(`.`)은 보존해야 함:
   ```typescript
   const parseNumber = (str: string) => str.replace(/[^0-9.]/g, '');
   ```
2. **Mobile 뷰 대응**: 계획에 모바일 Mini Cart Preview 언급이 없음. 현재 `isMobile` 상태(line 96-102)로 사이드바를 숨기고 있으므로, 모바일에서 Mini Cart 편집/삭제 UX도 터치 친화적으로 고려 필요 (스와이프 삭제 또는 롱프레스 편집 등).
3. **예상 KRW 표시 위치**: 계획서에서 "below the input"이라 했지만, 현재 폼 레이아웃상 "리스트에 추가" 버튼(line 412-418) 바로 위에 표시하는 것이 시각적으로 자연스러움.

### 3. 결론

계획 대비 구현 준비도: **90%** - 위 보완사항 반영 시 구현 가능.
우선순위 권장: A(Number Formatting) > C(Cash UX) > B(Edit Mode) 순서로 구현하면 의존성 충돌 없이 진행 가능.
