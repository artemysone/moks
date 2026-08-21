# Operator path: empty folder to staged changeset

One recruiter loop on a fresh multi-req company: `/init` an empty folder, `/open-req` one req, `pull` to seed the mock ATS and project candidate cards into the focused req, then stage ledger changesets from the company root. This is the dogfood path; the single-req fixture recipes (`pull.md`, `commit.md`) do not cover the multi-req layout.

## Sub-features

- `op-init` stands up `COMPANY.md`, `.moks/ledger.sqlite`, `.moks/vault.key`, and `.git/` from `/init` in an empty folder; no req dir.
- `op-open-req` creates `<slug>/HIRING.md` + `<slug>/candidates/.gitkeep` from `/open-req <title>` and writes `<slug>` to `.moks/focus`.
- `op-pull` seeds the mock ATS and projects one card per application into `<slug>/candidates/`; `--json` reports `cards.dir` and `cards.created`, and no `candidates/` appears at the company root.
- `op-ledger` stages `commit` from the company root; the changeset carries `agent_meta.req = <slug>` and `.moks/` stays at the root.
- `op-repull` on a second `pull` creates nothing new and preserves recruiter edits (score, notes, body) on existing cards; stage follows the mirror.
- `op-run` resolves the recruit agent, the model, and the projected card from the req dir; with the stub key it stops at the provider boundary (`invalid x-api-key`).

## How to get to it (user POV)

- Open the TUI in a new empty folder, send `/init`, then `/open-req <title>`.
- From the company root run `moks pull`, `moks commit`, `moks status`.
- From the req dir run `moks run --agent recruit -f HIRING.md -f candidates/<id>.md -- "<prompt>"`.
- A human then runs `moks review` and `moks push`; those stay on the fixture recipes (`review.md`, `push.md`).

## Driving it with control-moks

Preconditions: isolated workspace from `workspace.sh` (it exports the stub provider); `mkdir -p "$WORK/empty-co"`; TUI started in `$WORK/empty-co` per the SKILL.md Launch section (project path as the positional argument).

- `op-init`: send `/init`, Enter to accept the autocomplete, Enter to submit. Observe `COMPANY.md`, `.moks/ledger.sqlite`, `.moks/vault.key`, and `.git/` in `$WORK/empty-co`; no req dir. The model turn errors (`invalid x-api-key`) after the scaffold lands.
- `op-open-req`: send `/open-req Founding Engineer`, Enter, Enter. Observe `founding-engineer/HIRING.md` (titled `# Founding Engineer`), `founding-engineer/candidates/.gitkeep`, and `.moks/focus` containing `founding-engineer`.
- `op-pull`: run `scripts/moks.sh pull --json --cwd "$WORK/empty-co"`. Exit code `0`. Stdout JSON has `cards.dir` = `founding-engineer/candidates` and `cards.created` listing the five `cand_*` ids. Observe `founding-engineer/candidates/cand-priya.md` with `stage:`, `source: mock`, and `name:` frontmatter. No `candidates/` at the company root.
- `op-ledger`: run `scripts/moks.sh commit --action note --target-id cand_priya --reason "operator note" --json --cwd "$WORK/empty-co"`. Exit code `0`. Stdout shows `agent_meta.req` = `founding-engineer` and `path` = `$WORK/empty-co`. `scripts/moks.sh status --json --cwd "$WORK/empty-co"` lists the id as `staged`.
- `op-repull`: run `scripts/moks.sh pull --json --cwd "$WORK/empty-co"` again. `cards.created` is empty and a `score:` line added to a card beforehand survives.
- `op-run`: from `$WORK/empty-co/founding-engineer`, with `env.sh` sourced, run `bun run --conditions=browser "$CLI" run --agent recruit -f HIRING.md -f candidates/cand-priya.md -- "Score this candidate using the score-candidate skill"`. With the stub key: exit code `1`, stderr shows `recruit · claude-haiku-4-5` then `invalid x-api-key`. With a real `ANTHROPIC_API_KEY` exported before sourcing `env.sh`: exit code `0` and a scored reply; record whichever ran.

## Gotchas

- With zero providers the TUI blocks every submit behind the connect-provider dialog and nothing scaffolds. The workspace stub provider is what makes this recipe drivable; do not strip `MOKS_MODELS_PATH` / `ANTHROPIC_API_KEY` from the env.
- The stub key fails every model turn by design. Scaffolds, focus writes, ledger verbs, and card projection are unaffected.
- Cards come from `pull`, not from a disposition. If `candidates/` holds only `.gitkeep` after a pull, check `.moks/focus`; without a focused req `pull` reports `cards.dir` null and projects nothing.
- `moks run` has no `--cwd`; run it from the req directory. Ledger verbs accept `--cwd`.
- Slash commands need two Enters: the first accepts the autocomplete, the second submits.
- `cand_priya` resolves only after `pull` seeds the mock ATS. The projected card file is `cand-priya.md` (slugged), with `id: cand_priya` in the frontmatter.
