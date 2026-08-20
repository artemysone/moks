# Company /init and /open-req intake

`/init` is company-only: in any folder it writes or continues the company `HIRING.md` dossier and never creates a req directory, even when a title is typed after it. `/open-req [title]` creates or focuses a req subdirectory (`<slug>/HIRING.md` + `<slug>/candidates/`), writes `.moks/focus`, and starts role intake.

## Sub-features

- `init-empty` — `/init` in an empty folder writes company `HIRING.md` (dossier stub), no `candidates/`, no req dir.
- `init-no-req` — `/init <title>` on an inited company leaves `HIRING.md` alone and creates no req dir.
- `open-req-create` — `/open-req <title>` creates `<slug>/HIRING.md` + `<slug>/candidates/.gitkeep` and writes `<slug>` to `.moks/focus`.
- `open-req-focus` — `/open-req <title>` on an existing req focuses it without overwriting its `HIRING.md`.
- `open-req-single` — `/open-req` on a single-req root (fixture layout) does not nest a second req.

## How to get to it (user POV)

- TUI composer: type `/init` (optionally with notes) or `/open-req <title>` and press Enter. Both appear in slash autocomplete.
- The intake conversation after the scaffold is a recruit model turn and needs a connected provider.

## Driving it with control-moks

Preconditions: isolated workspace from `workspace.sh`; for `init-empty` and `open-req-create` make a fresh empty dir under `$WORK` (for example `$WORK/empty-co`) and start the TUI there in a tmux session this run owns.

- `init-empty`: start the TUI in the empty dir, send `/init` + Enter. Observe `HIRING.md` appears at the root with the `# Company` dossier stub, and neither `candidates/` nor any req subdirectory exists.
- `init-no-req`: in the same dir send `/init Senior Backend` + Enter. Observe `HIRING.md` unchanged and no `senior-backend/` dir.
- `open-req-create`: send `/open-req Senior Backend` + Enter. Observe `senior-backend/HIRING.md` (role stub titled `# Senior Backend`), `senior-backend/candidates/.gitkeep`, and `.moks/focus` containing `senior-backend`.
- `open-req-single`: start the TUI in `$COMPANY` (fixture single-req root), send `/open-req Other` + Enter. Observe no `other/` dir and the fixture `HIRING.md` unchanged.

## Gotchas

- Without a connected provider the model turn after the scaffold errors; the scaffold and focus writes land anyway. File state is the proof, not the chat reply.
- The scaffold runs when the command is submitted, not while typing. Autocomplete inserting `/open-req ` into the composer has no side effect yet.
- `/init` takes free-form notes, not a title. Typing `/init Senior Backend` must not create a req; if a req dir appears, that is the regression this feature guards.
- The slug comes from the first line of the arguments only.
