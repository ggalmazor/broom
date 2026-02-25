# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-25

### Added

- `install.sh` script for one-liner installation from GitHub releases
- `--dry-run` flag for `broom sweep`: fetches, analyzes, and prints a full branch report without prompting to delete
- Squash merge detection via blob comparison: compares file blob SHAs between the branch tip and `main` using `git ls-tree`, catching squash merges that `--cherry-mark` cannot detect (multi-commit branches). Immune to external diff drivers such as `difft`.
- Fast-forward local branches that are strictly behind their remote without requiring a checkout
- Worktree-aware sweep: displays `[worktree]` suffix for branches checked out in a linked worktree, removes the worktree before deleting the branch, and skips worktree branches during fast-forward
- Per-branch progress indicator during analysis (disable with `--no-progress`)

### Changed

- `merged` status is now rendered in green instead of dim gray
- Branch analysis now runs in parallel for faster results
- Squash/rebase detection upgraded from `git patch-id` scan to `git log --cherry-mark`, then further extended with blob-level content comparison

### Fixed

- Cliffy prompt summary line is now erased after the checkbox and confirm selections

## [0.1.0] - 2026-02-24

### Added

- Initial release
- `broom sweep` command to identify and delete stale local branches
- Detects branches merged into `main` via merge commit, squash merge, and rebase
- Identifies branches with unpushed commits
- Identifies branches needing rebase from `main`
- Interactive multi-select UI (space to toggle, enter to confirm)
- Confirmation prompt before deletion

[Unreleased]: https://github.com/ggalmazor/broom/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ggalmazor/broom/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/ggalmazor/broom/releases/tag/v0.1.0
