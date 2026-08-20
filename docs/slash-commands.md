# Moks slash commands

Inventory from `port/mox-into-moks` (P1–P5). Two systems share the `/` prefix.

## Two kinds of slash

| Kind | What happens | Examples |
|---|---|---|
| UI action | Runs a dialog or navigation immediately. No model turn. | `/commit`, `/push`, `/status`, `/models`, `/help` |
| Agent prompt | Inserts `/name` into the composer. On send, injects a template into the session. | `/init`, agent `/review`, MCP prompts |

Skills are commands internally, but `/` hides `source: skill`. Pick them via `/skills`.

## Hiring loop

Intended path: `/init` → skills → agent `/review` (packet) → `/commit` → UI `/review` (changeset) → `/push`.

| Slash | Kind | Does |
|---|---|---|
| `/init` | Agent | Scaffold + HM intake. Empty folder → company `HIRING.md`. Company present → req dir. |
| `/commit` | UI | Stage a ledger changeset. Action + reason. Toast: **Staged**. No ATS write. |
| `/status` | UI | List open changesets (staged / approved). Aliases: `/decisions`, `/commits`, `/receipts`. |
| `/review` | **Both** | **UI:** approve/reject a staged changeset. **Agent:** packet review of `HIRING.md` + cards before commit. Autocomplete shows both. |
| `/push` | UI | Apply an approved changeset. Asks Dry-run vs Write to ATS. Adverse still confirms. Dry-run never says “Pushed”. |

### Skills (via `/skills`)

| Skill | Does |
|---|---|
| `req-context` | Synthesize the req brief from `HIRING.md`; list gaps |
| `score-candidate` | Score onto the candidate card vs `HIRING.md` |
| `draft-outreach` | Draft copy onto the card; never send |
| `commit-disposition` | Recommend a disposition and stage it with the `commit` tool |

### CLI only — no slash yet

| CLI | Notes |
|---|---|
| `moks pull` | Refresh ATS mirror |
| `moks rebase` | Re-derive a stale changeset |
| `moks log` | Hash-chained history / `--compliance` |
| `moks diff` | Ledger mutations vs mirror. TUI `/diff` is the **file** viewer, not this. |

## Session and agent

Inherited harness. Still useful.

| Slash | Scope | Does |
|---|---|---|
| `/new` | App | Leave session, go home. Alias: `/clear` |
| `/sessions` | App | Switch session. Aliases: `/resume`, `/continue` |
| `/rename` | Session | Rename this session |
| `/timeline` | Session | Jump to a message |
| `/fork` | Session | Fork from a message |
| `/compact` | Session | Summarize / compact context. Alias: `/summarize` |
| `/undo` | Session | Revert the last user turn |
| `/redo` | Session | Restore a reverted turn |
| `/copy` | Session | Transcript to clipboard |
| `/export` | Session | Transcript to file |
| `/timestamps` | Session | Toggle timestamps. Alias: `/toggle-timestamps` |
| `/thinking` | Session | Toggle thinking blocks. Alias: `/toggle-thinking` |
| `/editor` | Prompt | Open `$EDITOR` on the draft |
| `/skills` | Prompt | Pick a skill; inserts `/skill-name` |
| `/models` | App | Switch model. Alias: `/mo` |
| `/variants` | App | Model variant |
| `/agents` | App | Switch agent (recruit, plan, …) |
| `/mcps` | App | Toggle MCP servers |
| `/connect` | App | Add a provider |
| `/org` | App | Switch org (only if more than one). Aliases: `/orgs`, `/switch-org` |
| `/move` | Prompt | Move session to another project dir |
| `/warp` | Prompt | Change workspace (experimental, hidden unless flag) |
| `/workspaces` | App | Manage workspaces (experimental, hidden unless flag) |

## System chrome

| Slash | Does |
|---|---|
| `/help` | Help dialog |
| `/system` | MCP / formatter status |
| `/debug` | Debug info |
| `/themes` | Theme picker |
| `/diff` | Local hiring **file** diff — not ledger `moks diff` |
| `/exit` | Quit. Aliases: `/quit`, `/q` |

Palette-only (no slash): Open docs, theme mode lock, debug overlay, console, heap snapshot. User-defined `moks.json` `command:` entries and MCP prompts also appear under `/`.

## Messy edges

1. **Two `/review`s.** Packet review (agent) vs changeset gate (human UI). Rename the UI one to `/approve` or `/gate`.
2. **`/diff` vs `moks diff`.** Slash = files. CLI = ledger mutations.
3. **`/status` vs statusline.** Slash lists changesets. Statusline already shows `2 staged · 1 approved`.
4. **No TUI slash for `pull`.** Cannot refresh the ATS mirror from `/` today.

Likely next cut: rename UI `/review` → `/approve`, add `/pull`, and either rename TUI `/diff` or add `/plan` for the ledger diff so hiring verbs match the CLI.
