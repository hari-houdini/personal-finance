# Runbook

Step-by-step procedures for the routine tasks and the things that go wrong. Commands assume you are in the project root and have set up the virtual environment as described in the [README](../README.md#quick-start).

- [Rebuild the reports](#rebuild-the-reports)
- [Watch the statements folder](#watch-the-statements-folder)
- [Start the dashboard](#start-the-dashboard)
- [Identify unknown merchants](#identify-unknown-merchants)
- [A statement failed to import](#a-statement-failed-to-import)
- [Reports look wrong or are corrupt](#reports-look-wrong-or-are-corrupt)
- [The Ask panel does not answer](#the-ask-panel-does-not-answer)
- [A one-off correction disappeared](#a-one-off-correction-disappeared)
- [Balances and budget figures stay out of git](#balances-and-budget-figures-stay-out-of-git)
- [Roll back a config change](#roll-back-a-config-change)
- [Escalation](#escalation)

## Rebuild the reports

**When:** you added or changed statement files, or you changed the taxonomy, merchant rules or personal rules.

**Prerequisites:** the statements are in `statements/credit-card/` or `statements/debit-card/`.

**Steps:**

1. Run the import:

   ```bash
   .venv/bin/python -m app.ingest.cli
   ```

2. Read the summary line. It shows the number of statements, records, rows needing review, and failures:

   ```
   statements: 6  records: 3065  needs review: 1020  failures: 0
   ```

3. If `failures` is not zero, see [a statement failed to import](#a-statement-failed-to-import).

The dashboard's **Re-read statements** button runs the same import. Refresh the page afterwards.

**Safe to repeat:** yes. The output is rebuilt from scratch each time, and the statements are never written.

## Watch the statements folder

**When:** you want new statements imported as they are copied in.

```bash
.venv/bin/python -m app.ingest.cli --watch
```

The command rebuilds once at start, then rebuilds two seconds after the last change in `statements/`. A file is read only once its size has stopped changing, so a half-copied file is not imported. Stop watching with `Ctrl-C`.

Watch mode does not start the dashboard. Run the server separately, as described in [start the dashboard](#start-the-dashboard).

## Start the dashboard

**When:** you want to use the dashboard.

```bash
.venv/bin/uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>.

**If the port is in use:**

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

This shows which process is listening. If it is an earlier copy of this server, you can reuse it, or stop it with `kill <PID>` after checking the PID is yours. If it is something else, choose another port, for example `--port 8010`.

**Do not** change `--host` to `0.0.0.0`. The server has no login, so binding it to all interfaces exposes your data to your network. See [architecture: security model](architecture.md#security-model).

**If the page says "No reports yet":** run [rebuild the reports](#rebuild-the-reports) first.

## Identify unknown merchants

**When:** the Transactions page shows many entries under "Needs review", with a merchant name that is not a brand you recognise.

**What leaves the machine:** a short fragment of each unknown descriptor, up to two words with location words removed. Each fragment is sent to web search through your `claude` CLI, one at a time. Amounts, dates, card details and full descriptors are never sent, and personal payees never reach this step.

**Steps:**

1. In the dashboard, click **Identify merchants**. The notice lists every fragment that will be sent.
2. Read the list. If a fragment looks like a person's name or a personal detail, cancel and add a personal rule for it instead.
3. Click **Search N names** to approve. Cancel to send nothing.
4. Wait for the toast: "Identified N brands". Each search can take up to three minutes.

From the command line, the same flow asks for a `y` before sending anything:

```bash
.venv/bin/python -m app.ingest.cli --resolve
```

**To search a fragment again:** remove its entry from `reports/merchant_cache.json` and run the flow again. Each search is an outbound call, so only repeat it when the first answer was wrong.

**Requires:** the `claude` CLI on your `PATH`.

## A statement failed to import

**Symptoms:** the import summary shows `failures` greater than zero, or the console shows `FAILED <file>: <reason>`.

**Find the cause:**

```bash
.venv/bin/python -m json.tool reports/import_manifest.json | less
```

Look at the `failures` list and at the `statements` entry for that file. The `error` tells you the row or line that failed. Debit CSV errors include the line number, for example `line 14: expected at least 3 fields`.

**Fix:**

- If the file is damaged, download it again from the bank. Do not edit a statement by hand. Edited statements no longer match the bank's records, and the transaction IDs change.
- If the bank has changed its format, the parser needs a change. That is a code change: see [contributing](../CONTRIBUTING.md).

Then run [rebuild the reports](#rebuild-the-reports). The other statements are unaffected while one file is broken, so you can keep using the dashboard.

## Reports look wrong or are corrupt

**When:** a figure does not match what you expect, or the dashboard fails to load the reports.

**Important:** `reports/` also holds `merchant_cache.json`, the brands found by web search. Deleting the folder forces every fragment to be searched again, which means sending them again. Back it up first.

**Steps:**

1. Keep a copy of the cache:

   ```bash
   cp reports/merchant_cache.json ~/Desktop/merchant_cache.backup.json
   ```

2. Delete the derived files and rebuild:

   ```bash
   rm -r reports/
   .venv/bin/python -m app.ingest.cli
   ```

3. Put the cache back if you want to keep the identified brands:

   ```bash
   cp ~/Desktop/merchant_cache.backup.json reports/merchant_cache.json
   .venv/bin/python -m app.ingest.cli
   ```

Your statements, overrides and personal rules are in other folders and are not touched.

**Rollback:** nothing is lost, because `reports/` is derived. If the rebuild is wrong, check the code change that caused it with `git log -- app/`, and revert with `git revert <commit>`.

## The Ask panel does not answer

The Ask panel uses the `claude` CLI. A failed question appears in the conversation as "I could not answer:" followed by the message below:

| Message | Cause | Fix |
|---|---|---|
| "The claude CLI was not found on PATH." | `claude` is not installed, or the server was started from a shell that cannot see it | Run `which claude` in the same shell. Install the CLI, or add its folder to `PATH` and restart the server. |
| "Claude took too long to answer. Try a narrower question." | The question needs too much of the data | Narrow the date range or ask a more specific question. The limit is 240 seconds. |
| "claude exited with code N." | The CLI ran and failed, often because it is not signed in | Run `claude` once in a terminal and check it works. |
| "Unexpected output from claude." | The CLI returned something other than its JSON envelope | Try again. If it repeats, check the CLI version. |
| HTTP `409`: "No reports yet" | The reports have not been built | [Rebuild the reports](#rebuild-the-reports). |

## A one-off correction disappeared

**Symptom:** you changed a transaction's category without ticking **Remember**, and after a re-import it is back to the old category.

**Cause:** transaction IDs are computed from the file name, row number, date, amount and descriptor. If the bank re-exported the statement with its rows in a different order, or the amount or descriptor changed, the ID is new, and the old override no longer matches.

**Fix:**

1. Change the category again in the dashboard.
2. Tick **Remember for this merchant** if the change applies to every payment to that merchant. A personal rule matches the descriptor rather than the ID, so it survives re-exports.

**Prevention:** keep the statement files exactly as the bank gave them. Do not rename rows or re-save CSVs in a spreadsheet.

## Balances and budget figures stay out of git

The "Your balances" form (Stability plan) saves to `config/local/stability.json`, and the Budget plan reads its salary, family support and bike figures from `config/local/budget.json`. Both folders are gitignored, so your real numbers are not committed.

`config/stability.json` still has a `user_entered` block for older setups, but the app reads and writes the local file when it exists. If you see real values in `config/stability.json`, move them to `config/local/stability.json` and reset that block to `null`, then check:

```bash
git diff config/stability.json
```

If the diff shows real values, do not commit that file. Commit your other changes without it:

```bash
git restore --staged config/stability.json
```

## Roll back a config change

**Committed files** (`config/taxonomy.json`, `config/merchants.json`, `config/stability.json`):

```bash
git diff config/taxonomy.json           # see what changed
git checkout -- config/taxonomy.json    # discard the change
.venv/bin/python -m app.ingest.cli      # rebuild
```

Use `git checkout --` only on files whose changes you want to discard. Check `git diff` first.

**Local files** (`config/local/rules.json`, `config/local/overrides.json`) are not in git, so keep a copy before editing them by hand:

```bash
cp config/local/rules.json config/local/rules.json.bak
```

To undo a personal rule, delete its entry from `rules.json`, then rebuild.

## Escalation

This is a single-owner project. For anything the steps above do not resolve:

- **Data or privacy concern** (something was sent that should not have been, or a file was committed by mistake): stop, do not push, and rotate anything that was exposed. Then open an issue as described in [`docs/agents/issue-tracker.md`](agents/issue-tracker.md).
- **Bug or missing behaviour:** open an issue following [`docs/agents/issue-tracker.md`](agents/issue-tracker.md). Include the command you ran and the exact message. Do not paste statement contents or amounts into an issue.
- **The bank changed its format:** see [contributing](../CONTRIBUTING.md) for how parsers are structured.
