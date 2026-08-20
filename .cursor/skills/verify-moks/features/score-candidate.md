# Score a candidate

A recruiter hands the recruit agent a req constitution (`HIRING.md`) and a candidate card, and asks it to score the candidate against the scorecard using the built-in `score-candidate` skill. The agent reads both files, scores each scorecard dimension, and writes its verdict. This is the flagship agent path; the sibling built-in skills (`req-context`, `draft-outreach`, `commit-disposition`) ride the same `moks run` surface.

## Sub-features

- `run-recruit` runs one headless recruit-agent turn over attached files.
- `run-json` machine-readable run output via `--json` or `--format json`.
- `builtin-skills` the agent can invoke `score-candidate` and its siblings.
- `agent-default` `moks run` defaults to the recruit agent when `--agent` is omitted.

## How to get to it (user POV)

- Run `moks run --agent recruit -f HIRING.md -f candidates/jordan-lee.md "Score this candidate using the score-candidate skill"` from a requisition.
- In the TUI, attach the files and type the same prompt.

## Driving it with the bun CLI

Preconditions:

- Fresh scratch requisition `$REQ` seeded with the fixture `HIRING.md` and `candidates/jordan-lee.md`.
- A model provider is configured: a provider API key env var (for example `ANTHROPIC_API_KEY`) or `moks auth login`. Without one, use the mock-LLM fallback below and report the live path as unreachable.
- Commands run from `packages/cli`.

- **Score headless.** Run `bun run --conditions=browser src/index.ts run --json --agent recruit -f "$REQ/HIRING.md" -f "$REQ/candidates/jordan-lee.md" -- "Score this candidate using the score-candidate skill"`. Exit 0; stdout contains the agent's scorecard verdict referencing Jordan Lee's Postgres and event-pipeline signal.
- **Mock-LLM fallback (no key).** Run `bun test test/product/hiring-e2e.test.ts` from `packages/cli`. Exit 0; the suite proves the CLI entry, recruit agent selection, fixture attachment, and skill wiring against a local mock LLM server.
- **Proof.** Save the run's stdout, stderr, and exit code to `$EVIDENCE`. For the live path, the verdict must reference actual fixture content (`Northline Analytics`, `Jordan Lee`), not a generic answer.

## Gotchas

- The `--` before the prompt is required with `-f`; without it yargs eats the prompt as another file path.
- A live-model run is nondeterministic; assert on fixture-grounded content, not exact wording.
- The mock-LLM test proves plumbing, not scoring quality. Do not report it as a live scoring verification.
- `--mini` (interactive) cannot combine with `--json` / `--format json`.
