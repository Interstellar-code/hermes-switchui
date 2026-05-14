import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { createWorkflowStore } from '../store';
import { writeWorkflowsManifest, type ManifestDocument } from './manifest';

// Minimal valid YAML for a single-node workflow
function makeYaml(opts: {
  name: string;
  description?: string;
  when_to_use?: string;
  nodeType?: 'prompt' | 'approval' | 'loop';
  tags?: string[];
}) {
  const { name, description = 'desc', when_to_use, nodeType = 'prompt', tags } = opts;
  let nodeBlock: string;
  if (nodeType === 'approval') {
    nodeBlock = `  - id: n1\n    approval:\n      message: "Approve?"`;
  } else if (nodeType === 'loop') {
    nodeBlock = `  - id: n1\n    loop:\n      prompt: "run iteration"\n      until: "COMPLETE"\n      max_iterations: 5`;
  } else {
    nodeBlock = `  - id: n1\n    prompt: "hello"`;
  }
  const whenLine = when_to_use ? `when_to_use: "${when_to_use}"\n` : '';
  const tagsLine = tags ? `tags:\n${tags.map(t => `  - ${t}`).join('\n')}\n` : '';
  return `name: "${name}"\ndescription: "${description}"\n${whenLine}${tagsLine}nodes:\n${nodeBlock}\n`;
}

describe('writeWorkflowsManifest', () => {
  it('empty store → manifest with empty workflows array', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    try {
      const result = writeWorkflowsManifest({ store, outputPath: tmp });
      expect(result.entriesWritten).toBe(0);
      expect(result.parseErrors).toEqual([]);

      const doc: ManifestDocument = JSON.parse(readFileSync(result.path, 'utf8'));
      expect(doc.version).toBe(1);
      expect(typeof doc.generated_at).toBe('number');
      expect(doc.generated_at).toBeGreaterThan(0);
      expect(Array.isArray(doc.workflows)).toBe(true);
      expect(doc.workflows).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('2 valid definitions → 2 entries with derived metadata', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    store.upsertWorkflowDefinition({
      id: 'wf-prompt',
      name: 'Prompt WF',
      source: 'bundled',
      yaml: makeYaml({ name: 'Prompt WF', nodeType: 'prompt', when_to_use: 'Use for prompts' }),
      checksum: 'a1',
    });
    store.upsertWorkflowDefinition({
      id: 'wf-loop',
      name: 'Loop WF',
      source: 'user',
      yaml: makeYaml({ name: 'Loop WF', nodeType: 'loop' }),
      checksum: 'a2',
    });

    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    try {
      const result = writeWorkflowsManifest({ store, outputPath: tmp });
      expect(result.entriesWritten).toBe(2);
      expect(result.parseErrors).toEqual([]);

      const doc: ManifestDocument = JSON.parse(readFileSync(result.path, 'utf8'));
      expect(doc.workflows).toHaveLength(2);

      const prompt = doc.workflows.find(w => w.id === 'wf-prompt')!;
      expect(prompt.has_loop).toBe(false);
      expect(prompt.has_approval).toBe(false);
      expect(prompt.node_count).toBe(1);
      expect(prompt.when_to_use).toBe('Use for prompts');
      expect(prompt.source).toBe('bundled');

      const loop = doc.workflows.find(w => w.id === 'wf-loop')!;
      expect(loop.has_loop).toBe(true);
      expect(loop.has_approval).toBe(false);
      expect(loop.source).toBe('user');
      expect(loop.when_to_use).toBe('');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('one broken YAML → skipped, recorded in parseErrors', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    store.upsertWorkflowDefinition({
      id: 'wf-good',
      name: 'Good WF',
      source: 'bundled',
      yaml: makeYaml({ name: 'Good WF' }),
      checksum: 'b1',
    });
    store.upsertWorkflowDefinition({
      id: 'wf-bad',
      name: 'Bad WF',
      source: 'bundled',
      yaml: '!!!: not: valid: yaml: at: all\n  - broken',
      checksum: 'b2',
    });

    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    try {
      const result = writeWorkflowsManifest({ store, outputPath: tmp });
      expect(result.entriesWritten).toBe(1);
      expect(result.parseErrors).toHaveLength(1);
      expect(result.parseErrors[0].id).toBe('wf-bad');

      const doc: ManifestDocument = JSON.parse(readFileSync(result.path, 'utf8'));
      expect(doc.workflows).toHaveLength(1);
      expect(doc.workflows[0].id).toBe('wf-good');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('output path defaults to ~/.hermes/switchui-workflows.json path format', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    try {
      const result = writeWorkflowsManifest({ store, outputPath: tmp });
      expect(result.path).toBe(join(tmp, 'switchui-workflows.json'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('tags JSON parse: valid tags → array, malformed → empty, no throw', () => {
    const store = createWorkflowStore({ dbPath: ':memory:' });
    store.upsertWorkflowDefinition({
      id: 'wf-tags',
      name: 'Tags WF',
      source: 'bundled',
      yaml: makeYaml({ name: 'Tags WF' }),
      checksum: 'c1',
      tags: ['foo', 'bar'],
    });
    store.upsertWorkflowDefinition({
      id: 'wf-notags',
      name: 'No Tags WF',
      source: 'bundled',
      yaml: makeYaml({ name: 'No Tags WF' }),
      checksum: 'c2',
    });

    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    try {
      const result = writeWorkflowsManifest({ store, outputPath: tmp });
      expect(result.entriesWritten).toBe(2);

      const doc: ManifestDocument = JSON.parse(readFileSync(result.path, 'utf8'));
      const tagged = doc.workflows.find(w => w.id === 'wf-tags')!;
      expect(tagged.tags).toEqual(['foo', 'bar']);

      const noTags = doc.workflows.find(w => w.id === 'wf-notags')!;
      expect(noTags.tags).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
