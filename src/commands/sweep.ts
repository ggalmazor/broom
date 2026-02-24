/**
 * broom - Git Branch Housekeeping Tool
 * Copyright (C) 2026 Guillermo G. Almazor <guille@ggalmazor.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Checkbox, Confirm } from '@cliffy/prompt';
import {
  analyzeBranches,
  AnalyzeProgress,
  BranchInfo,
  BranchStatus,
  fastForwardBranches,
  getLocalBranches,
  getWorktrees,
  hasOriginRemote,
  WorktreeInfo,
} from '../git/branches.ts';
import { isGitRepo } from '../git/repo.ts';
import {
  DeleteBranchError,
  FetchFailedError,
  NoOriginRemoteError,
  NotInGitRepoError,
} from '../utils/errors.ts';

const STATUS_LABEL: Record<BranchStatus, string> = {
  merged: 'merged',
  unpushed: 'unpushed commits',
  'needs-rebase': 'needs rebase',
  active: 'active',
};

/** ANSI color helpers — keep it dependency-free. */
function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}
function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}
function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}
function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[0m`;
}

function colorStatus(status: BranchStatus): string {
  switch (status) {
    case 'merged':
      return dim(STATUS_LABEL[status]);
    case 'unpushed':
      return yellow(STATUS_LABEL[status]);
    case 'needs-rebase':
      return red(STATUS_LABEL[status]);
    case 'active':
      return cyan(STATUS_LABEL[status]);
  }
}

function formatOption(branch: BranchInfo, worktree?: WorktreeInfo): string {
  const label = colorStatus(branch.status);
  const wtSuffix = worktree ? `  ${dim('[worktree]')}` : '';
  return `${branch.name.padEnd(40)} ${label}${wtSuffix}`;
}

/** True when stdout is an interactive terminal (progress rewriting is safe). */
function isTTY(): boolean {
  return Deno.stdout.isTerminal();
}

/**
 * Render a single progress line.
 * On a TTY the line is rewritten in place; otherwise a new line is printed.
 * Branches are analyzed in parallel so arrival order is non-deterministic —
 * the line shows the most recently completed branch name.
 */
function renderProgress(p: AnalyzeProgress): void {
  const pct = Math.round((p.current / p.total) * 100);
  const bar = `[${p.current}/${p.total}]`;
  const line = `  Analyzing ${bar} ${pct}%  ${dim(p.branch)}`;
  if (isTTY()) {
    Deno.stdout.writeSync(new TextEncoder().encode(`\r${line}`));
  } else {
    console.log(line);
  }
}

/** Clear the progress line from the terminal. */
function clearProgress(): void {
  if (isTTY()) {
    Deno.stdout.writeSync(new TextEncoder().encode('\r\x1b[K'));
  }
}

/**
 * Erase the Cliffy "success" summary line that is printed after a prompt
 * resolves. Cliffy writes `prefix + message + " › " + format(value) + "\n"`,
 * then the cursor sits at the start of the next line. We move up one row and
 * clear from the cursor to end-of-screen so callers can print their own
 * follow-up without the noisy comma-joined selection list.
 */
function eraseLastLine(): void {
  if (isTTY()) {
    Deno.stdout.writeSync(new TextEncoder().encode('\x1b[1A\x1b[0J'));
  }
}

async function fetchOrigin(): Promise<void> {
  const cmd = new Deno.Command('git', {
    args: ['fetch', 'origin', '--prune'],
    stdout: 'null',
    stderr: 'piped',
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new FetchFailedError(stderr);
  }
}

async function removeWorktree(worktreePath: string): Promise<void> {
  const cmd = new Deno.Command('git', {
    args: ['worktree', 'remove', '--force', worktreePath],
    stdout: 'null',
    stderr: 'piped',
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`Failed to remove worktree at ${worktreePath}: ${stderr}`);
  }
}

/**
 * Delete a local branch. If it is checked out in a linked worktree,
 * remove the worktree first via `git worktree remove --force`, then
 * delete the branch ref.
 */
async function deleteBranch(branch: string, worktree?: WorktreeInfo): Promise<void> {
  if (worktree) {
    await removeWorktree(worktree.path);
  }
  const cmd = new Deno.Command('git', {
    args: ['branch', '-D', branch],
    stdout: 'null',
    stderr: 'piped',
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new DeleteBranchError(branch, stderr);
  }
}

/**
 * Non-interactive sweep: given a list of branch names, delete them.
 * Used for testing and scripting.
 */
export async function sweepBranchesNonInteractive(branches: string[]): Promise<void> {
  if (!(await isGitRepo())) {
    throw new NotInGitRepoError();
  }

  for (const branch of branches) {
    await deleteBranch(branch);
    console.log(green(`  deleted  ${branch}`));
  }
}

/**
 * The interactive `sweep` command.
 *
 * 1. Verifies we're in a git repo with an origin remote.
 * 2. Fetches from origin.
 * 3. Analyzes all local branches (with optional progress output).
 * 4. Shows a multi-select list pre-selecting merged branches.
 * 5. Asks for confirmation, then deletes.
 */
export async function sweepCommand(
  opts: { progress: boolean } = { progress: true },
): Promise<void> {
  if (!(await isGitRepo())) {
    throw new NotInGitRepoError();
  }

  if (!(await hasOriginRemote())) {
    throw new NoOriginRemoteError();
  }

  console.log('Fetching from origin...');
  await fetchOrigin();

  console.log('Fast-forwarding local branches...');
  const ffResults = await fastForwardBranches();
  const ffUpdated = ffResults.filter((r) => r.updated);
  const ffFailed = ffResults.filter((r) => !r.updated);
  if (ffUpdated.length > 0) {
    for (const r of ffUpdated) {
      console.log(green(`  updated  ${r.branch}`));
    }
  }
  if (ffFailed.length > 0) {
    for (const r of ffFailed) {
      console.error(red(`  failed   ${r.branch}: ${r.error}`));
    }
  }
  if (ffResults.length === 0) {
    console.log(dim('  nothing to update'));
  }

  const localBranches = await getLocalBranches();
  if (localBranches.length === 0) {
    console.log('No local branches found (besides main). Nothing to sweep.');
    return;
  }
  console.log(
    `Found ${localBranches.length} local branch${
      localBranches.length === 1 ? '' : 'es'
    }. Analyzing...`,
  );

  // Collect worktree info once — used for display and deletion
  const worktrees = await getWorktrees();

  const onProgress = opts.progress ? renderProgress : undefined;
  const branches = await analyzeBranches(onProgress);
  if (opts.progress) clearProgress();

  const mergedCount = branches.filter((b) => b.status === 'merged').length;
  const unpushedCount = branches.filter((b) => b.status === 'unpushed').length;
  const needsRebaseCount = branches.filter((b) => b.status === 'needs-rebase').length;
  const activeCount = branches.filter((b) => b.status === 'active').length;
  const worktreeCount = worktrees.size;

  const summary = [
    mergedCount > 0 ? dim(`${mergedCount} merged`) : '',
    unpushedCount > 0 ? yellow(`${unpushedCount} unpushed`) : '',
    needsRebaseCount > 0 ? red(`${needsRebaseCount} needs rebase`) : '',
    activeCount > 0 ? cyan(`${activeCount} active`) : '',
    worktreeCount > 0 ? dim(`${worktreeCount} in worktree`) : '',
  ]
    .filter(Boolean)
    .join(', ');
  console.log(`Done. ${summary}\n`);

  const checkboxOptions = branches.map((b) => {
    const wt = worktrees.get(b.name);
    return {
      name: formatOption(b, wt),
      value: b.name,
      checked: b.status === 'merged',
    };
  });

  const selected: string[] = await Checkbox.prompt({
    message: 'Select branches to delete (Space to toggle, Enter to confirm):',
    options: checkboxOptions,
    search: true,
  });
  eraseLastLine();

  if (selected.length === 0) {
    console.log('\nNo branches selected. Nothing deleted.');
    return;
  }

  // Warn if any selected branches have associated worktrees
  const selectedWithWorktrees = selected.filter((b) => worktrees.has(b));
  if (selectedWithWorktrees.length > 0) {
    console.log(
      `\n${yellow('Warning:')} ${selectedWithWorktrees.length} selected branch${
        selectedWithWorktrees.length === 1 ? '' : 'es'
      } ${selectedWithWorktrees.length === 1 ? 'is' : 'are'} checked out in a worktree:`,
    );
    for (const b of selectedWithWorktrees) {
      console.log(`  ${b}  ${dim(worktrees.get(b)!.path)}`);
    }
    console.log(dim('  The worktree will be removed along with the branch.\n'));
  } else {
    console.log('');
  }

  const confirmed = await Confirm.prompt({
    message: `Delete ${selected.length} branch${selected.length === 1 ? '' : 'es'}?`,
    default: false,
  });
  eraseLastLine();

  if (!confirmed) {
    console.log('\nCancelled. Nothing deleted.');
    return;
  }

  console.log('');
  let failed = 0;
  for (const branch of selected) {
    const wt = worktrees.get(branch);
    try {
      await deleteBranch(branch, wt);
      const note = wt ? dim(` (worktree at ${wt.path} removed)`) : '';
      console.log(green(`  deleted  ${branch}`) + note);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  failed   ${branch}: ${msg}`));
      failed++;
    }
  }

  const deleted = selected.length - failed;
  console.log(
    `\n${green(`${deleted} branch${deleted === 1 ? '' : 'es'} deleted`)}` +
      (failed > 0 ? red(`, ${failed} failed`) : '') +
      '.',
  );
}
