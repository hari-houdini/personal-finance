# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Python 3.15 with FastAPI and uvicorn for the backend. The frontend is plain JavaScript modules with D3, with no build step. The stack was chosen by the owner in the grilling session (option b: Python backend, D3 frontend). The app runs locally on 127.0.0.1 only.

## Users

One person: the owner of the bank statements in this repository. They review their own money on a desktop, and sometimes on a phone. They are not a financial professional.

## Product Purpose

A local dashboard that shows where the owner's money goes, by category and sub-category, and what it would take to reach financial stability. Success means the owner can answer, from one screen, "where did my money go this month, and what should I change?" It also answers follow-up questions in a chat grounded in their own data.

## Positioning

The statements never leave the machine, except through the owner's own `claude` CLI session. The chat reads only the generated `reports/` folder. Nothing is uploaded to a service the owner does not already use.

## Operating Context

- Statements arrive as files in `statements/`, one folder per account type (credit card as JSON, debit card as headerless CSV). The owner adds new files by dropping them into those folders.
- A watcher turns each new statement into `reports/` (JSON). The dashboard reads those reports.
- Merchant names are looked up on the web only after the owner approves the list of fragments.
- Personal payees and employer names live in a gitignored local config.

## Capabilities and Constraints

- Views: Overview, Cash flow, Categories and sub-categories, Merchants (with a drill-down, for example Coffee into individual shops), Trends, Distributions, Stability plan, Transactions with a Needs Review tab, and a Chat panel whose answers open in an advice modal.
- A global date-range filter and category and sub-category filters apply across every view.
- `statements/` is read-only. `reports/` is derived and can be regenerated at any time.
- The statements contain card and current-account activity only. They have no bank balances. Emergency-fund and loan balances are entered by the owner, and until then are labelled as estimates.
- Currency is GBP.
- Terminology follows `GLOSSARY.md`: Statement, Transaction, Report, Taxonomy, Category, Sub-category, Payment channel, Card repayment.

## Brand Commitments

None. This is a private tool with no brand, name or identity to carry.

## Evidence on Hand

- Six statement files, 3,065 transactions, from November 2023 to the present. Real data stays in `statements/` and is never committed.
- Synthetic fixtures in `tests/fixtures/` are the only data used in tests.

## Product Principles

1. Trust the statements, and never change them. Every number traces back to a transaction.
2. Show the money that is spent on things, separately from money that moves between the owner's own accounts.
3. Make the next decision obvious: what to cut, what to protect, and how far the emergency fund is from its target.
4. Estimates are labelled as estimates. The owner's own balances always replace them.
