# Ledger loop

The ledger loop is how a recruiter moves a candidate with an audit trail: `pull` mirrors the ATS locally, `commit` stages a typed hiring mutation on the hash-chained ledger (it never writes the ATS), `review` approves or rejects it, `push --execute` applies approved changesets through the ATS adapter (mock today), and `log` shows the chained decision history. Committing a stage change also projects the new stage onto the candidate's markdown card.

## Sub-features

- `pull-mirror` seeds and syncs the local mirror from the mock ATS.
- `commit-stage` stages a mutation (`advance`, `note`, `tag`, `outreach`) against a mirror id.
- `review-approve` flips a staged changeset to approved (or rejected).
- `push-apply` applies approved changesets and marks them `applied`.
- `log-chain` lists entries and verifies the hash chain.
- `log-compliance` exports an LL144-shaped compliance report.
- `card-projection` writes the new stage into `candidates/<id>.md`.

## How to get to it (user POV)

- Run `moks pull`, `moks commit`, `moks review`, `moks push`, `moks log` from a requisition folder.
- In the TUI, the same verbs run as `moks commit` / `moks push` steps of the hiring loop.

## Driving it with the bun CLI

Preconditions:

- Fresh scratch requisition `$REQ` seeded from the hiring fixtures.
- Doctor reports `report.ats` as `"mock"`.
- Commands run from `packages/cli`; `moks` below means `bun run --conditions=browser src/index.ts <args> --json --cwd "$REQ"`.

- **Sync the mirror.** Run `moks pull`. Exit 0; JSON shows `"seeded": true` and `upserted` of 1 job, 5 candidates, 5 applications.
- **Stage a mutation.** Run `moks commit --action advance --target-id cand_priya --reason "strong event + postgres signal"`. Exit 0; `changeset.status` is `"staged"`, `changeset.id` is a UUID, `adverse` is `false`.
- **Approve it.** Run `moks review <changeset-id> --approve --by verifier`. Exit 0; `changeset.status` is `"approved"` and `reviewed_by` is `verifier`.
- **Apply it.** Run `moks push --execute`. Exit 0; `dry_run` is `false` and `pushed[0].status` is `"applied"`.
- **Read the chain.** Run `moks log`. Exit 0; `chain.ok` is `true` and the entry shows `"applied"` with your rationale.
- **Export compliance.** Run `moks log --compliance`. Exit 0; JSON schema `mox.compliance.ll144.v1` with the changeset, its hash, and `reviewed_by`.
- **Proof.** Save each JSON output to `$EVIDENCE`, plus `$REQ/candidates/cand-priya.md` showing the new `stage:` frontmatter, and confirm `$REQ/.moks/ledger.sqlite` exists.

Or run the whole loop with assertions: `.cursor/skills/verify-moks/scripts/verify-ledger-loop.sh`.

## Gotchas

- `commit --target-id` resolves against the pulled mirror, so `pull` must run first. The README's `jordan-lee` commit example fails with `unknown entity` — `jordan-lee` is a card fixture, not a mirror id. Use `cand_priya` and friends.
- The projected card filename kebab-cases the id: `cand_priya` becomes `candidates/cand-priya.md`.
- `moks commit` alone proves nothing about the ATS; the write only happens at `push --execute` (see [push-guardrails](./push-guardrails.md)).
- Without `--json`, output is styled text with ANSI codes; always pass `--json` when scripting.
- `advance` on `cand_priya` is non-adverse; `reject`, `offer`, and `hire` trip the adverse-action guard and change push behavior.
