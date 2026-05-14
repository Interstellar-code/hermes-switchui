import { describe, it, expect } from 'vitest';
import { createWorkflowStore } from '../store';
import { seedBundledWorkflows } from './seed-defaults';

describe('seedBundledWorkflows', () => {
  it('inserts all bundled workflows on a fresh DB', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    const result = seedBundledWorkflows(store);
    expect(result.inserted).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    const all = store.listWorkflowDefinitions({ source: 'bundled' });
    expect(all.length).toBe(result.inserted);
  });

  it('is idempotent — second call inserts 0 and skips all', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    const first = seedBundledWorkflows(store);
    const second = seedBundledWorkflows(store);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(first.inserted);
    expect(second.errors).toEqual([]);
  });
});
