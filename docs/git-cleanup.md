# Git cleanup

Product work lives on `dev`. Inherited OpenCode branches and tags were deleted.

`script/git-cleanup.ts` keeps `origin/dev`. Dry-run by default:

```bash
bun script/git-cleanup.ts
```

Cherry-picks from upstream should use a local `upstream` remote (`anomalyco/opencode`), not copied fork branches.
