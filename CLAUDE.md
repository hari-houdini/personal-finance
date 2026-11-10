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
