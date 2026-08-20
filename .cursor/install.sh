#!/usr/bin/env bash
set -euo pipefail

# moks pins Bun via package.json "packageManager". The default Cloud Agent image
# ships Node but not Bun, so bootstrap the pinned Bun release before installing.
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
fi

# Resolve bun from any shell (login, non-login, agent tool shells), not only
# interactive shells that source ~/.bashrc. Best-effort; never fail the install.
if command -v sudo >/dev/null 2>&1 && [ ! -e /usr/local/bin/bun ]; then
  sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun || true
fi

# Idempotent: reruns are a no-op when the lockfile is already satisfied.
bun install
