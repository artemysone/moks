#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
FIXTURES="$REPO/packages/cli/src/product/fixtures/hiring"
CLI="$REPO/packages/cli/src/index.ts"
MODELS="$REPO/.cursor/skills/verify-moks/fixtures/models.json"

if [[ ! -f "$FIXTURES/HIRING.md" || ! -f "$CLI" || ! -f "$MODELS" ]]; then
  echo "verify-moks: expected hiring fixtures, models stub, and CLI entry under $REPO" >&2
  exit 1
fi

RUN_ID="${1:-$(date +%Y%m%d-%H%M%S)-$$}"
ROOT="${MOKS_VERIFY_ROOT:-/tmp}"
WORK="$ROOT/moks-verify-$RUN_ID"
COMPANY="$WORK/company"
VERIFY_HOME="$WORK/home"
EVIDENCE="$REPO/.cursor/skills/verify-moks/evidence/$RUN_ID"

mkdir -p "$COMPANY/candidates" "$VERIFY_HOME/.config/moks" "$EVIDENCE"
cp "$FIXTURES/HIRING.md" "$COMPANY/HIRING.md"
cp "$FIXTURES/candidates/jordan-lee.md" "$COMPANY/candidates/jordan-lee.md"

cat >"$WORK/env.sh" <<EOF
export RUN_ID=$(printf '%q' "$RUN_ID")
export REPO=$(printf '%q' "$REPO")
export CLI=$(printf '%q' "$CLI")
export WORK=$(printf '%q' "$WORK")
export COMPANY=$(printf '%q' "$COMPANY")
export EVIDENCE=$(printf '%q' "$EVIDENCE")
export MOKS_VERIFY_WORK=$(printf '%q' "$WORK")
export HOME=$(printf '%q' "$VERIFY_HOME")
export XDG_CONFIG_HOME=$(printf '%q' "$VERIFY_HOME/.config")
export XDG_DATA_HOME=$(printf '%q' "$VERIFY_HOME/.local/share")
export XDG_STATE_HOME=$(printf '%q' "$VERIFY_HOME/.local/state")
export XDG_CACHE_HOME=$(printf '%q' "$VERIFY_HOME/.cache")
export MOKS_DISABLE_AUTOUPDATE=1
export MOKS_DISABLE_AUTOCOMPACT=1
export MOKS_DISABLE_MODELS_FETCH=1
# Stub provider so the TUI accepts submits (slash commands scaffold before the
# model turn). The dummy key fails at the provider boundary; export a real
# ANTHROPIC_API_KEY before sourcing env.sh to drive live model turns.
export MOKS_MODELS_PATH=$(printf '%q' "$MODELS")
export ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY:-moks-verify-dummy-key}"
EOF

echo "$WORK"
