"""Aggregations behind every chart. Pure functions over reports/transactions.json.

Money definitions (GBP, outflows are negative in the data, reported positive here):
  spending    essential + discretionary + fee + tax outflows, minus refunds
  debt        debt-kind outflows (loan and finance repayments)
  savings     savings-kind outflows (money set aside, not spent)
  transfers   transfer-kind rows (card repayments, family, own accounts). Excluded from net.
  earned      salary, self-employment and benefits credits
  net         every non-transfer row summed: money in minus money out
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

SPEND_KINDS = {"essential", "discretionary", "fee", "tax"}


@dataclass
class Dataset:
    transactions: list[dict]
    generated_at: str
    mtime: float


class Store:
    """Loads reports/transactions.json and reloads it when the file changes."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = Lock()
        self._data: Dataset | None = None

    def get(self) -> Dataset | None:
        if not self.path.exists():
            return None
        mtime = self.path.stat().st_mtime
        with self._lock:
            if self._data is None or self._data.mtime != mtime:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
                self._data = Dataset(payload["transactions"], payload.get("generated_at", ""), mtime)
            return self._data


def filter_rows(
    rows: list[dict],
    date_from: str | None = None,
    date_to: str | None = None,
    category: str | None = None,
    subcategory: str | None = None,
    merchant: str | None = None,
    account: str | None = None,
) -> list[dict]:
    out = []
    for r in rows:
        if date_from and r["date"] < date_from:
            continue
        if date_to and r["date"] > date_to:
            continue
        if category and r["category_id"] != category:
            continue
        if subcategory and not (r["subcategory_id"] == subcategory or r["subcategory_id"].startswith(subcategory + ".")):
            continue
        if merchant and r["merchant"].lower() != merchant.lower():
            continue
        if account and r["account"] != account:
            continue
        out.append(r)
    return out


def _money(value: float) -> float:
    return round(value, 2)


def kpis(rows: list[dict]) -> dict:
    earned = sum(r["amount"] for r in rows if r["flags"]["is_earned_income"])
    other_income = sum(r["amount"] for r in rows if r["flags"]["is_income"] and not r["flags"]["is_earned_income"])
    family_in = sum(r["amount"] for r in rows if r["subcategory_id"] == "transfers.family_in")
    spending_out = -sum(r["amount"] for r in rows if r["kind"] in SPEND_KINDS)
    refunds = sum(r["amount"] for r in rows if r["kind"] == "refund")
    spending = spending_out - refunds
    debt = -sum(r["amount"] for r in rows if r["kind"] == "debt")
    savings = -sum(r["amount"] for r in rows if r["kind"] == "savings")
    transfers_out = -sum(r["amount"] for r in rows if r["kind"] == "transfer" and r["amount"] < 0 and r["subcategory_id"] != "transfers.card_repayment")
    card_repayments = -sum(r["amount"] for r in rows if r["subcategory_id"] == "transfers.card_repayment")
    net = sum(r["amount"] for r in rows if not r["flags"]["is_transfer"])
    income_total = earned + other_income
    savings_rate = (income_total - spending - debt) / income_total if income_total > 0 else None
    return {
        "earned_income": _money(earned),
        "other_income": _money(other_income),
        "family_in": _money(family_in),
        "spending": _money(spending),
        "debt_service": _money(debt),
        "savings_out": _money(savings),
        "transfers_out": _money(transfers_out),
        "card_repayments": _money(card_repayments),
        "net": _money(net),
        "savings_rate": round(savings_rate, 4) if savings_rate is not None else None,
        "transactions": len(rows),
        "needs_review": sum(1 for r in rows if r["flags"]["needs_review"]),
    }


def monthly(rows: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        buckets[r["date"][:7]].append(r)
    series = []
    for month in sorted(buckets):
        rs = buckets[month]
        k = kpis(rs)
        by_category: dict[str, float] = defaultdict(float)
        for r in rs:
            if r["kind"] in SPEND_KINDS or r["kind"] == "refund":
                by_category[r["category_id"]] -= r["amount"]
        series.append({"month": month, **k, "by_category": {c: _money(v) for c, v in sorted(by_category.items())}})
    return series


def hierarchy(rows: list[dict]) -> dict:
    """category -> sub-category -> merchant tree of spending (for treemap and sunburst)."""
    tree: dict[str, dict] = {}
    for r in rows:
        if r["kind"] not in SPEND_KINDS and r["kind"] != "refund":
            continue
        value = -r["amount"]
        cat = tree.setdefault(r["category_id"], {"id": r["category_id"], "value": 0.0, "children": {}})
        cat["value"] += value
        sub = cat["children"].setdefault(r["subcategory_id"], {"id": r["subcategory_id"], "value": 0.0, "children": {}})
        sub["value"] += value
        merch = sub["children"].setdefault(r["merchant"], {"id": r["merchant"], "value": 0.0, "count": 0})
        merch["value"] += value
        merch["count"] = merch.get("count", 0) + 1
    def finish(node: dict) -> dict:
        children = node.get("children")
        out = {"id": node["id"], "value": _money(node["value"])}
        if "count" in node:
            out["count"] = node["count"]
        if children:
            out["children"] = sorted((finish(c) for c in children.values()), key=lambda c: -c["value"])
        return out
    return {"id": "spending", "value": _money(sum(c["value"] for c in tree.values())), "children": sorted((finish(c) for c in tree.values()), key=lambda c: -c["value"])}


def merchants(rows: list[dict], limit: int = 40) -> list[dict]:
    totals: dict[str, dict] = {}
    for r in rows:
        if r["kind"] not in SPEND_KINDS and r["kind"] != "refund":
            continue
        m = totals.setdefault(r["merchant"], {"merchant": r["merchant"], "value": 0.0, "count": 0, "subcategories": set()})
        m["value"] += -r["amount"]
        m["count"] += 1
        m["subcategories"].add(r["subcategory_id"])
    out = []
    for m in sorted(totals.values(), key=lambda x: -x["value"])[:limit]:
        out.append({
            "merchant": m["merchant"],
            "value": _money(m["value"]),
            "count": m["count"],
            "average": _money(m["value"] / m["count"]),
            "subcategories": sorted(m["subcategories"]),
        })
    return out


def daily_spend(rows: list[dict]) -> list[dict]:
    days: dict[str, float] = defaultdict(float)
    for r in rows:
        if r["kind"] in SPEND_KINDS or r["kind"] == "refund":
            days[r["date"]] += -r["amount"]
    return [{"date": d, "value": _money(v)} for d, v in sorted(days.items())]


def amounts_by_category(rows: list[dict], limit: int = 4000) -> dict[str, list[float]]:
    out: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        if r["kind"] in SPEND_KINDS:
            out[r["category_id"]].append(_money(-r["amount"]))
    return {c: v[:limit] for c, v in out.items()}


def flows(rows: list[dict]) -> dict:
    """Sankey-ready flows: income sources -> money kinds -> categories."""
    sources: dict[str, float] = defaultdict(float)
    kinds: dict[str, float] = defaultdict(float)
    cats: dict[str, float] = defaultdict(float)
    links: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        if r["flags"]["is_earned_income"]:
            sources[r["subcategory_id"]] += r["amount"]
    for r in rows:
        if r["kind"] in SPEND_KINDS or r["kind"] in {"debt", "savings"}:
            kinds[r["kind"]] += -r["amount"]
            if r["kind"] in SPEND_KINDS:
                cats[r["category_id"]] += -r["amount"]
                links[(r["kind"], f"cat:{r['category_id']}")] += -r["amount"]
    nodes = [{"id": f"src:{s}", "label": s} for s in sources] + [{"id": f"kind:{k}", "label": k} for k in kinds] + [{"id": f"cat:{c}", "label": c} for c in cats]
    links_out = [{"source": f"src:{s}", "target": "kind:income", "value": _money(v)} for s, v in sources.items()]
    links_out += [{"source": f"kind:{k}", "target": "kind:spendable", "value": _money(v)} for k, v in kinds.items()]
    links_out += [{"source": a, "target": b, "value": _money(v)} for (a, b), v in links.items()]
    return {"nodes": nodes, "links": links_out, "sources": {k: _money(v) for k, v in sources.items()}, "kinds": {k: _money(v) for k, v in kinds.items()}}


def transfers(rows: list[dict]) -> dict:
    """Account-to-transfer-type matrix for a chord diagram."""
    pairs: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        if r["kind"] == "transfer":
            pairs[(r["account"], r["subcategory_id"])] += abs(r["amount"])
    names = sorted({a for a, _ in pairs} | {s for _, s in pairs})
    matrix = [[_money(pairs.get((a, b), 0.0)) for b in names] for a in names]
    return {"names": names, "matrix": matrix}


def analytics(rows: list[dict]) -> dict:
    """Everything a dashboard view needs, for one filtered set of rows."""
    return {
        "kpis": kpis(rows),
        "monthly": monthly(rows),
        "hierarchy": hierarchy(rows),
        "merchants": merchants(rows),
        "daily": daily_spend(rows),
        "amounts_by_category": amounts_by_category(rows),
        "flows": flows(rows),
        "transfers": transfers(rows),
    }
