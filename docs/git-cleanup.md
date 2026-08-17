# Git cleanup

moks is a pre-user prototype. Product work lives on `main`.

Inherited OpenCode branches (~1,200) and tags (~1,000) were deleted. Remaining remotes:

| Ref | Why |
|-----|-----|
| `main` | Product branch. Use this. |
| `dev` | Still the GitHub default (this token cannot change it). Same tip as `main`. Delete after an admin sets the default to `main`. |

```bash
# Admin: switch default to main in GitHub settings, then:
git push origin --delete dev
```

`script/git-cleanup.ts` keeps `main` and `dev`. Dry-run by default.
