---
name: verify-moks
description: Drive the moks hiring CLI/TUI the way a recruiter does and prove behavior with isolated fixture workspaces. Use when proving a change on the real product, running a hiring-loop check, or verifying pull/commit/review/push/run.
---

# Verify moks

moks is a hiring CLI/TUI. The company folder is the workspace. A req is a subdirectory (or a single-req root with `HIRING.md` + `candidates/`). Cards are markdown working copies. The ledger in `.moks/` is the system of record. `moks commit` stages. `moks review` is human-only. `moks push` applies through the ATS adapter (mock today).

This skill drives the **shipped CLI** (`packages/cli/src/index.ts`) and, when needed, the interactive TUI. It does not prove via unit tests or ledger internals.

Read `features/README.md` before driving. Use the matching feature file. A proof that hits one convenient command is incomplete when the map lists other entry points.

## Launch

There is no long-lived product server for the hiring verbs. Launch means: install once, then create an isolated single-req company and run each command against it.

From the repo root:

```bash
bun install
WORK="$(.cursor/skills/verify-moks/scripts/workspace.sh)"
export MOKS_VERIFY_WORK="$WORK"
source "$WORK/env.sh"
.cursor/skills/verify-moks/scripts/doctor.sh
```

`workspace.sh` copies `packages/cli/src/product/fixtures/hiring/` into `$WORK/company` (Northline Analytics + `candidates/jordan-lee.md`), points `HOME` / `XDG_*` at `$WORK/home`, and writes `$WORK/env.sh`. Ready when `doctor.sh` prints `ok company=` and `ok home=` under that work dir.

Interactive TUI (only when a feature file says so):

```bash
export MOKS_VERIFY_TMUX="moks-verify-$RUN_ID"
tmux new-session -d -s "$MOKS_VERIFY_TMUX" -c "$COMPANY" \
  "cd \"$REPO/packages/cli\" && HOME=\"$HOME\" XDG_CONFIG_HOME=\"$XDG_CONFIG_HOME\" bun dev"
```

Ready when `tmux capture-pane -pt "$MOKS_VERIFY_TMUX"` shows the moks prompt. Do not run `bun dev` in the foreground of this agent. Do not attach to a TUI the user already has open.

Source install without a global `moks` binary:

```bash
.cursor/skills/verify-moks/scripts/moks.sh pull --json
```

That is `bun run --conditions=browser packages/cli/src/index.ts --cwd "$COMPANY" …` with the isolated env. Same verbs as `moks` in the README.

## Doctor

Run `.cursor/skills/verify-moks/scripts/doctor.sh` first whenever anything looks off. It is read-only. It must report:

- `bun` on PATH
- CLI entry `packages/cli/src/index.ts`
- `WORK` is a `moks-verify-*` directory
- `COMPANY` and `HOME` live under `WORK`
- `COMPANY` is not this git checkout
- fixture `HIRING.md` contains `Northline Analytics`
- `candidates/jordan-lee.md` exists
- after pull: `ok ledger=$COMPANY/.moks/ledger.sqlite`

Refuse to drive if doctor fails. Refuse to drive `~/.config/moks`, a recruiter's real company folder, or any directory that is not the workspace this run created.

## Drive

Prefer the headless CLI with `--json`. cwd is the requisition. Pass `--cwd "$COMPANY"` (the helper does this).

```bash
.cursor/skills/verify-moks/scripts/moks.sh <verb> --json
```

Stable handles:

| Surface | Handle |
|---------|--------|
| CLI verbs | `pull`, `status`, `commit`, `review`, `push`, `log`, `run` |
| JSON flag | `--json` (or `run --format json`) |
| Workspace | `--cwd` / helper cwd = isolated company |
| Fixture constitution | `HIRING.md` heading `Senior Backend Engineer`, company `Northline Analytics` |
| Fixture card | `candidates/jordan-lee.md` |
| Mock ATS after pull | `ats=mock`, job `job_req142`, candidates `cand_jane` / `cand_marcus` / `cand_priya` / `cand_devon` / `cand_amira` |
| Commit target | `--target-id cand_priya` or `--entity application:app_priya_142` (mirror ids, not `jordan-lee`) |
| TUI slash | `/init`, `/review` |
| Default agent | `recruit` |

`jordan-lee` is the scoring-card fixture. Ledger mutations after `pull` resolve against the mock ATS snapshot. `unknown entity: jordan-lee` means you skipped pull or used the card id as an ATS id.

Do not use `packages/cli/test/lib/cli-process.ts` or `TestLLMServer` as the proof. Those are test doubles. `moks run` against a paid provider is a real user path; only drive it when the feature file says so and a provider is configured.

TUI keystrokes go through the tmux session this run started. Capture with `tmux capture-pane -pt "$MOKS_VERIFY_TMUX"`. Prefer ARIA-free prompt strings (`moks`, `/init`, recruit) over cursor coordinates.

## Evidence

Write artifacts under `.cursor/skills/verify-moks/evidence/<run-id>/` (`$EVIDENCE` from `env.sh`). Cleanup must not delete this directory.

Proof standards:

- Exercise the real CLI/TUI path. No direct sqlite writes, no calling `@moks/ledger` from a scratch script as a substitute for `moks`.
- Capture the command (argv), stdout, stderr, and exit code for every CLI step. Save JSON stdout as `*.json`.
- For a mutation, capture the action and a second read (`status` / `log` / reopen the card). A successful exit code alone is not proof.
- After `pull`, assert `.moks/ledger.sqlite` and `.moks/mock-ats.sqlite` exist under `$COMPANY`, not under the repo.
- After `commit`, the changeset id appears in `status --json` with `status=staged`.
- After `review --approve`, that id is `approved`.
- `push` without `--execute` is dry-run. Confirm no ATS apply by a second `status` that still shows `approved` (not `applied`). `push --execute` is the write; use `--confirm` for reject / offer / hire.
- `moks run` proof includes the prompt, the recruit reply, and that `HIRING.md` / the card were attached. Do not treat a mock-LLM unit test as this proof.
- Record the feature id and entry point on every artifact (`meta.txt`).

## Cleanup

```bash
.cursor/skills/verify-moks/scripts/cleanup.sh
```

Kills only `$MOKS_VERIFY_TMUX` if set, then `rm -rf` the `moks-verify-*` work dir this run created. It never deletes `$EVIDENCE`. It refuses a path that does not contain `moks-verify-`. Never `killall bun` / `killall moks`.

After cleanup, confirm `$EVIDENCE` still has the captured files.

## Helpers

All scripts are executable. Invoke them from the repo root.

| Script | What |
|--------|------|
| `scripts/workspace.sh [run-id]` | Create isolated company + home. Prints `$WORK`. Writes `$WORK/env.sh`. |
| `scripts/doctor.sh` | Read-only health check. Requires `MOKS_VERIFY_WORK` or the work dir as argv0. |
| `scripts/moks.sh [--] <moks-args>` | Isolated CLI. Same. |
| `scripts/cleanup.sh` | Tear down work dir and optional tmux session. Keeps evidence. |

```bash
WORK="$(.cursor/skills/verify-moks/scripts/workspace.sh)"
export MOKS_VERIFY_WORK="$WORK"
source "$WORK/env.sh"
.cursor/skills/verify-moks/scripts/doctor.sh
.cursor/skills/verify-moks/scripts/moks.sh pull --json
.cursor/skills/verify-moks/scripts/cleanup.sh
```
