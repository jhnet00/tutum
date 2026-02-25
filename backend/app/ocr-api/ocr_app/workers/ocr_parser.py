"""
OCR 텍스트 파싱 엔진 - 업비트/거래소 형식 지원 (고도화 버전)

기본 전략:
1. '보유수량' 키워드를 앵커로 설정 -> 바로 윗줄에서 수량 추출
2. '매수평균가' 키워드를 앵커로 설정 -> 바로 아랫줄에서 가격 추출
3. 데이터 발견 시 인접 라인에서 심볼/종목명 역추적
4. 최종 결과 중복 제거
"""

import re
from typing import List, Dict, Optional

# ============================================
# 심볼 데이터베이스
# ============================================

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

# ============================================
# 헬퍼 함수
# ============================================


def extract_numbers(text: str) -> List[float]:
    """텍스트에서 모든 숫자 추출 (쉼표 제거)"""
    # 0.00381993 BTC 같은 경우 소수점 포함 인식
    pattern = r"[\d,]+\.?\d*"
    matches = re.findall(pattern, text)
    numbers = []
    for match in matches:
        try:
            # 쉼표 제거 후 float 변환
            clean_match = match.replace(",", "")
            if clean_match and clean_match != ".":
                numbers.append(float(clean_match))
        except ValueError:
            continue
    return numbers


def find_symbol_in_text(text: str) -> Optional[tuple]:
    """텍스트에서 알려진 심볼 또는 (BTC) 형태의 티커 찾기"""
    text_upper = text.upper()

    # 1. (BTC) 형태의 티커 추출 시도
    ticker_match = re.search(r"\(([A-Z]{2,10})\)", text_upper)
    if ticker_match:
        ticker = ticker_match.group(1)
        return (ticker, "token")

    # 2. 알려진 심볼 매칭
    for symbol, names in KNOWN_CRYPTO_SYMBOLS.items():
        if symbol in text_upper:
            return (symbol, "crypto")
        for name in names:
            if name in text:
                return (symbol, "crypto")

    for code, names in KNOWN_STOCK_SYMBOLS.items():
        if code in text:
            return (names[0], "stock")
        for name in names:
            if name in text:
                return (names[0], "stock")

    return None


# ============================================
# 업비트 특화 파싱 로직 (앵커 기반)
# ============================================


def extract_upbit_data(lines: List[str]) -> List[Dict]:
    """
    업비트 형식 앵커 기반 추출
    '보유수량' -> 위쪽은 수량
    '매수평균가' -> 아래쪽은 가격
    """
    results = []
    seen_symbols = set()

    # 1. '보유수량' 위치들 찾기
    anchor_indices = [i for i, line in enumerate(lines) if "보유수량" in line.strip()]

    for idx in anchor_indices:
        amount = None
        avg_price = None
        symbol = "알 수 없음"

        # A. 보유수량 추출 (바로 윗줄)
        if idx > 0:
            amount_line = lines[idx - 1].strip()
            numbers = extract_numbers(amount_line)
            if numbers:
                amount = numbers[0]
                # 팁: 수량 줄에 종목 이름도 있을 수 있으니 심볼 추출 시도
                sym_match = find_symbol_in_text(amount_line)
                if sym_match:
                    symbol = sym_match[0]

        # B. 심볼 역추적 (수량 줄이나 그 위 5줄 안에서)
        asset_type = "crypto"  # 기본값
        if symbol == "알 수 없음":
            for j in range(max(0, idx - 10), idx):
                sym_match = find_symbol_in_text(lines[j])
                if sym_match:
                    symbol = sym_match[0]
                    asset_type = sym_match[1]
                    break

        # C. 매수평균가 추출 ('보유수량' 아래 10줄 이내에서 '매수평균가' 찾기)
        for j in range(idx + 1, min(idx + 10, len(lines))):
            if "매수평균가" in lines[j]:
                if j + 1 < len(lines):
                    price_line = lines[j + 1].strip()
                    nums = extract_numbers(price_line)
                    if nums:
                        avg_price = nums[0]
                break

        if amount is not None:
            # 중복 제거: 심볼이 인식되었고 이미 처리한 적 없는 항목만 추가
            if symbol not in seen_symbols:
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
                seen_symbols.add(symbol)
                print(
                    f"[SUCCESS] Anchor extraction: {symbol}({asset_type}) | Amount: {amount} | Price: {avg_price}"
                )

    return results


def parse_portfolio_text(raw_text: str) -> List[Dict]:
    """메인 파서 - 앵커 기반 로직 사용"""
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

    print(f"[OCR] Total {len(lines)} lines parsing started (anchor method)")

    # 업비트 형식 추출
    items = extract_upbit_data(lines)

    if not items:
        print("[WARNING] Anchor-based extraction failed, fallback logic prepared (to be implemented)")
        # 필요시 기존의 일반 파싱 로직을 여기에 fallback으로 넣을 수 있음
        pass

    print(f"[SUCCESS] Returning {len(items)} items")
    return items
