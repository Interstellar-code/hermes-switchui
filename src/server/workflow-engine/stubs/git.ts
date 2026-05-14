// @archon/git stub — Switch UI local replacement.
// No runtime dependency on @archon/* packages.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

/** Switch UI does not manage worktrees; "main" is a safe default. */
export async function getDefaultBranch(_cwd: string): Promise<string> {
  return "main";
}

/** Identity — no worktree translation in Switch UI. */
export function toRepoPath(p: string): string {
  return p;
}
