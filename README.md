# moks

The agent harness for engineering talent acquisition.

moks is to hiring what a coding agent is to software: same workplace shape — workspace, plan, tools, review, push — pointed at requisitions instead of repos. Local first. Remote later.

The company folder is the workspace. A req is a subdirectory. `HIRING.md` is the constitution (company + per req). `candidates/<id>.md` are working copies. `moks commit` stages a ledger changeset. `moks push` applies approved changesets through the ATS adapter (mock today). `.moks/` is ledger + cache.

**Based on [OpenCode](https://github.com/anomalyco/opencode).** MIT licensed. **Not** officially affiliated with OpenCode or Anomaly.

| Coding | moks |
|--------|------|
| Repo | Company folder is the workspace |
| `AGENTS.md` | `HIRING.md` |
| GitHub | ATS (adapter seam; live Ashby on hold) |
| Diff | Local card + constitution changes |
| Commit / push | `moks commit` / `moks push` |
| PR review | `/review` packet review |
| Build agent | `recruit` (`build` stays hidden) |

## Install (from source)

Requires [Bun](https://bun.sh). Binary releases are not ready yet.

```bash
git clone https://github.com/artemysone/moks.git
cd moks
bun install
bun dev
```

`bun dev` starts the TUI from `packages/cli`. From that package you can also run:

```bash
cd packages/cli
bun dev
# or
bun run --conditions=browser src/index.ts
```

Default branch is `dev`. Day-to-day workflow is Bun (`bun install` / `bun dev`) — not npm/pnpm as the primary path.

## Hiring loop

Default agent is **`recruit`**.

```bash
bun dev
# /init → attach a resume → score-candidate → /review → moks commit → moks push
```

Headless fixture run (no ATS required):

```bash
cd packages/cli

FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent recruit \
  -f "$FIXTURES/HIRING.md" -f "$FIXTURES/candidates/jordan-lee.md" \
  "Score this candidate using the score-candidate skill"
```

Built-in skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`.  
Fixtures: [`packages/cli/src/product/fixtures/hiring/README.md`](packages/cli/src/product/fixtures/hiring/README.md).

Fixture loop: `pull` → run/screen → `commit` (stage) → `review` → `push --execute` → `log` / `log --compliance`.

```bash
bun run --conditions=browser src/index.ts pull

bun run --conditions=browser src/index.ts commit --action advance \
  --target-kind candidate --target-id jordan-lee \
  --reason "strong event + postgres signal"

bun run --conditions=browser src/index.ts review <changeset-id> --approve --by you
bun run --conditions=browser src/index.ts push --execute
bun run --conditions=browser src/index.ts log
bun run --conditions=browser src/index.ts log --compliance
```

### Scriptable / headless

Same verbs; add `--json` for machine-readable stdout. Full contract: [`packages/cli/src/product/headless.md`](packages/cli/src/product/headless.md).

```bash
moks pull --json
moks commit --action note --target-id jordan-lee --json
moks status --json
moks review <changeset-id> --approve --by you --json
moks push --execute --json
moks push --confirm --execute --json
moks log --json
moks log --compliance

moks run --json --agent recruit -f HIRING.md -f candidates/jordan-lee.md -- "Score this candidate"
```

### Optional: install script

`./install` is a moks-branded stub. It does **not** download upstream OpenCode binaries. Prefer source install above until moks ships its own releases.

## Docs

| Doc | What |
|-----|------|
| [docs/gtm.html](docs/gtm.html) | Product strategy / GTM |
| [AGENTS.md](AGENTS.md) | Constitution for work in this repo |
| [docs/mox-port.md](docs/mox-port.md) | Ledger-first port (verbs, adapter seam) |

## License

MIT — see [LICENSE](LICENSE). Upstream OpenCode copyright retained; moks adds copyright for fork work.
