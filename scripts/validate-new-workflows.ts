import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { workflowDefinitionSchema } from '../src/server/workflow-engine/schemas/workflow';

const files = [
  '.archon/workflows/defaults/tool-catalog-write.yaml',
  '.archon/workflows/defaults/githubawesome-monitor.yaml',
];

let anyFail = false;
for (const f of files) {
  const yaml = readFileSync(f, 'utf8');
  const parsed = parseYaml(yaml);
  const result = workflowDefinitionSchema.safeParse(parsed);
  console.log(`\n== ${f} (kind=${parsed?.kind ?? 'workflow'}) ==`);
  if (result.success) {
    console.log('OK');
  } else {
    anyFail = true;
    console.log('ERRORS:');
    for (const issue of result.error.issues) {
      console.log(' -', issue.path.join('.'), '|', issue.message);
    }
  }
}
process.exit(anyFail ? 1 : 0);
