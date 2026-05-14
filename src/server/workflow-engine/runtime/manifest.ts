/**
 * A.10 — Hermes manifest writer.
 *
 * Writes ~/.hermes/switchui-workflows.json on engine boot so the Hermes Agent
 * chat layer can discover available Switch UI workflows and route "launch
 * workflow X" requests without knowing anything about workflow_runs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseWorkflow } from '../discovery/loader';
import { isLoopNode, isApprovalNode } from '../schemas';
import type { SwitchUiWorkflowStore } from '../store/workflow-store';

export interface ManifestEntry {
  id: string;
  name: string;
  description: string | null;
  source: string;                     // 'bundled' | 'user' | 'project'
  version: string | null;
  tags: string[];
  // Parsed metadata — computed from yaml at write time so chat clients
  // don't need their own YAML parser.
  node_count: number;
  has_loop: boolean;
  has_approval: boolean;
  // If the YAML declares an `x-hermes.when_to_use:` extension or a top-level
  // `when_to_use` field, surface it here so chat routing has a natural-language
  // hint for the workflow. Empty string if absent.
  when_to_use: string;
  // Audit
  checksum: string;
  updated_at: number;
}

export interface ManifestDocument {
  version: 1;
  generated_at: number;
  switchui_root: string;              // process.cwd() at boot
  workflows: ManifestEntry[];
}

export interface WriteManifestOpts {
  store: SwitchUiWorkflowStore;
  /** Override the output path (tests). Default ~/.hermes/switchui-workflows.json. */
  outputPath?: string;
}

const DEFAULT_MANIFEST_DIR = join(homedir(), '.hermes');
const DEFAULT_MANIFEST_FILENAME = 'switchui-workflows.json';

/**
 * Extract `when_to_use` from raw YAML text.
 * Checks two locations in order:
 *   1. Top-level `when_to_use:` field
 *   2. `x-hermes.when_to_use:` extension block
 * Returns empty string if absent.
 */
function extractWhenToUse(yaml: string): string {
  // Top-level: "when_to_use: <value>" (single-line string)
  const topLevel = /^when_to_use:\s*["']?(.+?)["']?\s*$/m.exec(yaml);
  if (topLevel && topLevel[1].trim()) {
    return topLevel[1].trim();
  }
  // x-hermes block: indented "when_to_use: <value>" after "x-hermes:"
  const xHermes = /^x-hermes:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+when_to_use:\s*["']?(.+?)["']?\s*$/m.exec(yaml);
  if (xHermes && xHermes[1].trim()) {
    return xHermes[1].trim();
  }
  return '';
}

/**
 * Parse tags JSON from the row. Returns [] on null or malformed JSON.
 */
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Write the Hermes workflow manifest to disk (synchronous).
 * Called during engine boot after bundled workflows are seeded.
 */
export function writeWorkflowsManifest(opts: WriteManifestOpts): {
  path: string;
  entriesWritten: number;
  parseErrors: Array<{ id: string; error: string }>;
} {
  const { store } = opts;
  const outputDir = opts.outputPath ?? DEFAULT_MANIFEST_DIR;
  const outputFile = join(outputDir, DEFAULT_MANIFEST_FILENAME);

  const rows = store.listWorkflowDefinitions();
  const workflows: ManifestEntry[] = [];
  const parseErrors: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const result = parseWorkflow(row.yaml, row.id);
    if (result.error !== null) {
      parseErrors.push({ id: row.id, error: result.error.error });
      continue;
    }

    const nodes = result.workflow.nodes;
    const has_loop = nodes.some(isLoopNode);
    const has_approval = nodes.some(isApprovalNode);

    workflows.push({
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      version: row.version,
      tags: parseTags(row.tags),
      node_count: nodes.length,
      has_loop,
      has_approval,
      when_to_use: extractWhenToUse(row.yaml),
      checksum: row.checksum,
      updated_at: row.updated_at,
    });
  }

  const doc: ManifestDocument = {
    version: 1,
    generated_at: Date.now(),
    switchui_root: process.cwd(),
    workflows,
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, JSON.stringify(doc, null, 2), 'utf8');

  return {
    path: outputFile,
    entriesWritten: workflows.length,
    parseErrors,
  };
}
