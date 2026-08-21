# Company /init and /open-req intake

`/init` is company-only: in any folder it stands up the company workspace (`COMPANY.md` dossier, the `.moks/` ledger, a git repo) and never creates a req directory, even when a title is typed after it. `/open-req [title]` creates or focuses a req subdirectory (`<slug>/HIRING.md` + `<slug>/candidates/`), writes `.moks/focus`, and starts role intake. There is no `SCORECARD.md` and no company-root `HIRING.md`: the company bar is a section of `COMPANY.md` and the role scorecard is a section of the req `HIRING.md`.

## Sub-features

- `init-empty` — `/init` in an empty folder stands up the full company workspace: `COMPANY.md` (dossier stub), `.moks/ledger.sqlite`, `.moks/vault.key`, `.git/`; no `HIRING.md` at the root, no `candidates/` at the root, no req dir.
- `init-no-req` — `/init <title>` on an inited company leaves `COMPANY.md` alone and creates no req dir.
- `open-req-create` — `/open-req <title>` creates `<slug>/HIRING.md` + `<slug>/candidates/.gitkeep` and writes `<slug>` to `.moks/focus`.
- `open-req-focus` — `/open-req <title>` on an existing req focuses it without overwriting its `HIRING.md`.
- `open-req-single` — `/open-req` on a single-req root (fixture layout: root `HIRING.md` + `candidates/`) does not nest a second req and does not add a `COMPANY.md`.

## How to get to it (user POV)

- TUI composer: type `/init` (optionally with notes) or `/open-req <title>` and press Enter. Both appear in slash autocomplete.
- The intake conversation after the scaffold is a recruit model turn and needs a connected provider.

## Driving it with control-moks

Preconditions: isolated workspace from `workspace.sh`; for `init-empty` and `open-req-create` make a fresh empty dir under `$WORK` (for example `$WORK/empty-co`) and start the TUI there in a tmux session this run owns.

- `init-empty`: start the TUI in the empty dir, send `/init` + Enter. Observe the full workspace tree at the root: `COMPANY.md` with the `# Company` dossier stub, `.moks/ledger.sqlite`, `.moks/vault.key`, and `.git/`; no root `HIRING.md`, no `SCORECARD.md`, neither `candidates/` nor any req subdirectory exists.
- `init-no-req`: in the same dir send `/init Senior Backend` + Enter. Observe `COMPANY.md` unchanged and no `senior-backend/` dir.
- `open-req-create`: send `/open-req Senior Backend` + Enter. Observe `senior-backend/HIRING.md` (role stub titled `# Senior Backend` with a `## Scorecard` section), `senior-backend/candidates/.gitkeep`, and `.moks/focus` containing `senior-backend`.
- `open-req-single`: start the TUI in `$COMPANY` (fixture single-req root), send `/open-req Other` + Enter. Observe no `other/` dir, no `COMPANY.md`, and the fixture `HIRING.md` unchanged.

## Gotchas

- With a configured but failing provider (the workspace stub key) the model turn after the scaffold errors; the scaffold and focus writes land anyway. File state is the proof, not the chat reply.
- With zero providers the TUI blocks the submit itself behind the connect-provider dialog and nothing scaffolds. The workspace stub provider prevents this state; if the dialog appears, the env is missing `MOKS_MODELS_PATH` or the key.
- The scaffold runs when the command is submitted, not while typing. Autocomplete inserting `/open-req ` into the composer has no side effect yet.
- `/init` takes free-form notes, not a title. Typing `/init Senior Backend` must not create a req; if a req dir appears, that is the regression this feature guards.
- The slug comes from the first line of the arguments only.
