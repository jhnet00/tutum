from __future__ import annotations

import math
import sys
from pathlib import Path


OCR_API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OCR_API_ROOT))

from ocr_app.workers.ocr_parser import parse_portfolio_text  # noqa: E402


def _find(items: list[dict], symbol: str) -> dict:
    for item in items:
        if item.get("symbol") == symbol:
            return item
    raise AssertionError(f"symbol not found: {symbol}, items={items}")


def test_upbit_card_layout_prefers_value_above_avg_price_label() -> None:
    raw_text = """
투자내역
비트코인 (BTC)
0.00381993 BTC
보유수량
130,719,102 KRW
매수평균가
487,579 KRW
평가금액
499,338 KRW
매수금액
"""

    items = parse_portfolio_text(raw_text)
    btc = _find(items, "BTC")

    assert math.isclose(float(btc["amount"]), 0.00381993, rel_tol=0, abs_tol=1e-12)
    assert math.isclose(float(btc["avg_price"]), 130_719_102.0, rel_tol=0, abs_tol=1e-6)


def test_avg_price_uses_total_cost_div_amount_when_mismatched() -> None:
    raw_text = """
투자내역
비트코인 (BTC)
0.00381993 BTC
보유수량
499,338 KRW
매수평균가
487,579 KRW
평가금액
499,338 KRW
매수금액
"""

    items = parse_portfolio_text(raw_text)
    btc = _find(items, "BTC")

    expected_avg = 499_338.0 / 0.00381993
    assert math.isclose(float(btc["avg_price"]), expected_avg, rel_tol=0, abs_tol=1e-6)
