/**
 * Subgraph expansion unit tests (A.7-subgraphs, Track 2).
 *
 * Covers the pure expansion helpers in `dag-executor.ts`:
 *  - id namespacing (e.g. `code-review` → `review.code-review`)
 *  - depends_on rewriting for inner refs
 *  - `$INPUTS.<name>` substitution from `subgraph.inputs`
 *  - `$<inner-id>.output` rewriting to namespaced form
 *  - deep-clone safety (source subgraph definition is not mutated)
 *  - missing/wrong-kind reference errors
 *  - aggregateSubgraphOutputs resolves from completed child outputs
 */
import { describe, it, expect } from 'vitest';
import {
  expandSubgraph,
  aggregateSubgraphOutputs,
  type SubgraphDefinitionStore,
  type SubgraphOutputSpec,
} from './dag-executor';
import type { SubgraphNode, NodeOutput } from '../schemas';

function makeStore(defs: Record<string, { yaml: string; kind?: 'workflow' | 'subgraph' }>): SubgraphDefinitionStore {
  return {
    getWorkflowDefinition(id: string) {
      const entry = defs[id];
      if (!entry) return null;
      return { id, yaml: entry.yaml, kind: entry.kind ?? 'subgraph' };
    },
  };
}

function makeSubgraphNode(id: string, ref: string, inputs?: Record<string, unknown>): SubgraphNode {
  return {
    id,
    subgraph: {
      ref,
      ...(inputs !== undefined ? { inputs } : {}),
    },
  } as unknown as SubgraphNode;
}

describe('expandSubgraph', () => {
  it('namespaces inner ids to <parent>.<inner>', async () => {
    const yaml = `
name: pr-review
description: PR review subgraph
kind: subgraph
id: pr-review
nodes:
  - id: code-review
    prompt: Review the code
  - id: synthesize
    prompt: Combine results
    depends_on: [code-review]
`;
    const store = makeStore({ 'pr-review': { yaml } });
    const node = makeSubgraphNode('review', 'pr-review');

    const result = await expandSubgraph(node, 'run-1', 'placeholder-1', store);

    expect(result.childNodes.map(n => n.id)).toEqual([
      'review.code-review',
      'review.synthesize',
    ]);
    // depends_on entries that pointed at an inner id should be namespaced
    expect(result.childNodes[1].depends_on).toEqual(['review.code-review']);
  });

  it('substitutes $INPUTS.<name> in inner prompts', async () => {
    const yaml = `
name: pr-review
description: PR review subgraph
kind: subgraph
id: pr-review
inputs:
  - name: pr_number
    type: number
    required: true
nodes:
  - id: code-review
    prompt: |
      Review PR #$INPUTS.pr_number against the standards.
`;
    const store = makeStore({ 'pr-review': { yaml } });
    const node = makeSubgraphNode('review', 'pr-review', { pr_number: 42 });

    const result = await expandSubgraph(node, 'run-1', 'placeholder-1', store);

    const child = result.childNodes[0] as { prompt: string };
    expect(child.prompt).toContain('Review PR #42');
    expect(child.prompt).not.toContain('$INPUTS.pr_number');
  });

  it('rewrites $<inner-id>.output to namespaced form inside the body', async () => {
    const yaml = `
name: pipeline
description: chained subgraph
kind: subgraph
id: pipeline
nodes:
  - id: gather
    prompt: Gather data
  - id: summarize
    prompt: Summarise $gather.output briefly.
    depends_on: [gather]
`;
    const store = makeStore({ pipeline: { yaml } });
    const node = makeSubgraphNode('phase1', 'pipeline');

    const result = await expandSubgraph(node, 'run-1', 'placeholder-1', store);
    const summarize = result.childNodes.find(n => n.id === 'phase1.summarize') as { prompt: string };

    expect(summarize.prompt).toContain('$phase1.gather.output');
    expect(summarize.prompt).not.toMatch(/\$gather\.output(?!\.|[a-zA-Z])/);
  });

  it('deep-clones nodes so the source subgraph definition is not mutated', async () => {
    const yaml = `
name: pr-review
description: PR review subgraph
kind: subgraph
id: pr-review
inputs:
  - name: who
    type: string
nodes:
  - id: greet
    prompt: Hello $INPUTS.who
`;
    const store = makeStore({ 'pr-review': { yaml } });

    // Expand twice with different inputs. If the helper mutated the source,
    // the second expansion would observe the first call's substitution.
    const r1 = await expandSubgraph(
      makeSubgraphNode('a', 'pr-review', { who: 'alice' }),
      'run-1',
      'placeholder-a',
      store,
    );
    const r2 = await expandSubgraph(
      makeSubgraphNode('b', 'pr-review', { who: 'bob' }),
      'run-1',
      'placeholder-b',
      store,
    );

    const aGreet = r1.childNodes[0] as { prompt: string };
    const bGreet = r2.childNodes[0] as { prompt: string };

    expect(aGreet.prompt).toContain('Hello alice');
    expect(bGreet.prompt).toContain('Hello bob');
    expect(aGreet.prompt).not.toContain('bob');
  });

  it('returns the placeholder run id and outputs spec', async () => {
    const yaml = `
name: scaffolded
description: subgraph with outputs
kind: subgraph
id: scaffolded
nodes:
  - id: synthesize
    prompt: Synthesize
outputs:
  - name: result
    from: synthesize.output
`;
    const store = makeStore({ scaffolded: { yaml } });
    const node = makeSubgraphNode('phase', 'scaffolded');
    const result = await expandSubgraph(node, 'run-1', 'placeholder-1', store);

    expect(result.placeholderRunId).toMatch(/^[0-9a-f-]+$/i);
    expect(result.outputs).toEqual([{ name: 'result', from: 'synthesize.output' }]);
    expect(result.innerIdByChildId.get('phase.synthesize')).toBe('synthesize');
  });

  it('rejects when the subgraph definition is missing', async () => {
    const store = makeStore({});
    const node = makeSubgraphNode('phase', 'missing-subgraph');
    await expect(expandSubgraph(node, 'run-1', 'p-1', store)).rejects.toThrow(/not found/);
  });

  it('rejects when the referenced definition is not a subgraph', async () => {
    const yaml = `
name: regular
description: regular workflow
nodes:
  - id: only
    prompt: Hi
`;
    const store = makeStore({ regular: { yaml, kind: 'workflow' } });
    const node = makeSubgraphNode('phase', 'regular');
    await expect(expandSubgraph(node, 'run-1', 'p-1', store)).rejects.toThrow(/not a subgraph/);
  });

  it('substitutes $INPUTS arrays/objects via JSON encoding', async () => {
    const yaml = `
name: pr-review
description: PR review subgraph
kind: subgraph
id: pr-review
nodes:
  - id: head
    prompt: |
      Files: $INPUTS.files
`;
    const store = makeStore({ 'pr-review': { yaml } });
    const node = makeSubgraphNode('p', 'pr-review', { files: ['a.ts', 'b.ts'] });

    const result = await expandSubgraph(node, 'run-1', 'placeholder-1', store);
    const head = result.childNodes[0] as { prompt: string };

    expect(head.prompt).toContain('["a.ts","b.ts"]');
  });
});

describe('aggregateSubgraphOutputs', () => {
  it('resolves outputs.from against child node outputs', () => {
    const outputs: SubgraphOutputSpec[] = [
      { name: 'result', from: 'synthesize.output' },
    ];
    const nodeOutputs = new Map<string, NodeOutput>([
      ['review.synthesize', { state: 'completed', output: 'final summary' }],
    ]);

    const agg = aggregateSubgraphOutputs(outputs, 'review', nodeOutputs);
    expect(agg).toEqual({ result: 'final summary' });
  });

  it('returns null for missing or non-completed children', () => {
    const outputs: SubgraphOutputSpec[] = [
      { name: 'a', from: 'missing.output' },
      { name: 'b', from: 'failed.output' },
    ];
    const nodeOutputs = new Map<string, NodeOutput>([
      ['phase.failed', { state: 'failed', output: '', error: 'boom' }],
    ]);
    const agg = aggregateSubgraphOutputs(outputs, 'phase', nodeOutputs);
    expect(agg).toEqual({ a: null, b: null });
  });

  it('resolves JSON field accessors (from: <inner>.output.<field>)', () => {
    const outputs: SubgraphOutputSpec[] = [
      { name: 'verdict', from: 'judge.output.verdict' },
    ];
    const nodeOutputs = new Map<string, NodeOutput>([
      ['gate.judge', { state: 'completed', output: JSON.stringify({ verdict: 'pass', score: 9 }) }],
    ]);
    const agg = aggregateSubgraphOutputs(outputs, 'gate', nodeOutputs);
    expect(agg).toEqual({ verdict: 'pass' });
  });
});
