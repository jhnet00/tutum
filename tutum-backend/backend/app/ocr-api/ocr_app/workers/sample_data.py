"""
OCR 샘플 데이터 - Vision API 결과 캐싱

Vision API 비용 절약을 위해 샘플 스크린샷의 OCR 결과를 미리 저장
테스트 시 실제 API 호출 대신 캐싱된 데이터 사용
"""

# ============================================
# 샘플 OCR 결과 (Vision API 1회 호출 후 저장)
# ============================================

SAMPLE_OCR_RESULTS = {
    # 샘플 1: 업비트 포트폴리오 (코인)
    "upbit_portfolio": {
        "raw_text": """보유 자산
코인        보유수량    매수평균가      매수금액
BTC         1.5        50,000,000     75,000,000
ETH         10.0       2,500,000      25,000,000
XRP         5000       1,200          6,000,000""",
        "items": [
            {
                "symbol": "BTC",
                "amount": 1.5,
                "avg_price": 50000000,
                "currency": "KRW",
                "recognized": True,
            },
            {
                "symbol": "ETH",
                "amount": 10.0,
                "avg_price": 2500000,
                "currency": "KRW",
                "recognized": True,
            },
            {
                "symbol": "XRP",
                "amount": 5000,
                "avg_price": 1200,
                "currency": "KRW",
                "recognized": True,
            },
        ],
    },
    # 샘플 2: 삼성증권 포트폴리오 (주식)
    "samsung_securities": {
        "raw_text": """보유 종목
종목명          보유수량    매수평균가      매수금액
삼성전자        15         72,500         1,087,500
SK하이닉스      8          128,000        1,024,000
현대차          10         245,000        2,450,000""",
        "items": [
            {
                "symbol": "삼성전자",
                "amount": 15,
                "avg_price": 72500,
                "currency": "KRW",
                "recognized": True,
            },
            {
                "symbol": "SK하이닉스",
                "amount": 8,
                "avg_price": 128000,
                "currency": "KRW",
                "recognized": True,
            },
            {
                "symbol": "현대차",
                "amount": 10,
                "avg_price": 245000,
                "currency": "KRW",
                "recognized": True,
            },
        ],
    },
}


# ============================================
# 필드 매핑 규칙
# ============================================

FIELD_MAPPINGS = {
    # 스크린샷 텍스트 → 우리 필드명
    "보유수량": "amount",
    "보유량": "amount",
    "수량": "amount",
    "보유": "amount",
    "매수평균가": "avg_price",
    "평단가": "avg_price",
    "평균단가": "avg_price",
    "평균가": "avg_price",
    "매수금액": "total_cost",
    "평가금액": "current_value",
}


def get_sample_result(sample_name: str = "upbit_portfolio"):
    """
    샘플 OCR 결과 가져오기

    Args:
        sample_name: "upbit_portfolio" | "samsung_securities"

    Returns:
        {"raw_text": str, "items": list}
    """
    return SAMPLE_OCR_RESULTS.get(sample_name, SAMPLE_OCR_RESULTS["upbit_portfolio"])
