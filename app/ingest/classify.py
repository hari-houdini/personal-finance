"""Assign every transaction a merchant, sub-category, kind and flags.

Resolution order (first hit wins):
  1. config/local/rules.json       personal payees (never sent anywhere)
  2. reports/merchant_cache.json   brands resolved earlier by `--resolve`
  3. config/merchants.json         generic brand map
  4. otherwise                     Needs Review (review.unknown_merchant / unclassified)

Payment-processor prefixes (SQ *, SUMUP, ZETTLE_, PAYPAL *, ...) are removed
before matching, so "SQ *BRAND" is matched as "BRAND".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.ingest.parsers import RawTransaction

SPEND_KINDS = {"essential", "discretionary", "fee", "tax"}


@dataclass(frozen=True)
class Taxonomy:
    subcategories: dict[str, dict]  # sub id -> {category_id, kind, name}

    @classmethod
    def load(cls, path: Path) -> Taxonomy:
        data = json.loads(path.read_text(encoding="utf-8"))
        subs: dict[str, dict] = {}
        for category in data["categories"]:
            for sub in category["subcategories"]:
                subs[sub["id"]] = {
                    "category_id": category["id"],
                    "category_name": category["name"],
                    "kind": category["kind"],
                    "name": sub["name"],
                }
        return cls(subs)

    def valid(self, sub_id: str) -> bool:
        return sub_id in self.subcategories


@dataclass(frozen=True)
class Rule:
    brand: str
    pattern: re.Pattern
    subcategory: str
    source: str
    confidence: str


@dataclass
class Classified:
    merchant: str
    merchant_source: str
    merchant_confidence: str
    category_id: str
    subcategory_id: str
    kind: str
    flags: dict = field(default_factory=dict)


def _compile(entries: list[dict]) -> list[Rule]:
    return [
        Rule(
            brand=e["brand"],
            pattern=re.compile(e["pattern"], re.IGNORECASE),
            subcategory=e["subcategory"],
            source=e.get("source", "knowledge"),
            confidence=e.get("confidence", "medium"),
        )
        for e in entries
    ]


class Classifier:
    def __init__(
        self,
        taxonomy: Taxonomy,
        brand_rules: list[dict],
        local_rules: list[dict],
        processor_prefixes: list[str],
        earned_income: set[str],
        cache: dict[str, dict] | None = None,
    ) -> None:
        self.taxonomy = taxonomy
        self.local = _compile(local_rules)
        self.brands = _compile(brand_rules)
        self.prefixes = [re.compile(p, re.IGNORECASE) for p in processor_prefixes]
        self.earned_income = earned_income
        self.cache = cache or {}

    @classmethod
    def from_config(cls, config_dir: Path, local_dir: Path, cache_path: Path | None = None) -> Classifier:
        taxonomy = Taxonomy.load(config_dir / "taxonomy.json")
        merchants = json.loads((config_dir / "merchants.json").read_text(encoding="utf-8"))
        stability = json.loads((config_dir / "stability.json").read_text(encoding="utf-8"))
        local_path = local_dir / "rules.json"
        local = json.loads(local_path.read_text(encoding="utf-8")).get("rules", []) if local_path.exists() else []
        cache: dict[str, dict] = {}
        if cache_path and cache_path.exists():
            cache = json.loads(cache_path.read_text(encoding="utf-8")).get("entries", {})
        return cls(
            taxonomy=taxonomy,
            brand_rules=merchants["rules"],
            local_rules=local,
            processor_prefixes=merchants["processor_prefixes"],
            earned_income=set(stability["earned_income_subcategories"]),
            cache=cache,
        )

    def _strip_processor(self, text: str) -> str:
        for prefix in self.prefixes:
            text = prefix.sub("", text, count=1)
        return text.strip()

    def _match(self, text: str) -> Rule | None:
        for rule in self.local:
            if rule.pattern.search(text):
                return rule
        for key, entry in self.cache.items():
            if key and key in text and entry.get("subcategory_id") and self.taxonomy.valid(entry["subcategory_id"]):
                return Rule(entry["brand"], re.compile(re.escape(key), re.IGNORECASE), entry["subcategory_id"], "web", entry.get("confidence", "medium"))
        for rule in self.brands:
            if rule.pattern.search(text):
                return rule
        return None

    def classify(self, raw: RawTransaction, override: str | None = None) -> Classified:
        original = raw.description.upper()
        text = self._strip_processor(original)
        rule = self._match(text)

        if rule is not None and self.taxonomy.valid(rule.subcategory):
            sub_id = rule.subcategory
            merchant, source, confidence = rule.brand, rule.source, rule.confidence
        else:
            sub_id = "review.unknown_merchant" if raw.amount < 0 else "review.unclassified"
            merchant = _fallback_name(text) if _fallback_name(text) != "Unknown" else _fallback_name(original)
            source, confidence = "descriptor", "low"

        # A person's one-off correction wins over every rule, but keeps the merchant name.
        if override and self.taxonomy.valid(override):
            sub_id = override
            source, confidence = "user", "high"

        info = self.taxonomy.subcategories[sub_id]
        kind = info["kind"]
        is_review = kind == "review"

        # A positive amount on a spending merchant is a refund, not spending.
        is_refund = raw.amount > 0 and kind in SPEND_KINDS
        if is_refund:
            kind = "refund"

        flags = {
            "is_income": info["category_id"] == "income" and raw.amount > 0,
            "is_earned_income": sub_id in self.earned_income and raw.amount > 0,
            "is_transfer": kind == "transfer",
            "is_card_repayment": sub_id == "transfers.card_repayment",
            "is_refund": is_refund,
            "needs_review": is_review,
        }
        return Classified(
            merchant=merchant,
            merchant_source=source,
            merchant_confidence=confidence,
            category_id=info["category_id"],
            subcategory_id=sub_id,
            kind=kind,
            flags=flags,
        )


_NOISE_WORDS = {"DD", "VIS", "GB", "UK", "LTD", "PLC"}


def _fallback_name(text: str) -> str:
    """Readable placeholder for an unmatched descriptor: first two meaningful words."""
    words = [w for w in re.findall(r"[A-Z][A-Z'&-]+", text) if w not in _NOISE_WORDS]
    return " ".join(w.title() for w in words[:2]) or "Unknown"
