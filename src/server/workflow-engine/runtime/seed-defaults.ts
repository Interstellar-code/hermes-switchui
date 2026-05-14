/**
 * Seed the engine DB with the 20 bundled Archon workflow YAMLs on boot.
 *
 * Idempotent: upsertWorkflowDefinition short-circuits via SHA-256 checksum,
 * so re-running the seed against an already-populated DB is a cheap read.
 *
 * Source: src/server/workflow-engine/defaults/bundled-defaults.generated.ts
 * (auto-generated copy of Archon's bundled workflow set).
 */
import { createHash } from 'node:crypto';
import { BUNDLED_WORKFLOWS } from '../defaults/bundled-defaults.generated';
import { parseWorkflow } from '../discovery/loader';
import type { SwitchUiWorkflowStore } from '../store/workflow-store';

export interface SeedResult {
  inserted: number;
  skipped: number;
  errors: Array<{ filename: string; error: string }>;
}

export function seedBundledWorkflows(store: SwitchUiWorkflowStore): SeedResult {
  let inserted = 0;
  let skipped = 0;
  const errors: SeedResult['errors'] = [];

  for (const [filename, yaml] of Object.entries(BUNDLED_WORKFLOWS)) {
    const parsed = parseWorkflow(yaml, filename);
    if (parsed.error || !parsed.workflow) {
      errors.push({ filename, error: parsed.error?.error ?? 'parse failed' });
      continue;
    }

    const id = idFromFilename(filename);
    const existing = store.getWorkflowDefinition(id);
    // Codex Bundle 3 Q6 fix: normalize CRLF→LF before hashing so the same
    // YAML content produces the same checksum regardless of git autocrlf or
    // Windows tooling. Storage retains the original bytes.
    const normalized = yaml.replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(normalized).digest('hex');
    if (existing && existing.checksum === checksum) {
      skipped += 1;
      continue;
    }

    store.upsertWorkflowDefinition({
      id,
      name: parsed.workflow.name,
      description: parsed.workflow.description,
      source: 'bundled',
      yaml,
      checksum,
    });
    inserted += 1;
  }

  return { inserted, skipped, errors };
}

function idFromFilename(filename: string): string {
  // 'archon-fix-github-issue.yaml' → 'archon-fix-github-issue'
  return filename.replace(/\.ya?ml$/i, '');
}
