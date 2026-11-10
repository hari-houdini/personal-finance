"""Resolve unknown descriptors to brands with web search, through the claude CLI.

Privacy rules (from the approved plan):
  * Only a short brand fragment is sent (first alphabetic words, location words
    removed). Never the full descriptor, card data, amounts or dates.
  * Personal payees are matched by config/local/rules.json first and never reach here.
  * Nothing is sent without an explicit "yes" from the person running --resolve.
Results are cached in reports/merchant_cache.json so each fragment is searched once.
"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from app.ingest.classify import Classifier, Taxonomy

CLAUDE_TIMEOUT_SECONDS = 180


def fragment_for(description_upper: str, location_words: set[str]) -> str | None:
    """Reduce a descriptor to a brand fragment: up to two alphabetic, non-location words."""
    words = [w for w in re.findall(r"[A-Z][A-Z'&]+", description_upper) if w not in location_words and len(w) > 1]
    fragment = " ".join(words[:2]).strip()
    return fragment if len(fragment) >= 3 else None


def collect_candidates(transactions: list[dict], classifier: Classifier, location_words: set[str]) -> list[str]:
    """Distinct fragments from transactions still awaiting a brand, skipping personal rules."""
    seen: dict[str, None] = {}
    for tx in transactions:
        if tx["subcategory_id"] != "review.unknown_merchant":
            continue
        text = classifier._strip_processor(tx["description"].upper())
        if any(rule.pattern.search(text) for rule in classifier.local):
            continue
        fragment = fragment_for(text, location_words)
        if fragment and fragment not in classifier.cache:
            seen[fragment] = None
    return sorted(seen)


def _ask_claude(fragment: str, subcategories: list[str], project_root: Path) -> dict | None:
    prompt = (
        f'Identify the UK consumer brand behind this bank-statement descriptor fragment: "{fragment}".\n'
        "Use web search only for this fragment. If it is a person's name or cannot be identified, "
        'return brand null.\nReply with only one JSON object, no prose:\n'
        '{"brand": string or null, "subcategory_id": one of the ids below or null, '
        '"confidence": "high" | "medium" | "low"}\n'
        "Allowed subcategory_id values: " + ", ".join(subcategories)
    )
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json", "--allowedTools", "WebSearch"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        envelope = json.loads(proc.stdout)
        text = envelope.get("result", "") if isinstance(envelope, dict) else ""
    except json.JSONDecodeError:
        text = proc.stdout
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def resolve(
    fragments: list[str],
    taxonomy: Taxonomy,
    cache_path: Path,
    project_root: Path,
) -> dict[str, dict]:
    """Search each fragment and merge valid answers into the cache. Returns the new entries."""
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {"entries": {}}
    subs = sorted(taxonomy.subcategories)
    added: dict[str, dict] = {}
    for fragment in fragments:
        answer = _ask_claude(fragment, subs, project_root)
        if not answer or not answer.get("brand"):
            continue
        sub = answer.get("subcategory_id")
        if sub not in taxonomy.subcategories:
            continue
        entry = {
            "brand": str(answer["brand"])[:80],
            "subcategory_id": sub,
            "confidence": answer.get("confidence", "low") if answer.get("confidence") in {"high", "medium", "low"} else "low",
            "source": "web",
            "resolved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        cache["entries"][fragment] = entry
        added[fragment] = entry
    cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return added
