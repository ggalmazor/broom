import { assert, assertEquals } from '@std/assert';
import { createTempGitRepo } from '../helpers/git-test-repo.ts';
import { getRepoRoot, isGitRepo } from '../../src/git/repo.ts';

Deno.test('isGitRepo returns true inside a git repository', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);
    const result = await isGitRepo();
    assertEquals(result, true);
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('isGitRepo returns false outside a git repository', async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: 'broom-no-git-' });
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(tmpDir);
    const result = await isGitRepo();
    assertEquals(result, false);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test('getRepoRoot returns the repository root path', async () => {
  const repo = await createTempGitRepo();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(repo.path);
    const root = await getRepoRoot();
    // The root should be the temp repo path (may differ by symlink resolution)
    assert(root.length > 0);
    assert(root.endsWith(repo.path.split('/').pop()!));
  } finally {
    Deno.chdir(originalCwd);
    await repo.cleanup();
  }
});

Deno.test('getRepoRoot throws outside a git repository', async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: 'broom-no-git-' });
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(tmpDir);
    let threw = false;
    try {
      await getRepoRoot();
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});
