# Contributing

Thanks for working on this. The project handles one person's bank data, so the first section matters more than anything else in this file.

## Privacy rules

These apply to every change, every test, every issue and every commit.

1. **Never commit real data.** `statements/`, `reports/` and `config/local/` are gitignored. Keep them that way. Check `git status` before every commit.
2. **Tests use synthetic fixtures only.** Everything in `tests/fixtures/` is made up. If you need a new case, write a small synthetic file that shows the shape, not a copy of a real statement.
3. **Do not paste real descriptors, amounts or dates** into tests, issues, pull requests, commit messages or chat transcripts. If a bug only shows up with real data, describe the shape of the problem and reproduce it with a made-up row.
4. **Statements are read-only.** Any change to the parsers must keep them read-only. `tests/test_ingest.py` checks that the pipeline leaves the statement files byte-identical. Do not weaken that test.
5. **Personal payees stay personal.** Nothing in `config/merchants.json` or any other committed file should name a person, an employer or a private account.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Use Python 3.11 or later. The project is developed on 3.15.

## Running the tests and lint

Run everything from the project root:

```bash
.venv/bin/python -m pytest
.venv/bin/python -m ruff check app tests
```

The tests must pass and ruff must be clean before you open a pull request.

Do not run Python in isolated mode (`-I`) for the test suite. Isolated mode drops the project folder from the import path, and the tests fail to find the `app` package.

## Making a change

### Adding a bank statement format

1. Add a parser to `app/ingest/parsers.py` that returns `RawTransaction` records. Follow the existing two: they raise `ParseError` with the file name and line or row for any bad input, so the importer can report it and carry on.
2. Register the file extension in `parse_statement`.
3. Add a synthetic example under `tests/fixtures/<account>/` with the same shape as the bank's export, with made-up values.
4. Add tests next to the existing parser tests. Cover a good file, a bad row, and any sign or date conventions the bank uses.
5. Update the statement table in the [README](README.md#adding-statements) and the [architecture](docs/architecture.md#known-limits) limits.

### Adding or changing categories and merchant rules

These are data, not code. See [configuration](docs/configuration.md).

- Taxonomy IDs must stay unique. `test_taxonomy_ids_are_unique_and_valid` checks this.
- Rules are regular expressions, and the first match wins. Put specific patterns above general ones.
- Do not rename an existing sub-category ID. Existing data refers to it.

### Changing the API

- Keep the response shapes in [the API reference](docs/api.md) accurate. Update that page in the same change.
- Read endpoints should accept the standard [filters](docs/api.md#filters). Write endpoints must validate their input and return a clear status code.
- The API has no authentication and is bound to localhost. Do not add endpoints that expose data beyond that boundary.

### Changing the dashboard

The look is defined by [DESIGN.md](DESIGN.md), and the product's purpose and principles are in [PRODUCT.md](PRODUCT.md). Read both before a visual change.

- Colours, radii and spacing come from `web/css/tokens.css`. Do not add hard-coded colour values to other files.
- Every chart needs a table alternative in the page, so no value is reachable only through a hover. Keep that when you add a chart.
- Check any visual change at desktop width and at 390 pixels. Pay particular attention to the Overview, Stability plan and Transactions views, which carry most of the data.
- Text that is an estimate must be labelled as one.

### Using domain terms

Use the words in [GLOSSARY.md](GLOSSARY.md): *Statement*, *Transaction*, *Report*, *Taxonomy*, *Category*, *Sub-category*, *Payment channel*, *Card repayment*. If you need a new term, add it to the glossary in the same change.

## Commit messages and pull requests

The history uses Conventional Commit prefixes, for example `feat:` and `fix:`. Keep one logical change per commit.

A pull request should say what changed and why, list the tests you ran, and note any change to a privacy rule above. If the change affects behaviour a user sees, say which page or endpoint.

## Documentation

Update the docs in the same change as the code they describe:

| If you change | Update |
|---|---|
| Setup, commands or the quick start | [README](README.md) |
| Data flow, modules or privacy boundary | [Architecture](docs/architecture.md) |
| An endpoint or its response | [API reference](docs/api.md) |
| A config file or its keys | [Configuration](docs/configuration.md) |
| A routine procedure or a failure mode | [Runbook](docs/runbook.md) |
| A domain term | [Glossary](GLOSSARY.md) |

Keep documents short and link to the others rather than repeating them.

## Reporting problems

See the [runbook's escalation section](docs/runbook.md#escalation). Use `docs/agents/issue-tracker.md` for how issues are tracked. Never include statement contents, real descriptors or amounts in an issue.
