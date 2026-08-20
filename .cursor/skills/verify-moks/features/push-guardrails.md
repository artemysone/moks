# Push guardrails

`moks push` is the only ATS write, and it is guarded three ways: it dry-runs unless `--execute` is passed, it refuses staged (unreviewed) changesets, and adverse actions (reject, offer, hire) additionally require `--confirm` and exit with code 2 when it is missing. These guards are user-visible behavior a verification run must never paper over: a dry-run that looks like a push is exactly the false proof this map exists to prevent.

## Sub-features

- `push-dry-run` previews approved changesets without applying them.
- `push-review-required` blocks pushing a staged changeset.
- `push-adverse-confirm` blocks adverse actions without `--confirm`, exit code 2.
- `push-already-pushed` rejects re-pushing an applied changeset.

## How to get to it (user POV)

- Run `moks push` (preview) or `moks push --execute` (apply) from a requisition folder.
- Target one changeset with `moks push <changeset-id>` or `--commit-id <id>`.
- Acknowledge an adverse action with `moks push --confirm --execute`.

## Driving it with the bun CLI

Preconditions:

- Fresh scratch requisition `$REQ`, `moks pull` already run.
- Commands run from `packages/cli`; `moks` below means `bun run --conditions=browser src/index.ts <args> --json --cwd "$REQ"`.

- **Stage and approve an adverse changeset.** Run `moks commit --action reject --target-id cand_priya --reason "not a fit"` then `moks review <changeset-id> --approve --by verifier`. Commit JSON shows `"adverse": true`.
- **Hit the confirm guard.** Run `moks push <changeset-id> --execute`. Exit code 2; JSON is `{"error": "needs_confirm", ...}` and nothing is applied.
- **Confirm and apply.** Run `moks push <changeset-id> --confirm --execute`. Exit 0; `pushed[0].status` is `"applied"`.
- **Verify dry-run applies nothing.** For a fresh approved changeset, run `moks push` (no `--execute`), then `moks status`. Push JSON shows `"dry_run": true`; status still lists the changeset as `"approved"`, not `"applied"`.
- **Hit the review guard.** Commit without reviewing, then run `moks push <changeset-id> --execute`. Exit 1 with `"error": "review_required"`.
- **Proof.** Save each JSON output and exit code to `$EVIDENCE`; the status/log re-read after each blocked push is the evidence that the guard held.

## Gotchas

- Exit code 2 is reserved for `needs_confirm`; every other push failure exits 1. Assert the code, not just the message.
- `moks push` with no id pushes all approved changesets; one adverse changeset in the batch makes the whole push require `--confirm`.
- `--confirm` without `--execute` is still a dry-run. Both flags are needed for an adverse apply.
- The rejected stage also projects onto the candidate card (`stage: Rejected`), so check the card after an adverse apply.
