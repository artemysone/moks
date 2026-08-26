# Push to the ATS

Push applies approved changesets through the ATS adapter. Default is dry-run. `--execute` is the write. Adverse actions need `--confirm`.

## Sub-features

- `push-dry-run` previews without applying.
- `push-execute` applies an approved non-adverse changeset.
- `push-confirm` is required for reject / offer / hire.
- `push-blocked` exits `2` with `error: "needs_confirm"` when `--json` and confirm is missing.

## How to get to it (user POV)

- Run `moks push` or `moks push --json` (dry-run).
- Run `moks push --execute --json` to apply.
- Run `moks push --confirm --execute --json` for adverse actions.
- The TUI commit/review/push dialogs call the same ledger verbs. CLI is the scripted proof.

## Driving it with control-moks

Preconditions:

- Isolated workspace after `pull`.
- An approved changeset from `commit --action note --target-id cand_priya` plus `review <id> --approve --by verify-moks`.

- **Dry-run.** Run `scripts/moks.sh push --json`. Exit code `0`. The payload is a preview. Run `scripts/moks.sh status --json`. The changeset is still `approved`, not `applied`.
- **Execute.** Run `scripts/moks.sh push --execute --json`. Exit code `0`. `status --json` shows that id as `applied`.
- **Adverse block.** Commit `--action reject --target-id cand_amira --reason "below bar"`, approve it, then run `scripts/moks.sh push --execute --json` without `--confirm`. Exit code `2`. JSON `error` is `needs_confirm`. Status stays `approved`.
- **Adverse confirm.** Run `scripts/moks.sh push --confirm --execute --json`. Exit code `0`. Status becomes `applied`.
- **Proof.** Save dry-run, execute, blocked, and status JSON under `$EVIDENCE/push/`. Write `meta.txt` with feature id `push` and both entry points (`push` and `push --execute`). Observe `.moks/` under `$COMPANY` only.

## Gotchas

- Dry-run still talks to the adapter in preview form. Proof is the second `status`, not the word "dry-run" in help text.
- `--execute` without `--confirm` on reject / offer / hire is a successful demonstration of the guard, not a failed run.
- Do not push a recruiter's real company. Isolation is part of the proof.
- This map proves the mock adapter path. Live Ashby is Wave 3 of the cut-over, not on hold.
