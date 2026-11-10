"""Tests for the dashboard aggregations, the shared filters and the merchant rules.

All rows are synthetic and built in this file. Nothing reads statements/ or reports/.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from app import analytics
from app.ingest.classify import Classifier
from app.ingest.parsers import RawTransaction

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
LOCAL_FIXTURE = ROOT / "tests" / "fixtures" / "local"


def _row(day: str, amount: float, subcategory: str, category: str, kind: str, merchant: str = "Shop", **flags) -> dict:
    base = {
        "is_income": False,
        "is_earned_income": False,
        "is_transfer": kind == "transfer",
        "is_card_repayment": False,
        "is_refund": kind == "refund",
        "needs_review": False,
    }
    base.update(flags)
    return {
        "id": f"{day}-{merchant}-{amount}",
        "date": day,
        "amount": amount,
        "account": "debit-card",
        "merchant": merchant,
        "subcategory_id": subcategory,
        "category_id": category,
        "kind": kind,
        "description": merchant.upper(),
        "flags": base,
    }


ROWS = [
    _row("2025-01-05", 2500.0, "income.salary", "income", "income", "Employer", is_income=True, is_earned_income=True),
    _row("2025-01-07", -12.0, "eating_out.cafes_coffee", "eating_out", "discretionary", "Cafe A"),
    _row("2025-01-09", -80.0, "food.supermarket", "food", "essential", "Grocer"),
    _row("2025-01-20", -200.0, "debt.personal_loan", "debt", "debt", "Loan Co"),
    _row("2025-02-03", -30.0, "eating_out.fast_food", "eating_out", "discretionary", "Quick Bite"),
    _row("2025-02-10", 2500.0, "income.salary", "income", "income", "Employer", is_income=True, is_earned_income=True),
    _row("2025-02-11", -500.0, "transfers.own_accounts", "transfers", "transfer", "Savings Pot"),
    _row("2025-02-14", 40.0, "refunds.merchant", "refunds", "refund", "Shop", is_refund=True),
    _row("2025-03-02", -250.0, "shopping.general_retail", "shopping", "discretionary", "Store"),
]


def test_previous_window_is_the_same_length_ending_the_day_before():
    # Three days, 3 to 5 February 2025, compare with 31 January to 2 February 2025.
    assert analytics.previous_window("2025-02-03", "2025-02-05", "2025-01-01") == ("2025-01-31", "2025-02-02")


def test_previous_window_is_none_when_open_or_before_the_data():
    assert analytics.previous_window(None, None, "2025-01-01") is None
    # The earlier period would start before the first transaction, so there is nothing fair to compare.
    assert analytics.previous_window("2025-01-05", "2025-01-10", "2025-01-01") is None


def test_filter_rows_by_kind_group_and_amount_magnitude():
    spend = analytics.filter_rows(ROWS, kind="spending")
    assert all(r["kind"] in analytics.SPEND_KINDS | {"refund"} for r in spend)
    assert {r["merchant"] for r in analytics.filter_rows(ROWS, kind="income")} == {"Employer"}
    mid = analytics.filter_rows(ROWS, min_amount=25, max_amount=100)
    # Magnitudes: the £30, £40 and £80 rows fall in range; the £12 and £200 rows do not.
    assert sorted(r["amount"] for r in mid) == [-80.0, -30.0, 40.0]


def test_filter_rows_by_merchant_and_plain_kind():
    assert [r["merchant"] for r in analytics.filter_rows(ROWS, merchant="cafe a")] == ["Cafe A"]
    assert len(analytics.filter_rows(ROWS, kind="transfer")) == 1


def test_breakdown_sums_match_the_headline_figures():
    kpi = analytics.kpis(ROWS)
    detail = analytics.breakdown(ROWS, top=50)
    spend_total = sum(c["value"] for c in detail["spending"]["by_category"])
    debt_total = sum(s["value"] for s in detail["debt_service"]["by_subcategory"])
    earned_total = sum(s["value"] for s in detail["earned_income"]["by_source"])
    assert round(spend_total, 2) == round(kpi["spending"], 2)
    assert round(debt_total, 2) == round(kpi["debt_service"], 2)
    assert round(earned_total, 2) == round(kpi["earned_income"], 2)
    assert round(detail["net"]["money_in"] - detail["net"]["money_out"], 2) == round(kpi["net"], 2)


def test_analytics_carries_previous_block_only_when_asked():
    now = analytics.analytics(ROWS)
    assert now["previous"] is None
    prev_rows = analytics.filter_rows(ROWS, date_from="2025-01-01", date_to="2025-01-31")
    with_prev = analytics.analytics(ROWS, prev_rows, ("2025-01-01", "2025-01-31"))
    assert with_prev["previous"]["from"] == "2025-01-01"
    assert with_prev["previous"]["kpis"]["transactions"] == 4


def test_pret_is_coffee_and_greggs_is_bakery_not_fast_food():
    classifier = Classifier.from_config(CONFIG, LOCAL_FIXTURE)

    def raw(description: str, amount: float) -> RawTransaction:
        return RawTransaction("t.csv", 0, "debit-card", date(2025, 1, 1), None, amount, description)

    pret = classifier.classify(raw("PRET A MANGER 99999 TESTTOWN", -4.5))
    assert pret.subcategory_id == "eating_out.cafes_coffee"
    assert pret.merchant == "Pret A Manger"

    greggs = classifier.classify(raw("GREGGS 12345 TESTTOWN", -2.2))
    assert greggs.subcategory_id == "food.bakery_specialty"
