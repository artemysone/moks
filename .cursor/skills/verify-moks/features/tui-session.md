# TUI session

`bun dev` opens the interactive moks TUI: a chat-style session with the recruit agent over the current company folder, plus slash commands (`/init` to scaffold a req, `/review` for packet review) and the hiring loop ending in `moks commit` and `moks push`. This is the primary interactive surface; verify it whenever TUI wiring, keybinds, or the hiring loop UI changes.

## Sub-features

- `tui-launch` the TUI starts, renders the banner, and shows the status footer.
- `tui-provider-dialog` without a configured provider, a "Connect a provider" dialog opens.
- `tui-init` `/init` scaffolds a requisition in the company folder.
- `tui-hiring-loop` attach a resume, score, `/review`, then commit and push.

## How to get to it (user POV)

- Run `bun dev` from the repo root or from `packages/cli`.
- Run `bun run --conditions=browser src/index.ts` from `packages/cli` (same thing, explicit form).
- Open slash commands by typing `/` in the prompt; the hiring loop starts with `/init`.

## Driving it with tmux

Preconditions:

- `bun install` has run at the repo root.
- A dedicated session name `moks-verify-<run-id>`; never reuse or attach to a session this run did not create.
- Start in a scratch company folder (`-c "$REQ"`) unless the test is about the repo checkout itself.
- Agent turns (scoring, outreach) need a model provider; keyless runs can verify launch and dialog behavior only.

- **Launch.** Run `tmux new-session -d -s "moks-verify-$RUN_ID" -c "$REQ" "bun dev"` with `bun dev` resolving to `packages/cli` (from the repo root it does). After a few seconds, `tmux capture-pane -pt "moks-verify-$RUN_ID"` shows the moks banner and a footer with the folder path.
- **Check the provider gate.** With no key configured, the capture shows the "Connect a provider" dialog listing Anthropic, OpenAI, Google, and others. `Esc` dismisses it.
- **Type a slash command.** Run `tmux send-keys -t "moks-verify-$RUN_ID" "/init"` (no Enter) and capture; the command palette filters to `/init`. Send `Escape` to close without scaffolding.
- **Drive the hiring loop (provider required).** Send `/init` plus Enter, follow the prompts, attach `candidates/jordan-lee.md`, prompt "Score this candidate using the score-candidate skill", then `/review`, then commit and push through the UI.
- **Quit.** Send `C-c` twice or run the Cleanup section's `tmux kill-session`.
- **Proof.** Save every `capture-pane` output as `$EVIDENCE/screen-<step>.txt`; after any commit or push step, re-read the ledger headlessly (`moks log --json --cwd "$REQ"`) as the side-effect check.

## Gotchas

- Never run `bun dev` as a blocking foreground command; it holds the terminal. tmux is the repo's own documented recipe (`packages/cli/AGENTS.md`).
- Give the TUI a moment before capturing; an immediate capture races the first render.
- `capture-pane` grabs the visible pane only; scroll state can hide earlier output. Capture after each step, not once at the end.
- The keyless "Connect a provider" dialog is correct behavior, not a failure. Only report a launch failure if the banner and footer never render.
