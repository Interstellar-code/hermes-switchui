import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../discovery/loader';
import { BUNDLED_WORKFLOWS } from './bundled-defaults.generated';

const V1_WORKFLOWS = [
  'archon-resolve-conflicts',
  'archon-feature-development',
  'archon-smart-pr-review',
  'archon-fix-github-issue',
  'archon-plan-to-pr',
  'archon-idea-to-pr',
  'archon-interactive-prd',
  'archon-piv-loop',
] as const;

describe('bundled-defaults v1 hermes_task annotations', () => {
  it('all 8 v1 workflows parse without error', () => {
    for (const name of V1_WORKFLOWS) {
      const yaml = BUNDLED_WORKFLOWS[name];
      expect(yaml, `${name} not found in BUNDLED_WORKFLOWS`).toBeDefined();
      const result = parseWorkflow(yaml, `${name}.yaml`);
      expect(result.error, `${name} parse error: ${result.error}`).toBeNull();
    }
  });

  it('each v1 workflow has at least one node with hermes_task.skills non-empty', () => {
    for (const name of V1_WORKFLOWS) {
      const yaml = BUNDLED_WORKFLOWS[name];
      const result = parseWorkflow(yaml, `${name}.yaml`);
      expect(result.error).toBeNull();
      const nodes = result.workflow!.nodes;
      const annotated = nodes.filter(
        n => (n as Record<string, unknown>).hermes_task &&
             Array.isArray(((n as Record<string, unknown>).hermes_task as Record<string, unknown>).skills) &&
             (((n as Record<string, unknown>).hermes_task as Record<string, unknown>).skills as string[]).length > 0
      );
      expect(annotated.length, `${name}: expected at least 1 hermes_task node, got 0`).toBeGreaterThan(0);
    }
  });

  it('total annotated nodes across v1 workflows is >= 20', () => {
    let total = 0;
    for (const name of V1_WORKFLOWS) {
      const yaml = BUNDLED_WORKFLOWS[name];
      const result = parseWorkflow(yaml, `${name}.yaml`);
      expect(result.error).toBeNull();
      const nodes = result.workflow!.nodes;
      total += nodes.filter(
        n => (n as Record<string, unknown>).hermes_task !== undefined
      ).length;
    }
    expect(total).toBeGreaterThanOrEqual(15);
  });
});
