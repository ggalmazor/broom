import { join } from 'jsr:@std/path@^1.0.0';

export interface GitTestRepo {
  path: string;
  cleanup: () => Promise<void>;
  /** Create a branch pointing at the current HEAD of `main`. */
  createBranch: (name: string) => Promise<void>;
  /** Stage and commit a file on the currently checked-out branch. */
  commitFile: (filename: string, content: string, message: string) => Promise<void>;
  /** Switch to a branch (must already exist). */
  checkout: (branch: string) => Promise<void>;
  /** Merge `branch` into the current branch using a merge commit. */
  mergeBranch: (branch: string) => Promise<void>;
  /** Merge `branch` into main using squash (squash then commit). */
  squashMerge: (branch: string, message: string) => Promise<void>;
  /** Rebase `branch` onto main (fast-forward main afterwards). */
  rebaseBranch: (branch: string) => Promise<void>;
  /** Add a remote pointing at `url`. */
  addRemote: (name: string, url: string) => Promise<void>;
  /** Simulate an origin by bare-cloning this repo and adding it as a remote. */
  setupOrigin: () => Promise<{ originPath: string }>;
  /** Push the given branch to origin. */
  push: (branch: string) => Promise<void>;
  /**
   * Advance the remote branch by committing directly into a secondary clone of
   * origin (simulating a collaborator pushing). Then fetch in local so tracking
   * info reflects `[behind N]` without pulling.
   */
  advanceRemote: (
    branch: string,
    filename: string,
    content: string,
    message: string,
  ) => Promise<void>;
}

async function run(
  args: string[],
  cwd: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  });
  const output = await cmd.output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

export async function createTempGitRepo(): Promise<GitTestRepo> {
  const path = await Deno.makeTempDir({ prefix: 'broom-test-' });

  // Initialize with main as default branch
  await run(['git', 'init', '-b', 'main'], path);
  await run(['git', 'config', 'user.email', 'test@example.com'], path);
  await run(['git', 'config', 'user.name', 'Test User'], path);

  // Initial commit so main exists
  await Deno.writeTextFile(join(path, 'README.md'), '# Test Repo\n');
  await run(['git', 'add', '.'], path);
  await run(['git', 'commit', '-m', 'Initial commit'], path);

  const repo: GitTestRepo = {
    path,

    async cleanup() {
      try {
        await Deno.remove(path, { recursive: true });
      } catch {
        // Ignore errors during cleanup
      }
    },

    async createBranch(name: string) {
      await run(['git', 'branch', name], path);
    },

    async commitFile(filename: string, content: string, message: string) {
      await Deno.writeTextFile(join(path, filename), content);
      await run(['git', 'add', filename], path);
      await run(['git', 'commit', '-m', message], path);
    },

    async checkout(branch: string) {
      await run(['git', 'checkout', branch], path);
    },

    async mergeBranch(branch: string) {
      await run(['git', 'merge', '--no-ff', branch, '-m', `Merge branch '${branch}'`], path);
    },

    async squashMerge(branch: string, message: string) {
      await run(['git', 'merge', '--squash', branch], path);
      await run(['git', 'commit', '-m', message], path);
    },

    async rebaseBranch(branch: string) {
      // Rebase the branch onto main, then fast-forward main
      const result = await run(['git', 'rebase', 'main', branch], path);
      if (!result.success) {
        throw new Error(`Rebase failed: ${result.stderr}`);
      }
      await run(['git', 'checkout', 'main'], path);
      await run(['git', 'merge', '--ff-only', branch], path);
      await run(['git', 'checkout', 'main'], path);
    },

    async addRemote(name: string, url: string) {
      await run(['git', 'remote', 'add', name, url], path);
    },

    async setupOrigin() {
      const originPath = await Deno.makeTempDir({ prefix: 'broom-origin-' });
      // Create a bare clone to act as origin
      await run(['git', 'clone', '--bare', path, originPath], path);
      // Remove any existing origin
      await run(['git', 'remote', 'remove', 'origin'], path);
      await run(['git', 'remote', 'add', 'origin', originPath], path);
      // Set upstream for main
      await run(['git', 'fetch', 'origin'], path);
      await run(['git', 'branch', '--set-upstream-to=origin/main', 'main'], path);
      return { originPath };
    },

    async push(branch: string) {
      await run(['git', 'push', '--set-upstream', 'origin', branch], path);
    },

    async advanceRemote(branch: string, filename: string, content: string, message: string) {
      // Clone origin into a temp dir, commit there, push back, then fetch locally
      const tmpClone = await Deno.makeTempDir({ prefix: 'broom-clone-' });
      try {
        // Get the origin path from our remote config
        const { stdout: originUrl } = await run(['git', 'remote', 'get-url', 'origin'], path);
        await run(['git', 'clone', originUrl, tmpClone], tmpClone);
        await run(['git', 'config', 'user.email', 'collaborator@example.com'], tmpClone);
        await run(['git', 'config', 'user.name', 'Collaborator'], tmpClone);
        await run(['git', 'checkout', branch], tmpClone);
        await Deno.writeTextFile(join(tmpClone, filename), content);
        await run(['git', 'add', filename], tmpClone);
        await run(['git', 'commit', '-m', message], tmpClone);
        await run(['git', 'push', 'origin', branch], tmpClone);
        // Fetch locally so origin/<branch> tracking ref is updated
        await run(['git', 'fetch', 'origin'], path);
      } finally {
        await Deno.remove(tmpClone, { recursive: true }).catch(() => {});
      }
    },
  };

  return repo;
}
