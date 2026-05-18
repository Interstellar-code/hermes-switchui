/**
 * Unit tests for subgraph schema validation (A.7-subgraphs).
 * Covers subgraphInputSchema, subgraphOutputSchema, workflowBaseSchema kind/id/inputs/outputs,
 * and the dagNodeSchema mutual-exclusion for subgraph nodes.
 */
import { describe, it, expect } from 'vitest';
import { dagNodeSchema, subgraphReferenceSchema } from './dag-node';
import { subgraphInputSchema, subgraphOutputSchema, workflowBaseSchema } from './workflow';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// subgraphInputSchema
// ---------------------------------------------------------------------------

describe('subgraphInputSchema', () => {
  it('accepts a well-formed required input', () => {
    const result = subgraphInputSchema.safeParse({
      name: 'pr_number',
      type: 'string',
      required: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('pr_number');
      expect(result.data.required).toBe(true);
    }
  });

  it('accepts an optional input without type', () => {
    const result = subgraphInputSchema.safeParse({ name: 'pr_diff_path', required: false });
    expect(result.success).toBe(true);
  });

  it('rejects input name that is not snake_case (contains hyphen)', () => {
    const result = subgraphInputSchema.safeParse({ name: 'pr-number' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/snake_case/i);
    }
  });

  it('rejects input name starting with a digit', () => {
    const result = subgraphInputSchema.safeParse({ name: '1input' });
    expect(result.success).toBe(false);
  });

  it('rejects input name that is empty string', () => {
    const result = subgraphInputSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('accepts input name with uppercase letters (snake_case allows upper)', () => {
    // The regex is /^[a-z][a-z0-9_]*$/i — uppercase is fine
    const result = subgraphInputSchema.safeParse({ name: 'PR_Number' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// subgraphOutputSchema
// ---------------------------------------------------------------------------

describe('subgraphOutputSchema', () => {
  it('accepts a well-formed output', () => {
    const result = subgraphOutputSchema.safeParse({
      name: 'synthesis',
      from: 'synthesize.output',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe('synthesize.output');
    }
  });

  it('accepts output with description', () => {
    const result = subgraphOutputSchema.safeParse({
      name: 'report',
      from: 'report-node.output.summary',
      description: 'The final report',
    });
    expect(result.success).toBe(true);
  });

  it('rejects output with empty from', () => {
    const result = subgraphOutputSchema.safeParse({ name: 'result', from: '' });
    expect(result.success).toBe(false);
  });

  it('rejects output name that is not snake_case', () => {
    const result = subgraphOutputSchema.safeParse({ name: 'bad-name', from: 'node.output' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/snake_case/i);
    }
  });

  it('rejects output with missing from field', () => {
    const result = subgraphOutputSchema.safeParse({ name: 'result' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// workflowBaseSchema — kind / id / inputs / outputs
// ---------------------------------------------------------------------------

describe('workflowBaseSchema subgraph fields', () => {
  const baseFields = { name: 'Test', description: 'A test subgraph' };

  it('accepts kind=subgraph with id, inputs, outputs', () => {
    const result = workflowBaseSchema.safeParse({
      ...baseFields,
      kind: 'subgraph',
      id: 'pr-review-5agents',
      inputs: [{ name: 'pr_number', type: 'string', required: true }],
      outputs: [{ name: 'synthesis', from: 'synthesize.output' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('subgraph');
      expect(result.data.id).toBe('pr-review-5agents');
      expect(result.data.inputs).toHaveLength(1);
      expect(result.data.outputs).toHaveLength(1);
    }
  });

  it('accepts kind=workflow (default runnable workflow)', () => {
    const result = workflowBaseSchema.safeParse({ ...baseFields, kind: 'workflow' });
    expect(result.success).toBe(true);
  });

  it('accepts omitted kind (defaults to absent/undefined)', () => {
    const result = workflowBaseSchema.safeParse({ ...baseFields });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBeUndefined();
    }
  });

  it('rejects unknown kind value', () => {
    const result = workflowBaseSchema.safeParse({ ...baseFields, kind: 'task' });
    expect(result.success).toBe(false);
  });

  it('allows id on kind=subgraph', () => {
    const result = workflowBaseSchema.safeParse({
      ...baseFields,
      kind: 'subgraph',
      id: 'my-subgraph',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema — subgraph node mutual exclusion
// ---------------------------------------------------------------------------

describe('dagNodeSchema subgraph node', () => {
  it('accepts a well-formed subgraph reference node', () => {
    const result = dagNodeSchema.safeParse({
      id: 'call-pr-review',
      subgraph: { ref: 'pr-review-5agents', inputs: { pr_number: '42' } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { subgraph?: { ref: string } };
      expect(data.subgraph?.ref).toBe('pr-review-5agents');
    }
  });

  it('accepts subgraph node with when and timeout', () => {
    const result = dagNodeSchema.safeParse({
      id: 'conditional-subgraph',
      subgraph: {
        ref: 'some-subgraph',
        when: '$prev.output === "yes"',
        timeout: 60000,
        max_retries: 2,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects subgraph node combined with prompt (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: 'some-subgraph' },
      prompt: 'Also has a prompt',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/mutually exclusive/i);
    }
  });

  it('rejects subgraph node combined with bash (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: 'some-subgraph' },
      bash: 'echo hello',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/mutually exclusive/i);
    }
  });

  it('rejects subgraph node combined with command (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: 'some-subgraph' },
      command: 'review',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/mutually exclusive/i);
    }
  });

  it('rejects subgraph node combined with loop (mutually exclusive)', () => {
    // Need a valid loop config so the schema sees both subgraph AND loop
    // and fires the mutual-exclusion error rather than a loop validation error
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: 'some-subgraph' },
      loop: {
        prompt: 'iterate',
        until: 'COMPLETE',
        max_iterations: 5,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message).join(' ');
      expect(messages).toMatch(/mutually exclusive/i);
    }
  });

  it('rejects subgraph ref that is empty string', () => {
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects subgraph ref that has invalid characters (spaces)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'bad-node',
      subgraph: { ref: 'bad ref name' },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// subgraphReferenceSchema
// ---------------------------------------------------------------------------

describe('subgraphReferenceSchema', () => {
  it('accepts minimal ref with just the ref field', () => {
    const result = subgraphReferenceSchema.safeParse({ ref: 'my-subgraph' });
    expect(result.success).toBe(true);
  });

  it('accepts ref with all optional fields', () => {
    const result = subgraphReferenceSchema.safeParse({
      ref: 'my-subgraph',
      inputs: { foo: 'bar', count: 3 },
      when: '$x.output === "yes"',
      timeout: 30000,
      max_retries: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ref starting with a non-alphanumeric character', () => {
    const result = subgraphReferenceSchema.safeParse({ ref: '-bad-ref' });
    expect(result.success).toBe(false);
  });

  it('rejects empty ref', () => {
    const result = subgraphReferenceSchema.safeParse({ ref: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = subgraphReferenceSchema.safeParse({ ref: 'ok-ref', timeout: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative max_retries', () => {
    const result = subgraphReferenceSchema.safeParse({ ref: 'ok-ref', max_retries: -1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Well-formed subgraph YAML parses through workflowBaseSchema correctly
// ---------------------------------------------------------------------------

describe('well-formed subgraph YAML', () => {
  it('parses a complete subgraph declaration YAML', () => {
    const yaml = `
kind: subgraph
id: pr-review-5agents
name: PR Review 5 Agents
description: A reusable subgraph for 5-agent PR review
inputs:
  - name: pr_number
    type: string
    required: true
  - name: pr_diff_path
    type: string
    required: false
outputs:
  - name: synthesis
    from: synthesize.output
`;
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const result = workflowBaseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('subgraph');
      expect(result.data.id).toBe('pr-review-5agents');
      expect(result.data.inputs).toHaveLength(2);
      expect(result.data.outputs).toHaveLength(1);
      expect(result.data.inputs![0].name).toBe('pr_number');
      expect(result.data.inputs![0].required).toBe(true);
      expect(result.data.inputs![1].required).toBe(false);
      expect(result.data.outputs![0].from).toBe('synthesize.output');
    }
  });
});
