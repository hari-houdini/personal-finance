"""Chat bridge: forwards the user's message, unchanged, to the claude CLI.

Claude gets read-only access to reports/ (Read, Grep, Glob only) and answers with a
JSON object the dashboard renders in the advice modal. Nothing here writes to disk
or runs shell commands on Claude's behalf.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

CHAT_TIMEOUT_SECONDS = 240
ALLOWED_TOOLS = ["Read", "Grep", "Glob"]

SYSTEM_PROMPT = """You are the advisor inside a personal finance dashboard. The user is the owner of the data.

Data lives in the reports/ directory, which you may read:
- transactions.json: every transaction. Fields: date, amount (GBP, negative = money out), merchant, category_id, subcategory_id, kind, account, flags.
- summary.json: monthly totals by kind, totals per sub-category and per merchant.
- import_manifest.json: which statement files were loaded.

Kinds: income, essential, discretionary, debt, savings, tax, fee, transfer (not spending), refund, review (unclassified).
Use reports/ to ground every figure. Cite months and amounts. Say plainly when data is missing,
for example bank balances, which statements do not contain. Do not invent numbers.

Read-only: do not create, edit or delete files, and do not run shell commands.

Reply with exactly one JSON object and nothing else:
{"answer": "<markdown answer>", "actions": [{"title": "...", "detail": "..."}], "highlights": [{"label": "...", "value": "..."}]}
"""


def _extract_json(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def ask(message: str, reports_dir: Path, project_root: Path, session_id: str | None = None) -> dict:
    """Send `message` as-is to claude. Returns {answer, actions, highlights, session_id} or {error}."""
    command = [
        "claude",
        "-p",
        message,
        "--output-format",
        "json",
        "--add-dir",
        str(reports_dir),
        "--allowedTools",
        *ALLOWED_TOOLS,
        "--append-system-prompt",
        SYSTEM_PROMPT,
    ]
    if session_id:
        command += ["--resume", session_id]
    try:
        proc = subprocess.run(
            command,
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=CHAT_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return {"error": "The claude CLI was not found on PATH."}
    except subprocess.TimeoutExpired:
        return {"error": "Claude took too long to answer. Try a narrower question."}

    if proc.returncode != 0:
        return {"error": f"claude exited with code {proc.returncode}."}

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": "Unexpected output from claude."}

    result_text = str(envelope.get("result", "")) if isinstance(envelope, dict) else ""
    parsed = _extract_json(result_text) or {}
    return {
        "answer": parsed.get("answer") or result_text,
        "actions": parsed.get("actions") or [],
        "highlights": parsed.get("highlights") or [],
        "session_id": envelope.get("session_id") if isinstance(envelope, dict) else None,
    }
