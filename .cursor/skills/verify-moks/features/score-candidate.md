# Score a candidate

Headless `moks run` loads the req constitution and a candidate card, then the `recruit` agent scores with the `score-candidate` skill.

## Sub-features

- `run-recruit` defaults to the recruit agent when `--agent` is omitted.
- `run-files` attaches `HIRING.md` and the card via `-f` / `--file`.
- `run-json` prints machine-readable output.
- `run-score` writes a score onto the card or states the score in the reply (observe whichever the run actually did).

## How to get to it (user POV)

- Run `moks run --agent recruit -f HIRING.md -f candidates/jordan-lee.md -- "Score this candidate using the score-candidate skill"`.
- Omit `--agent` (defaults to recruit).
- Add `--json` / `--format json`.
- In the TUI, attach the same files and send the same prompt to recruit.

## Driving it with control-moks

Preconditions:

- Isolated workspace with fixture `HIRING.md` and `candidates/jordan-lee.md`.
- A configured model provider the recruit agent can call. If none is configured, record `run-score` as unreachable with the provider error. Do not substitute `bun test test/product/hiring-e2e.test.ts`.
- Doctor has passed.

- **Explicit agent.** Run `scripts/moks.sh run --json --agent recruit -f "$COMPANY/HIRING.md" -f "$COMPANY/candidates/jordan-lee.md" -- "Score this candidate using the score-candidate skill"`. Exit code `0`. Stdout is the recruit reply (JSON when `--json`). It does not say `agent "recruit" not found`.
- **Default agent.** On a fresh session, run the same without `--agent`. Exit code `0`. Stderr does not say `Falling back to default agent`.
- **Attachments.** The run used both files. The reply or tool trace refers to Northline / Senior Backend / Jordan Lee.
- **Card side effect.** Re-read `candidates/jordan-lee.md`. If frontmatter `score` changed, save a copy as `card-after.md`. If the score exists only in the reply, save the reply as `run.json` and say so. Either is valid proof; silence on both is not.
- **Proof.** Save argv, stdout, stderr, exit code, and the card snapshot under `$EVIDENCE/score-candidate/`. Write `meta.txt` with feature id `score-candidate` and entry point `moks run --agent recruit`.

## Gotchas

- `--` before the prompt is required so yargs does not eat the sentence as another `--file`.
- `--mini` cannot combine with `--json`.
- The hiring e2e test uses a mock LLM server. That is not this feature's proof.
- Scoring is not `moks commit`. A score on the card is a working-copy edit until someone commits a disposition.
