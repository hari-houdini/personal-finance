"""Stability metrics: emergency-fund cover, savings rate, debt progress.

Limits, stated plainly in the output: statements show card and current-account
activity only. Balances come from config/local/stability.json (user_entered) when
that file exists, otherwise from config/stability.json, and otherwise from transfer
totals as an estimate, labelled as such.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from app.analytics import kpis, monthly

BASELINE_MONTHS_DEFAULT = 3


def _window_months(all_months: list[str], n: int) -> list[str]:
    return all_months[-n:] if all_months else []


def compute(rows: list[dict], config_path: Path, local_path: Path | None = None) -> dict:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if local_path is not None and local_path.exists():
        config["user_entered"] = json.loads(local_path.read_text(encoding="utf-8")).get("user_entered", {})
    n = int(config.get("trailing_months_for_baseline", BASELINE_MONTHS_DEFAULT))
    series = monthly(rows)
    # The current month is partial, so it is left out of the baseline to avoid understating averages.
    current = date.today().strftime("%Y-%m")
    months = [m["month"] for m in series if m["month"] < current]
    window = _window_months(months, n)
    window_rows = [r for r in rows if r["date"][:7] in window]
    k = kpis(window_rows)
    divisor = max(len(window), 1)

    essential_kinds = set(config.get("essential_kinds", ["essential"]))
    essential_monthly = sum(-r["amount"] for r in window_rows if r["kind"] in essential_kinds) / divisor
    earned_monthly = k["earned_income"] / divisor
    spending_monthly = k["spending"] / divisor
    debt_monthly = k["debt_service"] / divisor
    savings_monthly = k["savings_out"] / divisor
    surplus_monthly = earned_monthly - spending_monthly - debt_monthly

    target_rate = float(config.get("savings_rate_target", 0.20))
    rate = (surplus_monthly / earned_monthly) if earned_monthly > 0 else None
    gap = max(0.0, target_rate * earned_monthly - surplus_monthly) if earned_monthly > 0 else None

    user = config.get("user_entered", {})
    fund_balance = user.get("emergency_fund_balance")
    if fund_balance is not None:
        fund_source = "entered by you"
    else:
        fund_balance = sum(-r["amount"] for r in rows if r["subcategory_id"] in {"savings.emergency_fund", "savings.general"} and r["amount"] < 0)
        fund_source = "estimate: total paid into savings in the statements"
    months_cover = (fund_balance / essential_monthly) if essential_monthly > 0 else None

    debts = []
    by_sub: dict[str, float] = defaultdict(float)
    for r in window_rows:
        if r["kind"] == "debt":
            by_sub[r["subcategory_id"]] += -r["amount"] / divisor
    for sub, monthly_payment in sorted(by_sub.items(), key=lambda kv: -kv[1]):
        debts.append({"subcategory_id": sub, "monthly_payment": round(monthly_payment, 2)})
    loans = user.get("loan_balances", {}) or {}
    avalanche = sorted(
        ({"name": name, **info} for name, info in loans.items() if isinstance(info, dict)),
        key=lambda x: -float(x.get("apr", 0)),
    )

    return {
        "window_months": window,
        "baseline": {
            "earned_income_monthly": round(earned_monthly, 2),
            "essential_spend_monthly": round(essential_monthly, 2),
            "spending_monthly": round(spending_monthly, 2),
            "debt_service_monthly": round(debt_monthly, 2),
            "savings_out_monthly": round(savings_monthly, 2),
            "surplus_monthly": round(surplus_monthly, 2),
        },
        "savings_rate": round(rate, 4) if rate is not None else None,
        "savings_rate_target": target_rate,
        "monthly_gap_to_target": round(gap, 2) if gap is not None else None,
        "emergency_fund": {
            "balance": round(fund_balance, 2),
            "source": fund_source,
            "months_cover": round(months_cover, 2) if months_cover is not None else None,
            "target_start_months": config["emergency_fund_months"]["start"],
            "target_full_months": config["emergency_fund_months"]["target"],
            "target_start_amount": round(config["emergency_fund_months"]["start"] * essential_monthly, 2),
            "target_full_amount": round(config["emergency_fund_months"]["target"] * essential_monthly, 2),
        },
        "debt": {
            "method": config.get("debt_method", "avalanche"),
            "monthly_payments": debts,
            "avalanche_order": avalanche,
            "note": None if avalanche else "Enter your loan balances and APRs on the Stability plan tab to get the avalanche order.",
        },
        "series": series[-12:],
        "limits": "Statements cover card and current-account activity only. Balances marked as estimates come from transfers, not bank balances.",
    }
