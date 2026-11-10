# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Personal finance project. The repo is at an early stage: it has no commits, no source code, no build system, and no tests yet. Update this file as code and tooling are added.

## Layout

- `statements/` — intended home for financial statements. It is currently empty.
- `.git/` — the repository has been initialized on `main`, with no commits.

## Working conventions

- **Treat everything in `statements/` as sensitive.** These are real bank or card records. Do not print their full contents into chat unless the user asks, do not copy their data into other files, and do not commit them. There is no `.gitignore` yet, so add one that excludes `statements/` before the first commit.
- Do not commit or push unless the user asks.
- Before adding a stack (language, framework, package manager), ask the user or confirm it from the request. Once one is chosen, record the install, run, and test commands here.

## Agent skills

### Issue tracker

GitHub Issues, via the `gh` CLI. The repo has no git remote yet, so one must be added before issue commands work. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
