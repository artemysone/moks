#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${MOKS_VERIFY_WORK:-}" && -f "$MOKS_VERIFY_WORK/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$MOKS_VERIFY_WORK/env.sh"
elif [[ -n "${1:-}" && -f "$1/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$1/env.sh"
else
  echo "verify-moks cleanup: set MOKS_VERIFY_WORK or pass the workspace directory" >&2
  exit 1
fi

if [[ "$WORK" != *"/moks-verify-"* ]]; then
  echo "verify-moks cleanup: refusing to remove $WORK" >&2
  exit 1
fi

if [[ -n "${MOKS_VERIFY_TMUX:-}" ]] && tmux has-session -t "$MOKS_VERIFY_TMUX" 2>/dev/null; then
  tmux kill-session -t "$MOKS_VERIFY_TMUX"
fi

rm -rf "$WORK"
echo "removed $WORK"
echo "kept evidence ${EVIDENCE:-}"
