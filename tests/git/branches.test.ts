import { assertEquals } from '@std/assert';
import { createTempGitRepo } from '../helpers/git-test-repo.ts';
import { analyzeBranches, AnalyzeProgress } from '../../src/git/branches.ts';

Deno.test('analyzeBranches returns empty array when no branches besides main', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);
    const result = await analyzeBranches();
    assertEquals(result, []);
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a branch merged via merge commit', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.checkout('main');
    await repo.mergeBranch('feature');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'merged');
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a branch merged via squash merge', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.checkout('main');
    await repo.squashMerge('feature', 'Squash merge feature branch');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'merged');
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a multi-commit branch merged via squash merge', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature-a.txt', 'feature a content\n', 'Add feature part A');
    await repo.commitFile('feature-b.txt', 'feature b content\n', 'Add feature part B');
    await repo.checkout('main');
    await repo.squashMerge('feature', 'Squash merge feature branch');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'merged');
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a branch merged via rebase', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.checkout('main');
    // Advance main so rebase is non-trivial
    await repo.commitFile('other.txt', 'other content\n', 'Other change on main');
    await repo.rebaseBranch('feature');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'merged');
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a branch with unpushed commits', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    Deno.chdir(repo.path);

    // Create a branch with a commit but do NOT push it
    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.checkout('main');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'unpushed');

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches detects a branch that needs rebasing', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    Deno.chdir(repo.path);

    // Create and push feature branch
    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.push('feature');
    await repo.checkout('main');

    // Advance main so feature is behind
    await repo.commitFile('main2.txt', 'main update\n', 'Advance main');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'needs-rebase');

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches classifies an active branch (pushed, ahead of main)', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    Deno.chdir(repo.path);

    // Create, commit, and push feature — main does NOT advance
    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'feature content\n', 'Add feature');
    await repo.push('feature');
    await repo.checkout('main');

    const result = await analyzeBranches();
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'feature');
    assertEquals(result[0].status, 'active');

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches handles multiple branches with mixed statuses', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    Deno.chdir(repo.path);

    // merged: merge-commit branch
    await repo.createBranch('merged-branch');
    await repo.checkout('merged-branch');
    await repo.commitFile('merged.txt', 'merged\n', 'Merged commit');
    await repo.checkout('main');
    await repo.mergeBranch('merged-branch');

    // unpushed: local-only branch
    await repo.createBranch('unpushed-branch');
    await repo.checkout('unpushed-branch');
    await repo.commitFile('unpushed.txt', 'unpushed\n', 'Unpushed commit');
    await repo.checkout('main');

    // active: pushed branch, main hasn't moved ahead of it
    await repo.createBranch('active-branch');
    await repo.checkout('active-branch');
    await repo.commitFile('active.txt', 'active\n', 'Active commit');
    await repo.push('active-branch');
    await repo.checkout('main');

    const result = await analyzeBranches();
    const byName = Object.fromEntries(result.map((b) => [b.name, b.status]));

    assertEquals(byName['merged-branch'], 'merged');
    assertEquals(byName['unpushed-branch'], 'unpushed');
    assertEquals(byName['active-branch'], 'active');

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches invokes onProgress callback for each branch', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('branch-a');
    await repo.checkout('branch-a');
    await repo.commitFile('a.txt', 'a\n', 'Commit on branch-a');
    await repo.checkout('main');

    await repo.createBranch('branch-b');
    await repo.checkout('branch-b');
    await repo.commitFile('b.txt', 'b\n', 'Commit on branch-b');
    await repo.checkout('main');

    const events: AnalyzeProgress[] = [];
    await analyzeBranches((p) => events.push(p));

    assertEquals(events.length, 2);
    assertEquals(events[0].current, 1);
    assertEquals(events[0].total, 2);
    assertEquals(events[1].current, 2);
    assertEquals(events[1].total, 2);
    // branch names must match what was analyzed
    assertEquals(new Set(events.map((e) => e.branch)), new Set(['branch-a', 'branch-b']));
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('analyzeBranches works without onProgress callback', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('f.txt', 'f\n', 'Commit on feature');
    await repo.checkout('main');

    // Should not throw when no callback provided
    const result = await analyzeBranches();
    assertEquals(result.length, 1);
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});
