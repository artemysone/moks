#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
RUN_ID=$(date +%Y%m%d-%H%M%S)-$$
REQ=$(mktemp -d /tmp/moks-verify-XXXXXX)
EVIDENCE="$ROOT/.cursor/skills/verify-moks/evidence/$RUN_ID"
mkdir -p "$EVIDENCE"
trap 'rm -rf "$REQ"' EXIT

cd "$ROOT/packages/cli"
mkdir -p "$REQ/candidates"
cp src/product/fixtures/hiring/HIRING.md "$REQ/"
cp src/product/fixtures/hiring/candidates/jordan-lee.md "$REQ/candidates/"

moks() {
  local step=$1
  shift
  bun run --conditions=browser src/index.ts "$@" --json --cwd "$REQ" >"$EVIDENCE/$step.json"
  echo "ran: $step (moks $*)"
}

check() {
  local file=$1 expr=$2 label=$3
  bun -e "const d = await Bun.file('$EVIDENCE/$file.json').json(); if (!($expr)) { console.error('FAIL: $label'); process.exit(1) } console.log('ok: $label')"
}

moks doctor-status status
check doctor-status "d.path === '$REQ' && (d.report.ats === null || d.report.ats === 'mock')" "doctor: fresh or mock instance at \$REQ"

moks pull pull
check pull 'd.seeded === true && d.upserted.candidates === 5' "pull seeds 1 job / 5 candidates / 5 applications"

moks commit commit --action advance --target-id cand_priya --reason "verify-moks ledger loop"
check commit 'd.changeset.status === "staged" && d.adverse === false' "commit stages a non-adverse changeset"
CS=$(bun -e "console.log((await Bun.file('$EVIDENCE/commit.json').json()).changeset.id)")

moks review review "$CS" --approve --by verifier
check review 'd.changeset.status === "approved"' "review approves $CS"

moks push-dry-run push
check push-dry-run 'd.ok === true && d.dry_run === true' "push defaults to dry-run"
moks status-after-dry-run status
check status-after-dry-run 'd.changesets[0].status === "approved"' "dry-run applied nothing"

moks push-execute push --execute
check push-execute 'd.ok === true && d.dry_run === false && d.pushed[0].status === "applied"' "push --execute applies via mock adapter"

moks log log
check log 'd.chain.ok === true && d.entries[0].status === "applied"' "hash chain verifies, entry applied"
moks log-compliance log --compliance

[ -f "$REQ/.moks/ledger.sqlite" ] || { echo "FAIL: .moks/ledger.sqlite missing"; exit 1; }
echo "ok: ledger db exists at \$REQ/.moks/ledger.sqlite"
grep -q "stage:" "$REQ/candidates/cand-priya.md" || { echo "FAIL: projected card candidates/cand-priya.md missing stage"; exit 1; }
cp "$REQ/candidates/cand-priya.md" "$EVIDENCE/projected-card.md"
echo "ok: candidate card projected with new stage"

bun -e "await Bun.write('$EVIDENCE/summary.json', JSON.stringify({ run_id: '$RUN_ID', req: '$REQ', changeset: '$CS', result: 'pass', steps: ['doctor-status', 'pull', 'commit', 'review', 'push-dry-run', 'status-after-dry-run', 'push-execute', 'log', 'log-compliance', 'projected-card'] }, null, 2))"
echo "PASS — evidence: $EVIDENCE"
