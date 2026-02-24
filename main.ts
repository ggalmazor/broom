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

import { Command } from '@cliffy/command';
import { sweepCommand } from './src/commands/sweep.ts';
import { VERSION } from './src/version.ts';

async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    Deno.exit(1);
  }
}

const program = new Command()
  .name('broom')
  .version(VERSION)
  .description('Git branch housekeeping — sweep away stale local branches')
  .action(function () {
    this.showHelp();
  })
  .command('sweep', 'Fetch origin, analyze branches, and interactively delete stale ones')
  .action(() => runCommand(sweepCommand));

await program.parse(Deno.args);
