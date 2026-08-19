---
name: commit-disposition
description: Recommend reject, offer, hire, or advance with rationale, then stage it with moks commit. Never silent ATS writes. Use when deciding next stage for a candidate.
---

# commit-disposition

Recommend a hiring disposition and stage it with the native `commit` / `status` / `diff` tools. You never write ATS stages silently. `commit` stages a ledger changeset. A human runs `moks review` and `moks push`. The CLI is the same implementation.

## Allowed actions (examples)

- `advance` — move forward in process (non-adverse)
- `reject` — pass / decline (adverse)
- `offer` — extend offer (adverse)
- `hire` — confirm hire (adverse)
- `note` — record context without stage claim

Adverse actions: reject, offer, hire. Human push requires `--confirm` for those.

## Before recommending

Look for `candidates/<id>.md` and cite its frontmatter `score` plus body. If the card has no score, say so and prefer running **score-candidate** first unless the user wants a `note`.

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

A human then:

moks review <id> --approve --by you
moks push --execute
moks push --confirm --execute   # reject | offer | hire

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
- Mention that a human must review, then push; adverse actions need `--confirm`
