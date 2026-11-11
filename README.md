# Personal finance

A local dashboard that shows where your money goes, by category, sub-category and merchant, and what it would take to reach financial stability. It reads your bank statements, builds derived reports, and serves a web dashboard on your own machine.

Your statements never leave the machine. The only outbound calls are the ones you approve: merchant lookups (which send short brand fragments only, after you say yes) and the chat, which runs through your own `claude` CLI session.

## What you get

- **Overview:** income, spending, debt, savings and net for any date range, with a monthly cash-flow chart.
- **Cash flow, categories and merchants:** where money moves, drilled down from category to sub-category to individual shops.
- **Trends and distributions:** monthly and daily patterns, and how big individual payments are.
- **Stability plan:** savings rate and emergency-fund cover against targets. Balances you enter replace the estimates.
- **Budget plan:** fixed costs stay as they are. A slider sets how much you save each month, and the tab shows what you can spend in each variable category.
- **Transactions:** every transaction, with a "Needs review" tab and one-click recategorisation.
- **Ask:** questions about your own data, answered in an advice panel.

Every view responds to the same date-range, account, category and sub-category filters.

## Requirements

- Python 3.11 or later. The project is developed on Python 3.15.
- macOS or Linux. The file watcher uses `watchdog`.
- Optional: the `claude` CLI (Claude Code) on your `PATH`. It is needed only for the Ask panel and for "Identify merchants". The dashboard works without it.

## Quick start

From the project root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 1. Drop statements into the two folders (see "Adding statements" below).
# 2. Build the reports once.
.venv/bin/python -m app.ingest.cli

# 3. Start the dashboard on localhost.
.venv/bin/uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. You should see the Overview within a few seconds.

If you do not have statements yet, the synthetic fixtures in `tests/fixtures/` have the same shape and are safe to try. Copy them into `statements/credit-card/` and `statements/debit-card/` and run the same commands.

## Adding statements

Statements are read-only. The importer never writes to `statements/`.

| Folder | Format | Example file name |
|---|---|---|
| `statements/credit-card/` | JSON with a `transactions` array | `2025-06.json` |
| `statements/debit-card/` | Headerless CSV: date `dd/mm/yyyy`, descriptor, signed amount | `2025-06.csv` |

Files in any other folder are skipped with a warning. Files that fail to parse are listed in `reports/import_manifest.json` and do not stop the rest of the import.

## Everyday use

| Task | How |
|---|---|
| Rebuild reports after adding statements | `.venv/bin/python -m app.ingest.cli`, or click **Re-read statements** in the dashboard |
| Rebuild automatically as files arrive | `.venv/bin/python -m app.ingest.cli --watch` |
| Identify unknown merchants | Click **Identify merchants** in the dashboard. It shows the fragments first and sends nothing until you approve. The CLI equivalent is `--resolve`. |
| Correct a category | Open **Transactions**, change the category, and tick **Remember for this merchant** to apply it to future payments |
| Enter your balances | Open **Stability plan**, fill in "Your balances", and save |

More detail on each task, and what to do when something goes wrong, is in the [runbook](docs/runbook.md).

## Tests and lint

```bash
.venv/bin/python -m pytest      # run from the project root
.venv/bin/python -m ruff check app tests
```

The tests use only the synthetic fixtures in `tests/fixtures/`.

## Project layout

```
app/                 Python backend
  ingest/            statements -> classified transactions -> reports/
  analytics.py       aggregations behind every chart
  stability.py       savings rate, emergency fund, debt progress
  api.py             JSON API and the static dashboard
  chat.py            bridge to the claude CLI for the Ask panel
config/              taxonomy, merchant rules, stability targets (committed)
config/local/        personal payees and overrides (gitignored)
statements/          your bank statements (gitignored, read-only)
reports/             derived output, rebuilt on every run (gitignored)
web/                 dashboard: plain JavaScript modules, D3, no build step
tests/               pytest suite and synthetic fixtures
docs/                architecture, API, configuration and runbook
```

## Documentation

| Document | Read it when |
|---|---|
| [Architecture](docs/architecture.md) | You want to understand the data flow, the privacy boundary, or the design decisions |
| [Configuration](docs/configuration.md) | You want to change categories, merchant rules, stability targets or your personal payees |
| [API reference](docs/api.md) | You are working on the dashboard or calling the local API |
| [Runbook](docs/runbook.md) | Something is wrong, or you need to do a routine operation |
| [Contributing](CONTRIBUTING.md) | You want to change the code |
| [Glossary](GLOSSARY.md) | You need the meaning of a term such as *Kind*, *Card repayment* or *Sub-category* |
| [Product](PRODUCT.md) and [Design](DESIGN.md) | You are changing what the dashboard shows or how it looks |

## Security

The server binds to `127.0.0.1` only, and it has no login. Anyone who can reach that port can read your data and change it. Do not bind it to `0.0.0.0`, and do not expose it through a tunnel or a reverse proxy. See [architecture](docs/architecture.md#security-model).

## Licence

No licence has been chosen yet. Until one is added, all rights are reserved by the author.
