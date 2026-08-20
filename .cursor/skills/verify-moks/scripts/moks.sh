#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -n "${MOKS_VERIFY_WORK:-}" && -f "$MOKS_VERIFY_WORK/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$MOKS_VERIFY_WORK/env.sh"
elif [[ -n "${1:-}" && -f "$1/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$1/env.sh"
  shift
else
  echo "verify-moks: set MOKS_VERIFY_WORK or pass the workspace directory as the first argument" >&2
  exit 1
fi

if [[ ! -f "$CLI" ]]; then
  echo "verify-moks: missing CLI entry $CLI" >&2
  exit 1
fi

cd "$COMPANY"
exec bun run --conditions=browser "$CLI" "$@"
