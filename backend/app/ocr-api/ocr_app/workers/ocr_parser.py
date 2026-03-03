"""
OCR 텍스트 파서 (업비트 카드형 레이아웃 우선)

핵심 개선:
1. 라벨(보유수량/매수평균가/매수금액) 주변 값 탐색 시 "위쪽 값 우선"으로 처리
2. 매수평균가가 매수금액/평가금액으로 잘못 매핑되는 경우 보정
3. 기존 응답 스키마(symbol, amount, avg_price, asset_type, currency) 유지
"""

import re
from typing import Dict, List, Optional


KNOWN_CRYPTO_SYMBOLS = {
    "BTC": ["비트코인", "Bitcoin"],
    "ETH": ["이더리움", "Ethereum"],
    "USDT": ["테더", "Tether"],
    "BNB": ["바이낸스코인", "Binance Coin"],
    "XRP": ["리플", "Ripple"],
    "USDC": ["USD코인", "USD Coin"],
    "ADA": ["에이다", "Cardano"],
    "DOGE": ["도지코인", "Dogecoin"],
    "SOL": ["솔라나", "Solana"],
    "TRX": ["트론", "Tron"],
}

KNOWN_STOCK_SYMBOLS = {
    "005930": ["삼성전자", "Samsung Electronics"],
    "000660": ["SK하이닉스", "SK Hynix"],
    "005380": ["현대차", "Hyundai Motor"],
    "035420": ["NAVER", "NAVER"],
    "035720": ["카카오", "Kakao"],
    "373220": ["LG에너지솔루션", "LG Energy Solution"],
    "207940": ["삼성바이오로직스", "Samsung Biologics"],
    "068270": ["셀트리온", "Celltrion"],
    "005490": ["POSCO홀딩스", "POSCO Holdings"],
    "105560": ["KB금융", "KB Financial"],
}

AMOUNT_LABELS = ["보유수량", "보유량", "수량"]
AVG_PRICE_LABELS = ["매수평균가", "평단가", "평균단가", "평균가"]
TOTAL_COST_LABELS = ["매수금액"]
NON_VALUE_LABELS = [
    *AMOUNT_LABELS,
    *AVG_PRICE_LABELS,
    *TOTAL_COST_LABELS,
    "평가금액",
    "평가손익",
    "수익률",
]


def extract_numbers(text: str) -> List[float]:
    """텍스트에서 숫자 목록 추출."""
    matches = re.findall(r"[\d,]+\.?\d*", text)
    numbers: List[float] = []
    for match in matches:
        try:
            normalized = match.replace(",", "")
            if normalized and normalized != ".":
                numbers.append(float(normalized))
        except ValueError:
            continue
    return numbers


def _contains_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def find_symbol_in_text(text: str) -> Optional[tuple]:
    """텍스트에서 티커/종목 추정."""
    text_upper = text.upper()

    ticker_match = re.search(r"\(([A-Z]{2,10})\)", text_upper)
    if ticker_match:
        return (ticker_match.group(1), "crypto")

    for symbol, names in KNOWN_CRYPTO_SYMBOLS.items():
        if symbol in text_upper:
            return (symbol, "crypto")
        if any(name in text for name in names):
            return (symbol, "crypto")

    for code, names in KNOWN_STOCK_SYMBOLS.items():
        if code in text:
            return (names[0], "stock")
        if any(name in text for name in names):
            return (names[0], "stock")

    return None


def _find_label_index(lines: List[str], start: int, end: int, labels: List[str]) -> Optional[int]:
    for i in range(start, end):
        if _contains_any(lines[i], labels):
            return i
    return None


def _extract_value_near_label(
    lines: List[str],
    label_idx: int,
    *,
    prefer_above: bool = True,
    max_distance: int = 3,
) -> Optional[float]:
    """라벨 주변에서 숫자 값을 추출. 카드형 UI를 위해 위쪽 우선."""
    offsets: List[int] = []
    if prefer_above:
        for dist in range(1, max_distance + 1):
            offsets.extend([-dist, dist])
    else:
        for dist in range(1, max_distance + 1):
            offsets.extend([dist, -dist])

    for offset in offsets:
        idx = label_idx + offset
        if idx < 0 or idx >= len(lines):
            continue

        candidate = lines[idx].strip()
        if not candidate:
            continue
        if _contains_any(candidate, NON_VALUE_LABELS):
            continue
        if "%" in candidate:
            continue

        nums = extract_numbers(candidate)
        if nums:
            return nums[0]

    return None


def _correct_avg_price_with_total_cost(
    *,
    amount: Optional[float],
    avg_price: Optional[float],
    total_cost: Optional[float],
) -> Optional[float]:
    """
    매수평균가 오인식 보정.
    - amount, total_cost가 있으면 derived_avg = total_cost / amount 계산
    - 기존 avg_price와 큰 불일치 시 derived_avg로 교체
    """
    if amount is None or total_cost is None or amount <= 0:
        return avg_price

    derived_avg = total_cost / amount
    if avg_price is None:
        return derived_avg

    implied_total = avg_price * amount
    # 35% 이상 괴리면 오인식으로 판단
    mismatch_ratio = abs(implied_total - total_cost) / max(total_cost, 1.0)
    if mismatch_ratio > 0.35:
        return derived_avg

    return avg_price


def extract_upbit_data(lines: List[str]) -> List[Dict]:
    """
    업비트 카드형 화면에서 자산 데이터 추출.
    기본 앵커: 보유수량
    """
    results: List[Dict] = []
    seen_symbols: set[str] = set()
    anchor_indices = [i for i, line in enumerate(lines) if _contains_any(line, AMOUNT_LABELS)]

    for idx in anchor_indices:
        amount: Optional[float] = None
        avg_price: Optional[float] = None
        total_cost: Optional[float] = None
        symbol = "알 수 없음"
        asset_type = "crypto"

        if idx > 0:
            amount_line = lines[idx - 1].strip()
            numbers = extract_numbers(amount_line)
            if numbers:
                amount = numbers[0]
            symbol_guess = find_symbol_in_text(amount_line)
            if symbol_guess:
                symbol, asset_type = symbol_guess

        if symbol == "알 수 없음":
            for j in range(max(0, idx - 12), idx):
                symbol_guess = find_symbol_in_text(lines[j])
                if symbol_guess:
                    symbol, asset_type = symbol_guess
                    break

        scan_end = min(idx + 16, len(lines))

        avg_label_idx = _find_label_index(lines, idx + 1, scan_end, AVG_PRICE_LABELS)
        if avg_label_idx is not None:
            avg_price = _extract_value_near_label(lines, avg_label_idx, prefer_above=True)

        total_cost_label_idx = _find_label_index(lines, idx + 1, scan_end, TOTAL_COST_LABELS)
        if total_cost_label_idx is not None:
            total_cost = _extract_value_near_label(lines, total_cost_label_idx, prefer_above=True)

        avg_price = _correct_avg_price_with_total_cost(
            amount=amount,
            avg_price=avg_price,
            total_cost=total_cost,
        )

        if amount is None:
            continue

        if symbol in seen_symbols and symbol != "알 수 없음":
            continue

        results.append(
            {
                "symbol": symbol,
                "amount": amount,
                "avg_price": avg_price,
                "asset_type": asset_type,
                "currency": "KRW",
                "recognized": symbol != "알 수 없음" and avg_price is not None,
            }
        )

        if symbol != "알 수 없음":
            seen_symbols.add(symbol)

        print(
            f"[SUCCESS] Anchor extraction: {symbol}({asset_type}) | Amount: {amount} | "
            f"Avg: {avg_price} | TotalCost: {total_cost}"
        )

    return results


def parse_portfolio_text(raw_text: str) -> List[Dict]:
    """메인 파서."""
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    print(f"[OCR] Total {len(lines)} lines parsing started (anchor method)")

    items = extract_upbit_data(lines)
    if not items:
        print("[WARNING] Anchor-based extraction failed, fallback logic prepared (to be implemented)")

    print(f"[SUCCESS] Returning {len(items)} items")
    return items
