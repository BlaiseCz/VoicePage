---
description: Stage, commit with conventional format, and push to develop
---

# Commit and Push

## 1. Run tests before committing
// turbo
```bash
pnpm build && pnpm typecheck && pnpm test
```

## 2. Stage all changes
```bash
git add -A
```

## 3. Commit with conventional commit message
Use the format: `type(scope): description`

```bash
git commit -m "type(scope): description"
```

## 4. Push to develop
```bash
git push origin develop
```

A PR to `main` will be automatically created by GitHub Actions.
You must approve and merge the PR manually.
