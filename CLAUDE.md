# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A local personal finance dashboard. It reads bank statements (credit card JSON, debit card CSV), builds derived reports, and serves a web dashboard on localhost. Stack: Python with FastAPI and uvicorn for the backend; plain JavaScript modules with D3 for the frontend, with no build step. The product and its design are in `PRODUCT.md` and `DESIGN.md`. Update this file as code and tooling change.

Documentation: `README.md` (overview and quick start), `CONTRIBUTING.md` (privacy rules, tests, change process), and `docs/` (architecture, API reference, configuration, runbook).

## Layout

- `app/` — backend. `app/ingest/` turns statements into reports (parsers, classifier, resolver, watcher, CLI). `analytics.py`, `stability.py`, `budget.py`, `chat.py` and `api.py` serve the dashboard.
- `config/` — committed configuration: `taxonomy.json`, `merchants.json`, `stability.json`, `budget.json`.
- `config/local/` — personal payees and overrides. Gitignored.
- `statements/` — real bank records, read-only, gitignored.
- `reports/` — derived output, rebuilt on every import, gitignored.
- `web/` — dashboard front end.
- `tests/` — pytest suite and synthetic fixtures in `tests/fixtures/`.
- `docs/` — architecture, API, configuration and runbook.

## Commands

Run from the project root. Use the project virtual environment.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # install
.venv/bin/python -m app.ingest.cli                                    # rebuild reports/
.venv/bin/python -m app.ingest.cli --watch                            # rebuild as statements arrive
.venv/bin/uvicorn app.api:app --host 127.0.0.1 --port 8000           # run the dashboard
.venv/bin/python -m pytest                                            # test
.venv/bin/python -m ruff check app tests                              # lint
```

Do not use `python -I` for pytest: isolated mode hides the `app` package.

## Working conventions

- **Treat everything in `statements/`, `reports/` and `config/local/` as sensitive.** These hold real bank or card records and personal payees. Do not print their contents into chat unless the user asks, do not copy their data into other files, and do not commit them. `.gitignore` already excludes them.
- The API binds to `127.0.0.1` and has no authentication. Keep it that way.
- Tests use only the synthetic fixtures in `tests/fixtures/`.
- Balances and budget figures (salary, family support, bike, debts) live in `config/local/` (`stability.json`, `budget.json`), which is gitignored. Keep them there. `config/stability.json` and `config/budget.json` are committed and hold only generic targets and rules.
- Do not commit or push unless the user asks.

## Agent skills

### Issue tracker

GitHub Issues, via the `gh` CLI. The repo has a git remote (`origin`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
