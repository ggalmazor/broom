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
import { analyzeBranches, BranchInfo, BranchStatus } from '../git/branches.ts';
import { hasOriginRemote } from '../git/branches.ts';
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

function formatOption(branch: BranchInfo): string {
  const label = colorStatus(branch.status);
  return `${branch.name.padEnd(40)} ${label}`;
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

async function deleteBranch(branch: string): Promise<void> {
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
 * 3. Analyzes all local branches.
 * 4. Shows a multi-select list pre-selecting merged branches.
 * 5. Asks for confirmation, then deletes.
 */
export async function sweepCommand(): Promise<void> {
  if (!(await isGitRepo())) {
    throw new NotInGitRepoError();
  }

  if (!(await hasOriginRemote())) {
    throw new NoOriginRemoteError();
  }

  console.log('Fetching from origin...');
  await fetchOrigin();

  console.log('Analyzing branches...\n');
  const branches = await analyzeBranches();

  if (branches.length === 0) {
    console.log('No local branches found (besides main). Nothing to sweep.');
    return;
  }

  // Pre-select merged branches for deletion
  const defaultSelected = branches
    .filter((b) => b.status === 'merged')
    .map((b) => b.name);

  const options = branches.map((b) => ({
    name: formatOption(b),
    value: b.name,
    checked: b.status === 'merged',
  }));

  const selected: string[] = await Checkbox.prompt({
    message: 'Select branches to delete (Space to toggle, Enter to confirm):',
    options,
    search: true,
  });

  if (selected.length === 0) {
    console.log('\nNo branches selected. Nothing deleted.');
    return;
  }

  console.log(`\nBranches to delete (${selected.length}):`);
  for (const branch of selected) {
    console.log(`  ${branch}`);
  }

  const confirmed = await Confirm.prompt({
    message: `Delete ${selected.length} branch${selected.length === 1 ? '' : 'es'}?`,
    default: false,
  });

  if (!confirmed) {
    console.log('\nCancelled. Nothing deleted.');
    return;
  }

  console.log('');
  let failed = 0;
  for (const branch of selected) {
    try {
      await deleteBranch(branch);
      console.log(green(`  deleted  ${branch}`));
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

  // Suppress unused import warning — defaultSelected is referenced here
  void defaultSelected;
}
