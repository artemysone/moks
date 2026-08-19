# Git cleanup

Product work lives on `dev`. Inherited OpenCode branches and tags were deleted.

`script/git-cleanup.ts` keeps `github/dev`. Dry-run by default:

```bash
bun script/git-cleanup.ts
```
