# moks verification map

This directory is the maintained source for verifying the user-facing behavior of moks. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Create an isolated company with `.cursor/skills/verify-moks/scripts/workspace.sh`.
- `export MOKS_VERIFY_WORK="$WORK"` and `source "$WORK/env.sh"`.
- Run `.cursor/skills/verify-moks/scripts/doctor.sh` and require `ok company=` under that work dir, fixture `Northline Analytics`, and `candidates/jordan-lee.md`.
- Drive only through `.cursor/skills/verify-moks/scripts/moks.sh`.
- Never drive `~/.config/moks`, the git checkout as cwd, or a TUI session this run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Ledger verbs after `pull` use mock ATS ids (`cand_priya`, `app_priya_142`). The `jordan-lee` card is for `run` / scoring.
- Restore the isolated workspace after a mutation by creating a fresh work dir. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final stdout line.
- CLI proof includes the command, stdout, stderr, and exit code.
- Mutation proof includes a read-only second view (`status`, `log`, or the card file).
- Dry-run proof observes that the second view did not apply (`approved` stays `approved` until `push --execute`).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-moks` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Pull the ATS mirror](./pull.md) covers seeding the mock ATS and reading it back through `status`.
- [Stage a disposition](./commit.md) covers `moks commit` onto a mirrored candidate.
- [Review a changeset](./review.md) covers human approve and reject.
- [Push to the ATS](./push.md) covers dry-run vs `--execute` and `--confirm`.
- [Score a candidate](./score-candidate.md) covers headless `moks run` with the recruit agent.
