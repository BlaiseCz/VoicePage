---
description: Instructions to configure GitHub branch protection rules for main and develop
---

# Setup Branch Protection Rules

These rules must be configured manually in GitHub → Settings → Branches → Branch protection rules.

## 1. Protect `main` branch
Create a rule for `main` with these settings:

- **Require a pull request before merging** → enabled
  - Require approvals: **1** (you approve)
  - Dismiss stale PR approvals when new commits are pushed: **enabled**
- **Require status checks to pass before merging** → enabled
  - Required checks:
    - `Build & Test (20)`
    - `Build & Test (22)`
    - `Lint`
    - `Security audit`
- **Require conversation resolution before merging** → enabled
- **Do not allow bypassing the above settings** → disabled (so you as admin can emergency-merge)
- **Restrict who can push to matching branches** → only via PR

## 2. Protect `develop` branch
Create a rule for `develop` with these settings:

- **Require status checks to pass before merging** → enabled
  - Required checks:
    - `Build & Test (20)`
    - `Build & Test (22)`
    - `Lint`
- **Allow force pushes** → only you (for rebasing)

## 3. Set default branch
Set `develop` as the default branch so new PRs target `develop` by default.
Feature branches → `develop` → `main` (release flow).
