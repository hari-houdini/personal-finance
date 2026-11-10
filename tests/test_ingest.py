"""Tests for the statement ingest pipeline. All data here is synthetic (tests/fixtures)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.ingest import pipeline, resolver
from app.ingest.classify import Classifier, Taxonomy
from app.ingest.parsers import (
    ParseError,
    parse_credit_json,
    parse_debit_csv,
    scrub_identifiers,
)
from app.ingest.watcher import Debouncer

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
CONFIG = ROOT / "config"
LOCAL_FIXTURE = FIXTURES / "local"


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- parsers -----------------------------------------------------------------

def test_credit_json_signs_and_scrubs_identifiers():
    rows = parse_credit_json(FIXTURES / "credit-card" / "synthetic-2025.json")
    assert [r.amount for r in rows] == [-4.5, 20.0, 12.0]  # debit negative, credit positive
    assert all("4000123412341234" not in r.description for r in rows)
    assert all("REF9988" not in r.description and "REF1122" not in r.description for r in rows)
    assert any("REFUND" in r.description for r in rows)  # real words survive scrubbing


def test_debit_csv_handles_quoted_thousands_and_headerless_rows():
    rows = parse_debit_csv(FIXTURES / "debit-card" / "synthetic-2025.csv")
    assert len(rows) == 4
    assert rows[0].amount == -1234.56
    assert rows[1].amount == 2500.00
    assert rows[1].date.isoformat() == "2025-03-02"  # dd/mm/yyyy


def test_bad_debit_row_raises_with_line_number(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("01/03/2025,ONLY TWO FIELDS\n", encoding="utf-8")
    with pytest.raises(ParseError, match="line 1"):
        parse_debit_csv(bad)


def test_scrub_removes_card_numbers_and_references():
    text = scrub_identifiers("SHOP 4000 1234 5678 9010 REF ABCDEF123 TOWN 2123456789012345")
    assert "4000" not in text and "ABCDEF123" not in text and "2123456789012345" not in text
    assert "SHOP" in text and "TOWN" in text


# --- classification -----------------------------------------------------------

@pytest.fixture()
def classifier():
    return Classifier.from_config(CONFIG, LOCAL_FIXTURE)


def _raw(description: str, amount: float):
    from datetime import date

    from app.ingest.parsers import RawTransaction

    return RawTransaction("t.csv", 0, "debit-card", date(2025, 1, 1), None, amount, description)


def test_brand_match_and_processor_prefix_is_stripped(classifier):
    coffee = classifier.classify(_raw("STARBUCKS 99999 TESTTOWN", -4.5))
    assert coffee.subcategory_id == "eating_out.cafes_coffee"
    assert coffee.merchant == "Starbucks"

    grocer = classifier.classify(_raw("SQ *TESCO 1234 TESTTOWN", -20))
    assert grocer.subcategory_id == "food.supermarket"


def test_local_personal_rule_beats_everything(classifier):
    salary = classifier.classify(_raw("PIXEL TOYS LTD", 2500))
    assert salary.subcategory_id == "income.salary"
    assert salary.flags["is_earned_income"] is True
    assert salary.merchant_source == "user"


def test_positive_spend_is_a_refund_not_spending(classifier):
    refund = classifier.classify(_raw("STARBUCKS 99999 TESTTOWN REFUND", 12))
    assert refund.kind == "refund"
    assert refund.flags["is_refund"] is True


def test_unknown_descriptor_goes_to_review(classifier):
    unknown = classifier.classify(_raw("UNKNOWN SHOP 88 CITY", -12))
    assert unknown.subcategory_id == "review.unknown_merchant"
    assert unknown.flags["needs_review"] is True


def test_card_repayment_is_a_transfer_not_spending(classifier):
    rep = classifier.classify(_raw("HSBC BNK VSA1234", -200))
    assert rep.subcategory_id == "transfers.card_repayment"
    assert rep.flags["is_transfer"] is True and rep.flags["is_card_repayment"] is True


def test_taxonomy_ids_are_unique_and_valid():
    tax = Taxonomy.load(CONFIG / "taxonomy.json")
    assert "eating_out.cafes_coffee" in tax.subcategories
    assert tax.subcategories["transfers.family_in"]["kind"] == "transfer"


# --- resolver privacy ---------------------------------------------------------

def test_fragment_drops_location_words_and_numbers():
    frag = resolver.fragment_for("MARKS&SPENCER PLC LEAMINGTON SP 44", {"LEAMINGTON", "SP", "PLC"})
    assert frag == "MARKS&SPENCER"
    assert resolver.fragment_for("12 34", set()) is None


def test_personal_payees_never_become_search_candidates(classifier):
    txs = [
        {"subcategory_id": "review.unknown_merchant", "description": "PIXEL TOYS LTD"},
        {"subcategory_id": "review.unknown_merchant", "description": "UNKNOWN SHOP 88 CITY"},
    ]
    candidates = resolver.collect_candidates(txs, classifier, set())
    assert all("PIXEL" not in c for c in candidates)
    assert "UNKNOWN SHOP" in candidates


# --- pipeline -----------------------------------------------------------------

def test_pipeline_is_read_only_and_leaks_no_identifiers(tmp_path):
    statements = FIXTURES
    before = {p: _digest(p) for p in statements.rglob("*") if p.is_file()}

    result = pipeline.build(statements, tmp_path / "reports", CONFIG, LOCAL_FIXTURE)

    after = {p: _digest(p) for p in statements.rglob("*") if p.is_file()}
    assert before == after, "statements were modified"
    assert result["records"] == 7
    assert not result["failures"]

    report = (tmp_path / "reports" / "transactions.json").read_text(encoding="utf-8")
    for secret in ("4000123412341234", "REF9988776655", "AB1234", "REF1122334455"):
        assert secret not in report
    summary = json.loads((tmp_path / "reports" / "summary.json").read_text(encoding="utf-8"))
    assert "monthly_by_kind" in summary


def test_pipeline_is_idempotent(tmp_path):
    a = pipeline.build(FIXTURES, tmp_path / "a", CONFIG, LOCAL_FIXTURE)
    b = pipeline.build(FIXTURES, tmp_path / "b", CONFIG, LOCAL_FIXTURE)
    ids_a = [t["id"] for t in json.loads((tmp_path / "a" / "transactions.json").read_text())["transactions"]]
    ids_b = [t["id"] for t in json.loads((tmp_path / "b" / "transactions.json").read_text())["transactions"]]
    assert ids_a == ids_b and a["records"] == b["records"]


def test_unknown_folder_is_skipped(tmp_path):
    stray = tmp_path / "other"
    stray.mkdir()
    (stray / "x.csv").write_text("01/01/2025,A,1.00\n", encoding="utf-8")
    assert pipeline.discover(tmp_path) == []


# --- watcher ------------------------------------------------------------------

def test_debouncer_runs_once_for_a_burst():
    import time

    calls: list[int] = []
    debouncer = Debouncer(lambda: calls.append(1), delay=0.2)
    for _ in range(5):
        debouncer.trigger()
    time.sleep(0.5)
    assert calls == [1]
