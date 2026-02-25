"""
스마트 OCR 파싱 헬퍼 함수

테이블 구조 인식 + 키워드 패턴 매칭
"""

from typing import List, Dict, Optional, Tuple
import re


def find_symbol_in_text(
    text: str, crypto_db: dict, stock_db: dict
) -> Optional[Tuple[str, str]]:
    """
    텍스트에서 알려진 심볼 찾기

    Returns:
        (symbol, asset_type) 또는 None
        예: ("BTC", "crypto") 또는 ("삼성전자", "stock")
    """
    text_upper = text.upper()

    # 코인 심볼 매칭
    for symbol, names in crypto_db.items():
        if symbol in text_upper:
            return (symbol, "crypto")
        for name in names:
            if name in text:
                return (symbol, "crypto")

    # 주식 심볼 매칭
    for code, names in stock_db.items():
        if code in text:
            return (names[0], "stock")  # 한글 종목명 반환
        for name in names:
            if name in text:
                return (names[0], "stock")

    return None


def extract_price_near_keyword(line: str, keywords: List[str]) -> Optional[float]:
    """
    키워드 근처의 숫자를 가격으로 추출

    예: "평단가 72,500원" → 72500
    """
    for keyword in keywords:
        if keyword in line:
            # 키워드 이후의 숫자 찾기
            idx = line.find(keyword)
            after_keyword = line[idx + len(keyword) :]

            # 숫자 패턴 찾기
            pattern = r"[\d,]+\.?\d*"
            matches = re.findall(pattern, after_keyword)

            if matches:
                try:
                    return float(matches[0].replace(",", ""))
                except ValueError:
                    continue

    return None


def parse_table_structure(lines: List[str]) -> Optional[Dict[str, int]]:
    """
    테이블 헤더를 분석해서 컬럼 매핑 생성

    Returns:
        {"symbol": 0, "amount": 1, "avg_price": 2} 같은 컬럼 인덱스 맵
    """
    # 헤더 키워드
    symbol_keywords = ["종목", "코인", "자산", "symbol", "coin", "asset", "name"]
    amount_keywords = [
        "보유",
        "수량",
        "개수",
        "주",
        "amount",
        "quantity",
        "shares",
        "balance",
    ]
    price_keywords = [
        "평단가",
        "평균",
        "매수가",
        "단가",
        "가격",
        "avg",
        "price",
        "average",
    ]

    for line in lines[:5]:  # 처음 5줄만 확인
        line_lower = line.lower()
        parts = line.split()

        if len(parts) < 2:
            continue

        # 헤더로 보이는 라인 찾기
        has_symbol = any(kw in line_lower for kw in symbol_keywords)
        has_amount = any(kw in line_lower for kw in amount_keywords)
        has_price = any(kw in line_lower for kw in price_keywords)

        if has_symbol and (has_amount or has_price):
            # 컬럼 인덱스 매핑
            column_map = {}

            for i, part in enumerate(parts):
                part_lower = part.lower()

                if any(kw in part_lower for kw in symbol_keywords):
                    column_map["symbol"] = i
                elif any(kw in part_lower for kw in amount_keywords):
                    column_map["amount"] = i
                elif any(kw in part_lower for kw in price_keywords):
                    column_map["avg_price"] = i

            if "symbol" in column_map:
                return column_map

    return None


def parse_line_with_column_map(line: str, column_map: Dict[str, int]) -> Dict[str, any]:
    """
    컬럼 맵을 사용해서 라인 파싱
    """
    parts = line.split()
    result = {}

    if "symbol" in column_map and len(parts) > column_map["symbol"]:
        result["symbol"] = parts[column_map["symbol"]]

    if "amount" in column_map and len(parts) > column_map["amount"]:
        try:
            amount_str = (
                parts[column_map["amount"]]
                .replace(",", "")
                .replace("주", "")
                .replace("개", "")
            )
            result["amount"] = float(amount_str)
        except ValueError:
            pass

    if "avg_price" in column_map and len(parts) > column_map["avg_price"]:
        try:
            price_str = (
                parts[column_map["avg_price"]]
                .replace(",", "")
                .replace("원", "")
                .replace("$", "")
            )
            result["avg_price"] = float(price_str)
        except ValueError:
            pass

    return result
