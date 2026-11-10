"""Command line for the import pipeline.

  python -m app.ingest.cli                 rebuild reports/ once
  python -m app.ingest.cli --watch         rebuild now, then keep watching statements/
  python -m app.ingest.cli --resolve       ask claude (with web search) about unknown merchants,
                                           after showing the fragments and asking for a yes
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from app.ingest import pipeline, resolver
from app.ingest.classify import Classifier, Taxonomy
from app.ingest.watcher import start_watching, wait_until_stable
from app.paths import (
    CONFIG_DIR,
    LOCAL_CONFIG_DIR,
    PROJECT_ROOT,
    REPORTS_DIR,
    STATEMENTS_DIR,
)


def _stable_rebuild() -> dict:
    for path, _account in pipeline.discover(STATEMENTS_DIR):
        wait_until_stable(path)
    return pipeline.build(STATEMENTS_DIR, REPORTS_DIR, CONFIG_DIR, LOCAL_CONFIG_DIR)


def _print_run(result: dict) -> None:
    print(
        f"statements: {result['statements']}  records: {result['records']}  "
        f"needs review: {result['needs_review']}  failures: {len(result['failures'])}"
    )
    for failure in result["failures"]:
        print(f"  FAILED {failure['file']}: {failure['error']}", file=sys.stderr)


def _resolve_interactive() -> int:
    transactions = json.loads((REPORTS_DIR / "transactions.json").read_text(encoding="utf-8"))["transactions"]
    classifier = Classifier.from_config(CONFIG_DIR, LOCAL_CONFIG_DIR, REPORTS_DIR / "merchant_cache.json")
    location_words = set(json.loads((CONFIG_DIR / "merchants.json").read_text(encoding="utf-8")).get("location_words", []))
    fragments = resolver.collect_candidates(transactions, classifier, location_words)
    if not fragments:
        print("Nothing to resolve: every descriptor is matched or personal.")
        return 0
    print(f"{len(fragments)} brand fragments will be sent to web search through the claude CLI.")
    print("Only these short fragments leave the machine. No amounts, dates, card data or personal payees.")
    print("First five, for a sanity check:", ", ".join(fragments[:5]))
    if input("Send them? [y/N] ").strip().lower() != "y":
        print("Cancelled. Nothing was sent.")
        return 0
    taxonomy = Taxonomy.load(CONFIG_DIR / "taxonomy.json")
    added = resolver.resolve(fragments, taxonomy, REPORTS_DIR / "merchant_cache.json", PROJECT_ROOT)
    print(f"Resolved {len(added)} of {len(fragments)} fragments. Rebuilding reports...")
    _print_run(_stable_rebuild())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Transform statements into reports.")
    parser.add_argument("--watch", action="store_true", help="keep watching statements/ for new files")
    parser.add_argument("--resolve", action="store_true", help="resolve unknown merchants with web search (asks first)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if args.resolve:
        return _resolve_interactive()

    _print_run(_stable_rebuild())
    if not args.watch:
        return 0

    observer = start_watching(STATEMENTS_DIR, lambda: _print_run(_stable_rebuild()))
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
