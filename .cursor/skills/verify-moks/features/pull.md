# Pull the ATS mirror

Pull copies the ATS snapshot into the local ledger mirror so later commit, review, and push have entities to resolve.

## Sub-features

- `pull-seed` creates `.moks/` and seeds the mock ATS on a fresh company.
- `pull-upsert` reports jobs, candidates, and applications.
- `pull-status` shows the same counts through `moks status`.
- `pull-repeat` on a second pull is not a second seed.

## How to get to it (user POV)

- Run `moks pull` in a company or req directory.
- Run `moks pull --json` for machine-readable stdout.
- In the TUI, the recruiter still uses the same `pull` verb from a shell in that workspace.

## Driving it with control-moks

Preconditions:

- Isolated workspace from `scripts/workspace.sh`.
- `scripts/doctor.sh` reports the fixture company and no requirement that a ledger already exist.
- `$COMPANY/.moks/ledger.sqlite` is absent before the first pull.

- **First pull.** Sync the mock ATS. Run `scripts/moks.sh pull --json`. Exit code `0`. Stdout JSON has `ats` `mock`, `seeded` `true`, `upserted.jobs` `1`, `upserted.candidates` `5`, `upserted.applications` `5`, and `path` equal to `$COMPANY`.
- **Ledger files.** Confirm side effects. `$COMPANY/.moks/ledger.sqlite` and `$COMPANY/.moks/mock-ats.sqlite` exist. They are not under the git checkout.
- **Status view.** Read the mirror back. Run `scripts/moks.sh status --json`. Exit code `0`. `report.ats` is `mock`. `report.jobs` is `1`. `report.candidates` is `5`. `report.applications` is `5`.
- **Second pull.** Pull again. Run `scripts/moks.sh pull --json`. Exit code `0`. `seeded` is `false`. Upsert counts stay `1` / `5` / `5`.
- **Proof.** Save both pull payloads and the status payload under `$EVIDENCE/pull/` as `pull-1.json`, `pull-2.json`, and `status.json`. Write `meta.txt` with feature id `pull` and entry point `moks pull --json`.

## Gotchas

- `status` before the first pull prints `mirror empty — run moks pull` and has `report.ats` null. That is not a failed doctor, and it is not a successful pull.
- Pull seeds the **mock ATS fixture** (Jane Ortega, Priya Shah, …), not `jordan-lee`. The card is a separate scoring fixture.
- A second pull that reports `seeded: true` means the mock DB was empty again. Check that you did not point `--cwd` at a new directory by accident.
- Do not open `ledger.sqlite` with a one-off script as the proof. `status --json` is the user-facing second view.
