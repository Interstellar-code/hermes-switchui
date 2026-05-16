// @archon/paths stub — Switch UI local replacement.
// No runtime dependency on @archon/* packages.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

const HERMES_HOME = join(homedir(), ".hermes");
const SWITCHUI_HOME = join(HERMES_HOME, "switchui");

// ─── Logger ────────────────────────────────────────────────────────────────

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export function createLogger(ns: string): Logger {
  return {
    info: (...args: unknown[]) => console.log(`[${ns}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${ns}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${ns}]`, ...args),
    debug: (...args: unknown[]) => {
      if (process.env.DEBUG_WORKFLOW) console.debug(`[${ns}]`, ...args);
    },
  };
}

// ─── Build-time constants ───────────────────────────────────────────────────

export const BUNDLED_IS_BINARY: boolean = false;
export const BUNDLED_VERSION: string = "0.0.0-switchui";

// ─── Analytics stub ─────────────────────────────────────────────────────────

/** No-op analytics capture — Switch UI does not report to Archon telemetry. */
export function captureWorkflowInvoked(_props: Record<string, unknown>): void {
  // intentional no-op
}

// ─── Home directories ───────────────────────────────────────────────────────

export function getArchonHome(): string {
  mkdirSync(SWITCHUI_HOME, { recursive: true });
  return SWITCHUI_HOME;
}

export function getHomeScriptsPath(): string {
  const p = join(SWITCHUI_HOME, "scripts");
  mkdirSync(p, { recursive: true });
  return p;
}

export function getHomeCommandsPath(): string {
  const p = join(SWITCHUI_HOME, "commands");
  mkdirSync(p, { recursive: true });
  return p;
}

export function getHomeWorkflowsPath(): string {
  const p = join(SWITCHUI_HOME, "workflows");
  mkdirSync(p, { recursive: true });
  return p;
}

export function getLegacyHomeWorkflowsPath(): string {
  // Legacy location used by Archon before the switchui rename; kept for migration path.
  return join(HERMES_HOME, ".archon", "workflows");
}

// ─── App-bundled defaults ────────────────────────────────────────────────────

export function getDefaultWorkflowsPath(): string {
  return join(SWITCHUI_HOME, "bundled", "workflows");
}

export function getDefaultCommandsPath(): string {
  return join(SWITCHUI_HOME, "bundled", "commands");
}

// ─── Project path helpers ────────────────────────────────────────────────────

export function getRunArtifactsPath(
  owner: string,
  repo: string,
  runId: string
): string {
  return join(SWITCHUI_HOME, "runs", owner, repo, runId, "artifacts");
}

export function getProjectLogsPath(owner: string, repo: string): string {
  return join(SWITCHUI_HOME, "runs", owner, repo, "logs");
}

// ─── Search path helpers ─────────────────────────────────────────────────────

export function getWorkflowFolderSearchPaths(): string[] {
  return [getHomeWorkflowsPath()];
}

export function getCommandFolderSearchPaths(
  configuredFolder?: string
): string[] {
  const paths: string[] = [getHomeCommandsPath()];
  if (configuredFolder) paths.unshift(configuredFolder);
  return paths;
}

// ─── File discovery ───────────────────────────────────────────────────────────

export interface FindMarkdownOptions {
  maxDepth?: number;
}

export interface MarkdownEntry {
  path: string;
  relativePath: string;
  /** Command name derived from filename (without .md extension), matching Archon's convention. */
  commandName: string;
}

export async function findMarkdownFilesRecursive(
  dir: string,
  prefix: string,
  options: FindMarkdownOptions = {}
): Promise<MarkdownEntry[]> {
  const { maxDepth = Infinity } = options;
  const results: MarkdownEntry[] = [];

  async function walk(current: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const fullPath = join(current, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        await walk(fullPath, relPath, depth + 1);
      } else if (entry.isFile() && name.endsWith(".md")) {
        const commandName = name.slice(0, -3); // strip .md
        results.push({ path: fullPath, relativePath: prefix ? `${prefix}/${relPath}` : relPath, commandName });
      }
    }
  }

  await walk(dir, "", 0);
  return results;
}

// ─── Repo identity ────────────────────────────────────────────────────────────

export interface OwnerRepo {
  owner: string;
  repo: string;
}

/** Parse "owner/repo" or bare "repo" strings. Returns { owner: "", repo } for bare names. */
export function parseOwnerRepo(name: string): OwnerRepo {
  const parts = name.split("/");
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts.slice(1).join("/") };
  }
  return { owner: "", repo: name };
}
