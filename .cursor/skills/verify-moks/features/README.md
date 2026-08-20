# moks verification map

This directory is the maintained source for verifying user-facing moks behavior. Read this index before driving, then follow the matching feature file as the recipe.

## Baseline preconditions

- `bun install` has run at the repo root (Bun is the only supported runtime).
- `REQ` is a fresh scratch requisition seeded from `packages/cli/src/product/fixtures/hiring/` (see the skill's Launch section). Never drive a requisition this run did not create.
- Every CLI command runs from `packages/cli` as `bun run --conditions=browser src/index.ts <verb> --json --cwd "$REQ"`.
- The doctor check (`status --json`) reports `report.ats` as `"mock"` before any drive.
- Evidence goes to `.cursor/skills/verify-moks/evidence/<run-id>/` and survives cleanup.

## Driving conventions

- Treat every command and quoted prompt as literal. The mirror ids (`cand_priya`, `app_priya_142`, `job_req142`) are exact.
- Headless proof includes the command, its JSON stdout, and the exit code.
- Mutation proof includes a read-only second view (`status` or `log`) showing the stored state.
- TUI drives run in a dedicated tmux session named `moks-verify-<run-id>`; observe with `tmux capture-pane`.
- Report an unreachable path (for example a model-dependent path with no provider key) with the attempted command and the unmet precondition. Do not report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph of user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>` (starting with `Preconditions:`, pairing each user action with an exact command and observable result), and `Gotchas`. Keep implementation details out; name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Ledger loop](./ledger-loop.md) covers pull, commit, review, push, and the decision log — the core disposition workflow.
- [Push guardrails](./push-guardrails.md) covers dry-run by default, review-before-push, and adverse-action confirmation.
- [Score a candidate](./score-candidate.md) covers the recruit agent scoring a fixture candidate, headless and via mock LLM.
- [TUI session](./tui-session.md) covers launching the interactive TUI and driving the hiring loop in it.
