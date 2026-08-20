---
name: verify-moks
description: Launch, drive, and prove the moks hiring CLI/TUI (packages/cli) the way a recruiter does. Use when verifying user-facing behavior — the headless ledger loop (pull/commit/review/push/log), a recruit agent run, or a TUI session — before claiming a change works.
---

# Verify moks

moks is a local-first hiring-agent CLI/TUI. The primary surfaces are the headless CLI (`moks <verb> --json`) and the TUI (`bun dev`). A leftover engine server (`moks serve`) exists but is not a user drive path; do not verify through it.

Every verification run owns two directories:

- `REQ` — a disposable scratch requisition (the "company folder" the CLI operates on). Deleted in cleanup.
- `EVIDENCE` — `.cursor/skills/verify-moks/evidence/<run-id>/`. Never deleted.

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)-$$
REQ=$(mktemp -d /tmp/moks-verify-XXXXXX)
EVIDENCE="$(git rev-parse --show-toplevel)/.cursor/skills/verify-moks/evidence/$RUN_ID"
mkdir -p "$EVIDENCE"
```

Two runs never share state: each has its own `REQ` (own `.moks/` ledger, own mock-ATS db) and its own tmux session name. Side-by-side headless runs are safe. Never point a run at a requisition you did not create, and never run the CLI without `--cwd "$REQ"` — it walks up looking for a company root and can adopt a parent directory.

## Launch

moks has no binary release; it runs from source with Bun. Install once per checkout, from the repo root:

```bash
bun install
```

There is no server to keep alive. "Launch" for a drive means seeding the scratch requisition from the shipped hiring fixtures:

```bash
CLI=packages/cli   # run all bun commands from this package
mkdir -p "$REQ/candidates"
cp "$CLI/src/product/fixtures/hiring/HIRING.md" "$REQ/"
cp "$CLI/src/product/fixtures/hiring/candidates/jordan-lee.md" "$REQ/candidates/"
```

For a TUI drive, start each session in its own tmux session (never in the foreground):

```bash
tmux new-session -d -s "moks-verify-$RUN_ID" -c packages/cli "bun dev"
tmux capture-pane -pt "moks-verify-$RUN_ID"   # observe the screen
```

Ready signal: the pane shows the moks banner and a status footer with the cwd path. Without a configured model provider the TUI opens a "Connect a provider" dialog; the TUI itself is up, but agent turns need a provider (see Drive).

## Doctor

One check answers "is this instance worth driving?" — run it before any drive and whenever anything looks off:

```bash
cd packages/cli
bun run --conditions=browser src/index.ts status --json --cwd "$REQ"
```

Healthy means exit code 0, `path` echoing your `$REQ` (proving the CLI adopted your scratch requisition and not a parent folder), and `report.ats` of `null` on a fresh instance or `"mock"` once `pull` has run. After a `pull` it also reports `jobs: 1, candidates: 5, applications: 5` and the changeset counts. It reads decision state without mutating it, with one caveat: on a never-driven requisition it creates the empty `.moks/` scaffolding (idempotent, no ledger entries).

## Drive

All commands run from `packages/cli`. Define once:

```bash
moks() { bun run --conditions=browser src/index.ts "$@" --json --cwd "$REQ"; }
```

**Path 1 — deterministic ledger loop (no model key required).** This is the default proof path. `pull` seeds a mock ATS mirror; the ids it knows are `cand_jane`, `cand_marcus`, `cand_priya`, `cand_devon`, `cand_amira` (applications `app_<name>_142`, job `job_req142`). See [features/ledger-loop.md](features/ledger-loop.md) for the full recipe and [features/push-guardrails.md](features/push-guardrails.md) for the dry-run and adverse-action behavior.

```bash
moks pull
moks commit --action advance --target-id cand_priya --reason "strong event + postgres signal"
moks review <changeset-id> --approve --by verifier
moks push --execute
moks log
```

**Path 2 — recruit agent run (model-dependent).** `moks run --agent recruit -f HIRING.md -f candidates/jordan-lee.md "Score this candidate using the score-candidate skill"` needs a configured provider (an `ANTHROPIC_API_KEY`-style env var or `moks auth login`). Without a key, prove the same loop against the repo's mock LLM server instead: `bun test test/product/hiring-e2e.test.ts` from `packages/cli`. See [features/score-candidate.md](features/score-candidate.md).

**Path 3 — TUI session.** Drive with `tmux send-keys` and observe with `tmux capture-pane`. Keyless verification covers launch, dialogs, and slash-command UI; agent turns need a provider. See [features/tui-session.md](features/tui-session.md).

Prompt strings and flags above are real and load-bearing; keep quoted values literal.

## Evidence

Every drive writes to `$EVIDENCE`:

- each command's stdout as `<step>.json` (the verbs print JSON with `--json`) and its exit code in `summary.json`
- side effects, checked directly, not inferred: `.moks/ledger.sqlite` exists, `moks log` reports `chain.ok: true`, the projected candidate card (`$REQ/candidates/<kebab-cased-id>.md`) carries the new stage
- for TUI drives, `tmux capture-pane -pt <session>` output as `screen-<step>.txt`

Proof standards: exercise the real user path (the CLI verbs a recruiter runs), capture the action and the resulting state, and verify side effects alongside stdout. The mock ATS adapter is a production boundary (`createMockAdapter` is the shipped adapter today), so no extra mocking is needed or allowed. `moks push` without `--execute` is a dry-run; it is verified to stage nothing — the changeset stays `approved` and no ledger entry flips to `applied` — so never present a dry-run as an applied write.

## Cleanup

Kill only what this run started, by exact name, then remove the scratch requisition:

```bash
tmux kill-session -t "moks-verify-$RUN_ID" 2>/dev/null || true
rm -rf "$REQ"
```

Never kill by process name (`pkill bun` would take out unrelated work). Never delete `.cursor/skills/verify-moks/evidence/` — that is where proof lives, and it must survive cleanup.

## Helpers

[`scripts/verify-ledger-loop.sh`](scripts/verify-ledger-loop.sh) (executable) runs the whole ledger-loop proof — launch, doctor, drive, evidence, cleanup — and fails loudly on any broken assertion:

```bash
.cursor/skills/verify-moks/scripts/verify-ledger-loop.sh
# evidence lands in .cursor/skills/verify-moks/evidence/<run-id>/
```

Rerun it after any change that touches the decision verbs, the ledger, or the CLI wiring.
