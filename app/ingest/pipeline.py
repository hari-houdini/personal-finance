"""Transform everything in statements/ into the derived reports/ folder.

reports/ is fully rebuilt on every run, so it can always be regenerated and never
drifts from the statements. Nothing here writes to statements/.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from app.ingest.classify import Classifier
from app.ingest.parsers import ParseError, RawTransaction, parse_statement

log = logging.getLogger("ingest")

ACCOUNT_FOLDERS = {"credit-card": "credit-card", "debit-card": "debit-card"}
STATEMENT_SUFFIXES = {".json", ".csv"}


def discover(statements_dir: Path) -> list[tuple[Path, str]]:
    """Return (path, account) for each statement, sorted for deterministic output."""
    found: list[tuple[Path, str]] = []
    for path in sorted(statements_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in STATEMENT_SUFFIXES:
            continue
        if path.name.startswith("."):
            continue
        account = ACCOUNT_FOLDERS.get(path.parent.name)
        if account is None:
            log.warning("skipping %s: parent folder is not credit-card or debit-card", path)
            continue
        found.append((path, account))
    return found


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _record_id(raw: RawTransaction) -> str:
    """Deterministic id from file name, row, date, amount and descriptor. Not a bank reference."""
    key = f"{raw.source}|{raw.row}|{raw.date.isoformat()}|{raw.amount:.2f}|{raw.description}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def build(
    statements_dir: Path,
    reports_dir: Path,
    config_dir: Path,
    local_dir: Path,
) -> dict:
    """Parse, classify and write all reports. Returns a small run summary."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    cache_path = reports_dir / "merchant_cache.json"
    classifier = Classifier.from_config(config_dir, local_dir, cache_path)

    overrides_path = local_dir / "overrides.json"
    overrides: dict[str, str] = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}

    statements = discover(statements_dir)
    manifest: list[dict] = []
    records: list[dict] = []
    failures: list[dict] = []

    for path, account in statements:
        entry = {"file": path.name, "account": account, "sha256": _sha256(path)}
        try:
            raws = parse_statement(path, account)
        except (ParseError, KeyError, ValueError) as exc:
            entry.update(status="failed", error=str(exc))
            failures.append({"file": path.name, "error": str(exc)})
            manifest.append(entry)
            log.error("failed to read %s: %s", path.name, exc)
            continue

        for raw in raws:
            record_id = _record_id(raw)
            classified = classifier.classify(raw, overrides.get(record_id))
            records.append(
                {
                    "id": record_id,
                    "date": raw.date.isoformat(),
                    "posted_date": raw.posted_date.isoformat() if raw.posted_date else None,
                    "amount": raw.amount,
                    "account": raw.account,
                    "description": raw.description,
                    "merchant": classified.merchant,
                    "merchant_source": classified.merchant_source,
                    "merchant_confidence": classified.merchant_confidence,
                    "category_id": classified.category_id,
                    "subcategory_id": classified.subcategory_id,
                    "kind": classified.kind,
                    "flags": classified.flags,
                    "source": raw.source,
                }
            )
        entry.update(status="ok", rows=len(raws))
        manifest.append(entry)

    records.sort(key=lambda r: (r["date"], r["account"], r["id"]))
    generated = datetime.now(UTC).isoformat(timespec="seconds")

    _write_json(
        reports_dir / "transactions.json",
        {
            "generated_at": generated,
            "currency": "GBP",
            "sign_convention": "negative = money out, positive = money in",
            "count": len(records),
            "transactions": records,
        },
    )
    _write_json(reports_dir / "summary.json", _summarise(records, generated))
    _write_json(
        reports_dir / "import_manifest.json",
        {"generated_at": generated, "statements": manifest, "failures": failures},
    )

    needs_review = sum(1 for r in records if r["flags"]["needs_review"])
    return {
        "statements": len(statements),
        "records": len(records),
        "needs_review": needs_review,
        "failures": failures,
        "generated_at": generated,
    }


def _summarise(records: list[dict], generated: str) -> dict:
    by_month: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_sub: dict[str, float] = defaultdict(float)
    by_merchant: dict[str, float] = defaultdict(float)
    for r in records:
        month = r["date"][:7]
        by_month[month][r["kind"]] += r["amount"]
        by_month[month]["net"] += r["amount"]
        if not r["flags"]["is_transfer"]:
            by_sub[r["subcategory_id"]] += r["amount"]
            by_merchant[r["merchant"]] += r["amount"]
    return {
        "generated_at": generated,
        "currency": "GBP",
        "monthly_by_kind": {m: {k: round(v, 2) for k, v in sorted(d.items())} for m, d in sorted(by_month.items())},
        "subcategory_totals": {k: round(v, 2) for k, v in sorted(by_sub.items(), key=lambda kv: kv[1])},
        "merchant_totals": {k: round(v, 2) for k, v in sorted(by_merchant.items(), key=lambda kv: kv[1])[:200]},
    }


def _write_json(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
