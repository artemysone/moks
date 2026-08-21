#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${MOKS_VERIFY_WORK:-}" && -f "$MOKS_VERIFY_WORK/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$MOKS_VERIFY_WORK/env.sh"
elif [[ -n "${1:-}" && -f "$1/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$1/env.sh"
else
  echo "verify-moks doctor: set MOKS_VERIFY_WORK or pass the workspace directory" >&2
  exit 1
fi

fail() {
  echo "verify-moks doctor: $1" >&2
  exit 1
}

command -v bun >/dev/null || fail "bun is not on PATH"
[[ -f "$CLI" ]] || fail "CLI entry missing: $CLI"
[[ -d "$WORK" && "$WORK" == *"/moks-verify-"* ]] || fail "WORK is not an isolated moks-verify directory: ${WORK:-unset}"
[[ "$COMPANY" == "$WORK/"* ]] || fail "COMPANY is not inside WORK"
[[ "$HOME" == "$WORK/"* ]] || fail "HOME is not the isolated verify home"
[[ "$COMPANY" != "$REPO" && "$COMPANY" != "$REPO/"* ]] || fail "refusing to drive the git checkout"
[[ -f "$COMPANY/HIRING.md" ]] || fail "company HIRING.md missing"
grep -q "Northline Analytics" "$COMPANY/HIRING.md" || fail "HIRING.md is not the hiring fixture"
[[ -f "$COMPANY/candidates/jordan-lee.md" ]] || fail "jordan-lee card missing"
[[ -f "${MOKS_MODELS_PATH:-}" ]] || fail "models stub missing: ${MOKS_MODELS_PATH:-unset}"
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || fail "provider key unset (stub or real)"

if [[ -e "$HOME/.config/moks" && ! -d "$HOME/.config/moks" ]]; then
  fail "isolated config path is not a directory"
fi

echo "ok bun=$(bun --version)"
echo "ok cli=$CLI"
echo "ok work=$WORK"
echo "ok company=$COMPANY"
echo "ok home=$HOME"
echo "ok models=$MOKS_MODELS_PATH"

if [[ -f "$COMPANY/.moks/ledger.sqlite" ]]; then
  echo "ok ledger=$COMPANY/.moks/ledger.sqlite"
else
  echo "ok ledger=absent (run pull first)"
fi
