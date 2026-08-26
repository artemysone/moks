# moks

The operating system for high-stakes talent acquisition. Works with your current ATS or becomes it.

You type `moks`. That is the TUI. Harvey is the company. The buyer is a TA lead.

Pick a req, score people with evidence, bless the write, apply to the ATS. Req is the matter. Cards are projections. The ledger owns decisions and assessments. The agent stages. A human applies. Mock ATS is the default. Live Ashby is the path. Not Claude plus an ATS plugin.

## Hiring loop

Default agent is `recruit`. TUI first.

```bash
moks
# /init → /open-req → focus the req → pick a person → score → /review → moks commit → moks push
```

`moks commit` stages. `moks review` is human-only. `moks push` applies through the ATS adapter. Dry-run default. Adverse still needs `--confirm`.

Built-in skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`.
Fixtures: [`packages/cli/src/product/fixtures/hiring/README.md`](packages/cli/src/product/fixtures/hiring/README.md).

Headless fixture run:

```bash
cd packages/cli

FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent recruit \
  -f "$FIXTURES/HIRING.md" -f "$FIXTURES/candidates/jordan-lee.md" \
  "Score this candidate using the score-candidate skill"
```

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

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/artemysone/moks/main/install | bash
```

That puts `moks` on your PATH (`~/.moks/bin`). Then:

```bash
mkdir ~/acme && cd ~/acme
moks
# /init
```

Do **not** run the product against this git checkout. `bun dev` is for editing the CLI.

Cut a release (maintainers):

```bash
MOKS_CHANNEL=latest MOKS_VERSION=0.1.0 MOKS_RELEASE=1 GH_REPO=artemysone/moks \
  bun run --cwd packages/cli script/build.ts
```

### From source (engineering)

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/artemysone/moks.git
cd moks
bun install
bun dev
```

`bun dev` starts the TUI from `packages/cli`. Local binary without GitHub:

```bash
cd packages/cli && bun run script/build.ts --single
cd ../..
./install --binary packages/cli/dist/moks-darwin-arm64/bin/moks
```

Default branch is `main`. Day-to-day engineering is Bun (`bun install` / `bun dev`), not npm/pnpm as the primary path.

### Upgrade

```bash
moks upgrade
moks upgrade 0.1.0
```

Only curl installs (`~/.moks/bin/moks`) upgrade in place. npm / brew channels are not shipped.

## Lineage

Hard fork of [OpenCode](https://github.com/anomalyco/opencode). MIT licensed. **Not** officially affiliated with OpenCode or Anomaly. That is not the pitch.

| Coding agent | moks |
|--------|------|
| Repo | Company folder is the local workspace |
| `AGENTS.md` | `COMPANY.md` + req `HIRING.md` |
| GitHub | ATS adapter, Ashby first |
| Diff | Local card + constitution changes |
| Commit / push | `moks commit` / `moks push` |
| PR review | `/review` packet review |
| Build agent | `recruit` (`build` stays hidden) |

## Strategy

[docs/strategy.md](docs/strategy.md)

## License

MIT. See [LICENSE](LICENSE). Upstream OpenCode copyright retained; moks adds copyright for fork work.
