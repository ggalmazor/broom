# CLAUDE.md — Broom

## What is this?

Broom is a CLI tool for housekeeping local git branches. It fetches from `origin`, analyzes local branches against `main`, and lets you interactively select and delete stale ones.

It detects branches that have been merged into `main` via all GitHub merge strategies (merge commit, squash merge, rebase), as well as branches with unpushed commits or branches that need rebasing.

## Architecture

- **`main.ts`** — CLI entry point. Wires Cliffy commands and handles top-level errors.
- **`src/commands/sweep.ts`** — The `sweep` command: fetches origin, analyzes branches, shows interactive multi-select list, confirms, and deletes.
- **`src/git/`** — Pure, testable git logic:
  - `src/git/repo.ts` — `isGitRepo`, `getRepoRoot`
  - `src/git/branches.ts` — `analyzeBranches` and supporting functions. Returns `BranchInfo[]`.
- **`src/utils/errors.ts`** — Typed error hierarchy.
- **`src/version.ts`** — Single source of truth for the version string.
- **`tests/`** — Tests using Deno's built-in test runner.
- **`scripts/`** — Release and install automation.

## Key design decisions

- **All git logic is pure and testable** — `src/git/branches.ts` only uses `Deno.Command` with `git`. No external dependencies.
- **Squash/rebase detection** — Uses patch-id comparison via `git patch-id` to detect commits whose diff content matches a commit already in `main`, covering squash merges and rebases.
- **No config file** — Broom is stateless. Run it, clean up, done.
- **Cliffy Checkbox** for the interactive multi-select UI.

## TDD workflow — MANDATORY

**Every change follows Red → Green → Refactor:**

1. **Write the failing test first.** No production code without a test that demands it.
2. **Run `deno task test`** — confirm the test fails for the right reason.
3. **Write the minimum code** to make the test pass.
4. **Run `deno task test`** — confirm all tests pass.
5. **Refactor** if needed, keeping tests green.
6. **Commit.** Tests must pass before every commit.

### What to test

- **All pure logic in `src/git/`** — branch analysis, merge detection, status classification.
- **Edge cases first** — no branches, branch named `main`, branches already deleted remotely.

### What NOT to test (for now)

- Interactive Cliffy prompts — non-interactive variants are tested.

### Running tests

```sh
deno task test          # run all tests once
deno task test:watch    # watch mode
```

### Test file conventions

- Test files go in `tests/` and match `*.test.ts`
- Mirror `src/` structure: `src/git/branches.ts` → `tests/git/branches.test.ts`
- Use `Deno.test()` from Deno's built-in runner and `assertEquals` etc. from `@std/assert`
- Test names should read as sentences

## Development workflow

1. Run `deno task dev` to run from source
2. Write a test, see it fail
3. Write the code, see it pass
4. Commit when tests are green

## Code style

- TypeScript with strict mode
- Deno-style imports: explicit `.ts` extensions, `jsr:` specifiers
- Semicolons — used consistently throughout
- Functions are plain `async function name()` style, not arrow-assigned
- Keep it simple: no abstractions until they earn their place

## File structure

```
main.ts                # Entry point
deno.json              # Deno config
CHANGELOG.md           # Keep a Changelog format
src/
  version.ts           # VERSION constant
  commands/
    sweep.ts           # The sweep command
  git/
    repo.ts            # isGitRepo, getRepoRoot
    branches.ts        # analyzeBranches (pure logic)
  utils/
    errors.ts          # Typed error hierarchy
tests/
  helpers/
    git-test-repo.ts   # createTempGitRepo helper
  git/
    branches.test.ts
    repo.test.ts
scripts/
  install.ts
  release.ts
dist/                  # Built binaries (gitignored)
```
