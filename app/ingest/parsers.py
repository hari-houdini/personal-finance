"""Read-only parsers for the two statement formats.

Statements are the single source of truth and are never written. Every file is
opened with mode "rb" or "r", and nothing in this module creates or modifies
a file under statements/.

Formats (verified against the real files, see README):
  * credit-card/*.json  -> {"transactions": [...]}, ISO dates, positive amounts
                           with transactionCreditDebitCode telling the direction.
  * debit-card/*.csv    -> no header row; columns: date dd/mm/yyyy, descriptor,
                           signed amount. Amounts may contain thousands separators.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

# Identifiers that must never reach reports/: card numbers, long reference
# numbers, and masked card patterns such as "4000 12** **** 1234".
_CARD_PATTERNS = [
    re.compile(r"\b\d{4}[ *x]{1,3}[\dx*]{2,4}[ *x]{1,3}[\dx*]{2,4}[ *x]{1,3}\d{3,4}\b", re.IGNORECASE),
    re.compile(r"\b\d{12,19}\b"),
    re.compile(r"\b(?:REF|REFERENCE|AUTH|AUTHCODE)[:#\s]*[A-Z0-9]{6,}\b", re.IGNORECASE),
]


def scrub_identifiers(text: str) -> str:
    """Remove card numbers and reference IDs from a descriptor."""
    for pattern in _CARD_PATTERNS:
        text = pattern.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip()


@dataclass(frozen=True)
class RawTransaction:
    source: str            # statement file name, for traceability
    row: int               # position within that file
    account: str           # "credit-card" or "debit-card"
    date: date
    posted_date: date | None
    amount: float          # GBP, signed: negative = money out
    description: str       # descriptor with identifiers scrubbed


class ParseError(ValueError):
    """Raised when a statement row cannot be read. The importer reports it and keeps going."""


def _parse_iso(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _parse_uk(value: str) -> date:
    return datetime.strptime(value.strip(), "%d/%m/%Y").date()


def parse_amount(value: str | float) -> float:
    """Accept floats, plain strings, and strings with thousands separators."""
    if isinstance(value, (int, float)):
        return float(value)
    return float(value.replace(",", "").strip())


def parse_credit_json(path: Path, account: str = "credit-card") -> list[RawTransaction]:
    """Parse a credit-card JSON statement. Returns records in file order."""
    with path.open("rb") as handle:
        payload = json.load(handle)
    records: list[RawTransaction] = []
    for index, item in enumerate(payload.get("transactions", [])):
        magnitude = parse_amount(item["transactionAmount"]["amount"])
        direction = item.get("transactionCreditDebitCode", "")
        if direction == "DEBIT_TRANSACTION":
            signed = -abs(magnitude)
        elif direction == "CREDIT_TRANSACTION":
            signed = abs(magnitude)
        else:
            raise ParseError(f"{path.name} row {index}: unknown direction code")
        descriptions = item.get("transactionDescriptions") or []
        description = scrub_identifiers(" ".join(d.strip() for d in descriptions if d))
        posted = item.get("transactionPostingDate")
        records.append(
            RawTransaction(
                source=path.name,
                row=index,
                account=account,
                date=_parse_iso(item["transactionDate"]),
                posted_date=_parse_iso(posted) if posted else None,
                amount=round(signed, 2),
                description=description,
            )
        )
    return records


def parse_debit_csv(path: Path, account: str = "debit-card") -> list[RawTransaction]:
    """Parse a headerless debit-card CSV. Bad rows raise ParseError with their line number."""
    records: list[RawTransaction] = []
    with path.open("r", newline="", encoding="utf-8", errors="strict") as handle:
        for index, row in enumerate(csv.reader(handle)):
            if not row or all(not cell.strip() for cell in row):
                continue
            if len(row) < 3:
                raise ParseError(f"{path.name} line {index + 1}: expected at least 3 fields, got {len(row)}")
            try:
                parsed_date = _parse_uk(row[0])
                amount = parse_amount(row[-1])
            except ValueError as exc:
                raise ParseError(f"{path.name} line {index + 1}: {exc}") from exc
            records.append(
                RawTransaction(
                    source=path.name,
                    row=index,
                    account=account,
                    date=parsed_date,
                    posted_date=None,
                    amount=round(amount, 2),
                    description=scrub_identifiers(row[1].strip()),
                )
            )
    return records


def parse_statement(path: Path, account: str) -> list[RawTransaction]:
    """Dispatch on file extension. Raises ParseError for unknown formats."""
    suffix = path.suffix.lower()
    if suffix == ".json":
        return parse_credit_json(path, account)
    if suffix == ".csv":
        return parse_debit_csv(path, account)
    raise ParseError(f"unsupported statement format: {path.name}")
