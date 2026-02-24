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

/**
 * The classification of a local branch relative to `main`.
 *
 * - `merged`       — All commits on this branch are already in `main` (via merge commit,
 *                    squash merge, or rebase). Safe to delete.
 * - `unpushed`     — The branch has local commits that have not been pushed to origin.
 * - `needs-rebase` — The branch has diverged from `main` (i.e. main has commits the branch
 *                    doesn't, and the branch has commits main doesn't). Rebasing is recommended.
 * - `active`       — The branch has commits not in main and is up-to-date with origin.
 *                    Considered actively in progress.
 */
export type BranchStatus = 'merged' | 'unpushed' | 'needs-rebase' | 'active';

export interface BranchInfo {
  name: string;
  status: BranchStatus;
}

async function git(args: string[], cwd?: string): Promise<{ success: boolean; stdout: string }> {
  const cmd = new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
    ...(cwd ? { cwd } : {}),
  });
  const output = await cmd.output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout).trim(),
  };
}

/**
 * Returns the list of local branch names, excluding `main`.
 */
async function getLocalBranches(): Promise<string[]> {
  const { stdout } = await git(['branch', '--list', '--format=%(refname:short)']);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== 'main');
}

/**
 * Returns true if `origin` remote exists.
 */
export async function hasOriginRemote(): Promise<boolean> {
  const { stdout } = await git(['remote']);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .includes('origin');
}

/**
 * Collect patch-ids (sha + patch-id pairs) for commits reachable from `ref` but not from `main`.
 * The patch-id is a hash of the diff, making it identical across rebase/squash.
 */
async function getPatchIds(ref: string): Promise<Map<string, string>> {
  // git log produces commit SHAs; git patch-id reads diff-trees from stdin
  const logResult = await git(['log', '--format=%H', `main..${ref}`]);
  if (!logResult.stdout) {
    return new Map();
  }
  const shas = logResult.stdout.split('\n').filter((s) => s.length > 0);

  const patchIds = new Map<string, string>(); // sha → patch-id

  for (const sha of shas) {
    // Get the diff for this single commit
    const diffResult = await git(['diff-tree', '--stdin', '-p', sha]);
    if (!diffResult.stdout) continue;

    // Feed the diff through git patch-id
    const patchIdCmd = new Deno.Command('git', {
      args: ['patch-id', '--stable'],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'null',
    });
    const patchIdProc = patchIdCmd.spawn();
    const writer = patchIdProc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(diffResult.stdout + '\n'));
    await writer.close();
    const patchIdOutput = await patchIdProc.output();
    const line = new TextDecoder().decode(patchIdOutput.stdout).trim();
    if (line) {
      const [pid] = line.split(' ');
      patchIds.set(sha, pid);
    }
  }

  return patchIds;
}

/**
 * Returns the set of patch-ids already in `main`.
 */
async function getMainPatchIds(): Promise<Set<string>> {
  // Get all commits reachable from main
  const logResult = await git(['log', '--format=%H', 'main']);
  if (!logResult.stdout) return new Set();

  const shas = logResult.stdout.split('\n').filter((s) => s.length > 0);
  const set = new Set<string>();

  for (const sha of shas) {
    const diffResult = await git(['diff-tree', '--stdin', '-p', sha]);
    if (!diffResult.stdout) continue;

    const patchIdCmd = new Deno.Command('git', {
      args: ['patch-id', '--stable'],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'null',
    });
    const patchIdProc = patchIdCmd.spawn();
    const writer = patchIdProc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(diffResult.stdout + '\n'));
    await writer.close();
    const patchIdOutput = await patchIdProc.output();
    const line = new TextDecoder().decode(patchIdOutput.stdout).trim();
    if (line) {
      const [pid] = line.split(' ');
      set.add(pid);
    }
  }

  return set;
}

/**
 * Returns true if the branch is already merged into main via git's ancestry check.
 * This covers regular merge commits (fast-forward and recursive).
 */
async function isMergedByAncestry(branch: string): Promise<boolean> {
  const { success } = await git(['merge-base', '--is-ancestor', branch, 'main']);
  return success;
}

/**
 * Returns true if all commits on `branch` (not in main) have their diff already in main,
 * which detects squash merges and rebases.
 */
async function isMergedByPatchId(
  branch: string,
  mainPatchIds: Set<string>,
): Promise<boolean> {
  const branchPatchIds = await getPatchIds(branch);
  if (branchPatchIds.size === 0) {
    // No unique commits — already merged by ancestry
    return true;
  }
  for (const pid of branchPatchIds.values()) {
    if (!mainPatchIds.has(pid)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if the branch has commits not pushed to origin (i.e. no remote tracking branch
 * or local commits ahead of origin).
 */
async function hasUnpushedCommits(branch: string): Promise<boolean> {
  // Check if there's a remote tracking branch
  const trackingResult = await git([
    'rev-parse',
    '--verify',
    `origin/${branch}`,
  ]);
  if (!trackingResult.success) {
    // No remote tracking branch at all — branch is purely local
    // But we only call this when the branch is NOT merged, so this means it has local commits
    return true;
  }

  // Count commits ahead of origin
  const aheadResult = await git(['rev-list', '--count', `origin/${branch}..${branch}`]);
  const ahead = parseInt(aheadResult.stdout, 10);
  return ahead > 0;
}

/**
 * Returns true if `main` has commits that are not in `branch` (i.e. branch needs rebasing).
 */
async function needsRebase(branch: string): Promise<boolean> {
  const result = await git(['rev-list', '--count', `${branch}..main`]);
  const count = parseInt(result.stdout, 10);
  return count > 0;
}

/**
 * Analyze all local branches (excluding `main`) and classify each one.
 *
 * Prerequisites: caller must ensure `git fetch origin` has been run before calling this.
 *
 * Classification order (first match wins):
 * 1. `merged`       — branch tip is ancestor of main, OR all unique diffs are in main
 * 2. `unpushed`     — branch has commits not pushed to origin
 * 3. `needs-rebase` — main has commits not in branch
 * 4. `active`       — branch is up to date and has unique commits
 */
export async function analyzeBranches(): Promise<BranchInfo[]> {
  const branches = await getLocalBranches();
  if (branches.length === 0) {
    return [];
  }

  // Pre-compute main patch-ids once for efficiency
  const mainPatchIds = await getMainPatchIds();

  const results: BranchInfo[] = [];

  for (const branch of branches) {
    let status: BranchStatus;

    // 1. Merged check (ancestry first — fast path)
    if (await isMergedByAncestry(branch)) {
      status = 'merged';
    } else if (await isMergedByPatchId(branch, mainPatchIds)) {
      status = 'merged';
    } else if (await hasUnpushedCommits(branch)) {
      // 2. Unpushed
      status = 'unpushed';
    } else if (await needsRebase(branch)) {
      // 3. Needs rebase
      status = 'needs-rebase';
    } else {
      // 4. Active (has commits not in main, is up-to-date with origin)
      status = 'active';
    }

    results.push({ name: branch, status });
  }

  return results;
}
