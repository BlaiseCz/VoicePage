---
description: Full development pipeline — build, test, commit, push, and create PR
---

# Development Pipeline

Follow these steps for every change:

## 1. Build all packages
// turbo
```bash
pnpm build
```

## 2. Run type checking
// turbo
```bash
pnpm typecheck
```

## 3. Run all tests
// turbo
```bash
pnpm test
```

## 4. Stage and commit changes
Use **conventional commit** format: `type(scope): description`

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

```bash
git add -A
git commit -m "type(scope): description"
```

## 5. Push to develop branch
```bash
git push origin develop
```

## 6. Verify CI passes
After pushing, GitHub Actions will automatically:
- Run build + typecheck + tests (Node 20 & 22)
- Run lint
- Run security audit

## 7. Automatic PR creation
Once CI passes on `develop`, a PR to `main` is automatically created.
**You must manually approve and merge the PR on GitHub.**

## 8. Release & changelog
When merged to `main`:
- Changelog is auto-generated from conventional commits
- A GitHub Release is created with the tag
