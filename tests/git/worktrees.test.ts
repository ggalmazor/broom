import { assert, assertEquals } from '@std/assert';
import { createTempGitRepo } from '../helpers/git-test-repo.ts';
import { getWorktrees } from '../../src/git/branches.ts';

Deno.test('getWorktrees returns empty map when no linked worktrees exist', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    const worktrees = await getWorktrees();

    assertEquals(worktrees.size, 0);
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('getWorktrees returns linked worktrees keyed by branch name', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();
  const wtPath = await Deno.makeTempDir({ prefix: 'broom-wt-' });

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature');
    await repo.createWorktree('feature', wtPath);

    const worktrees = await getWorktrees();

    assertEquals(worktrees.size, 1);
    assert(worktrees.has('feature'));
    assertEquals(worktrees.get('feature')!.branch, 'feature');
    // git resolves symlinks in worktree paths (macOS /var → /private/var)
    assertEquals(worktrees.get('feature')!.path, await Deno.realPath(wtPath));
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
    await Deno.remove(wtPath, { recursive: true }).catch(() => {});
  }
});

Deno.test('getWorktrees does not include the main worktree', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);

    const worktrees = await getWorktrees();

    // main worktree (repo.path / main branch) must not appear
    assert(!worktrees.has('main'));
    assertEquals(worktrees.size, 0);
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('getWorktrees returns all linked worktrees when multiple exist', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();
  const wtA = await Deno.makeTempDir({ prefix: 'broom-wt-a-' });
  const wtB = await Deno.makeTempDir({ prefix: 'broom-wt-b-' });

  try {
    Deno.chdir(repo.path);

    await repo.createBranch('feature-a');
    await repo.createWorktree('feature-a', wtA);

    await repo.createBranch('feature-b');
    await repo.createWorktree('feature-b', wtB);

    const worktrees = await getWorktrees();

    assertEquals(worktrees.size, 2);
    assert(worktrees.has('feature-a'));
    assert(worktrees.has('feature-b'));
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
    await Deno.remove(wtA, { recursive: true }).catch(() => {});
    await Deno.remove(wtB, { recursive: true }).catch(() => {});
  }
});

Deno.test('fastForwardBranches skips a branch checked out in a linked worktree', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();
  const wtPath = await Deno.makeTempDir({ prefix: 'broom-wt-' });

  try {
    const { originPath } = await repo.setupOrigin();

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'v1\n', 'Initial feature commit');
    await repo.push('feature');
    await repo.checkout('main');

    // Check feature out in a worktree
    await repo.createWorktree('feature', wtPath);

    // Advance origin/feature so it would normally be fast-forwarded
    await repo.advanceRemote('feature', 'feature.txt', 'v2\n', 'Remote advance');

    Deno.chdir(repo.path);

    const { fastForwardBranches } = await import('../../src/git/branches.ts');
    const results = await fastForwardBranches();

    // feature is in a worktree — must be skipped
    assertEquals(results.filter((r) => r.branch === 'feature').length, 0);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
    await Deno.remove(wtPath, { recursive: true }).catch(() => {});
  }
});
