#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { join } from 'jsr:@std/path@^1.0.0';
import { exists } from 'jsr:@std/fs@^1.0.0';

const HOME = Deno.env.get('HOME');
if (!HOME) {
  console.error('Error: HOME environment variable not set');
  Deno.exit(1);
}

const INSTALL_DIR = join(HOME, 'bin');
const PROJECT_ROOT = join(import.meta.dirname!, '..');
const BINARY_NAME = 'broom';
const SOURCE_BINARY = join(PROJECT_ROOT, BINARY_NAME);
const TARGET_BINARY = join(INSTALL_DIR, BINARY_NAME);

console.log('Compiling broom...');

const compileCmd = new Deno.Command('deno', {
  args: [
    'compile',
    '--allow-run',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--output',
    BINARY_NAME,
    'main.ts',
  ],
  cwd: PROJECT_ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});

const compileResult = await compileCmd.output();

if (!compileResult.success) {
  console.error('Compilation failed');
  Deno.exit(1);
}

console.log('Compilation successful');

console.log(`\nEnsuring ${INSTALL_DIR} exists...`);
await Deno.mkdir(INSTALL_DIR, { recursive: true });

if (!(await exists(SOURCE_BINARY))) {
  console.error(`Binary not found at: ${SOURCE_BINARY}`);
  Deno.exit(1);
}

console.log(`\nInstalling to ${TARGET_BINARY}...`);

try {
  if (await exists(TARGET_BINARY)) {
    await Deno.remove(TARGET_BINARY);
  }

  await Deno.copyFile(SOURCE_BINARY, TARGET_BINARY);
  await Deno.chmod(TARGET_BINARY, 0o755);
} catch (error) {
  const message = error instanceof Error ? error.message : error;
  console.error(`Installation failed: ${message}`);
  Deno.exit(1);
}

console.log(`\nInstallation complete!`);
console.log(`The 'broom' command is now available at: ${TARGET_BINARY}`);

const PATH = Deno.env.get('PATH') || '';
const pathDirs = PATH.split(':');

if (!pathDirs.includes(INSTALL_DIR)) {
  console.log('\nNote: ~/bin is not in your PATH.');
  console.log('Add this to your shell config (~/.zshrc, ~/.bashrc, etc.):');
  console.log(`\n  export PATH="$HOME/bin:$PATH"\n`);
  console.log('Then restart your shell or run: source ~/.zshrc');
} else {
  console.log('\nYou can now run: broom --help');
}
