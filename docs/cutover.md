# Harvey cut-over

This is the execution plan. Partner page is `docs/gtm.html`.

Harvey is the company. TUI is the first surface. The buyer is a TA lead, not an engineer who already likes coding agents.

The last month taught us the analog. We keep the mechanics. We drop the story.

---

## Locked

- Closed product, prestige-first, high ACV. MIT on the fork is lineage, not GTM.
- TUI first. No web, desktop, or rooms in this cut-over.
- Req is the matter. Cards stay as human projections. The filesystem is not the product.
- Own the data model in the ledger. ATS is a connected system, not the truth.
- Human applies writes. The agent stages. That split stays.
- One strong agent first, Screen / scorecard. Then Pipeline / attention. Match / rank after those exist.
- Live Ashby is the 2-week ATS path. MCP sits behind our adapter. Greenhouse next. REST only if MCP cannot note or move stage.

---

## What the reviews found

Four parallel reviews, then the first cut-over commit. Current state:

**ATS.** CLI opens non-mock adapters. Mock is still the default. Agent MCP writes are denied unless the tool looks like a read. Nobody translates vendor tools into `ats_snapshot` / `ats_apply`. Pull still does not create people. `/connect` still writes `moks.json`, not `.moks/config.json`.

**Agents.** Recruit is an intake partner. Skills are markdown recipes. TUI score still usually hits `CardWrite` (always 3 or N/A). Ledger now has `assessments` and `req_jobs`. Nothing writes an assessment yet. Structured JSON output exists in the runtime and hiring never uses it.

**Ontology.** Split SoR. Ledger owns intended ATS writes and can store assessments. Cards still own the live score. `.moks/vault.key` is encryption, not a Talent Vault. CLI verbs are still `commit` / `push`. Recruiter-facing TUI copy says stage / apply.

**TUI.** Home is slate-first. `COMPANY.md` companies list reqs. People are names, not `.md` files. Keyboard picks a req or fills `Score <id>`. Coding chrome on home is quieter (`!` shell, `:q`, MCP footer, which-key teacher). Tab still cycles agents.

---

## Stop

Do not pick these up. They belong to the old company.

- Analog backlog leftovers. H16, H19, H27, more TUI chrome polish
- "Live Ashby on hold" in `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/mox-port.md`
- OSS / "open the harness, sell the kernel" as identity
- "Filesystem is the book" as a locked ontology claim
- Keyword `CardWrite` as the demo path
- Dual untranslated MCP contracts as "good enough"
- Connect pills for Juicebox / Metaview / Gmail / Outlook as the ATS path
- `moks agent create` / custom agent builder
- Talent Vault / RAG / historical ingest
- Web, desktop, rooms, Command Center
- Porting hiring onto engine SessionV2

`docs/backlog.md` waves 1 to 5 are done. Freeze the list. New work comes from this file.

---

## Keep

Do not rebuild these.

- Session runner, MCP host, permissions, skill loader, multi-provider, TUI shell
- `@moks/ledger`. Hash chain, CAS, fail-closed policy, human-only apply, encrypted payloads
- `AtsAdapter` + mock adapter + ledger MCP client, as our contract, not as vendor shape
- Agent MCP OAuth / `/connect` dialog. Retarget, do not rewrite
- `recruit` as orchestrator. `plan` / `explore` stay hidden
- Skills that are not the product. `req-context`, `draft-outreach`, `commit-disposition`
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

TUI already started this. Taste pane, bless. CLI and skills still say commit/push.

---

## Waves

### Wave 0. Lock the story (1 to 2 days)

Partner-facing and agent-facing docs cannot sell the old company while we cut over.

- Rewrite `docs/gtm.html` for Harvey. Closed, TUI first, design partners, progressive ATS ownership. Kill OSS-as-drug, WAU eng-TA, GitOps.
- README one-liner and hiring loop. Drop "what a coding agent is to software" as the lead. "Based on OpenCode" can stay as a lineage footnote, not the pitch.
- `AGENTS.md` ontology. Req is the matter, cards are projections, ledger owns decisions and assessments. Analog table becomes an implementation note, not the product.
- Strike "live Ashby on hold" everywhere. P6 is this cut-over.
- Mark `docs/backlog.md` frozen. Point here.

No code required. Do this first so the next agents do not re-litigate.

### Wave 1. TUI is a recruiting tool (3 to 4 days)

Design-partner first frame. Pick a req, see the slate, pick a person, ask recruit. Composer is secondary.

1. Packet loader follows `COMPANY.md` + `.moks/focus`, not "walk up for `HIRING.md`." (`packages/tui/src/feature-plugins/sidebar/packet-data.ts`)
2. Home is slate-first. Logo + blank chat is not the product. (`packages/tui/src/routes/home.tsx`)
3. Keyboard pick req and candidate. Candidate row is an action, open or assess, not a `foo.md` label. Drop the `.md` suffix.
4. Hide from the TA. `!` shell, `:q`, tab-cycles-agents on home, `N MCP /system` footer, which-key as the teacher. Keep `ctrl+p`.
5. Help is the loop. Pick req → pick person → score → taste → apply. Not "press ctrl+p."
6. Relabel commit/push in TUI copy to stage/apply.

Leave the session runner, review pane, decision dialogs, `/init` and `/open-req`.

### Wave 2. Screen / scorecard is a real agent (4 to 5 days)

This is the product, not a skill.

1. Typed assessment in the company ledger. Req, candidate, scorecard hash, overall, recommendation, dimensions `{label, score, evidence, source_path}`. Card keeps a short projection. Do not stuff this into `AddNote`.
2. Bind `<req>/` to a Job, or add Req and hang applications off it. Stop attaching local people to `jobs ORDER BY id LIMIT 1`.
3. Force structured output through the existing `json_schema` path. Reject missing citations. No invented employers.
4. TUI "score X" and `moks run -- "Score X"` call this path, not `CardWrite.scored`. Keep the keyword writer only as a no-model test fallback.
5. Packet row opens the assessment, not a lone `score: 3`.
6. Fixture eval, not string-contains. Every scored row has a path. No employer absent from the card. N/A when there is no evidence. Must-have dimensions present.

`score-candidate` becomes this agent's recipe or goes away. `recruit` stays the orchestrator and stops de-emphasizing score.

### Wave 3. Live ATS behind the adapter (5 to 7 days)

Do not let the agent write the ATS. Do not build REST unless MCP cannot do the job.

1. CLI `openLedger` uses `openAtsAdapter`. Kill `requireWiredAts`. Mock stays the default. (`packages/cli/src/decision/session.ts`)
2. `/connect` Ashby writes both `.moks/config.json` and `moks.json`, and sets the ATS id. Known URL, not a blank paste. Drop juicebox/gmail/outlook from the 2-week path.
3. Auth on ledger MCP. Headers or reuse the agent OAuth session. Secret in the auth store, never the workspace.
4. Vendor tool map. Ashby MCP → `AtsSnapshot` / `AdvanceStage` / `AddNote`. CAS and idempotency stay in our layer. Fixture server stays the contract double.
5. Sync materializes the packet. Chosen job → req folder + cards. Inverse of "the folder is the pile." TUI `/sync` is today's pull.
6. Default-deny agent MCP tools. Allow listed reads. Deny every write in the loop, not two mock names.
7. Sandbox loop. Connect → sync one req → score from cards → human bless note or stage → apply lands remotely → sync shows applied.

Greenhouse is the same translator once Ashby works. Its current adapter is a prefixed mock. Do not call that live.

### Wave 4. Attention + demo path (2 to 3 days)

1. Pipeline / attention agent from what already exists. Leftover kind, stale constitution hashes, staged IDs, `readStatus().pipeline`. Ranked "needs attention on this req" with why. First frame of a focused req.
2. One scripted design-partner path. Hard-code or pin one real sandbox req. Instrument what they actually invoke.
3. Defer Match / rank until Screen objects exist so compare ranks assessments.

---

## Success

A recruiter sits at the TUI and does the work they currently do in Claude + Ashby, faster, with a score they can reopen, without re-prompting the same way.

If that lands, Vault, richer agents, and full ATS mode have a place. If it does not, stop adding product.

---

## Not this cut-over

Talent Vault / RAG. Custom agent builder. Domain post-training. Multiplayer. Bias dashboards. Broad write coverage. License flip. Private-repo decision is a founder call, not a wave. Using product moks to implement this list.

---

## Order

Wave 0 → 1 → 2 → 3 → 4.

Req-first home and a real score can demo on mock ATS. Live apply is what makes it a design-partner product rather than a better local fixture. Do not start Wave 3 until Wave 1 home and Wave 2 assessment have a place to put the people you sync.
