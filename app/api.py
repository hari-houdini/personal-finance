"""FastAPI application: JSON API for the dashboard, plus the static web/ front end.

Binds to 127.0.0.1 only (see README.md for the run command). Nothing here touches statements/.
"""

from __future__ import annotations

import json
import math
import re

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import analytics, budget, chat, stability
from app.ingest import pipeline, resolver
from app.ingest.classify import Classifier, Taxonomy
from app.paths import (
    CONFIG_DIR,
    LOCAL_CONFIG_DIR,
    PROJECT_ROOT,
    REPORTS_DIR,
    STATEMENTS_DIR,
    WEB_DIR,
)

app = FastAPI(title="Personal finance", docs_url=None, redoc_url=None)
store = analytics.Store(REPORTS_DIR / "transactions.json")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


def _rows(f: dict):
    data = store.get()
    if data is None:
        raise HTTPException(409, "No reports yet. Run the import first (POST /api/import).")
    return data, analytics.filter_rows(data.transactions, **f)


def _filters(date_from, date_to, category, subcategory, merchant, account, kind, min_amount, max_amount) -> dict:
    return {
        "date_from": date_from,
        "date_to": date_to,
        "category": category,
        "subcategory": subcategory,
        "merchant": merchant,
        "account": account,
        "kind": kind,
        "min_amount": min_amount,
        "max_amount": max_amount,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/meta")
def meta() -> dict:
    data = store.get()
    taxonomy = json.loads((CONFIG_DIR / "taxonomy.json").read_text(encoding="utf-8"))
    manifest_path = REPORTS_DIR / "import_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if data is None:
        return {"ready": False, "taxonomy": taxonomy, "manifest": manifest}
    dates = [t["date"] for t in data.transactions]
    return {
        "ready": True,
        "generated_at": data.generated_at,
        "count": len(data.transactions),
        "first_date": min(dates) if dates else None,
        "last_date": max(dates) if dates else None,
        "needs_review": sum(1 for t in data.transactions if t["flags"]["needs_review"]),
        "taxonomy": taxonomy,
        "manifest": manifest,
    }


@app.get("/api/analytics")
def get_analytics(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    category: str | None = None,
    subcategory: str | None = None,
    merchant: str | None = None,
    account: str | None = None,
    kind: str | None = None,
    min_amount: float | None = Query(None, ge=0),
    max_amount: float | None = Query(None, ge=0),
) -> dict:
    f = _filters(date_from, date_to, category, subcategory, merchant, account, kind, min_amount, max_amount)
    data, rows = _rows(f)
    dates = [t["date"] for t in data.transactions]
    window = analytics.previous_window(date_from, date_to, min(dates) if dates else None)
    previous_rows = None
    if window is not None:
        prev_filters = {**f, "date_from": window[0], "date_to": window[1]}
        previous_rows = analytics.filter_rows(data.transactions, **prev_filters)
    return analytics.analytics(rows, previous_rows, window)


@app.get("/api/transactions")
def transactions(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    category: str | None = None,
    subcategory: str | None = None,
    merchant: str | None = None,
    account: str | None = None,
    kind: str | None = None,
    min_amount: float | None = Query(None, ge=0),
    max_amount: float | None = Query(None, ge=0),
    review: bool = False,
    q: str | None = None,
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> dict:
    _, rows = _rows(_filters(date_from, date_to, category, subcategory, merchant, account, kind, min_amount, max_amount))
    if review:
        rows = [r for r in rows if r["flags"]["needs_review"]]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in r["description"].lower() or needle in r["merchant"].lower()]
    rows = sorted(rows, key=lambda r: (r["date"], r["id"]), reverse=True)
    return {"total": len(rows), "items": rows[offset: offset + limit]}


@app.get("/api/stability")
def get_stability() -> dict:
    data = store.get()
    if data is None:
        raise HTTPException(409, "No reports yet. Run the import first.")
    return stability.compute(data.transactions, CONFIG_DIR / "stability.json", LOCAL_CONFIG_DIR / "stability.json")


def _read_optional(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _pins(raw: str | None) -> dict[str, float] | None:
    """Parse the owner's hand-set category amounts: a JSON object of line ID to pounds."""
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "allocations must be a JSON object") from exc
    if not isinstance(value, dict) or not all(
        isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in value.values()
    ):
        raise HTTPException(422, "allocations must map category IDs to amounts of zero or more")
    return {str(k): float(v) for k, v in value.items()}


@app.get("/api/budget")
def get_budget(
    saving: float | None = Query(None, ge=0),
    bike_sold: bool | None = None,
    allocations: str | None = Query(None, description="JSON object of variable category ID to pounds, for categories set by hand"),
) -> dict:
    """Budget plan for one monthly saving amount. saving defaults to the savings-rate target, capped at what is affordable."""
    baseline_path = REPORTS_DIR / "budget_baseline.json"
    if not baseline_path.exists():
        raise HTTPException(409, "No budget baseline yet. Run the import first.")
    pins = _pins(allocations)
    taxonomy = json.loads((CONFIG_DIR / "taxonomy.json").read_text(encoding="utf-8"))
    plan = budget.compute_plan(
        baseline_data=json.loads(baseline_path.read_text(encoding="utf-8")),
        rules=json.loads((CONFIG_DIR / "budget.json").read_text(encoding="utf-8")),
        local=_read_optional(LOCAL_CONFIG_DIR / "budget.json"),
        user_balances=_read_optional(LOCAL_CONFIG_DIR / "stability.json").get("user_entered", {}),
        targets=json.loads((CONFIG_DIR / "stability.json").read_text(encoding="utf-8")),
        names=budget.subcategory_names(taxonomy),
        saving=saving,
        bike_sold=bike_sold,
        allocations=pins,
    )
    if pins:
        variable = {line["id"] for line in plan["protected"]["lines"] + plan["discretionary"]["lines"]}
        unknown = sorted(set(pins) - variable)
        if unknown:
            raise HTTPException(422, f"unknown variable category {unknown[0]}")
    return plan


class Reclassify(BaseModel):
    transaction_id: str
    subcategory_id: str
    remember: bool = False


@app.post("/api/classify")
def reclassify(body: Reclassify) -> dict:
    """Move one transaction to another sub-category. remember=true saves a personal rule for its merchant."""
    taxonomy = Taxonomy.load(CONFIG_DIR / "taxonomy.json")
    if not taxonomy.valid(body.subcategory_id):
        raise HTTPException(422, f"unknown sub-category {body.subcategory_id}")
    data = store.get()
    tx = next((t for t in (data.transactions if data else []) if t["id"] == body.transaction_id), None)
    if tx is None:
        raise HTTPException(404, "transaction not found")
    if body.remember:
        fragment = resolver.fragment_for(tx["description"].upper(), set()) or tx["description"].upper()[:20]
        pattern = r"\b" + re.escape(fragment)
        path = LOCAL_CONFIG_DIR / "rules.json"
        LOCAL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        local = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"rules": []}
        local["rules"] = [r for r in local["rules"] if r.get("pattern") != pattern]
        local["rules"].insert(0, {"brand": tx["merchant"], "pattern": pattern, "subcategory": body.subcategory_id, "source": "user", "confidence": "high"})
        path.write_text(json.dumps(local, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not body.remember:
        # One-off correction, keyed by the stable transaction id, applied on every rebuild.
        LOCAL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        overrides = LOCAL_CONFIG_DIR / "overrides.json"
        current = json.loads(overrides.read_text(encoding="utf-8")) if overrides.exists() else {}
        current[body.transaction_id] = body.subcategory_id
        overrides.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    result = pipeline.build(STATEMENTS_DIR, REPORTS_DIR, CONFIG_DIR, LOCAL_CONFIG_DIR)
    return {"ok": True, **{k: result[k] for k in ("records", "needs_review")}}


@app.post("/api/import")
def run_import() -> dict:
    result = pipeline.build(STATEMENTS_DIR, REPORTS_DIR, CONFIG_DIR, LOCAL_CONFIG_DIR)
    return {k: result[k] for k in ("statements", "records", "needs_review", "failures", "generated_at")}


@app.get("/api/resolve/candidates")
def resolve_candidates() -> dict:
    """Fragments that would be sent to web search. Nothing is sent by this call."""
    data = store.get()
    classifier = Classifier.from_config(CONFIG_DIR, LOCAL_CONFIG_DIR, REPORTS_DIR / "merchant_cache.json")
    location = set(json.loads((CONFIG_DIR / "merchants.json").read_text(encoding="utf-8")).get("location_words", []))
    fragments = resolver.collect_candidates(data.transactions if data else [], classifier, location)
    return {"count": len(fragments), "fragments": fragments}


class ResolveRequest(BaseModel):
    fragments: list[str] = Field(..., min_length=1, max_length=200)


@app.post("/api/resolve")
def resolve_fragments(body: ResolveRequest) -> dict:
    """Search only the fragments the user has just approved in the UI."""
    allowed = set(resolve_candidates()["fragments"])
    approved = [f for f in body.fragments if f in allowed]
    if not approved:
        raise HTTPException(422, "none of the fragments are pending resolution")
    taxonomy = Taxonomy.load(CONFIG_DIR / "taxonomy.json")
    added = resolver.resolve(approved, taxonomy, REPORTS_DIR / "merchant_cache.json", PROJECT_ROOT)
    result = pipeline.build(STATEMENTS_DIR, REPORTS_DIR, CONFIG_DIR, LOCAL_CONFIG_DIR)
    return {"searched": len(approved), "resolved": len(added), "records": result["records"], "needs_review": result["needs_review"]}


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = None


@app.post("/api/chat")
def chat_endpoint(body: ChatRequest) -> dict:
    if not REPORTS_DIR.exists() or not (REPORTS_DIR / "transactions.json").exists():
        raise HTTPException(409, "No reports yet. Run the import first.")
    result = chat.ask(body.message, REPORTS_DIR, PROJECT_ROOT, body.session_id)
    if "error" in result:
        raise HTTPException(502, result["error"])
    return result


class BalancesRequest(BaseModel):
    emergency_fund_balance: float | None = None
    loan_balances: dict[str, dict] = Field(default_factory=dict)


@app.put("/api/stability/balances")
def set_balances(body: BalancesRequest) -> dict:
    """Saves balances to config/local/stability.json (gitignored), never to the committed config."""
    path = LOCAL_CONFIG_DIR / "stability.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    config = _read_optional(path) or {"user_entered": {}}
    config.setdefault("user_entered", {})
    config["user_entered"]["emergency_fund_balance"] = body.emergency_fund_balance
    config["user_entered"]["loan_balances"] = body.loan_balances
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"ok": True}
