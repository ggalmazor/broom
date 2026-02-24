# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-24

### Added

- Initial release
- `broom sweep` command to identify and delete stale local branches
- Detects branches merged into `main` via merge commit, squash merge, and rebase
- Identifies branches with unpushed commits
- Identifies branches needing rebase from `main`
- Interactive multi-select UI (space to toggle, enter to confirm)
- Confirmation prompt before deletion

[Unreleased]: https://github.com/ggalmazor/broom/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ggalmazor/broom/releases/tag/v0.1.0
