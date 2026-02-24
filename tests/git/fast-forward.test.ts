import { assertEquals } from '@std/assert';
import { createTempGitRepo } from '../helpers/git-test-repo.ts';
import { fastForwardBranches } from '../../src/git/branches.ts';

Deno.test('fastForwardBranches updates a branch that is behind its remote', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    // Create, push, then advance the remote without pulling locally
    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'v1\n', 'Initial feature commit');
    await repo.push('feature');
    await repo.checkout('main');

    // Simulate a collaborator pushing a new commit to origin/feature
    await repo.advanceRemote('feature', 'feature.txt', 'v2\n', 'Collaborator commit on feature');

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();

    assertEquals(results.length, 1);
    assertEquals(results[0].branch, 'feature');
    assertEquals(results[0].updated, true);
    assertEquals(results[0].error, undefined);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('fastForwardBranches skips a branch that is ahead of its remote', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'v1\n', 'Initial feature commit');
    await repo.push('feature');

    // Add a local commit NOT pushed — branch is now ahead of origin
    await repo.commitFile('feature.txt', 'v2-local\n', 'Local-only commit');
    await repo.checkout('main');

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();

    // Should not attempt to fast-forward an ahead branch
    assertEquals(results.length, 0);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('fastForwardBranches skips a diverged branch', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    await repo.createBranch('feature');
    await repo.checkout('feature');
    await repo.commitFile('feature.txt', 'v1\n', 'Initial feature commit');
    await repo.push('feature');

    // Local commit (makes it ahead) + remote commit (makes it also behind) = diverged
    await repo.commitFile('local.txt', 'local\n', 'Local-only commit');
    await repo.advanceRemote('feature', 'remote.txt', 'remote\n', 'Remote commit');
    await repo.checkout('main');

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();

    assertEquals(results.length, 0);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('fastForwardBranches skips branches with no tracking remote', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    // Branch exists locally but was never pushed
    await repo.createBranch('local-only');
    await repo.checkout('local-only');
    await repo.commitFile('local.txt', 'local\n', 'Local commit');
    await repo.checkout('main');

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();

    assertEquals(results.length, 0);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('fastForwardBranches returns empty array when no branches besides main', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();

    assertEquals(results, []);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('fastForwardBranches updates multiple eligible branches independently', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    const { originPath } = await repo.setupOrigin();

    // feature-a: behind remote → should update
    await repo.createBranch('feature-a');
    await repo.checkout('feature-a');
    await repo.commitFile('a.txt', 'v1\n', 'feature-a initial');
    await repo.push('feature-a');
    await repo.advanceRemote('feature-a', 'a.txt', 'v2\n', 'feature-a remote advance');

    // feature-b: behind remote → should update
    await repo.createBranch('feature-b');
    await repo.checkout('feature-b');
    await repo.commitFile('b.txt', 'v1\n', 'feature-b initial');
    await repo.push('feature-b');
    await repo.advanceRemote('feature-b', 'b.txt', 'v2\n', 'feature-b remote advance');

    // feature-c: up to date → should not appear in results
    await repo.createBranch('feature-c');
    await repo.checkout('feature-c');
    await repo.commitFile('c.txt', 'v1\n', 'feature-c initial');
    await repo.push('feature-c');

    await repo.checkout('main');

    Deno.chdir(repo.path);

    const results = await fastForwardBranches();
    const updated = results.filter((r) => r.updated).map((r) => r.branch).sort();

    assertEquals(updated, ['feature-a', 'feature-b']);

    await Deno.remove(originPath, { recursive: true });
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});
