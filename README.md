# broom

Git branch housekeeping — sweep away stale local branches.

Broom fetches from `origin`, analyzes every local branch against `main`, and presents an interactive checklist so you can select and delete the ones you no longer need.

## Features

- Detects branches merged into `main` via **merge commit**, **squash merge**, and **rebase**
- Squash merge detection works even for multi-commit branches and is immune to external diff drivers (e.g. `difft`)
- Identifies branches with **unpushed commits** and branches that **need rebasing**
- **Fast-forwards** local branches that are strictly behind their remote, without requiring a checkout
- **Worktree-aware**: shows a `[worktree]` label, removes the worktree before deleting the branch
- Interactive multi-select UI with search, pre-selecting all merged branches
- `--dry-run` mode to inspect the report without being prompted to delete anything

## Installation

```sh
curl -fsSL https://raw.githubusercontent.com/ggalmazor/broom/main/install.sh | bash
```

To install a specific version:

```sh
curl -fsSL https://raw.githubusercontent.com/ggalmazor/broom/main/install.sh | bash -s 1.0.0
```

Supported platforms: macOS (arm64, x86_64), Linux (x86_64).

## Usage

```
broom sweep              # fetch, analyze, prompt to delete
broom sweep --dry-run    # fetch, analyze, print report — no deletion
broom sweep --no-progress  # suppress the per-branch progress line
```

### How it works

1. `git fetch origin --prune` — sync with remote and drop pruned refs
2. Fast-forward any local branch that is strictly behind its upstream
3. Classify every local branch (except `main`):
   - **merged** — tip is an ancestor of `main`, or all patches are already in `main` (rebase), or all touched files have identical content in `main` (squash merge)
   - **unpushed** — no remote tracking ref, or local commits ahead of origin
   - **needs rebase** — `main` has commits the branch doesn't
   - **active** — pushed, has unique commits, up to date with origin
4. Show a multi-select list (merged branches pre-checked)
5. Confirm, then delete

## Requirements

- [Deno](https://deno.land/) 2.x
- Git

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE).
