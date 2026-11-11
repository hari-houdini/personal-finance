"""Budget plan: fixed, protected and variable spending, set against a chosen monthly saving.

Two steps, so the slider stays instant:
- baseline() reads transactions and produces trailing averages. The ingest pipeline runs it and writes reports/budget_baseline.json.
- compute_plan() turns that baseline and the owner's figures into allowances for one saving amount. The API runs it on each request.

Pure functions only. Nothing here reads statements/ or writes config/local/; callers load the files and pass the dicts in.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date

SAVING_STEP = 10.0
BONUS_RATIO = 1.05  # a salary credit more than 5% above base salary counts as a bonus
ANNUAL_MONTHS = 12  # lumpy fixed bills (annual_average_subcategories) are averaged over this many complete months
LIMITS = (
    "Variable spend uses the complete months in the trailing window, from the statements. Fixed costs use the latest "
    "complete month. Base salary, household contribution, family support and balances come from config/local/."
)


def subcategory_names(taxonomy: dict) -> dict[str, str]:
    return {s["id"]: s["name"] for c in taxonomy.get("categories", []) for s in c.get("subcategories", [])}


def complete_months(today: date, n: int) -> list[str]:
    """The n calendar months before the current one, oldest first. The current month is partial, so it is left out."""
    year, month = today.year, today.month
    out: list[str] = []
    for _ in range(max(n, 1)):
        month -= 1
        if month == 0:
            month, year = 12, year - 1
        out.append(f"{year:04d}-{month:02d}")
    return list(reversed(out))


def _matches(text: str, pattern: str | None) -> bool:
    return bool(pattern) and re.search(pattern, text, re.IGNORECASE) is not None


def _amount(entry: object) -> float:
    if isinstance(entry, dict):
        entry = entry.get("amount")
    return float(entry or 0)


def _money(value: float) -> float:
    return round(value + 0.0, 2)


def baseline(records: list[dict], rules: dict, local: dict, today: date) -> dict:
    """Trailing averages per subcategory, in money out (positive numbers). Run by the ingest pipeline."""
    n = int(rules.get("trailing_months", 3))
    window = complete_months(today, n)
    latest = window[-1]
    base = _amount(local.get("base_salary"))
    bike_pattern = (local.get("bike") or {}).get("payee_pattern")
    family_pattern = (local.get("family_support") or {}).get("payee_pattern")
    excluded = "|".join(local.get("excluded_patterns", [])) or None
    mandatory_subs = set(rules.get("mandatory_subcategories", []))
    mandatory_kinds = set(rules.get("mandatory_kinds", ["debt"]))
    protected_subs = set(rules.get("protected_subcategories", []))
    variable_kinds = set(rules.get("variable_kinds", ["essential", "discretionary", "fee", "refund"]))
    variable_transfers = set(rules.get("variable_transfer_subcategories", ["transfers.family_out"]))
    annual_subs = set(rules.get("annual_average_subcategories", []))
    annual_window = complete_months(today, ANNUAL_MONTHS)
    annual_sum: dict[str, float] = defaultdict(float)

    mandatory: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    protected: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    discretionary: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    bike: dict[str, float] = defaultdict(float)
    family: dict[str, float] = defaultdict(float)
    excluded_total: dict[str, float] = defaultdict(float)
    unresolved: dict[str, float] = defaultdict(float)
    unresolved_rows = 0
    salary: dict[str, float] = defaultdict(float)

    for r in records:
        month = r["date"][:7]
        sub, kind = r["subcategory_id"], r["kind"]
        if sub in annual_subs and month in annual_window and not _matches(r.get("description") or "", excluded):
            annual_sum[sub] += -float(r["amount"])
        if month not in window:
            continue
        desc = r.get("description") or ""
        amount = float(r["amount"])
        out = -amount  # positive = money out

        if kind == "income":
            if sub == "income.salary" and amount > 0:
                salary[month] += amount
            continue
        if _matches(desc, family_pattern):
            family[month] += out
            continue
        if _matches(desc, excluded):
            excluded_total[month] += out
            continue
        if sub in mandatory_subs or kind in mandatory_kinds:
            mandatory[sub][month] += out
            continue
        if sub in protected_subs:
            protected[sub][month] += out
            continue
        if _matches(desc, bike_pattern):
            bike[month] += out
            continue
        if kind == "review" or sub.startswith("review."):
            unresolved[month] += out
            unresolved_rows += 1
            continue
        if kind in variable_kinds or sub in variable_transfers:
            discretionary[sub][month] += out

    def average(by_month: dict[str, float]) -> float:
        return sum(by_month.values()) / n

    mandatory_lines = {}
    for sub in annual_subs:
        if annual_sum.get(sub, 0.0) > 0:
            mandatory_lines[sub] = {"amount": _money(annual_sum[sub] / ANNUAL_MONTHS), "basis": f"{ANNUAL_MONTHS}-month average"}
    for sub, by_month in mandatory.items():
        if sub in annual_subs:
            continue
        last = by_month.get(latest, 0.0)
        if last > 0:
            mandatory_lines[sub] = {"amount": _money(last), "basis": f"latest month ({latest})"}
        else:
            mandatory_lines[sub] = {"amount": _money(average(by_month)), "basis": "trailing average"}
    mandatory_lines = {sub: info for sub, info in mandatory_lines.items() if info["amount"] > 0}

    bonus = [
        {"month": m, "amount": _money(salary[m] - base)}
        for m in window
        if base and salary.get(m, 0.0) > base * BONUS_RATIO
    ]

    return {
        "generated_for": today.isoformat(),
        "window_months": window,
        "latest_month": latest,
        "mandatory": mandatory_lines,
        "protected": {sub: _money(average(v)) for sub, v in protected.items() if average(v) > 0},
        "discretionary": {sub: _money(average(v)) for sub, v in discretionary.items() if average(v) > 0},
        "bike": _money(average(bike)),
        "family_support": {"monthly_average": _money(average(family))},
        "bonus": bonus,
        "excluded": {"total": _money(sum(excluded_total.values())), "note": "one-off or ended costs, left out of the baseline"},
        "unresolved": {"monthly_average": _money(average(unresolved)), "rows": unresolved_rows},
    }


def _months_to(target: float, balance: float | None, saving: float) -> float | None:
    if balance is None:
        return None
    gap = target - balance
    if gap <= 0:
        return 0.0
    if saving <= 0:
        return None
    return round(gap / saving, 1)


def _debt(name: str, monthly: float, info: dict) -> dict:
    balance = info.get("balance")
    apr = float(info.get("apr") or 0)
    to_clear = round(balance / monthly, 1) if balance and monthly > 0 else None
    return {
        "name": name,
        "monthly": _money(monthly),
        "balance": balance,
        "apr": apr,
        "months_left": info.get("months_left"),
        "months_to_clear": to_clear,
    }


def compute_plan(
    baseline_data: dict,
    rules: dict,
    local: dict,
    user_balances: dict,
    targets: dict,
    names: dict[str, str],
    saving: float | None = None,
    bike_sold: bool | None = None,
) -> dict:
    """Allowances for one monthly saving amount. The slider sets `saving`; everything else follows from it."""
    base = _amount(local.get("base_salary"))
    household = _amount(local.get("household_contribution"))
    income = base + household
    family = local.get("family_support") or {}
    education_loan = float(family.get("education_loan_monthly") or 0)
    family_protected = float(family.get("protected_monthly") or 0)
    sold = bool((local.get("bike") or {}).get("sold")) if bike_sold is None else bool(bike_sold)
    bike_cost = 0.0 if sold else float(baseline_data.get("bike") or 0)

    overrides = local.get("fixed_overrides") or {}
    mandatory_lines = [
        {"id": sub, "name": names.get(sub, sub), "amount": _money(float(overrides[sub])), "basis": "set in config/local/budget.json"}
        if sub in overrides
        else {"id": sub, "name": names.get(sub, sub), "amount": info["amount"], "basis": info["basis"]}
        for sub, info in baseline_data.get("mandatory", {}).items()
    ]
    if education_loan:
        mandatory_lines.append({"id": "family.education_loan", "name": "Education loan", "amount": education_loan, "basis": "config/local/budget.json"})
    if bike_cost > 0:
        mandatory_lines.append({"id": "bike.insurance", "name": "Motorbike insurance (while you own it)", "amount": bike_cost, "basis": "trailing average"})
    mandatory_total = sum(line["amount"] for line in mandatory_lines)

    protected_hist = baseline_data.get("protected", {})
    protected_hist_total = sum(protected_hist.values()) + family_protected
    target_rate = float(targets.get("savings_rate", 0.2))
    max_saving = max(0.0, math.floor((income - mandatory_total - protected_hist_total) / SAVING_STEP) * SAVING_STEP)
    default_saving = min(max_saving, math.floor(target_rate * income / SAVING_STEP) * SAVING_STEP)
    saving = default_saving if saving is None else min(max(0.0, float(saving)), max_saving)

    spend_budget = income - mandatory_total - saving
    scale = 1.0
    if protected_hist_total > 0 and spend_budget < protected_hist_total:
        scale = max(0.0, spend_budget) / protected_hist_total
    protected_lines = [
        {"id": sub, "name": names.get(sub, sub), "historical": avg, "allowance": _money(avg * scale)}
        for sub, avg in sorted(protected_hist.items(), key=lambda kv: -kv[1])
    ]
    if family_protected:
        protected_lines.append({"id": "family.protected", "name": "Family support (protected)", "historical": family_protected, "allowance": _money(family_protected * scale)})
    protected_allowed = sum(line["allowance"] for line in protected_lines)

    discretionary_budget = max(0.0, spend_budget - protected_allowed)
    disc_hist = baseline_data.get("discretionary", {})
    disc_hist_total = sum(disc_hist.values())
    discretionary_lines = [
        {
            "id": sub,
            "name": names.get(sub, sub),
            "historical": avg,
            "allowance": _money(discretionary_budget * avg / disc_hist_total) if disc_hist_total else 0.0,
        }
        for sub, avg in sorted(disc_hist.items(), key=lambda kv: -kv[1])
    ]

    balance = user_balances.get("emergency_fund_balance")
    start_months = int(targets.get("emergency_fund_months", {}).get("start", 3))
    full_months = int(targets.get("emergency_fund_months", {}).get("target", 6))
    start_amount = start_months * mandatory_total
    full_amount = full_months * mandatory_total
    fund = {
        "balance": balance,
        "months_cover": round(balance / mandatory_total, 2) if balance is not None and mandatory_total > 0 else None,
        "target_start_months": start_months,
        "target_full_months": full_months,
        "target_start_amount": _money(start_amount),
        "target_full_amount": _money(full_amount),
        "months_to_start": _months_to(start_amount, balance, saving),
        "months_to_full": _months_to(full_amount, balance, saving),
    }

    details = local.get("debts") or {}
    debt_monthly = sum(line["amount"] for line in mandatory_lines if line["id"].startswith("debt."))
    debts = []
    if debt_monthly > 0 or details.get("car_finance"):
        debts.append(_debt("Car finance (VW Finance)", debt_monthly, details.get("car_finance") or {}))
    if education_loan or details.get("education_loan"):
        debts.append(_debt("Education loan", education_loan, details.get("education_loan") or {}))
    debts.sort(key=lambda d: -d["apr"])

    flags: list[str] = []
    if mandatory_total + protected_hist_total > income:
        flags.append("Fixed costs and protected spending are more than your income. Reduce a fixed cost or raise income to plan savings.")
    elif scale < 1:
        flags.append("Protected spending is cut to fit the saving you chose.")
    if balance is None:
        flags.append("Enter your emergency fund balance to see how many months it covers.")
    if any(d["balance"] is None for d in debts):
        flags.append("Enter the remaining balance for each debt to see when it clears.")
    cap = rules.get("energy_cap") or {}
    energy_line = next((line for line in mandatory_lines if line["id"] == "housing.energy"), None)
    if energy_line and cap and not cap.get("next_quarter_confirmed"):
        raised = _money(energy_line["amount"] * (1 + float(cap.get("next_quarter_forecast_increase", 0))))
        flags.append(
            f"The Ofgem cap for {cap.get('next_quarter', 'next quarter')} is not confirmed yet. "
            f"If it rises by the forecast, energy would be about £{raised:,.2f} a month."
        )
    benchmarks = {}
    for key, line_id in (("water", "housing.water"), ("energy", "housing.energy")):
        info = (rules.get("benchmarks") or {}).get(key)
        if info:
            yours = next((line["amount"] for line in mandatory_lines if line["id"] == line_id), None)
            benchmarks[key] = {"name": names.get(line_id, line_id), **info, "yours": yours}
    unresolved = baseline_data.get("unresolved", {})
    if unresolved.get("monthly_average", 0) > 0:
        flags.append(
            f"About £{unresolved['monthly_average']:,.2f} a month is still in Needs review and is not in this plan. "
            "Resolve those payees and the plan tightens."
        )
    if sold:
        flags.append("Motorbike marked as sold: its insurance is taken out of the plan.")
    if baseline_data.get("bonus"):
        flags.append("Bonus months are left out of income, so the plan is built on base salary only. Any bonus you save is extra to the plan.")

    return {
        "window_months": baseline_data.get("window_months", []),
        "bike_sold": sold,
        "income": {"base": _money(base), "household": _money(household), "total": _money(income)},
        "saving": {
            "value": _money(saving),
            "min": 0.0,
            "max": _money(max_saving),
            "step": SAVING_STEP,
            "default": _money(default_saving),
            "target_rate": target_rate,
            "target": _money(target_rate * income),
            "rate": round(saving / income, 4) if income else None,
        },
        "mandatory": {"total": _money(mandatory_total), "lines": mandatory_lines},
        "protected": {"total": _money(protected_allowed), "scale": round(scale, 4), "lines": protected_lines},
        "discretionary": {"budget": _money(discretionary_budget), "historical_total": _money(disc_hist_total), "lines": discretionary_lines},
        "stability": {
            "savings_rate": round(saving / income, 4) if income else None,
            "emergency_fund": fund,
            "debts": debts,
            "avalanche_order": [d["name"] for d in debts],
        },
        "bonus": baseline_data.get("bonus", []),
        "family_support": {
            "education_loan": education_loan,
            "protected": family_protected,
            "historical_monthly_average": baseline_data.get("family_support", {}).get("monthly_average"),
        },
        "benchmarks": benchmarks,
        "flags": flags,
        "limits": LIMITS,
    }
