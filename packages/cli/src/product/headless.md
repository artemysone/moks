# Headless and scriptable

Headless is a mode of moks, not a separate CLI. Same verbs as interactive. Add `--json` or `run --format json` for machine-readable stdout and stable exit codes.

The company folder is the workspace. Focus selects the working req. `HIRING.md` is the req constitution. `candidates/*.md` are projections. The ledger is the system of record for decisions, assessments, and ATS mutations. `.moks/` is ledger + cache (`ledger.sqlite`, `vault.key`, focus).

## Fixture loop

`pull` → run/screen → `commit` (stage) → `review` → `push --execute` → `log` / `log --compliance`.

```bash
moks pull
moks run --agent recruit -- "Score this candidate"
moks commit --action advance --target-id jordan-lee --reason "strong event + postgres"
moks review <changeset-id> --approve --by you
moks push --execute
moks log
moks log --compliance
```

`moks commit` stages a changeset. It does not write the ATS. `moks review` is human-only. `moks push --execute` applies approved changesets through the ATS adapter. Mock is the default. Live Ashby is the adapter path.

## Push (ATS write)

Stdout is JSON only when `--json` is set. Exit codes:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | error |
| 2 | `push` blocked: adverse action needs `--confirm` (`error: "needs_confirm"`) |

```bash
# Apply approved changesets via the adapter. Default is dry-run.
moks push --execute --json
moks push --confirm --execute --json   # reject | offer | hire
```

Push applies the write. Agent MCP write tools stay denied.

```bash
moks status --json
```

## Agent headless

```bash
moks run --json --agent recruit -- "Score this candidate"
moks run --json --auto -- "…"
```

`--mini` (interactive) cannot be combined with `--json` / `--format json`.

## Source install (no binary yet)

```bash
cd packages/cli
bun run --conditions=browser src/index.ts push --json
bun run --conditions=browser src/index.ts run --json --agent recruit -- "…"
```

Hiring fixtures: `src/product/fixtures/hiring/`.
