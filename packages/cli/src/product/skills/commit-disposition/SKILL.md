---
name: commit-disposition
description: Recommend reject, offer, hire, or advance with rationale, then stage it with moks commit. Never silent ATS writes. Use when deciding next stage for a candidate.
---

# commit-disposition

Recommend a hiring disposition and stage it with the native `commit` / `status` / `diff` tools. You never write ATS stages silently. `commit` stages a ledger changeset. After commit, point the human at taste (the landing / review pane). Do not tell them to run CLI verbs. The CLI is the same implementation.

## Allowed actions (examples)

- `advance` — move forward in process (non-adverse)
- `reject` — pass / decline (adverse)
- `offer` — extend offer (adverse)
- `hire` — confirm hire (adverse)
- `note` — record context without stage claim

Adverse actions: reject, offer, hire. Human push requires `--confirm` for those.

## Before recommending

Look for `candidates/<id>.md` and cite its body (and frontmatter `score` if present). If the card has no score, say so. Do not block commit on scoring. Score-candidate is optional — not the default next step.

## Output format

```markdown
# Disposition: <action> · <candidate> → <role>

## Recommendation
- Action: <action>
- Rationale: ...
- Evidence: bullets with source paths (include `candidates/<id>.md` when present)

## Risks
- ...

## Record the decision (required)

Prefer the native `commit` / `status` / `diff` tools. Do not use bash or raw `git commit`. Do not call push or review.

commit: action=<action> target_kind=candidate target_id=<id> reason="<one line>"
status
diff

CLI equivalent:

moks commit --action <action> --target-kind candidate --target-id <id> --reason "<one line>" --meta '{"card":"candidates/<id>.md"}'

Inspect:

moks status
moks diff

After staging, point the human at the review pane — that is where they taste and approve. Do not assign CLI homework.

## Do not
- Invent silent ATS stage moves
- Call `moks push` or `moks review`
- Skip the native `commit` tool call
- Use raw `git commit`
```

## Rules

- Prefer the native `commit` / `status` / `diff` tools when the user asks you to record it
- Always end with the native `commit` tool call filled in for this case
- The CLI equivalent must include `--target-id <id>` and `--meta` with the card path
- If evidence is thin, recommend gathering more context instead of adverse action
- After commit, say the review pane is where they taste/approve; do not tell them to run `moks review` or `moks push`
