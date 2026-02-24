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

export interface AnalyzeProgress {
  branch: string;
  current: number;
  total: number;
}

export type ProgressCallback = (progress: AnalyzeProgress) => void;

async function git(args: string[]): Promise<{ success: boolean; stdout: string }> {
  const cmd = new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
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
export async function getLocalBranches(): Promise<string[]> {
  const { stdout } = await git(['branch', '--list', '--format=%(refname:short)']);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== 'main');
}

export interface FastForwardResult {
  branch: string;
  updated: boolean;
  error?: string;
}

/**
 * For every local branch that has a live upstream tracking ref and is strictly
 * behind it (no local-only commits), fast-forward the local ref without
 * requiring a checkout. Uses `git fetch origin <branch>:<branch>`.
 *
 * Branches that are ahead, diverged, or have no upstream are skipped silently.
 * The currently checked-out branch is also skipped (git refuses to fast-forward it
 * this way; the user can `git pull` that themselves).
 *
 * Returns one result per branch that was attempted.
 */
export async function fastForwardBranches(): Promise<FastForwardResult[]> {
  // Get all local branches with their upstream tracking status in one shot
  const { stdout } = await git([
    'branch',
    '--list',
    '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(HEAD)',
  ]);

  const results: FastForwardResult[] = [];

  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    const branch = parts[0];
    const upstream = parts[1] ?? '';
    const track = parts[2] ?? '';
    const head = parts[3] ?? '';

    // Skip currently checked-out branch (git fetch <ref>:<ref> fails on HEAD)
    if (head === '*') continue;

    // Skip branches with no upstream or whose remote was pruned
    if (!upstream || track === '[gone]') continue;

    // Only fast-forward if strictly behind (no local-only commits)
    // track looks like "[behind 3]" or "[ahead 1, behind 2]" or "[ahead 2]"
    const isBehind = track.includes('behind');
    const isAhead = track.includes('ahead');
    if (!isBehind || isAhead) continue;

    // Fast-forward without checkout: fetch the remote ref directly into local
    const upstreamBranch = upstream.replace(/^origin\//, '');
    const { success, stdout: errOut } = await git([
      'fetch',
      'origin',
      `${upstreamBranch}:${branch}`,
    ]);

    if (success) {
      results.push({ branch, updated: true });
    } else {
      results.push({ branch, updated: false, error: errOut });
    }
  }

  return results;
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
 * Returns true if the branch is already merged into main via git's ancestry check.
 * This covers regular merge commits (fast-forward and recursive). It is the fast
 * path: if the branch tip is an ancestor of main, no further analysis is needed.
 */
async function isMergedByAncestry(branch: string): Promise<boolean> {
  const { success } = await git(['merge-base', '--is-ancestor', branch, 'main']);
  return success;
}

/**
 * Returns true if all commits unique to `branch` (not in `main`) have an equivalent
 * patch already present in `main` — i.e. the branch was squash-merged or rebased.
 *
 * Uses `git log --left-right --cherry-mark main...branch`:
 *   `>` — commit is unique to branch (not in main)
 *   `=` — commit has an equivalent patch already in main
 *
 * If every branch-side commit is marked `=` (none are `>`), the branch is fully merged.
 * This is O(commits since the branch diverged), not O(all of main).
 */
async function isMergedByCherryMark(branch: string): Promise<boolean> {
  const { stdout } = await git([
    'log',
    '--left-right',
    '--cherry-mark',
    '--format=%m',
    `main...${branch}`,
  ]);
  if (!stdout) return true; // no commits on either side

  const lines = stdout.split('\n').filter((l) => l.length > 0);
  // Branch-side commits start with `>` (unique) or `=` (already in main)
  const branchSide = lines.filter((l) => l === '>' || l === '=');
  if (branchSide.length === 0) return true; // no branch-unique commits
  // Merged if every branch-side commit is equivalent (=), none are unique (>)
  return branchSide.every((l) => l === '=');
}

/**
 * Returns true if the branch has commits not pushed to origin (i.e. no remote tracking
 * branch, or local commits ahead of origin).
 */
async function hasUnpushedCommits(branch: string): Promise<boolean> {
  const trackingResult = await git(['rev-parse', '--verify', `origin/${branch}`]);
  if (!trackingResult.success) {
    // No remote tracking branch — branch is purely local with unmerged commits
    return true;
  }
  const aheadResult = await git(['rev-list', '--count', `origin/${branch}..${branch}`]);
  return parseInt(aheadResult.stdout, 10) > 0;
}

/**
 * Returns true if `main` has commits that are not in `branch` (branch needs rebasing).
 */
async function needsRebase(branch: string): Promise<boolean> {
  const result = await git(['rev-list', '--count', `${branch}..main`]);
  return parseInt(result.stdout, 10) > 0;
}

/**
 * Classify a single branch. Classification order (first match wins):
 * 1. `merged`       — branch tip is ancestor of main, OR all unique patches are in main
 * 2. `unpushed`     — branch has commits not pushed to origin
 * 3. `needs-rebase` — main has commits not in branch
 * 4. `active`       — branch is up to date with origin and has unique commits
 */
async function classifyBranch(branch: string): Promise<BranchStatus> {
  if (await isMergedByAncestry(branch)) return 'merged';
  if (await isMergedByCherryMark(branch)) return 'merged';
  if (await hasUnpushedCommits(branch)) return 'unpushed';
  if (await needsRebase(branch)) return 'needs-rebase';
  return 'active';
}

/**
 * Analyze all local branches (excluding `main`) and classify each one.
 *
 * Prerequisites: caller must ensure `git fetch origin` has been run before calling this.
 *
 * Branches are analyzed in parallel for speed. The onProgress callback (if provided)
 * is called after each branch completes — order may not match the original branch list.
 *
 * @param onProgress  Optional callback invoked after each branch is classified.
 */
export async function analyzeBranches(onProgress?: ProgressCallback): Promise<BranchInfo[]> {
  const branches = await getLocalBranches();
  if (branches.length === 0) return [];

  const total = branches.length;
  let current = 0;

  const results = await Promise.all(
    branches.map(async (branch) => {
      const status = await classifyBranch(branch);
      onProgress?.({ branch, current: ++current, total });
      return { name: branch, status };
    }),
  );

  // Restore original branch order (Promise.all preserves index order already,
  // but current counter may fire out of order — that's fine for progress display)
  return results;
}
