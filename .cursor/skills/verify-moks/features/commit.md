# Stage a disposition

Commit stages a typed hiring mutation on the ledger. It does not write the ATS.

## Sub-features

- `commit-note` stages `AddNote` on a mirrored candidate.
- `commit-advance` stages `AdvanceStage` on a mirrored application.
- `commit-status` lists the new changeset as `staged`.
- `commit-missing` fails when the target is not in the mirror.

## How to get to it (user POV)

- Run `moks commit --action note --target-id <id> --reason "…"`.
- Run `moks commit --action advance --target-id <id> --reason "…"`.
- Run the same with `--json`.
- From the TUI agent, the `commit` tool is the same verb; human proof still uses the CLI.

## Driving it with control-moks

Preconditions:

- Isolated workspace.
- `scripts/moks.sh pull --json` already succeeded (`ats=mock`).
- No open changeset for `cand_priya` in `status --json`.

- **Note.** Stage a note. Run `scripts/moks.sh commit --action note --target-id cand_priya --reason "verify-moks note" --json`. Exit code `0`. Stdout includes `changeset.id` and `changeset.status` `staged`. `path` is `$COMPANY`.
- **Confirm staged.** Run `scripts/moks.sh status --json`. The open list contains that id with `status` `staged`.
- **Advance.** Stage an advance on Priya's application. Run `scripts/moks.sh commit --action advance --target-id cand_priya --reason "verify-moks advance" --json`. Exit code `0`. A second staged changeset appears in `status --json`.
- **Unknown target.** Run `scripts/moks.sh commit --action note --target-id jordan-lee --reason "should fail" --json`. Exit code is not `0`. Stderr or stdout mentions `unknown entity` and `moks pull`.
- **Proof.** Save commit and status JSON under `$EVIDENCE/commit/`. Write `meta.txt` with feature id `commit` and entry point `moks commit --action note --target-id cand_priya`.

## Gotchas

- `jordan-lee` is the scoring card id. After pull, use `cand_priya` or `application:app_priya_142`.
- `--reason` is required. An empty reason fails before any ledger write.
- Commit is not an ATS write. `status` must still show `staged`, never `applied`.
- `--target-kind candidate` is optional documentation; resolution uses the mirror.
