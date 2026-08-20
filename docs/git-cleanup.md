# Git cleanup

Product work lives on `main`. Inherited OpenCode branches and tags were deleted.

`script/git-cleanup.ts` keeps `github/main`. Dry-run by default:

```bash
bun script/git-cleanup.ts
```
