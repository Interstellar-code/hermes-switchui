/**
 * Integration tests for subgraph loader validation (A.7-subgraphs).
 * Tests parseWorkflow with a mock store to exercise:
 *   - Subgraph YAML declaration parsing
 *   - Subgraph reference resolution (store lookup)
 *   - Required input binding validation
 *   - Cycle detection (direct and transitive)
 *   - Reuse of a subgraph from two disjoint paths (must NOT trigger cycle detection)
 */
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from './loader';
import type { ISubgraphStore } from './loader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid subgraph YAML string. */
function makeSubgraphYaml(opts: {
  id: string;
  inputs?: Array<{ name: string; required?: boolean }>;
  outputs?: Array<{ name: string; from: string }>;
  nodes?: string;
} = { id: 'my-sub' }): string {
  const inputs = opts.inputs
    ? 'inputs:\n' +
      opts.inputs
        .map(
          i =>
            `  - name: ${i.name}\n    required: ${i.required !== false ? 'true' : 'false'}`,
        )
        .join('\n')
    : '';
  const outputs = opts.outputs
    ? 'outputs:\n' +
      opts.outputs.map(o => `  - name: ${o.name}\n    from: ${o.from}`).join('\n')
    : '';
  const nodes =
    opts.nodes ??
    `nodes:
  - id: inner-step
    prompt: "do something"`;
  return `
kind: subgraph
id: ${opts.id}
name: My Subgraph
description: A test subgraph
${inputs}
${outputs}
${nodes}
`.trim();
}

/** Build a minimal valid parent workflow YAML that references a subgraph. */
function makeParentYaml(opts: {
  subgraphRef: string;
  inputs?: Record<string, unknown>;
  extraNodes?: string;
} = { subgraphRef: 'my-sub' }): string {
  const inputsYaml = opts.inputs
    ? 'inputs:\n' +
      Object.entries(opts.inputs)
        .map(([k, v]) => `          ${k}: "${String(v)}"`)
        .join('\n')
    : '';
  return `
name: Parent Workflow
description: A workflow that references a subgraph
nodes:
  - id: call-sub
    subgraph:
      ref: ${opts.subgraphRef}
      ${inputsYaml ? inputsYaml : ''}
${opts.extraNodes ?? ''}
`.trim();
}

/** Mock store backed by a map of id → yaml content. */
function makeStore(entries: Record<string, string>): ISubgraphStore {
  return {
    getWorkflowDefinition(id: string) {
      const yaml = entries[id];
      if (!yaml) return null;
      return { id, yaml, kind: 'subgraph' };
    },
  };
}

/** Mock store that returns a 'workflow' kind (not a subgraph). */
function makeWorkflowStore(id: string, yaml: string): ISubgraphStore {
  return {
    getWorkflowDefinition(lookupId: string) {
      if (lookupId !== id) return null;
      return { id, yaml, kind: 'workflow' };
    },
  };
}

// ---------------------------------------------------------------------------
// Subgraph YAML declaration parsing
// ---------------------------------------------------------------------------

describe('parseWorkflow — subgraph declaration (kind=subgraph)', () => {
  it('parses a well-formed subgraph YAML', () => {
    const yaml = makeSubgraphYaml({
      id: 'pr-review',
      inputs: [
        { name: 'pr_number', required: true },
        { name: 'pr_diff_path', required: false },
      ],
      outputs: [{ name: 'synthesis', from: 'inner-step' }],
    });
    const result = parseWorkflow(yaml, 'pr-review.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
    expect(result.workflow!.kind).toBe('subgraph');
    expect(result.workflow!.id).toBe('pr-review');
    expect(result.workflow!.inputs).toHaveLength(2);
    expect(result.workflow!.outputs).toHaveLength(1);
  });

  it('fails when kind=subgraph but id is missing', () => {
    const yaml = `
kind: subgraph
name: Missing Id Subgraph
description: No id field here
nodes:
  - id: step1
    prompt: "hello"
`.trim();
    const result = parseWorkflow(yaml, 'bad-sub.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/id/i);
  });

  it('fails when kind=subgraph and id is empty string', () => {
    const yaml = `
kind: subgraph
id: ""
name: Empty Id Subgraph
description: Empty id
nodes:
  - id: step1
    prompt: "hello"
`.trim();
    const result = parseWorkflow(yaml, 'bad-sub.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/id/i);
  });

  it('fails when outputs[].from references an unknown inner node', () => {
    const yaml = `
kind: subgraph
id: bad-outputs
name: Bad Outputs Subgraph
description: Output from unknown node
outputs:
  - name: result
    from: nonexistent-node.output
nodes:
  - id: real-node
    prompt: "do work"
`.trim();
    const result = parseWorkflow(yaml, 'bad-outputs.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/nonexistent-node/);
  });

  it('fails when inputs[].name is not snake_case (contains hyphen)', () => {
    const yaml = `
kind: subgraph
id: bad-inputs
name: Bad Inputs Subgraph
description: Input with bad name
inputs:
  - name: pr-number
    required: true
nodes:
  - id: step1
    prompt: "hello"
`.trim();
    const result = parseWorkflow(yaml, 'bad-inputs.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/snake_case|pr-number/i);
  });

  it('passes for kind=workflow without id (normal workflow)', () => {
    const yaml = `
name: Normal Workflow
description: A regular workflow
nodes:
  - id: step1
    prompt: "hello"
`.trim();
    const result = parseWorkflow(yaml, 'normal.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow!.kind).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Subgraph reference resolution (store lookup)
// ---------------------------------------------------------------------------

describe('parseWorkflow — subgraph reference validation', () => {
  it('passes when workflow references an existing subgraph', () => {
    const subYaml = makeSubgraphYaml({ id: 'my-sub' });
    const store = makeStore({ 'my-sub': subYaml });
    const yaml = makeParentYaml({ subgraphRef: 'my-sub' });
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
  });

  it('fails when workflow references a non-existent subgraph', () => {
    const store = makeStore({}); // empty store
    const yaml = makeParentYaml({ subgraphRef: 'missing-sub' });
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/missing-sub/);
    expect(result.error!.error).toMatch(/not found/i);
  });

  it('fails when referenced id exists but is a workflow, not a subgraph', () => {
    const workflowYaml = `
name: Not A Subgraph
description: A regular workflow
nodes:
  - id: step1
    prompt: "hello"
`.trim();
    const store = makeWorkflowStore('not-a-subgraph', workflowYaml);
    const yaml = makeParentYaml({ subgraphRef: 'not-a-subgraph' });
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/not-a-subgraph/);
    expect(result.error!.error).toMatch(/not a subgraph|kind/i);
  });

  it('fails when workflow references a subgraph but misses a required input', () => {
    const subYaml = makeSubgraphYaml({
      id: 'pr-review',
      inputs: [{ name: 'pr_number', required: true }],
    });
    const store = makeStore({ 'pr-review': subYaml });
    // Parent does not bind pr_number
    const yaml = `
name: Parent Workflow
description: Missing required input
nodes:
  - id: call-sub
    subgraph:
      ref: pr-review
`.trim();
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/pr_number/);
    expect(result.error!.error).toMatch(/requires|required/i);
  });

  it('passes when required input is bound at the reference site', () => {
    const subYaml = makeSubgraphYaml({
      id: 'pr-review',
      inputs: [{ name: 'pr_number', required: true }],
    });
    const store = makeStore({ 'pr-review': subYaml });
    const yaml = `
name: Parent Workflow
description: Binds required input
nodes:
  - id: call-sub
    subgraph:
      ref: pr-review
      inputs:
        pr_number: "42"
`.trim();
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).toBeNull();
  });

  it('passes when optional input is NOT bound (required: false)', () => {
    const subYaml = makeSubgraphYaml({
      id: 'my-sub',
      inputs: [{ name: 'optional_param', required: false }],
    });
    const store = makeStore({ 'my-sub': subYaml });
    // No inputs bound at all — that's fine since optional
    const yaml = makeParentYaml({ subgraphRef: 'my-sub' });
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).toBeNull();
  });

  it('does not validate subgraph references when no store is passed', () => {
    // Without a store, the reference lookup is skipped — no error even for missing refs
    const yaml = makeParentYaml({ subgraphRef: 'any-ref-at-all' });
    const result = parseWorkflow(yaml, 'parent.yaml'); // no store
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('parseWorkflow — cycle detection', () => {
  it('fails on direct self-reference cycle (A → A)', () => {
    // Subgraph that references itself
    const selfRefYaml = `
kind: subgraph
id: self-ref
name: Self Reference Subgraph
description: References itself
nodes:
  - id: inner
    subgraph:
      ref: self-ref
`.trim();
    const store = makeStore({ 'self-ref': selfRefYaml });
    // Parent workflow that references self-ref
    const yaml = makeParentYaml({ subgraphRef: 'self-ref' });
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/cycle/i);
    expect(result.error!.error).toMatch(/self-ref/);
  });

  it('fails on indirect transitive cycle (A → B → A)', () => {
    // subgraph-b references subgraph-a
    const subgraphBYaml = `
kind: subgraph
id: subgraph-b
name: Subgraph B
description: References A
nodes:
  - id: call-a
    subgraph:
      ref: subgraph-a
`.trim();
    // subgraph-a references subgraph-b
    const subgraphAYaml = `
kind: subgraph
id: subgraph-a
name: Subgraph A
description: References B
nodes:
  - id: call-b
    subgraph:
      ref: subgraph-b
`.trim();
    const store = makeStore({
      'subgraph-a': subgraphAYaml,
      'subgraph-b': subgraphBYaml,
    });
    // Parent references A, which references B, which references A → cycle
    const yaml = `
name: Parent Workflow
description: Triggers A→B→A cycle
nodes:
  - id: call-a
    subgraph:
      ref: subgraph-a
`.trim();
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toMatch(/cycle/i);
  });

  it('does NOT trip cycle detection when a subgraph is reused in two disjoint paths', () => {
    // my-sub is referenced twice by two different nodes with no dependency between them
    const subYaml = makeSubgraphYaml({ id: 'my-sub' });
    const store = makeStore({ 'my-sub': subYaml });
    const yaml = `
name: Parent Workflow
description: Reuses subgraph from two disjoint paths
nodes:
  - id: call-sub-1
    subgraph:
      ref: my-sub
  - id: call-sub-2
    subgraph:
      ref: my-sub
`.trim();
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
  });

  it('does NOT trip cycle detection for longer chain without cycle (A → B → C)', () => {
    const subCYaml = makeSubgraphYaml({ id: 'sub-c' });
    const subBYaml = `
kind: subgraph
id: sub-b
name: Subgraph B
description: References C
nodes:
  - id: call-c
    subgraph:
      ref: sub-c
`.trim();
    const subAYaml = `
kind: subgraph
id: sub-a
name: Subgraph A
description: References B
nodes:
  - id: call-b
    subgraph:
      ref: sub-b
`.trim();
    const store = makeStore({
      'sub-a': subAYaml,
      'sub-b': subBYaml,
      'sub-c': subCYaml,
    });
    const yaml = `
name: Parent Workflow
description: Linear chain A→B→C
nodes:
  - id: call-a
    subgraph:
      ref: sub-a
`.trim();
    const result = parseWorkflow(yaml, 'parent.yaml', store);
    expect(result.error).toBeNull();
  });
});
