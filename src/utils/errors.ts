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

export class BroomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotInGitRepoError extends BroomError {
  constructor() {
    super('Not in a git repository');
  }
}

export class NoOriginRemoteError extends BroomError {
  constructor() {
    super("No 'origin' remote configured for this repository");
  }
}

export class FetchFailedError extends BroomError {
  constructor(output: string) {
    super(`Failed to fetch from origin: ${output}`);
  }
}

export class DeleteBranchError extends BroomError {
  constructor(branch: string, output: string) {
    super(`Failed to delete branch '${branch}': ${output}`);
  }
}
