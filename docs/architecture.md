# Architecture

This page explains how the system fits together, where data is allowed to go, and why it is built the way it is. For setup and everyday tasks, see the [README](../README.md) and the [runbook](runbook.md).

## Context and goals

The owner has bank statements from a credit card and a current account. They want to answer "where did my money go this month, and what should I change?" from one screen, and to ask follow-up questions grounded in their own data.

Goals, in priority order:

1. **Trust the numbers.** Every figure traces back to a transaction in a statement. Statements are never changed.
2. **Keep data local.** Statements and derived reports stay on the machine. Outbound calls happen only when the owner approves them.
3. **Be regenerable.** Anything derived can be deleted and rebuilt from the statements without losing information the owner entered.
4. **Stay simple.** No database, no build step, no framework beyond FastAPI and D3.

## Data flow

```
 statements/credit-card/*.json ─┐
 statements/debit-card/*.csv  ──┤  read-only
                                ▼
                     ┌──────────────────────┐
                     │ ingest.pipeline      │  discover → parse → classify
                     │  parsers.py          │
                     │  classify.py ◄───────┼── config/*.json (committed)
                     │                      │── config/local/*.json (gitignored)
                     │                      │── reports/merchant_cache.json
                     └──────────┬───────────┘
                                ▼
          reports/transactions.json  summary.json  import_manifest.json
                                │          (derived, gitignored, rebuilt each run)
                                ▼
                     ┌──────────────────────┐
                     │ analytics.py         │  pure aggregations
                     │ stability.py         │
                     │ api.py (FastAPI)     │── 127.0.0.1 only
                     └──────────┬───────────┘
                                ▼
                     web/ (JavaScript + D3)   browser on the same machine
                                │
          ┌─────────────────────┴──────────────────────┐
          ▼                                            ▼
 chat.py → `claude -p` (reads reports/)     resolver.py → `claude -p` (WebSearch)
 only when the owner asks a question        only after the owner approves fragments
```

## Components

| Module | Responsibility |
|---|---|
| `app/ingest/pipeline.py` | Finds statements, parses them, classifies each row, and writes the three reports. Also writes the import manifest. |
| `app/ingest/parsers.py` | Reads the two statement formats. Removes card numbers and reference IDs from descriptors. Never writes. |
| `app/ingest/classify.py` | Assigns merchant, sub-category, kind and flags. Resolution order is described below. |
| `app/ingest/resolver.py` | Builds short brand fragments from unknown descriptors and asks `claude` (with web search) to identify each one. Caches answers. |
| `app/ingest/watcher.py` | Watches `statements/` and triggers a rebuild after files stop changing. |
| `app/ingest/cli.py` | Command line: one-off rebuild, `--watch`, and `--resolve`. |
| `app/analytics.py` | Pure functions over `transactions.json`. Every chart's numbers come from here. |
| `app/stability.py` | Savings rate, emergency-fund cover and debt progress against `config/stability.json`. |
| `app/chat.py` | Sends the owner's question to the `claude` CLI with read-only access to `reports/`. |
| `app/api.py` | JSON API and the static dashboard. |
| `web/` | Dashboard. Plain ES modules, D3 vendored under `web/vendor/`, no build step. |

## Key decisions and trade-offs

### Statements are the only source of truth, and reports are rebuilt from them

Every run rebuilds `reports/` from scratch. That costs a few seconds, and in exchange the reports can never drift from the statements, and a corrupted report is fixed by deleting it. The importer writes each report to a temporary file and then renames it, so a crash never leaves a half-written file.

### No database

The data set is one person's statements, a few thousand rows. JSON files are easy to inspect, back up and regenerate. The trade-off is that the whole transaction list is loaded into memory. `analytics.Store` caches it and reloads when the file's modification time changes.

### Two kinds of user correction, stored differently

| Correction | Stored in | Applies to |
|---|---|---|
| "Change this one" | `config/local/overrides.json`, keyed by transaction ID | One transaction |
| "Remember for this merchant" | `config/local/rules.json`, as a new rule | Every future payment matching the descriptor |

Both are gitignored, and both are applied on every rebuild.

**Trade-off:** transaction IDs are a hash of file name, row number, date, amount and descriptor. If a bank re-exports a statement with rows in a different order, the IDs change and one-off overrides for that file stop applying. Rules are unaffected because they match descriptors, not IDs. See the [runbook](runbook.md#a-one-off-correction-disappeared) for recovery.

### Merchant resolution order

For each transaction, the first hit wins:

1. `config/local/rules.json`: the owner's personal payees. Never sent anywhere.
2. `reports/merchant_cache.json`: brands previously identified by web search.
3. `config/merchants.json`: the generic brand map, which is committed.
4. Otherwise the transaction goes to **Needs review**, sub-category `review.unknown_merchant` or `review.unclassified`.

Payment-processor prefixes such as `SQ *` and `PAYPAL *` are removed before matching.

### Money sign convention

Outflows are negative in the data. Analytics reports spending and debt as positive figures, and net as money in minus money out. Transfers between the owner's own accounts, card repayments and family transfers are kind `transfer`. They are excluded from spending and from net, so a card repayment is not counted twice.

### Stability uses complete months only

The current month is partial, so the stability baseline excludes it. The baseline window is `trailing_months_for_baseline` months (default 3). Where the statements do not show a balance, the emergency fund is estimated from transfers and labelled as an estimate. Balances the owner enters replace the estimate.

### The chat reads reports, not statements

The chat runs `claude -p` with `--add-dir reports/` and `--allowedTools Read Grep Glob`. It cannot write files or run shell commands. Its answers are JSON, parsed by the dashboard into the advice panel. Timeouts are 240 seconds.

## Privacy boundary

| Data | Where it can go |
|---|---|
| Statements (`statements/`) | Read on this machine. Never written, never sent. |
| Reports (`reports/`) | Read on this machine by the dashboard. Read by `claude` when the owner asks a question in the Ask panel, which sends the question and the relevant report content to the model service behind that CLI session. |
| Personal payees and overrides (`config/local/`) | Never sent anywhere. |
| Merchant lookup | Only short brand fragments (up to two alphabetic words, location words removed, minimum three characters), and only after the owner approves the list in the dashboard or with `--resolve`. Amounts, dates, card data and full descriptors are not sent. |

The owner's own `claude` CLI session is the only external service the application uses. The positioning in [PRODUCT.md](../PRODUCT.md) relies on this, so any new outbound call needs the same explicit approval step.

## Security model

- **Binding:** the API is meant to run on `127.0.0.1` only.
- **Authentication:** none. Anyone who can reach the port can read the data and change it.
- **Write endpoints:** `POST /api/import`, `POST /api/classify`, `POST /api/resolve`, `PUT /api/stability/balances`. `POST /api/chat` starts a `claude` process.
- **CORS:** not configured, so cross-origin browser requests are refused by default.

Keep the server on localhost. If you ever need remote access, put authentication in front of it first.

## Known limits

- Only two account folders are recognised: `credit-card` and `debit-card`.
- Statement formats are fixed to the two shapes in the [README](../README.md#adding-statements). A new bank format needs a new parser.
- Statements contain no bank balances. Emergency-fund and loan figures are estimates until the owner enters balances.
- Debit-card CSVs have no header row, so a column change in the bank's export is not detected by name. Parse errors report the line number.
- Merchant identification depends on web search quality and is cached per fragment. Wrong answers can be corrected by changing the category, which becomes a personal rule.
