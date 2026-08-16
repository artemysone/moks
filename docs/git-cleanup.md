# Git cleanup (inherited OpenCode refs)

The `artemysone/moks` fork copied ~1,200 OpenCode branches and ~1,000 OpenCode tags. Product work lives on `dev`. Those extra refs are not a moks release story.

## Keep

- `dev` — default branch. Never delete.

## Delete (after dry-run review)

- Every other `origin/*` branch (OpenCode WIP copied at fork, plus merged `company-workspace`)
- All inherited `v*`, `github-v*`, `vscode-v*`, and `pr-*` tags

Do **not** run the destructive pass from a product PR. A repo admin should:

1. Protect `dev` on GitHub.
2. Dry-run and read the manifest:

```bash
bun script/git-cleanup.ts
```

3. Execute only after reviewing the manifest:

```bash
bun script/git-cleanup.ts --execute
bun script/git-cleanup.ts --tags --execute
```

Cherry-picks from upstream should use a local `upstream` remote (`anomalyco/opencode`), not the copied fork branches.
