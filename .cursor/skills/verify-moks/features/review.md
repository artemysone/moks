# Review a changeset

Review is the human approve or reject of a staged changeset. The agent does not do this.

## Sub-features

- `review-approve` marks a staged changeset approved.
- `review-reject` marks a staged changeset rejected.
- `review-required` refuses a call with neither `--approve` nor `--reject`.
- `review-tui` is `/review` in the TUI (packet review). CLI `--approve` is the ledger verb.

## How to get to it (user POV)

- Run `moks review <changeset-id> --approve --by <who>`.
- Run `moks review <changeset-id> --reject --by <who>`.
- Run the same with `--json`.
- In the TUI, type `/review` to review a hiring packet. That path does not replace CLI approve/reject for ledger status.

## Driving it with control-moks

Preconditions:

- Isolated workspace after a successful `pull`.
- A staged changeset id from `commit --action note --target-id cand_priya --reason "verify-moks review" --json`.

- **Approve.** Run `scripts/moks.sh review <id> --approve --by verify-moks --json`. Exit code `0`. `changeset.status` is `approved`. `changeset.reviewed_by` is `verify-moks`.
- **Confirm.** Run `scripts/moks.sh status --json`. That id is `approved`, not `staged`.
- **Reject path.** Commit a second note, then run `scripts/moks.sh review <id2> --reject --by verify-moks --json`. `changeset.status` is `rejected`. `status --json` counts it under rejected, not open.
- **Missing flag.** Run `scripts/moks.sh review <id> --json` with neither approve nor reject. The process fails. Message requires `--approve` or `--reject`.
- **Proof.** Save review and status JSON under `$EVIDENCE/review/`. Write `meta.txt` with feature id `review` and entry point `moks review <id> --approve`.

## Gotchas

- `/review` in the TUI is packet review, not a silent substitute for `moks review --approve`. If you only drove `/review`, say so. Do not mark `review-approve` verified.
- Review is human-only. A proof that uses a test helper to flip status in sqlite is invalid.
- Approving twice or reviewing an applied changeset is a different error. Start from `staged`.
