# Configuration

All configuration is plain JSON. The dashboard reads most of it on every request, so most edits take effect after the next rebuild, or straight away for stability targets.

| File | Committed to git | Changed by | Read by |
|---|---|---|---|
| [`config/taxonomy.json`](#configtaxonomyjson) | Yes | You | Classifier, dashboard filters |
| [`config/merchants.json`](#configmerchantsjson) | Yes | You | Classifier |
| [`config/stability.json`](#configstabilityjson) | Yes | You | Stability plan, Budget plan |
| [`config/budget.json`](#configbudgetjson) | Yes | You | Budget plan (ingest) |
| [`config/local/budget.json`](#configlocalbudgetjson) | No | You | Budget plan |
| [`config/local/stability.json`](#configlocalstabilityjson) | No | The balances forms | Stability plan, Budget plan |
| [`config/local/rules.json`](#configlocalrulesjson) | No | "Remember for this merchant" | Classifier |
| [`config/local/overrides.json`](#configlocaloverridesjson) | No | Changing one transaction's category | Classifier |
| [`reports/merchant_cache.json`](#reportsmerchant_cachejson) | No | "Identify merchants" | Classifier |

The `config/local/` folder is gitignored because it holds personal payees and overrides. Keep it that way.

## `config/taxonomy.json`

Every transaction is assigned one sub-category from this tree.

```json
{
  "version": 1,
  "status": "approved",
  "currency": "GBP",
  "kinds": ["income", "essential", "discretionary", "debt", "savings", "tax", "fee", "transfer", "refund", "review"],
  "categories": [
    {
      "id": "food",
      "name": "Food & Groceries",
      "kind": "essential",
      "subcategories": [
        { "id": "food.supermarket", "name": "Supermarkets" }
      ]
    }
  ]
}
```

- **Category** (`categories[]`): a top-level group. Has `id`, `name` and a `kind`.
- **Sub-category** (`subcategories[]`): a child of a category. Has an `id` and a `name`. IDs are unique across the file. By convention the ID starts with the category's ID followed by a dot, for example `food.supermarket`. The exception is the `gifts.*` sub-categories under `gifts_donations`, so match the existing IDs rather than the pattern.
- **Help** (`help`, optional, on categories and sub-categories): a short plain-English explanation of the name, for example "Money you paid back on loans." The dashboard shows it as the hover tip on the filter chip for that category or sub-category. The classifier does not read this field, so adding or editing it never changes any transaction's category.
- **Kind**: what the money is for. It decides how a transaction counts in the analytics. The meaning of each kind is in the [glossary](../GLOSSARY.md) and in the docstring of `app/analytics.py`.

Sub-category IDs are stored in reports and in your overrides and rules. **Do not rename an ID that already has data against it.** Add a new one and move the old transactions with the dashboard instead. Renaming the display `name` is safe.

The `review.*` sub-categories are reserved for transactions the classifier cannot place. Don't remove them.

## `config/merchants.json`

The generic brand map. It is committed, so it must not contain anything personal.

```json
{
  "_comment": "Generic brand map (safe to commit).",
  "processor_prefixes": ["^SQ \\*", "^SUMUP\\s*\\*?", "^ZETTLE_\\*?"],
  "rules": [
    {
      "brand": "Example Supermarket",
      "pattern": "\\bEXAMPLE SUPERMARKET",
      "subcategory": "food.supermarket",
      "source": "knowledge",
      "confidence": "medium"
    }
  ],
  "location_words": ["LONDON", "MANCHESTER"]
}
```

- **`processor_prefixes`**: regular expressions for payment processors. They are removed from the start of a descriptor before matching, so `SQ *EXAMPLE SUPERMARKET` matches as `EXAMPLE SUPERMARKET`.
- **`rules`**: regular expressions, case-insensitive, matched against the cleaned descriptor. **First match wins**, so put specific patterns above general ones.
- **`location_words`**: place names removed from descriptors before a brand fragment is built for web search.

Each rule needs `brand`, `pattern` and `subcategory`. `source` and `confidence` are for your reference and are stored on each transaction.

When you add a rule, check it with the tests: `.venv/bin/python -m pytest`. A pattern that is too broad will quietly claim transactions that belong elsewhere. Test it against a real descriptor first.

## `config/stability.json`

Targets for the Stability plan, and the balances you enter.

```json
{
  "earned_income_subcategories": ["income.salary", "income.self_employment", "income.benefits_pensions"],
  "essential_kinds": ["essential"],
  "emergency_fund_months": { "start": 3, "target": 6 },
  "savings_rate_target": 0.20,
  "debt_method": "avalanche",
  "trailing_months_for_baseline": 3,
  "user_entered": {
    "emergency_fund_balance": null,
    "loan_balances": {}
  }
}
```

| Key | Meaning |
|---|---|
| `earned_income_subcategories` | Sub-categories counted as earned income. Used for the savings rate. |
| `essential_kinds` | Kinds counted as essential spending. Used for emergency-fund cover. |
| `emergency_fund_months` | Start and full targets, in months of essential spending. |
| `savings_rate_target` | Target share of earned income to keep after spending and debt. `0.20` is 20%. |
| `debt_method` | Order in which loans are listed: `avalanche` puts the highest interest rate first. |
| `trailing_months_for_baseline` | How many complete months the averages use. The current partial month is never included. |
| `user_entered.emergency_fund_balance` | Your real emergency-fund balance, in pounds, or `null` to use the estimate. |
| `user_entered.loan_balances` | Your loans, keyed by name, each with `balance` and `apr`. |

The `user_entered` block here is a fallback. The "Your balances" form now saves to [`config/local/stability.json`](#configlocalstabilityjson), which is gitignored, and the app reads that file when it exists. Keep real balances out of this committed file.

## `config/budget.json`

Generic rules for the Budget plan: which sub-categories are fixed (mandatory), which are protected, and which kinds are variable. Committed, so it holds no personal figures.

```json
{
  "trailing_months": 3,
  "mandatory_subcategories": ["housing.rent", "housing.council_tax", "transport.car_insurance", "..."],
  "mandatory_kinds": ["debt"],
  "protected_subcategories": ["food.supermarket", "health.pharmacy", "transport.fuel_charging", "..."],
  "variable_kinds": ["essential", "discretionary", "fee", "refund"],
  "variable_transfer_subcategories": ["transfers.family_out"]
}
```

| Key | Meaning |
|---|---|
| `trailing_months` | Complete months the variable averages use. |
| `mandatory_subcategories` | Fixed costs. Shown as they are; the slider does not change them. Fixed costs use the latest complete month. |
| `mandatory_kinds` | Every sub-category of these kinds is fixed. `debt` covers loan and finance repayments. |
| `protected_subcategories` | Variable spending that is cut last. |
| `variable_kinds` | Kinds that count as variable spending when not fixed or protected. |
| `variable_transfer_subcategories` | Transfer sub-categories that count as variable, such as family support sent to family. |

## `config/local/budget.json`

Your personal Budget plan figures. Gitignored. Changing a payee pattern or `excluded_patterns` needs a rebuild (`app.ingest.cli`). Salary, household and debt figures apply on the next request.

```json
{
  "base_salary": { "amount": 3000, "effective_from": "2026-10" },
  "household_contribution": { "amount": 500 },
  "family_support": { "payee_pattern": "FAMILY PAYEE", "education_loan_monthly": 500, "protected_monthly": 300 },
  "fixed_overrides": { "transport.car_insurance": 100.00 },
  "bike": { "payee_pattern": "BIKE INSURER", "sold": false },
  "excluded_patterns": ["ONE OFF SHOP"],
  "debts": {
    "car_finance": { "balance": 6100.0, "apr": 7.9, "months_left": 14 },
    "education_loan": { "balance": 2000.0, "apr": 0, "months_left": 4 }
  }
}
```

| Key | Meaning |
|---|---|
| `base_salary` | Your base salary, without bonuses. Bonus months are found in the statements and left out. |
| `household_contribution` | Money from someone else that you count as income in the plan. |
| `family_support` | The payee you send money to, the fixed education loan repayment inside it, and the protected family amount. |
| `fixed_overrides` | A fixed amount that replaces the statement figure for a fixed sub-category, for example a premium you know is current. |
| `bike` | The payee for a bike you still own, and whether you have sold it. A sold bike's cost comes out of the plan. |
| `excluded_patterns` | Payees left out of the baseline: one-offs and costs that have ended. |
| `debts` | Balance, interest rate (APR) and months left for each debt. Used for the stability figures and the order of repayment. |

## `config/local/stability.json`

The balances you enter on the Stability plan and Budget plan tabs. Gitignored.

```json
{
  "user_entered": {
    "emergency_fund_balance": 4200.0,
    "loan_balances": {}
  }
}
```

## `config/local/rules.json`

Your personal payees. Same shape as the entries in `merchants.json`, and checked before anything else, so a personal rule always wins. It is never sent anywhere.

```json
{
  "rules": [
    {
      "brand": "Family",
      "pattern": "\\bEXAMPLE PERSON",
      "subcategory": "transfers.family_out",
      "source": "user",
      "confidence": "high"
    }
  ]
}
```

Created and updated by the dashboard when you choose **Remember for this merchant**. You can also edit it by hand. Newer rules are inserted first.

## `config/local/overrides.json`

One-off corrections, keyed by transaction ID.

```json
{
  "3f9a0c1d2e4b5a6f": "shopping.clothing_footwear"
}
```

Written by the dashboard when you change one transaction without ticking **Remember**. Applied on every rebuild. If a bank re-exports a statement with its rows in a different order, the IDs change and overrides stop matching. See [architecture](architecture.md#two-kinds-of-user-correction-stored-differently).

## `reports/merchant_cache.json`

Brands identified by web search, keyed by the fragment that was searched.

```json
{
  "entries": {
    "EXAMPLE SHOP": {
      "brand": "Example Shop",
      "subcategory_id": "shopping.general_retail",
      "confidence": "medium",
      "source": "web",
      "resolved_at": "2026-11-10T20:30:00+00:00"
    }
  }
}
```

Each fragment is searched once, so the cache also limits how often anything leaves the machine. To search a fragment again, delete its entry and run **Identify merchants** again. The cache lives in `reports/`, so deleting `reports/` clears it too.

## Adding a new sub-category, step by step

1. Add the sub-category to `config/taxonomy.json` under the right category, with a new ID.
2. Optionally add `config/merchants.json` rules that point at it.
3. Run `.venv/bin/python -m app.ingest.cli` to rebuild.
4. Move any existing transactions with the dashboard, or add a rule under `config/local/rules.json`.
5. Run the tests.
