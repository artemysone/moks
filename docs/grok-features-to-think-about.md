# Grok Build TUI — features to think about

Source: local Grok Build `1.0.4` (`~/.grok/docs/user-guide/`, `grok --help`). Compared against moks TUI (`packages/tui`) and mini (`moks --mini`).

Grok’s TUI is a **spatial** product. moks already has most of the *features* (palette, questions, permissions, `--mini`, sessions, themes). What’s worth stealing is the **contracts**, remapped to hiring — not the coding dashboard.

Default loop we are porting toward: open company → `/init` a req → focus it → load that `HIRING.md` → score onto the card → draft outreach → `/review` → `moks commit` → `moks push`.

---

## Thesis

| Grok | moks today | Wrong port |
|------|------------|------------|
| Scrollback is a selectable document | Chat transcript; messages scroll away | Recreate Grok’s coding chrome |
| Blocking cards never trap you | Esc on a card = reject | Modal that steals the packet |
| Footer always teaches this state’s keys | Which-key is a hidden overlay | Another vim cheatsheet |
| Minimal mode treats the terminal as the book | `--mini` exists, not first-class | Delete alt-screen, or ignore mini |
| Dashboard = parallel coding agents | Session list + pin + subagent strip | Multi-coder board for recruiters |
| Plan preview: comment / request / approve | `/review` is a prompt template | Plan → generate recruiting software |

moks still *feels* like OpenCode: leader-key chords, modal dialogs, plugin slots, which-key, worktrees, MCP, compaction. Hiring identity is in copy, agents, packet sidebar, and commit/push — not a redesigned TA layout.

---

## Copy

### 1. Contextual shortcuts bar

Grok’s best habit. Bottom bar always shows the keys for **this** state: which pane is focused, whether a turn is running, what kind of entry is selected. When a blocking card has the keyboard, the bar shows *that* card’s keys. When focus is parked, the bar names the card (`Tab/Space: question`) and that hint is pinned so a narrow bar cannot trim the only way back.

moks: composer hint row changes a bit (idle / running / shell). Which-key is `ctrl+alt+k`, a toggle overlay/dock — not a persistent teacher.

Hiring bar should read things like: `tab next card · enter score · p push`. Recruiters are not vim users.

### 2. Focus parking on blocking cards

Three Grok surfaces block the agent and take the keyboard: **question card**, **permission prompt**, **cancel-turn panel**. Shared contract:

- `Tab` / `Shift+Tab` walk that card’s rows and wrap. They never leave the card.
- `Esc` steps back one rung: clear pending selection first; only then leave. Question and permission **park** in the scrollback so you can read context; the card stays on screen. `Tab` returns.
- Cancel-turn’s Esc means “keep running” — never a dead end.

moks: Esc on permission/question = reject. Prompt stays below the card. You cannot re-read the candidate card / `HIRING.md` without answering or dismissing.

This is the first thing to steal. Scoring is “read evidence, then decide.”

### 3. Sticky user-prompt headers

Grok pins the user prompt as a sticky header when you scroll past it. The ask stays visible while you read the response, tools, diffs.

moks: user turns are left-bordered cards that scroll away. `stickyScroll` only pins the viewport to the bottom.

Hiring: the ask (“score Maya against Staff Eng”) should stay pinned while you scroll evidence.

### 4. Per-block fold

Grok scrollback entries are selectable. Collapse / expand the selected entry (`←`/`→`, or `h`/`l` in vim). Thinking, tools, diffs fold independently. Optional `respect_manual_folds` pins a hand-folded block so streaming does not reopen it. `Enter` opens the block in a fullscreen viewer. `y` copies content, `Y` copies metadata (e.g. the shell command).

moks: global toggles only (thinking show/hide, tool details, generic tool output). Tool output is truncated, not per-block. Clicking a user card opens an *actions* menu, not a viewer.

Scoring transcripts get long (search, notes, outreach drafts). A global tool-detail toggle is too coarse.

### 5. Plan preview → packet review

When Grok exits plan mode it opens a scrollable preview with an action bar:

| Key | Action |
|-----|--------|
| `a` | Approve (or approve with comments) and start building |
| `s` | Request changes — focus the prompt |
| `c` | Comment on the selected line / range |
| `y` | Copy the plan |
| `q` | Quit the plan, turn plan mode off |

`Tab` moves between preview and prompt. Inline comments + freeform notes go back to the agent; plan mode stays on so you iterate.

moks `/review` is a server prompt template (packet review, not `gh pr`). There is no plan artifact surface. This Grok screen *is* what `/review` should feel like: read the packet, comment on the score/outreach, approve to commit, or send back.

### 6. Queue vs steer as first-class

Grok, mid-turn:

- Plain `Enter` **queues** a follow-up. Default `follow_up_behavior = "queue"` holds until the turn ends (and holds while blocked on background tasks / subagents). `"steer"` injects at the next safe gap.
- Interrupt is explicit (`Ctrl+Enter` / terminal-specific): cancel-and-send, always appears at the bottom of the transcript.
- Double-Enter on an empty composer sends the top queued row now.

moks backend can queue (`QUEUED` on messages). Mini has a queue manager. Fullscreen has the keybind and no UI. No explicit steer-vs-queue control.

Hiring: “also mention Series B” must not cancel a scoring turn.

### 7. Minimal / scrollback-native as a real product

Grok `--minimal`: finalized blocks print into the terminal’s native scrollback; a small pinned region holds the prompt + running turn. Session-scoped flags; sticky default via `[ui] screen_mode`. Minimal uses the terminal’s own 16-color palette — no theme, no polarity detection. Commands that need fullscreen (`/theme`, `/dashboard`, `/tutorial`) are hidden and say why.

moks `--mini` is the same idea (`screenMode: "split-footer"`). It is not first-class: no sticky pref, no mode-aware command hiding, fullscreen is still the personality.

The book *is* the filesystem. Native scrollback is more “the book” than an alt-screen app. Worth making mini equally polished, maybe the default later.

---

## Port, don’t clone

### Agent dashboard → req / candidate roster

Grok `Ctrl+\` / `/dashboard`: live roster of top-level sessions in this pager. Peek, reply, dispatch, pin, rename, stop, attach. Grouped by state (Needs input → Working → Idle → …) or by cwd. Dispatch input always spawns a new session. Peek lets you answer a pending question without attaching.

Do **not** ship a parallel-coder board.

Port as a **pipeline roster**: needs input / scoring / outreach draft / unpushed. Rows are reqs or cards, not agents. Peek = read the card + pending question. Attach = focus that req and open the session.

### Shift+Tab cycle → hiring modes

Grok cycles **Normal → Plan → Always-approve**.

moks Tab / Shift+Tab already cycles **agents** (`recruit` ↔ `plan`). Auto-approve is a separate palette toggle.

Possible cycle: `recruit` / `plan` / always-approve — or `recruit` / `plan` / review. Do not add a third coding mode.

### `/btw` → a note that doesn’t derail

Grok `/btw` is an aside: not part of the main turn. In minimal mode the answer is a dismissible panel above the prompt.

Hiring: “note she mentioned visa” while a score is running, without steering the score.

### Question cards as TA surface

Grok `ask_user_question`: numbered answers, multi-question tabs, free-text row, multi-select, dismiss (`Shift+X` continues without an answer), fullscreen the card. 1–9 / a–f pick directly.

moks already has `QuestionPrompt` (numbered options, multi-question tabs, custom “other”, confirm). Lean harder: score / disposition / which-req as cards, not chat. Pair with focus parking so you can read the packet first.

### Permission scope widening

Grok: `←`/`→` widen or narrow what an “always” answer would remember; `e` edits the bash pattern by hand.

moks: allow once / always / reject. Always confirms patterns until restart.

Worth tightening the “always” language for hiring writes (`moks push`), not cloning bash-pattern editing.

---

## Skip

| Grok | Why |
|------|-----|
| Worktrees / `Ctrl+W` new worktree | Coding isolation. We already have experimental `/workspaces` — hide it harder. |
| `/loop`, `/goal`, `/deep-research`, `/imagine` | Not TA. |
| Agent dashboard as multi-coder roster | Wrong metaphor (see port). |
| Vim mode for scrollback | Optional later, not identity. Default is correct: letter keys focus the prompt and type. |
| `pager.toml` deep theming | Overkill. Themes + compact-ish density if needed. |
| Onboarding tutorial | Tips + empty-company copy are enough until the product is sharper. |
| `/dream` / memory consolidation | Not now. |
| Destructive double-press on quit / new session | Nice polish. Not a concept to prioritize. |
| Cursor color via OSC 12 | Cute. Skip. |

---

## Inventory

Fullscreen TUI = `packages/tui` (default `moks`). Mini = `packages/moks/src/cli/cmd/run/` (`moks --mini`).

| # | Concept | moks | Notes |
|---|---------|------|-------|
| 1 | Fullscreen alt-screen vs inline | **Have** | Default OpenTUI alt-screen. Mini is no-alt-screen. |
| 2 | Minimal / scrollback-native | **Have** | `--mini`. Not first-class (see Copy §7). |
| 3 | Command palette | **Have** | Ctrl+P. `?` is not the palette. |
| 4 | Contextual shortcuts bar | **Partial** | Composer hints + which-key overlay. |
| 5 | Sticky user-prompt headers | **Don’t** | Cards scroll away. |
| 6 | Per-block fold | **Partial** | Global toggles only. |
| 7 | Fullscreen block viewer | **Partial** | `/diff`, permission expand, not a selected-entry viewer. |
| 8 | Session picker / resume / continue | **Have** | `/sessions`, `--continue`, pin + slots 1–9. |
| 9 | Multi-session dashboard | **Partial** | Session list + pin + child cycling. No peek / reply / attach. |
| 10 | Prompt queue / steer | **Partial** | Backend + mini UI. Fullscreen: no manager. |
| 11 | Shift+Tab cycle modes | **Partial** | Cycles agents, not Normal/Plan/YOLO. |
| 12 | Blocking question cards | **Have** | `QuestionPrompt`. No parking. |
| 13 | Permission + scope widening | **Have** | Once / always / reject. Weaker “always” editor. |
| 14 | Cancel-turn + subagent choices | **Don’t** | Double-Esc aborts. Ctrl+B backgrounds. |
| 15 | Double-Esc rewind | **Don’t** | Double-Esc = interrupt. Undo is `/undo`. |
| 16 | `/doctor` | **Don’t** | Closest: `/debug`, `/system`. Cheap trust win later. |
| 17 | Theme picker + live preview | **Have** | `/themes`. |
| 18 | Compact mode (density) | **Don’t** | `/compact` is summarization. |
| 19 | Vim scrollback | **Don’t** | Skip. |
| 20 | Worktree launch | **Partial** | Experimental, coding-lineage. Skip. |
| 21 | Todos pane | **Have** | Sidebar plugin. |
| 22 | Background tasks pane | **Partial** | Task rows + “background”. No dedicated pane. |
| 23 | `/btw` aside | **Don’t** | Port as a note, don’t clone the command. |
| 24 | Welcome / home | **Have** | Logo + composer + hiring tips. |
| 25 | Click-to-select scrollback | **Partial** | Click user card → actions. No entry-selection model. |
| 26 | Image paste / file chips | **Have** | |
| 27 | `@` picker + line ranges | **Have** | |
| 28 | Focus parking | **Don’t** | Copy first. |
| 29 | Slash MRU / fuzzy menu | **Partial** | Fuzzy `/` + palette. No slash MRU. |
| 30 | Settings modal | **Don’t** | Scattered toggles. |
| 31 | Session fork | **Have** | |
| 32 | Onboarding tutorial | **Don’t** | Skip for now. |
| 33 | Destructive double-press | **Partial** | Lists yes; quit / `/new` no. |
| 34 | `/context` token breakdown | **Partial** | Sidebar + composer %. No category breakdown. |
| 35 | Prompt history search | **Partial** | Up/down last 50. No search overlay. |
| 36 | External editor for draft | **Have** | `/editor`. |
| 37 | Session-info overlay | **Partial** | `/system`, `/debug`, `/status` (decisions). |
| 38 | Plan / review preview | **Don’t** | Copy as `/review` surface. |
| 39 | Shortcuts help overlay | **Partial** | Thin `/help`. Real help is palette + which-key. |
| 40 | Hiring-specific surfaces | **Partial** | See below. |

---

## Hiring surfaces today

**Have**

- Sidebar **packet**: company title, req list, click-to-focus (writes `.moks/focus`), focused req + candidate id / stage / score
- Composer **req status**: `title · N cards · N unpushed · agent`
- Slash `/commit` `/push` `/status` → decision dialogs
- Slash `/init` and `/review` as prompt templates
- Agents: `recruit` and `plan`
- Placeholders and home tips already speak score / outreach / commit
- Skills: req-context, score-candidate, draft-outreach, commit-disposition

**Don’t have as first-class TUI**

- Candidate card reader / editor
- Scorecard UI
- Outreach composer
- Packet review pane (only `/review` as a prompt)
- Req picker beyond sidebar click-to-focus

Score, outreach, and review are *agent jobs* (skills + slash prompts), not screens. That is the gap vs Grok: they built spatial UX for coding decisions; we still ask the agent to do hiring decisions in markdown.

---

## Grok layout (for reference)

**Fullscreen:** scrollback (conversation as selectable entries) + prompt. `Tab` moves focus. User prompts, assistant markdown, collapsible thinking, tool calls with inline diffs, task lists.

**Minimal:** terminal-native scrollback is the history; pinned footer is the cockpit (prompt + running turn).

**Welcome:** before a session — resume, new worktree, Claude import.

**Dashboard:** roster + dispatch + peek.

**Shortcuts bar:** always on, always contextual.

**Home / session in moks:** centered logo → composer → tips → footer on home. Session is a sticky-bottom message scrollbox, then permission/question card, optional subagent strip, composer. Right sidebar: packet / context / MCP / todos / modified files. No top header. Dialogs are modal overlays.

---

## Priority if we take anything

1. **Focus parking** on question + permission cards
2. **Shortcuts bar** that names the live surface (replace which-key as the default teacher)
3. **`/review` as Grok’s plan-preview** (comment / request changes / approve → commit)
4. **Sticky turn headers** + **per-block fold**
5. **Queue UI** in fullscreen (Enter queues; interrupt is explicit)
6. **Mini as a real mode** (sticky pref, mode-aware commands)
7. **Roster** only after the packet is a place you can read — not a second session list

Grok’s one-liner: **blocking cards never trap you, and the footer always tells you how to leave.**
