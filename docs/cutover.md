# Harvey cut-over

This file is the execution plan. It supersedes `docs/gtm.html` until that page is rewritten.

Harvey is the company. TUI is the first surface. The buyer is a TA lead, not an engineer who already likes coding agents.

The last month taught us the analog. We keep the mechanics. We drop the story.

---

## Locked

- Closed product, prestige-first, high ACV. MIT on the fork is lineage, not GTM.
- TUI first. No web, desktop, or rooms in this cut-over.
- Req is the matter. Cards stay as human projections. The filesystem is not the product.
- Own the data model in the ledger. ATS is a connected system, not the truth.
- Human applies writes. The agent stages. That split stays.
- One strong agent first: Screen / scorecard. Then Pipeline / attention. Match / rank after those exist.
- Live Ashby (MCP behind our adapter) is the 2-week ATS path. Greenhouse next. REST only if MCP cannot note or move stage.

---

## What the reviews found

Four parallel reviews. The short version:

**ATS.** Two stacks that do not share config or auth. Product CLI/TUI is mock-only (`packages/cli/src/decision/session.ts` refuses anything but mock). Ledger already has `AtsAdapter`, MCP pull/push, CAS, and tests. Agent MCP host already does OAuth and tool discovery. Nobody translates vendor tools into our contract (`ats_snapshot` / `ats_apply`). Pull never creates people. `/connect` writes `moks.json`, not `.moks/config.json`.

**Agents.** Recruit is an intake partner. The four skills are markdown recipes. TUI score/draft usually never hits the model. `CardWrite` keyword-matches the scorecard and writes `3` or `N/A`. Ledger has Job / Candidate / Application / mutations. It has no Assessment, Scorecard, Ranking, or Citation type. Structured JSON output exists in the harness and hiring never uses it.

**Ontology.** Split SoR. Ledger owns intended ATS writes. Cards own scores, drafts, takes, compare. `.moks/vault.key` is encryption, not a Talent Vault. Req folder and ATS Job are not bound. `commit` / `push` / `pull` / `rebase` are real mechanics with git names.

**TUI.** Launch is still OpenCode home: logo, composer, chat. Packet list sits under the composer, candidates are `foo.md` with no action, and the loader only finds a root `HIRING.md`. A real `COMPANY.md` company shows no slate. Req pick is mouse-only.

We are ahead on harness, permissions, ledger, and human apply. We are behind on the three things a design partner will feel: live ATS, a real score, a req-first TUI.

---

## Stop

Do not pick these up. They belong to the old company.

- Analog backlog leftovers: H16, H19, H27, more TUI chrome polish
- “Live Ashby on hold” in `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/mox-port.md`
- OSS / “open the harness, sell the kernel” as identity
- “Filesystem is the book” as a locked ontology claim
- Keyword `CardWrite` as the demo path
- Dual untranslated MCP contracts as “good enough”
- Connect pills for Juicebox / Metaview / Gmail / Outlook as the ATS path
- `moks agent create` / custom agent builder
- Talent Vault / RAG / historical ingest
- Web, desktop, rooms, Command Center
- Porting hiring onto engine SessionV2

`docs/backlog.md` waves 1–5 are done. Freeze the list. New work comes from this file.

---

## Keep

Do not rebuild these.

- Session runner, MCP host, permissions, skill loader, multi-provider, TUI shell
- `@moks/ledger`: hash chain, CAS, fail-closed policy, human-only apply, encrypted payloads
- `AtsAdapter` + mock adapter + ledger MCP client (as our contract, not as vendor shape)
- Agent MCP OAuth / `/connect` dialog (retarget, do not rewrite)
- `recruit` as orchestrator. `plan` / `explore` stay hidden harness.
- Skills that are not the product: `req-context`, `draft-outreach`, `commit-disposition`
- Company folder as the local workspace. Focus. Cards as projections.
- Adverse confirm. Dry-run default. Agent cannot `push` or `review`.

---

## Relabel (do not rewrite the engine)

Keep function names. Change what a recruiter sees.

| Today | Recruiter sees |
|---|---|
| commit | Stage / record |
| review (changeset) | Taste / bless |
| `/review` (agent packet) | Keep as packet review, different word from bless |
| push | Apply (to ATS) |
| pull | Sync |
| rebase | Refresh stale |
| log / diff | History / what will apply |
| `candidates/jordan-lee.md` | Jordan Lee · Screen · 4 |

TUI already started this (Taste pane, bless). CLI and skills still say commit/push.

---

## Waves

### Wave 0 — lock the story (1–2 days)

Partner-facing and agent-facing docs cannot sell the old company while we cut over.

- Rewrite `docs/gtm.html` to Harvey: closed, TUI first, design partners, progressive ATS ownership. Kill OSS-as-drug, WAU eng-TA, GitOps.
- README one-liner and hiring loop. Drop “what a coding agent is to software” as the lead. “Based on OpenCode” can stay as a legal/lineage footnote, not the pitch.
- `AGENTS.md` ontology: req is the matter, cards are projections, ledger owns decisions and assessments. Analog table becomes an implementation note, not the product.
- Strike “live Ashby on hold” everywhere. P6 is this cut-over.
- Mark `docs/backlog.md` frozen. Point here.

No code required. Do this first so the next agents do not re-litigate.

### Wave 1 — TUI is a recruiting tool (3–4 days)

Design-partner first frame: pick a req, see the slate, pick a person, ask recruit. Composer is secondary.

1. Packet loader follows `COMPANY.md` + `.moks/focus`, not “walk up for `HIRING.md`.” (`packages/tui/src/feature-plugins/sidebar/packet-data.ts`)
2. Home is slate-first. Logo + blank chat is not the product. (`packages/tui/src/routes/home.tsx`)
3. Keyboard pick req and candidate. Candidate row is an action (open / assess), not `foo.md` display. Drop the `.md` suffix.
4. Hide from the TA surface: `!` shell, `:q`, tab-cycles-agents on home, `N MCP /system` footer, which-key as the teacher. Keep `ctrl+p`.
5. Help is the loop: pick req → pick person → score → taste → apply. Not “press ctrl+p.”
6. Relabel commit/push in TUI copy to stage/apply.

Leave the session runner, review pane, decision dialogs, `/init` and `/open-req`.

### Wave 2 — Screen / scorecard is a real agent (4–5 days)

This is the product, not a skill.

1. Typed assessment in the company ledger: req, candidate, scorecard hash, overall, recommendation, dimensions `{label, score, evidence, source_path}`. Card keeps a short projection. Do not stuff this into `AddNote`.
2. Bind `<req>/` to a Job (or add Req and hang applications off it). Stop attaching local people to `jobs ORDER BY id LIMIT 1`.
3. Force structured output through the existing `json_schema` path. Reject missing citations. No invented employers.
4. TUI “score X” and `moks run -- "Score X"` call this path, not `CardWrite.scored`. Keep the keyword writer only as a no-model test fallback.
5. Packet row opens the assessment, not a lone `score: 3`.
6. Fixture eval, not string-contains: every scored row has a path; no employer absent from the card; N/A when there is no evidence; must-have dimensions present.

`score-candidate` becomes this agent’s recipe or goes away. `recruit` stays the orchestrator and stops de-emphasizing score.

### Wave 3 — live ATS behind the adapter (5–7 days)

Do not let the agent write the ATS. Do not build REST unless MCP cannot do the job.

1. CLI `openLedger` uses `openAtsAdapter`. Kill `requireWiredAts`. Mock stays the default. (`packages/cli/src/decision/session.ts`)
2. `/connect` Ashby writes `.moks/config.json` **and** `moks.json`, sets the ATS id. Known URL, not a blank paste. Drop juicebox/gmail/outlook from the 2-week path.
3. Auth on ledger MCP: headers or reuse the agent OAuth session. Secret in the auth store, never the workspace.
4. Vendor tool map: Ashby MCP → `AtsSnapshot` / `AdvanceStage` / `AddNote`. CAS and idempotency stay in our layer. Fixture server stays the contract double.
5. Sync materializes the packet: chosen job → req folder + cards. Inverse of “the folder is the pile.” TUI `/sync` (today’s pull).
6. Default-deny agent MCP tools. Allow listed reads. Deny every write in the loop, not two mock names.
7. Sandbox loop: connect → sync one req → score from cards → human bless note or stage → apply lands remotely → sync shows applied.

Greenhouse is the same translator once Ashby works. Its current adapter is a prefixed mock. Do not call that live.

### Wave 4 — attention + demo path (2–3 days)

1. Pipeline / attention agent from what already exists: leftover kind, stale constitution hashes, staged IDs, `readStatus().pipeline`. Ranked “needs attention on this req” with why. First frame of a focused req.
2. One scripted design-partner path. Hard-code or pin one real sandbox req. Instrument what they actually invoke.
3. Defer Match / rank until Screen objects exist so compare ranks assessments.

---

## Success

A sophisticated recruiter can sit at the TUI and say: I did the work I currently do in Claude + Ashby, faster, with a score I can reopen, and I did not re-prompt the same way.

If that lands, Vault, richer agents, and full ATS mode have somewhere to live.

---

## Not this cut-over

Talent Vault / RAG. Custom agent builder. Domain post-training. Multiplayer. Bias dashboards. Broad write coverage. License flip. Private-repo decision (founder call, not a wave). Using product moks to implement this list.

---

## Order

Wave 0 → 1 → 2 → 3 → 4.

TUI feeling and a real score can demo on mock ATS. Live apply is what makes it a design-partner product rather than a better local fixture. Do not start Wave 3 until Wave 1 home and Wave 2 assessment have a place to put the people you sync.
