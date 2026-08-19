# Mox → Moks port plan

Port Mox's ledger-first decision engine into the Moks harness. After this port, every
`moks` verb (`pull`, `commit`, `diff`, `review`, `push`, `rebase`, `log`) is driven by the
hash-chained ledger — **git is removed from product mechanics entirely**. The git
*metaphor* stays; the git *implementation* goes.

Source repo: `~/mox` (read-only during the port — never modify it).
Target repo: `~/moks` (this repo).

Work items P1–P6 below are sized for one implementation agent each. Execute in order;
P4 and P5 may run in parallel after P3 lands. Each item follows the backlog format
(`docs/backlog.md`): read **Keep** before touching anything, ship the **Change** only,
mark the item done here in the same PR.

---

## Locked decisions (do not relitigate)

1. **Ledger is the system of record** for decisions and ATS mutations. Markdown cards
   (`HIRING.md`, `candidates/*.md`) remain the human-readable working copies — a
   projection, never the record.
2. **No git in the product.** `decision/git.ts`, `refs/moks/ats`, and git audit trailers
   are deleted, not adapted. Whether a user keeps their company folder in a git repo is
   their business and invisible to moks.
3. **New package `packages/ledger` (`@moks/ledger`).** Plain TypeScript + `bun:sqlite`,
   exactly as written in Mox. Do **not** rewrite it into Effect, drizzle, or the
   `@moks/core` idioms. It is a leaf dependency with zero imports from other moks
   packages.
4. **Do not port Mox's agent layer.** Mox's `agent/loop.ts`, `session.ts`, `tools.ts`,
   `model.ts`, permissions, server, and TUI re-implement what Moks inherits from
   Opencode in richer form. Only `agent/hiring.ts` (the hiring.md parser bridge) comes
   across. Verified: no module outside Mox's `agent/` imports the `ai` SDK, so the
   port set does not touch Moks' `ai@6` catalog pin.
5. **Paths adapt to moks conventions.** `.mox/` → `.moks/`, `hiring.md` → `HIRING.md`,
   `scorecard.md` → `SCORECARD.md` (create on `/init` only if absent). Ledger data lives
   at the **company** level: `<company>/.moks/ledger.sqlite`, `<company>/.moks/vault.key`.
   Changesets carry the req/job reference; policy loads from the **focused req's**
   `HIRING.md`, falling back to the company `HIRING.md`, failing closed
   (`always_gate`) when neither parses.
6. **MCP SDK version:** moks pins a patched `@modelcontextprotocol/sdk@1.29.0`; Mox's
   adapter uses `^1.30.0`. The ported `adapters/mcp.ts` must compile against the moks
   pinned version. If a 1.30-only API is used, adapt the adapter, not the pin.
7. **Effect classes map onto the existing permission vocabulary.** `reversible` /
   `compensable` / `irreversible` gate floors stay engine-side (`policy.ts`).
   Interactive asks go through Moks' existing permission system and decision dialog.
   Adverse actions (Reject, ExtendOffer, Hire) keep the explicit-confirm behavior the
   current `moks push --confirm` has.
8. **Agent can never push.** `moks push` and `moks review` are human CLI/TUI verbs only.
   The native agent tools expose `commit` (stage), `status`, and `diff` — nothing that
   applies a changeset to the ATS.

## Verb semantics after the port

| Verb | Backed by | Notes |
|---|---|---|
| `moks pull` | `sync.ts` pull | Sync ATS snapshot into local mirror; flags stale changesets |
| `moks status` | ledger + mirror | Staged / approved / stale / applied counts; working-set summary |
| `moks commit` | `ledger.ts` stage | Stage a changeset of typed mutations (agent or human author) |
| `moks diff` | `plan.ts` | Staged mutations vs current mirror state |
| `moks review <id>` | `ledger.ts` review | Approve/reject with reviewer identity; human-only |
| `moks push` | `sync.ts` push | Apply approved changesets via the ATS adapter; human-only; adverse confirm |
| `moks rebase` | `rebase.ts` | Re-derive stale changesets after the ATS moved |
| `moks log` | `hash.ts` chain | Decision history; `--compliance` export |
| `moks activity` | ledger events | Rewire existing command from receipts to ledger events |

---

## Port set (Mox → Moks, file by file)

All source paths relative to `~/mox/packages/engine/src/`, targets relative to
`~/moks/packages/ledger/src/`. "As-is" = copy, fix import extensions/paths only.

### P1 scope — engine core

| Source | Target | Action |
|---|---|---|
| `domain.ts` | `domain.ts` | As-is |
| `hash.ts` | `hash.ts` | As-is |
| `ledger.ts` | `ledger.ts` | As-is |
| `mirror.ts` | `mirror.ts` | As-is |
| `precondition.ts` | `precondition.ts` | As-is |
| `policy.ts` | `policy.ts` | As-is |
| `vault.ts` | `vault.ts` | As-is |
| `compliance.ts` | `compliance.ts` | As-is |
| `rebase.ts` | `rebase.ts` | As-is |
| `plan.ts` | `plan.ts` | As-is |
| `sync.ts` | `sync.ts` | As-is |
| `db.ts` | `db.ts` | As-is |
| `errors.ts` | `errors.ts` | As-is |
| `events.ts` | `events.ts` | As-is |
| `schema.ts` | `schema.ts` | As-is |
| `paths.ts` | `paths.ts` | **Adapt** per decision 5 (`.moks/`, company-level DB, `HIRING.md`) |
| `index.ts` | `index.ts` | **Rewrite** — export only what this package contains |
| Tests: `domain.machine`, `hash.chain`, `ledger`, `policy`, `vault`, `vault.shred`, `rebase`, `sync`, `events`, `schema.migrate` `.test.ts` | alongside sources | As-is (update paths in fixtures) |

### P2 scope — adapters, MCP, hiring parser

| Source | Target | Action |
|---|---|---|
| `adapters/types.ts` | `adapters/types.ts` | As-is |
| `adapters/mock.ts` | `adapters/mock.ts` | As-is |
| `adapters/greenhouse.ts` | `adapters/greenhouse.ts` | As-is (still fixture-backed; live ATS is P6) |
| `adapters/juicebox.ts` | `adapters/juicebox.ts` | As-is |
| `adapters/sourcing.ts` | `adapters/sourcing.ts` | As-is |
| `adapters/mcp.ts` | `adapters/mcp.ts` | **Adapt** to moks-pinned MCP SDK (decision 6) |
| `mcp/` (client + fixture server) | `mcp/` | As-is (test infrastructure) |
| `agent/hiring.ts` | `hiring.ts` | **Adapt**: focused-req `HIRING.md` resolution with company fallback (decision 5); drop Mox template-copy behavior in favor of moks `/init` scaffold (`product/req-workspace.ts`) |
| `config.ts` | `config.ts` | **Adapt**: read from `.moks/config.json`; strip Mox-only keys |
| `init.ts` | — | **Do not port.** Moks' `/init` (`product/req-workspace.ts`) already scaffolds; extend it in P3 to create `SCORECARD.md` if absent |
| `~/mox/fixtures/*` | `packages/ledger/fixtures/` | Copy fixture JSON used by ported tests |
| `~/mox/templates/scorecard.md` | `packages/moks/src/product/` template dir | Copy as `SCORECARD.md` template |
| Tests: `adapters/*.test.ts`, `mcp/*.test.ts`, `m3.test.ts`, `config.test.ts`, `init.test.ts` | alongside | As-is where deps ported; drop assertions that target unported modules (document each drop in the PR) |

### Not ported (deliberate)

`agent/loop.ts`, `agent/model.ts`, `agent/session.ts`, `agent/tools.ts`,
`agent/task.ts`, `agent/agents.ts`, `agent/compaction.ts`, `agent/usage.ts`,
`agent/pricing.ts`, `agent/transform.ts`, `server.ts`, `main.ts`, `auth.ts`,
`workspace.ts`, `plugin.ts`, `mirror`-independent review HTML (`review-page.ts`) and
`~/mox/packages/{cli,tui,client}` in full. Moks has equivalents or doesn't need them.
`review-page.ts` (shareable HTML review) goes to the parking lot — port later if a
share-a-review-link story emerges.

### Deleted from Moks

| File | Reason |
|---|---|
| `packages/moks/src/decision/git.ts` | Git plumbing, `refs/moks/ats` — decision 2 |
| `packages/moks/src/decision/ats.ts` | `.moks/ats.json` mock write path — superseded by adapters |
| `packages/moks/src/decision/receipt.ts` | Receipts superseded by ledger changesets/events |
| `packages/moks/src/decision/ledger.ts` | 3-line no-op stub — replaced by `@moks/ledger` |
| `packages/moks/src/decision/verbs.ts` | Rewritten in P3 as a thin layer over `@moks/ledger` |
| `packages/moks/src/decision/activity.ts` | Rewired in P3 to ledger events |

---

## Work items

### P1 — Mount `@moks/ledger` with the engine core, tests green

- **Status:** open
- **Outcome:** `packages/ledger` exists in the moks workspace with Mox's domain/ledger
  core and its tests passing. Nothing else in moks imports it yet.
- **Keep:** Mox semantics exactly — hash chain format, changeset statuses, CAS
  preconditions, effect classes, fail-closed policy. Tests are the spec; do not "improve"
  behavior while porting.
- **Change:** Create `packages/ledger/{package.json,tsconfig.json,src/}` per the P1 table.
  `package.json`: name `@moks/ledger`, `type: module`, exports `./src/index.ts`, deps:
  none beyond `bun:sqlite` builtins (verify — the P1 set imports only node builtins and
  bun). Add `@moks/ledger` to the root `typecheck` turbo filter.
- **Don't:** Rewrite into Effect. Import from `@moks/core` or `packages/moks`. Port
  anything from Mox's `agent/` or `server.ts`. Touch existing moks packages.
- **Touch:** `packages/ledger/**` (new), root `package.json` typecheck script, `turbo.json`
  if a task entry is needed.
- **Verify:** `bun test` inside `packages/ledger` — all ported tests pass (expect roughly
  the ledger/domain/policy/vault/rebase/sync share of Mox's 406). `bun turbo typecheck`
  filters clean. `git -C ~/mox status` untouched.

### P2 — Adapters, MCP seam, and the HIRING.md policy bridge

- **Status:** open — depends on P1
- **Outcome:** The full adapter seam (mock, greenhouse-fixture, juicebox-fixture, MCP)
  works inside `@moks/ledger`, and policy loads from moks-convention `HIRING.md` with
  company fallback and fail-closed default.
- **Keep:** `AtsAdapter` interface shape (this is the seam P6 plugs into). Fail-closed
  MCP config behavior. Fixture datasets as-is.
- **Change:** Port per the P2 table. Reconcile `adapters/mcp.ts` with the moks-pinned
  patched MCP SDK 1.29.0. Rewrite `hiring.ts` path resolution: focused req
  `HIRING.md` → company `HIRING.md` → fail closed (`always_gate`).
- **Don't:** Add live vendor HTTP calls (that's P6). Change the adapter interface.
  Bump or unpatch the MCP SDK pin.
- **Touch:** `packages/ledger/src/{adapters,mcp}/**`, `packages/ledger/src/hiring.ts`,
  `packages/ledger/src/config.ts`, `packages/ledger/fixtures/**`.
- **Verify:** Adapter + MCP + m3 + hiring tests pass in `packages/ledger`. A unit test
  proves: req-level HIRING.md wins over company-level; missing both → `always_gate`.

### P3 — Rewire the verbs: CLI, agent tools, and the git deletion

- **Status:** open — depends on P2
- **Outcome:** `moks pull | status | commit | diff | review | rebase | push | log |
  activity` all run against `@moks/ledger`. `decision/git.ts` and `decision/ats.ts` are
  gone. No git invocation remains anywhere in the decision path.
- **Keep:** CLI ergonomics recruiters already have: `push` dry-run by default,
  `--execute` to write, `--confirm` for adverse actions. Existing command help voice.
  The analog map in `AGENTS.md` (update mechanics text, not the analogy).
- **Change:**
  - Rewrite `decision/verbs.ts` as a thin translation layer: card/workspace context in,
    `@moks/ledger` calls out. Delete `git.ts`, `ats.ts`, `receipt.ts`, the old stub
    `ledger.ts`; rewire `activity.ts` to ledger events.
  - New CLI commands `cli/cmd/{pull,diff,review,rebase,log}.ts`; rewire existing
    `cli/cmd/{commit,push,status,activity}.ts`. Register all in
    `packages/moks/src/index.ts` beside the existing `.command(CommitCommand)` block.
    Note: CLI `moks diff` is the **ledger** diff; the TUI file-diff viewer (backlog H19)
    is a different surface — do not merge them.
  - Update `tool/decision.ts`: native agent tools become `commit` (stage), `status`,
    `diff`. Remove any tool that could apply/push. Effect-class floors from `policy.ts`
    feed the existing permission ask flow (decision 7).
  - Extend `/init` (`product/req-workspace.ts`) to create `SCORECARD.md` from the
    template when absent and ensure `<company>/.moks/` exists for the ledger.
- **Don't:** Let any agent-reachable code path call `sync.push` or `ledger.review`.
  Re-introduce a JSON mock write path. Break `moks run --agent recruit` fixture flows.
- **Touch:** `packages/moks/src/decision/**`, `packages/moks/src/tool/decision.ts`,
  `packages/moks/src/cli/cmd/**`, `packages/moks/src/index.ts`,
  `packages/moks/src/product/req-workspace.ts`, product tests under
  `packages/moks/test/` covering verbs.
- **Verify:** On the hiring fixture (never this monorepo root): agent screens a
  candidate → changeset staged, ATS mirror unchanged → `moks diff` shows the mutation →
  `moks review <id> --approve --by you` → `moks push --execute` applies via the mock
  adapter → `moks log` shows the chained entry and `moks log --compliance` exports.
  `rg -n "refs/moks/ats|ats\.json|Bun.spawn\(\[\"git\"" packages/moks/src` returns
  nothing. Existing product tests pass or are updated in the same PR.

### P4 — TUI surfaces on the ledger

- **Status:** open — depends on P3; may run parallel with P5
- **Outcome:** The TUI decision dialog and statusline reflect ledger state. `/push` from
  the TUI can dry-run or execute (this absorbs deferred backlog item **H20**, minus its
  git-ref verify step, which is obsolete).
- **Keep:** H20's guardrails: no auto-execute, no agent-invoked writes, adverse confirm.
  Toast copy must distinguish dry-run from executed.
- **Change:** `dialog-decision.tsx` and the TUI `/push`, `/commit`, `/review` handlers
  call the P3 verb layer. Statusline shows staged/approved counts for the focused req.
- **Don't:** Build a review pane (that's still H27, still deferred). Touch diff-viewer
  scope (H19).
- **Touch:** `packages/tui/src/component/dialog-decision.tsx`, TUI command handlers,
  statusline component.
- **Verify:** In a fixture workspace TUI session: stage, review, dry-run push, execute
  push — mirror updates, statusline counts change, no "Pushed" toast on dry-run.

### P5 — Docs and ontology

- **Status:** open — depends on P3; may run parallel with P4
- **Outcome:** Repo docs describe the ledger-first reality. No doc tells an agent or
  human that git or `.moks/ats.json` is the audit path.
- **Change:**
  - `AGENTS.md`: `.moks/` line becomes "ledger + cache (ledger.sqlite, vault.key,
    focus)"; analog map row `git commit → moks commit` gains a note that mechanics are
    the moks ledger, not git.
  - `docs/backlog.md`: mark H20 done-via-P4 when it lands; update parking-lot line
    "mock ATS is the write path" → "adapter seam is the write path; live Ashby = P6";
    add a pointer to this file.
  - `README.md` verb section; `packages/moks/src/product/headless.md` fixture flow.
- **Don't:** Rewrite the constitution's ontology (company folder, req subdirs, markdown
  cards — all unchanged). Touch `CONTEXT.md` scope beyond decision-path mentions.
- **Touch:** `AGENTS.md`, `docs/backlog.md`, `README.md`, `product/headless.md`, this file.
- **Verify:** `rg -in "ats\.json|refs/moks|git trailer" AGENTS.md docs README.md` → only
  historical references clearly marked as replaced.

### P6 — Live Ashby through the adapter seam (post-port milestone)

- **Status:** open — depends on P3; the first real-world test of the whole thesis
- **Outcome:** `MOKS_ATS=ashby` syncs a real Ashby workspace through `adapters/`: `pull`
  mirrors real reqs/candidates, `push --execute` writes a staged, human-approved
  disposition back to Ashby.
- **Keep:** Adapter interface unchanged — this is proof the seam holds. All P3
  guardrails (human-only push, adverse confirm, fail-closed policy).
- **Change:** New `adapters/ashby.ts` implementing `AtsAdapter` against the real Ashby
  API (or Ashby's MCP server via the existing `adapters/mcp.ts` path — implementer
  chooses after reading Ashby's current API docs; record the choice here). API key via
  moks auth/env, never in the workspace.
- **Don't:** Widen the adapter interface for Ashby-specific features in this pass. Let
  candidate PII bypass the vault.
- **Touch:** `packages/ledger/src/adapters/ashby.ts` (+ tests with recorded/stubbed
  responses), config plumbing for `MOKS_ATS=ashby`.
- **Verify:** Against a sandbox Ashby workspace: full loop `pull → run "screen …" →
  diff → review → push --execute → log` with a real remote write, then `pull` again
  shows the applied state and no stale changesets.

---

## Global acceptance (after P1–P5)

1. `bun test` green in `packages/ledger` and in `packages/moks` product tests.
2. `bun turbo typecheck --filter=moks... --filter=@moks/core... --filter=@moks/ledger...` clean.
3. Fixture e2e (P3 verify script) passes.
4. Zero git invocations in the decision path; `decision/git.ts` does not exist.
5. `~/mox` untouched. Mox stays frozen as reference until the port is proven; retire it
   after P6.

## Dispatch notes for implementation agents

- One work item per agent, in order: P1 → P2 → P3 → then P4 ∥ P5 → P6.
- Give each agent: this file, `AGENTS.md`, `docs/backlog.md` (rules + analog map), and
  read access to `~/mox`. The Mox tests are the behavioral spec — port them first, then
  make them pass.
- Branch per item (`port/p1-ledger-core`, …), PR per item, mark the item's Status here
  in the same PR.
- If an item's **Keep** would have to break, stop and report back — do not improvise a
  redesign mid-port.
