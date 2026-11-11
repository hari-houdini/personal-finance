"""Tests for the budget plan: trailing baseline, allowances, the saving slider and the bike switch.

All rows are synthetic and built in this file. Nothing reads statements/, reports/ or config/local/.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from app import budget

ROOT = Path(__file__).resolve().parents[1]
TODAY = date(2026, 11, 11)  # complete months are Aug, Sep and Oct 2026


def _rec(day: str, amount: float, sub: str, kind: str, desc: str = "Shop") -> dict:
    return {"date": day, "amount": amount, "subcategory_id": sub, "kind": kind, "description": desc}


RULES = {
    "trailing_months": 3,
    "mandatory_subcategories": ["housing.rent"],
    "mandatory_kinds": ["debt"],
    "protected_subcategories": ["food.supermarket"],
    "variable_kinds": ["essential", "discretionary", "fee", "refund"],
    "variable_transfer_subcategories": ["transfers.family_out"],
}

LOCAL = {
    "base_salary": {"amount": 3000},
    "household_contribution": {"amount": 800},
    "family_support": {"payee_pattern": "FAMILY PAYEE", "education_loan_monthly": 500, "protected_monthly": 300},
    "bike": {"payee_pattern": "BIKE INSURER", "sold": False},
    "excluded_patterns": ["ONE OFF SHOP"],
}

TARGETS = {"savings_rate": 0.2, "emergency_fund_months": {"start": 3, "target": 6}}

RECORDS = [
    _rec("2026-08-28", 3000, "income.salary", "income", "EMPLOYER"),
    _rec("2026-09-28", 4500, "income.salary", "income", "EMPLOYER"),
    _rec("2026-10-28", 3000, "income.salary", "income", "EMPLOYER"),
    _rec("2026-08-01", -1000, "housing.rent", "essential", "LANDLORD"),
    _rec("2026-09-01", -1000, "housing.rent", "essential", "LANDLORD"),
    _rec("2026-10-01", -1000, "housing.rent", "essential", "LANDLORD"),
    _rec("2026-08-10", -100, "food.supermarket", "essential"),
    _rec("2026-09-10", -200, "food.supermarket", "essential"),
    _rec("2026-10-10", -150, "food.supermarket", "essential"),
    _rec("2026-08-15", -60, "eating_out.cafes_coffee", "discretionary"),
    _rec("2026-09-15", -60, "eating_out.cafes_coffee", "discretionary"),
    _rec("2026-10-15", -60, "eating_out.cafes_coffee", "discretionary"),
    _rec("2026-10-05", -60, "transfers.family_out", "transfer", "FAMILY MEMBER"),
    _rec("2026-09-05", -800, "transfers.family_out", "transfer", "FAMILY PAYEE P1 BP"),
    _rec("2026-09-20", -1250, "review.unknown_merchant", "review", "ONE OFF SHOP LTD"),
    _rec("2026-10-20", -50, "review.unknown_merchant", "review", "SOME SHOP"),
    _rec("2026-08-07", -4.57, "insurance.other", "essential", "BIKE INSURER"),
    _rec("2026-09-07", -4.57, "insurance.other", "essential", "BIKE INSURER"),
    _rec("2026-10-07", -4.57, "insurance.other", "essential", "BIKE INSURER"),
    _rec("2026-10-02", 200, "transfers.own_accounts", "transfer", "TOP UP"),
]


def _baseline() -> dict:
    return budget.baseline(RECORDS, RULES, LOCAL, TODAY)


def _plan(local: dict = LOCAL, user_balances: dict | None = None, **kwargs) -> dict:
    return budget.compute_plan(_baseline(), RULES, local, user_balances or {}, TARGETS, {}, **kwargs)


def test_complete_months_skips_current_month_and_rolls_back_a_year():
    assert budget.complete_months(TODAY, 3) == ["2026-08", "2026-09", "2026-10"]
    assert budget.complete_months(date(2026, 2, 1), 3) == ["2025-11", "2025-12", "2026-01"]


def test_baseline_uses_latest_month_for_fixed_and_averages_variable():
    bl = _baseline()
    assert bl["window_months"] == ["2026-08", "2026-09", "2026-10"]
    assert bl["mandatory"]["housing.rent"] == {"amount": 1000.0, "basis": "latest month (2026-10)"}
    assert bl["protected"]["food.supermarket"] == 150.0  # (100 + 200 + 150) / 3
    assert bl["discretionary"]["eating_out.cafes_coffee"] == 60.0
    assert bl["discretionary"]["transfers.family_out"] == 20.0  # only the non-FAMILY PAYEE transfer is variable
    assert bl["bike"] == 4.57
    assert bl["family_support"]["monthly_average"] == round(800 / 3, 2)
    assert bl["excluded"]["total"] == 1250.0  # the one-off is excluded, not counted as spending
    assert bl["unresolved"]["rows"] == 1


def test_bonus_is_flagged_and_not_counted_in_income():
    bl = _baseline()
    assert bl["bonus"] == [{"month": "2026-09", "amount": 1500.0}]
    plan = _plan(saving=300)
    assert plan["income"]["total"] == 3800.0  # base 3000 + household 800, no bonus


def test_allowances_add_back_up_to_income():
    plan = _plan(saving=300)
    protected = plan["protected"]["total"]
    discretionary = sum(line["allowance"] for line in plan["discretionary"]["lines"])
    total = plan["mandatory"]["total"] + protected + plan["saving"]["value"] + discretionary
    assert abs(total - plan["income"]["total"]) < 0.05


def test_slider_is_clamped_to_the_affordable_range():
    plan = _plan(saving=10_000)
    assert plan["saving"]["value"] == plan["saving"]["max"] == 1840.0
    assert plan["discretionary"]["budget"] <= 10
    assert _plan(saving=-5)["saving"]["value"] == 0


def test_default_saving_is_the_target_rate_when_affordable():
    plan = _plan()
    assert plan["saving"]["target"] == 760.0
    assert plan["saving"]["value"] == 760.0


def test_bike_switch_removes_its_cost_from_the_plan():
    owned = _plan(saving=300, bike_sold=False)
    sold = _plan(saving=300, bike_sold=True)
    assert any(line["id"] == "bike.insurance" for line in owned["mandatory"]["lines"])
    assert not any(line["id"] == "bike.insurance" for line in sold["mandatory"]["lines"])
    assert sold["mandatory"]["total"] == round(owned["mandatory"]["total"] - 4.57, 2)
    assert sold["saving"]["max"] >= owned["saving"]["max"]


def test_shortfall_cuts_protected_spending_and_flags_it():
    plan = _plan(saving=0, local={**LOCAL, "base_salary": {"amount": 1000}, "household_contribution": {"amount": 0}})
    assert plan["protected"]["scale"] == 0
    assert any("more than your income" in flag for flag in plan["flags"])


def test_fixed_override_replaces_the_latest_month_amount():
    plan = _plan(saving=300, local={**LOCAL, "fixed_overrides": {"housing.rent": 1100}})
    rent = next(line for line in plan["mandatory"]["lines"] if line["id"] == "housing.rent")
    assert rent["amount"] == 1100.0
    assert rent["basis"] == "set in config/local/budget.json"


def test_emergency_fund_and_debt_months():
    local = {**LOCAL, "debts": {"education_loan": {"balance": 2000, "apr": 0, "months_left": None}}}
    plan = _plan(saving=300, local=local, user_balances={"emergency_fund_balance": 3000})
    fund = plan["stability"]["emergency_fund"]
    assert fund["months_cover"] == round(3000 / plan["mandatory"]["total"], 2)
    assert fund["months_to_start"] == round((3 * plan["mandatory"]["total"] - 3000) / 300, 1)
    education = next(d for d in plan["stability"]["debts"] if d["name"] == "Education loan")
    assert education["months_to_clear"] == 4.0


def test_committed_rules_file_names_the_expected_groups():
    rules = json.loads((ROOT / "config" / "budget.json").read_text(encoding="utf-8"))
    assert "housing.rent" in rules["mandatory_subcategories"]
    assert "food.supermarket" in rules["protected_subcategories"]
    assert "transfers.family_out" in rules["variable_transfer_subcategories"]


def test_subcategory_names_reads_taxonomy_shape():
    taxonomy = {"categories": [{"id": "housing", "subcategories": [{"id": "housing.rent", "name": "Rent"}]}]}
    assert budget.subcategory_names(taxonomy) == {"housing.rent": "Rent"}
