# API reference

The dashboard talks to a local JSON API served by FastAPI. The API exists for the dashboard; it is not a public interface. It has no authentication and must stay bound to `127.0.0.1`. See [architecture: security model](architecture.md#security-model).

Start the server from the project root:

```bash
.venv/bin/uvicorn app.api:app --host 127.0.0.1 --port 8000
```

The interactive docs are disabled. Use this page as the reference.

## Conventions

- **Base URL:** `http://127.0.0.1:8000`
- **Dates:** ISO `YYYY-MM-DD`. `from` and `to` are inclusive.
- **Amounts:** GBP. Negative means money out, positive means money in, as stored in `reports/transactions.json`.
- **Errors:** FastAPI's standard shape, `{"detail": "..."}`.

| Status | Meaning |
|---|---|
| `409` | No reports yet. Run the import first (`POST /api/import`). |
| `404` | The transaction ID does not exist. |
| `422` | The request is valid JSON but the values are wrong, for example an unknown sub-category. |
| `502` | The `claude` CLI failed, timed out, or is missing. The `detail` says which. |

## Filters

Most read endpoints accept the same filters. They are applied together.

| Parameter | Type | Meaning |
|---|---|---|
| `from` | date | First date, inclusive |
| `to` | date | Last date, inclusive |
| `category` | string | Category ID, for example `food` |
| `subcategory` | string | Sub-category ID, for example `food.supermarket` |
| `merchant` | string | Merchant name as shown in the dashboard |
| `account` | string | `credit-card` or `debit-card` |
| `kind` | string | A kind group: `income`, `spending` (essential, discretionary, fee, tax and refunds), `outflow` (everything that leaves except transfers), `debt` or `savings`. Any single kind from the taxonomy also works |
| `min_amount` | number | Smallest payment size, as a positive magnitude. Money in and money out are both compared by size |
| `max_amount` | number | Largest payment size, as a positive magnitude, inclusive |

Category and sub-category IDs come from `config/taxonomy.json`. `GET /api/meta` returns the full taxonomy.

## Endpoints

### Status and metadata

#### `GET /api/meta`

Whether reports exist, when they were built, and the taxonomy.

```json
{
  "ready": true,
  "generated_at": "2026-11-10T20:19:00+00:00",
  "count": 3065,
  "first_date": "2023-11-01",
  "last_date": "2026-11-09",
  "needs_review": 1020,
  "taxonomy": { "categories": [] },
  "manifest": { "statements": [], "failures": [] }
}
```

When no reports exist, `ready` is `false` and `count` and the dates are absent. The taxonomy and manifest are still returned.

### Reading the data

#### `GET /api/analytics`

Everything the Overview, Cash flow, Categories, Merchants, Trends and Distributions views draw from. Accepts the [filters](#filters).

The response has these top-level keys: `kpis`, `previous`, `breakdown`, `monthly`, `hierarchy`, `merchants`, `daily`, `amounts_by_category`, `flows`, `transfers`. The definitions of each money figure are in the docstring of [`app/analytics.py`](../app/analytics.py).

- `previous` is the same measures for the equal-length period that ends the day before `from`, with its own `from`, `to` and `kpis`. It is `null` when `from` or `to` is missing, or when that period starts before the first transaction. The dashboard uses it for the up and down arrows on the Overview figures.
- `breakdown` explains the Overview figures: `earned_income` (by source and the largest payments in), `spending` (by category, each with its sub-categories), `debt_service` (by sub-category) and `net` (money in and money out, each with its largest payments).

#### `GET /api/transactions`

Paged list of transactions, newest first.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `from`, `to`, `category`, `subcategory`, `merchant`, `account`, `kind`, `min_amount`, `max_amount` | | | [Filters](#filters) |
| `review` | bool | `false` | Only transactions flagged "needs review" |
| `q` | string | | Case-insensitive match on description or merchant |
| `limit` | int | `200` | 1 to 2000 |
| `offset` | int | `0` | Start position |

```json
{
  "total": 262,
  "items": [
    {
      "id": "3f9a0c1d2e4b5a6f",
      "date": "2026-10-28",
      "amount": -12.4,
      "account": "credit-card",
      "description": "EXAMPLE COFFEE LONDON",
      "merchant": "Example Coffee",
      "subcategory_id": "food.convenience",
      "kind": "discretionary",
      "flags": { "needs_review": false, "is_transfer": false }
    }
  ]
}
```

The values above are illustrative. Real records carry more fields; see `reports/transactions.json`.

#### `GET /api/stability`

Savings rate, emergency-fund cover and debt progress against `config/stability.json`. Takes no filters. The response includes `savings_rate`, `savings_rate_target`, `window_months`, `spending_monthly`, `earned_income_monthly`, `surplus_monthly`, and `monthly_gap_to_target`, plus the emergency-fund and debt sections. Each figure is labelled as an estimate or user-entered. The full shape is defined in [`app/stability.py`](../app/stability.py).

#### `GET /api/budget`

The Budget plan for one monthly saving amount. Reads `reports/budget_baseline.json` (written by each rebuild) and the personal figures in `config/local/`. Returns 409 until the first import has run.

Query parameters:

| Parameter | Meaning |
|---|---|
| `saving` | Monthly saving in pounds. Optional. Defaults to the savings-rate target (20% of income), capped at what fixed costs and protected spending allow. Values are clamped to `0` … `saving.max`. |
| `bike_sold` | `true` takes the motorbike's insurance out of the plan. Optional. Defaults to the value in `config/local/budget.json`. |

The response is split into `income`, `saving` (value, min, max, step, default, target and rate), `mandatory` (fixed lines), `protected` (lines with `historical` and `allowance`), `discretionary` (the same, sharing what is left), `stability` (emergency fund and debts), `bonus`, `flags` and `limits`. Allowances plus fixed costs plus saving always add up to income. The full shape is defined in [`app/budget.py`](../app/budget.py).

#### `GET /api/resolve/candidates`

Merchant fragments waiting for identification. Makes no outbound calls.

```json
{ "count": 2, "fragments": ["EXAMPLE SHOP", "SAMPLE CAFE"] }
```

### Changing the data

#### `POST /api/classify`

Move one transaction to another sub-category. Rebuilds the reports.

```json
{ "transaction_id": "3f9a0c1d2e4b5a6f", "subcategory_id": "shopping.clothing_footwear", "remember": false }
```

- `remember: false` writes a one-off override in `config/local/overrides.json`.
- `remember: true` adds a personal rule to `config/local/rules.json` that applies to every future payment matching the descriptor.
- `422` if the sub-category is not in the taxonomy. `404` if the transaction does not exist.

Response: `{"ok": true, "records": 3065, "needs_review": 1020}`

#### `POST /api/import`

Rebuild `reports/` from `statements/`. This is what **Re-read statements** does.

Response: `{"statements": 6, "records": 3065, "needs_review": 1020, "failures": [], "generated_at": "..."}`

Files that fail to parse appear in `failures` and do not stop the rest of the import.

#### `POST /api/resolve`

Identify the merchants behind approved fragments. Each fragment is sent to `claude` with web search, one at a time, up to 180 seconds each. Answers are cached in `reports/merchant_cache.json`, and reports are rebuilt afterwards.

```json
{ "fragments": ["EXAMPLE SHOP"] }
```

Only fragments returned by `GET /api/resolve/candidates` are accepted. Others are ignored. If none are pending, the response is `422`.

Response: `{"searched": 1, "resolved": 1, "records": 3065, "needs_review": 1019}`

#### `PUT /api/stability/balances`

Save balances the owner enters. These replace the estimates on the Stability page.

```json
{
  "emergency_fund_balance": 4200.0,
  "loan_balances": {
    "Car finance": { "balance": 6100.0, "apr": 7.9 }
  }
}
```

`loan_balances` is keyed by the loan's name. Each loan has a `balance` and an annual `apr` as a percentage. Pass `null` for `emergency_fund_balance` to clear it.

Writes to the `user_entered` section of `config/local/stability.json`, which is gitignored. See [configuration](configuration.md#configlocalstabilityjson).

Response: `{"ok": true}`

### Ask

#### `POST /api/chat`

Send a question to the `claude` CLI. The CLI reads `reports/` through read-only tools and returns an answer. Timeout 240 seconds.

```json
{ "message": "Can I afford a week away in May?", "session_id": null }
```

Response:

```json
{
  "answer": "Markdown text of the answer",
  "actions": [{ "title": "...", "detail": "..." }],
  "highlights": [{ "label": "...", "value": "..." }],
  "session_id": "b1c2d3e4-..."
}
```

Pass the returned `session_id` back to continue the same conversation. Errors: `409` if there are no reports, `502` if the CLI is missing, fails, or times out.

### Static files

- `GET /` serves the dashboard, `web/index.html`.
- `GET /static/...` serves `web/`: CSS, JavaScript modules and the vendored D3 files.
