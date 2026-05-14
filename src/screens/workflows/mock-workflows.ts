export type WorkflowSource = 'bundled' | 'user' | 'project'
export type VersionTier = 'v1' | 'v1.1'
export type NodeType = 'prompt' | 'bash' | 'command' | 'approval' | 'router' | 'loop'

export interface DagNode {
  id: string
  label: string
  type: NodeType
  /** cx/cy are layout hints — absolute pixel coordinates in SVG space */
  cx: number
  cy: number
  config?: string
}

export interface MockWorkflow {
  id: string
  name: string
  description: string
  source: WorkflowSource
  tags: string[]
  node_count: number
  last_used_at: string | null
  version_tier: VersionTier
  has_loop: boolean
  has_approval: boolean
  // extended fields for editor
  required_inputs: string[]
  optional_inputs: string[]
  when_to_use: string
  dag_depth: number
  max_parallelism: number
  run_count: number
  dag: DagNode[]
  dag_edges: [string, string][]
  yaml: string
}

// v1 subset (8): archon-resolve-conflicts, archon-feature-development, archon-smart-pr-review,
//                archon-fix-github-issue, archon-plan-to-pr, archon-idea-to-pr,
//                archon-interactive-prd, archon-piv-loop
// v1.1 (12):     all remaining

export const MOCK_WORKFLOWS: MockWorkflow[] = [
  // ── v1 subset ────────────────────────────────────────────────────────────────
  {
    id: 'archon-fix-github-issue',
    name: 'Fix GitHub Issue',
    description: 'Classify → investigate root cause → fix → PR → review → merge.',
    source: 'bundled',
    tags: ['github', 'fix', 'pr'],
    node_count: 7,
    last_used_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: true,
    required_inputs: ['GITHUB_ISSUE_URL', 'BASE_BRANCH'],
    optional_inputs: ['REVIEWER_NOTES', 'MAX_ATTEMPTS'],
    when_to_use:
      'Use when a GitHub issue needs autonomous resolution — bug fixes, small features with clear acceptance criteria. Produces a validated PR ready for human review. Requires a public or accessible repository.',
    dag_depth: 4,
    max_parallelism: 2,
    run_count: 47,
    dag: [
      { id: 'classify',  label: 'Classify Issue', type: 'prompt',   cx: 60,  cy: 50 },
      { id: 'invest',    label: 'Investigate',    type: 'prompt',   cx: 195, cy: 50 },
      { id: 'fix',       label: 'Generate Fix',   type: 'bash',     cx: 330, cy: 50 },
      { id: 'validate',  label: 'Validate',       type: 'bash',     cx: 465, cy: 20 },
      { id: 'create-pr', label: 'Create PR',      type: 'command',  cx: 465, cy: 82 },
      { id: 'review',    label: 'Review PR',      type: 'prompt',   cx: 600, cy: 50 },
      { id: 'merge',     label: 'Merge',          type: 'approval', cx: 735, cy: 50 },
    ],
    dag_edges: [
      ['classify', 'invest'], ['invest', 'fix'], ['fix', 'validate'],
      ['fix', 'create-pr'], ['validate', 'review'], ['create-pr', 'review'], ['review', 'merge'],
    ],
    yaml: `name: archon-fix-github-issue
version: "1.4.2"
description: Classify → investigate root cause → fix → PR → review → merge.

required_inputs:
  - GITHUB_ISSUE_URL
  - BASE_BRANCH

optional_inputs:
  - REVIEWER_NOTES
  - MAX_ATTEMPTS

when_to_use: |
  Use when a GitHub issue needs autonomous resolution — bug fixes,
  small features with clear acceptance criteria. Produces a validated
  PR ready for human review.

nodes:
  classify:
    type: prompt
    model: claude-opus-4
    prompt: "Classify the issue at $GITHUB_ISSUE_URL. Output: type, severity, complexity."

  invest:
    type: prompt
    depends_on: [classify]
    model: claude-opus-4
    prompt: "Investigate root cause. Repo: $BASE_BRANCH. Issue: $GITHUB_ISSUE_URL."

  fix:
    type: bash
    depends_on: [invest]
    command: hermes apply-fix --branch fix/$ISSUE_ID --base $BASE_BRANCH

  validate:
    type: bash
    depends_on: [fix]
    command: pnpm test --reporter=verbose

  create-pr:
    type: command
    depends_on: [fix]
    command: gh pr create --title "$ISSUE_TITLE" --body "$PR_BODY" --base $BASE_BRANCH

  review:
    type: prompt
    depends_on: [validate, create-pr]
    model: claude-sonnet-4-5
    prompt: "Review the PR for correctness, security, and test coverage."

  merge:
    type: approval
    depends_on: [review]
    prompt: "Approve to merge the PR."
`,
  },
  {
    id: 'archon-idea-to-pr',
    name: 'Idea → PR',
    description: 'End-to-end: autonomous plan → implement → PR → review → merge.',
    source: 'bundled',
    tags: ['idea', 'planning', 'pr'],
    node_count: 9,
    last_used_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: true,
    required_inputs: ['IDEA_DESCRIPTION', 'BASE_BRANCH'],
    optional_inputs: ['DOCS_DIR', 'REVIEWER_NOTES'],
    when_to_use:
      'Use for new feature requests where no prior plan exists. Hermes autonomously creates a plan, implements it across parallel sub-agents, and produces a fully reviewed PR.',
    dag_depth: 5,
    max_parallelism: 3,
    run_count: 23,
    dag: [
      { id: 'plan',       label: 'Plan',         type: 'prompt',   cx: 60,  cy: 60 },
      { id: 'impl-a',     label: 'Impl A',        type: 'bash',     cx: 200, cy: 30 },
      { id: 'impl-b',     label: 'Impl B',        type: 'bash',     cx: 200, cy: 90 },
      { id: 'validate',   label: 'Validate',      type: 'bash',     cx: 340, cy: 60 },
      { id: 'create-pr',  label: 'Create PR',     type: 'command',  cx: 480, cy: 60 },
      { id: 'review',     label: 'Review',        type: 'prompt',   cx: 620, cy: 60 },
      { id: 'merge',      label: 'Merge',         type: 'approval', cx: 760, cy: 60 },
    ],
    dag_edges: [
      ['plan', 'impl-a'], ['plan', 'impl-b'],
      ['impl-a', 'validate'], ['impl-b', 'validate'],
      ['validate', 'create-pr'], ['create-pr', 'review'], ['review', 'merge'],
    ],
    yaml: `name: archon-idea-to-pr
version: "1.2.0"
description: End-to-end — autonomous plan → implement → PR → review → merge.

required_inputs:
  - IDEA_DESCRIPTION
  - BASE_BRANCH

optional_inputs:
  - DOCS_DIR
  - REVIEWER_NOTES

when_to_use: |
  Use for new feature requests where no prior plan exists. Hermes
  autonomously creates a plan, implements it across parallel sub-agents,
  and produces a fully reviewed PR.

nodes:
  plan:
    type: prompt
    model: claude-opus-4
    prompt: "Create a detailed implementation plan for: $IDEA_DESCRIPTION"

  impl-a:
    type: bash
    depends_on: [plan]
    command: hermes implement --plan $PLAN_PATH --shard a

  impl-b:
    type: bash
    depends_on: [plan]
    command: hermes implement --plan $PLAN_PATH --shard b

  validate:
    type: bash
    depends_on: [impl-a, impl-b]
    command: pnpm test && pnpm tsc --noEmit

  create-pr:
    type: command
    depends_on: [validate]
    command: gh pr create --title "$IDEA_DESCRIPTION" --base $BASE_BRANCH

  review:
    type: prompt
    depends_on: [create-pr]
    model: claude-sonnet-4-5
    prompt: "Review this PR for completeness relative to the original idea."

  merge:
    type: approval
    depends_on: [review]
    prompt: "Approve to merge the implementation PR."
`,
  },
  {
    id: 'archon-plan-to-pr',
    name: 'Plan → PR',
    description: 'Existing plan → implement → PR → review.',
    source: 'bundled',
    tags: ['plan', 'pr'],
    node_count: 6,
    last_used_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: true,
    required_inputs: ['PLAN_PATH', 'BASE_BRANCH'],
    optional_inputs: ['REVIEWER_NOTES'],
    when_to_use:
      'Use when a plan document already exists and needs execution. Skips the planning phase for faster iteration on well-scoped work.',
    dag_depth: 4,
    max_parallelism: 1,
    run_count: 31,
    dag: [
      { id: 'read',      label: 'Read Plan',   type: 'prompt',   cx: 60,  cy: 50 },
      { id: 'impl',      label: 'Implement',   type: 'bash',     cx: 195, cy: 50 },
      { id: 'test',      label: 'Test',         type: 'bash',     cx: 330, cy: 50 },
      { id: 'create-pr', label: 'Create PR',   type: 'command',  cx: 465, cy: 50 },
      { id: 'review',    label: 'Review',       type: 'prompt',   cx: 600, cy: 50 },
      { id: 'merge',     label: 'Merge',        type: 'approval', cx: 735, cy: 50 },
    ],
    dag_edges: [
      ['read', 'impl'], ['impl', 'test'], ['test', 'create-pr'],
      ['create-pr', 'review'], ['review', 'merge'],
    ],
    yaml: `name: archon-plan-to-pr
version: "1.3.1"
description: Existing plan → implement → PR → review.

required_inputs:
  - PLAN_PATH
  - BASE_BRANCH

optional_inputs:
  - REVIEWER_NOTES

when_to_use: |
  Use when a plan document already exists and needs execution.
  Skips the planning phase for faster iteration on well-scoped work.

nodes:
  read:
    type: prompt
    model: claude-opus-4
    prompt: "Parse and understand the plan at $PLAN_PATH. Extract tasks."

  impl:
    type: bash
    depends_on: [read]
    command: hermes implement --plan $PLAN_PATH --base $BASE_BRANCH

  test:
    type: bash
    depends_on: [impl]
    command: pnpm test

  create-pr:
    type: command
    depends_on: [test]
    command: gh pr create --base $BASE_BRANCH

  review:
    type: prompt
    depends_on: [create-pr]
    model: claude-sonnet-4-5
    prompt: "Review the PR against the original plan."

  merge:
    type: approval
    depends_on: [review]
    prompt: "Approve to merge."
`,
  },
  {
    id: 'archon-feature-development',
    name: 'Feature Development',
    description: 'Implement from existing plan → validate → PR.',
    source: 'bundled',
    tags: ['feature', 'implement'],
    node_count: 5,
    last_used_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['FEATURE_SPEC', 'BASE_BRANCH'],
    optional_inputs: ['DOCS_DIR'],
    when_to_use:
      'Lighter than idea-to-pr. Best for bounded feature work with a clear spec. Skips planning and review orchestration.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 18,
    dag: [
      { id: 'impl',      label: 'Implement',  type: 'bash',    cx: 60,  cy: 50 },
      { id: 'lint',      label: 'Lint',        type: 'bash',    cx: 200, cy: 20 },
      { id: 'test',      label: 'Test',         type: 'bash',    cx: 200, cy: 80 },
      { id: 'create-pr', label: 'Create PR',  type: 'command', cx: 340, cy: 50 },
      { id: 'summary',   label: 'Summarize',  type: 'prompt',  cx: 480, cy: 50 },
    ],
    dag_edges: [
      ['impl', 'lint'], ['impl', 'test'],
      ['lint', 'create-pr'], ['test', 'create-pr'], ['create-pr', 'summary'],
    ],
    yaml: `name: archon-feature-development
version: "1.1.0"
description: Implement from existing plan → validate → PR.

required_inputs:
  - FEATURE_SPEC
  - BASE_BRANCH

optional_inputs:
  - DOCS_DIR

when_to_use: |
  Lighter than idea-to-pr. Best for bounded feature work with a clear spec.
  Skips planning and review orchestration.

nodes:
  impl:
    type: bash
    command: hermes implement --spec $FEATURE_SPEC --base $BASE_BRANCH

  lint:
    type: bash
    depends_on: [impl]
    command: pnpm lint --fix

  test:
    type: bash
    depends_on: [impl]
    command: pnpm test

  create-pr:
    type: command
    depends_on: [lint, test]
    command: gh pr create --base $BASE_BRANCH --title "$FEATURE_SPEC"

  summary:
    type: prompt
    depends_on: [create-pr]
    model: claude-haiku-4-5
    prompt: "Summarize what was built and any caveats."
`,
  },
  {
    id: 'archon-smart-pr-review',
    name: 'Smart PR Review',
    description: '5-agent parallel review fan-out with classifier router → synthesized report.',
    source: 'bundled',
    tags: ['pr', 'review', 'parallel'],
    node_count: 8,
    last_used_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['PR_URL'],
    optional_inputs: ['FOCUS_AREAS'],
    when_to_use:
      'Default PR review. Analyzes PR complexity first, then spawns only the relevant review agents. Faster than comprehensive for routine changes.',
    dag_depth: 3,
    max_parallelism: 5,
    run_count: 62,
    dag: [
      { id: 'classify',    label: 'Classify PR',   type: 'router',  cx: 60,  cy: 70 },
      { id: 'correctness', label: 'Correctness',   type: 'prompt',  cx: 210, cy: 20 },
      { id: 'security',    label: 'Security',      type: 'prompt',  cx: 210, cy: 50 },
      { id: 'perf',        label: 'Performance',   type: 'prompt',  cx: 210, cy: 80 },
      { id: 'style',       label: 'Style',         type: 'prompt',  cx: 210, cy: 110 },
      { id: 'tests',       label: 'Tests',         type: 'prompt',  cx: 210, cy: 140 },
      { id: 'synthesize',  label: 'Synthesize',    type: 'prompt',  cx: 380, cy: 70 },
      { id: 'comment',     label: 'PR Comment',    type: 'command', cx: 530, cy: 70 },
    ],
    dag_edges: [
      ['classify', 'correctness'], ['classify', 'security'], ['classify', 'perf'],
      ['classify', 'style'], ['classify', 'tests'],
      ['correctness', 'synthesize'], ['security', 'synthesize'],
      ['perf', 'synthesize'], ['style', 'synthesize'], ['tests', 'synthesize'],
      ['synthesize', 'comment'],
    ],
    yaml: `name: archon-smart-pr-review
version: "1.1.5"
description: 5-agent parallel review fan-out with classifier router.

required_inputs:
  - PR_URL

optional_inputs:
  - FOCUS_AREAS

when_to_use: |
  Default PR review. Analyzes PR complexity first, then spawns only
  the relevant review agents.

nodes:
  classify:
    type: router
    model: claude-haiku-4-5
    prompt: "Classify PR $PR_URL. Determine which review dimensions are relevant."
    routes: [correctness, security, perf, style, tests]

  correctness:
    type: prompt
    depends_on: [classify]
    model: claude-sonnet-4-5
    prompt: "Review $PR_URL for logical correctness and edge cases."

  security:
    type: prompt
    depends_on: [classify]
    model: claude-sonnet-4-5
    prompt: "Review $PR_URL for security vulnerabilities."

  perf:
    type: prompt
    depends_on: [classify]
    model: claude-sonnet-4-5
    prompt: "Review $PR_URL for performance issues."

  style:
    type: prompt
    depends_on: [classify]
    model: claude-haiku-4-5
    prompt: "Review $PR_URL for code style and conventions."

  tests:
    type: prompt
    depends_on: [classify]
    model: claude-sonnet-4-5
    prompt: "Review $PR_URL test coverage and quality."

  synthesize:
    type: prompt
    depends_on: [correctness, security, perf, style, tests]
    model: claude-opus-4
    prompt: "Synthesize all review findings into a structured report."

  comment:
    type: command
    depends_on: [synthesize]
    command: gh pr review $PR_URL --comment --body "$REPORT"
`,
  },
  {
    id: 'archon-interactive-prd',
    name: 'Interactive PRD',
    description: 'Guided PRD creation with 3 approval gates and iterative refinement.',
    source: 'bundled',
    tags: ['prd', 'planning', 'approval'],
    node_count: 7,
    last_used_at: null,
    version_tier: 'v1',
    has_loop: false,
    has_approval: true,
    required_inputs: ['GOAL_DESCRIPTION'],
    optional_inputs: ['EXISTING_DOCS', 'STAKEHOLDERS'],
    when_to_use:
      'Use when a feature needs a properly scoped PRD before implementation. Guides through goal alignment, user stories, acceptance criteria, and technical constraints with approval gates.',
    dag_depth: 5,
    max_parallelism: 1,
    run_count: 8,
    dag: [
      { id: 'goals',    label: 'Goals',          type: 'approval', cx: 60,  cy: 50 },
      { id: 'stories',  label: 'User Stories',   type: 'prompt',   cx: 195, cy: 50 },
      { id: 'criteria', label: 'Acceptance',     type: 'approval', cx: 330, cy: 50 },
      { id: 'tech',     label: 'Tech Spec',      type: 'prompt',   cx: 465, cy: 50 },
      { id: 'review',   label: 'Final Review',   type: 'approval', cx: 600, cy: 50 },
      { id: 'save',     label: 'Save PRD',       type: 'command',  cx: 735, cy: 50 },
    ],
    dag_edges: [
      ['goals', 'stories'], ['stories', 'criteria'], ['criteria', 'tech'],
      ['tech', 'review'], ['review', 'save'],
    ],
    yaml: `name: archon-interactive-prd
version: "1.0.0"
description: Guided PRD creation with 3 approval gates.

required_inputs:
  - GOAL_DESCRIPTION

optional_inputs:
  - EXISTING_DOCS
  - STAKEHOLDERS

when_to_use: |
  Use when a feature needs a properly scoped PRD before implementation.
  Guides through goal alignment, user stories, acceptance criteria,
  and technical constraints with approval gates.

nodes:
  goals:
    type: approval
    prompt: "Review and approve the goal definition: $GOAL_DESCRIPTION"

  stories:
    type: prompt
    depends_on: [goals]
    model: claude-opus-4
    prompt: "Generate user stories from: $GOAL_DESCRIPTION"

  criteria:
    type: approval
    depends_on: [stories]
    prompt: "Approve acceptance criteria before tech spec phase."

  tech:
    type: prompt
    depends_on: [criteria]
    model: claude-opus-4
    prompt: "Generate technical specification and constraints."

  review:
    type: approval
    depends_on: [tech]
    prompt: "Final PRD review — approve to save."

  save:
    type: command
    depends_on: [review]
    command: hermes prd save --output docs/prd-$GOAL_SLUG.md
`,
  },
  {
    id: 'archon-piv-loop',
    name: 'PIV Loop',
    description: 'Plan → Implement → Validate loop with user_input_prompt until passing.',
    source: 'bundled',
    tags: ['loop', 'implement', 'validate'],
    node_count: 6,
    last_used_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: true,
    has_approval: false,
    required_inputs: ['TASK_DESCRIPTION'],
    optional_inputs: ['MAX_CYCLES'],
    when_to_use:
      'For complex tasks requiring iterative refinement. Each cycle presents results for human review before proceeding. Best for novel or high-risk implementations.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 14,
    dag: [
      { id: 'plan',     label: 'Plan',      type: 'prompt',   cx: 60,  cy: 50 },
      { id: 'impl',     label: 'Implement', type: 'bash',     cx: 210, cy: 50 },
      { id: 'validate', label: 'Validate',  type: 'bash',     cx: 360, cy: 50 },
      { id: 'check',    label: 'Check',     type: 'router',   cx: 510, cy: 50 },
      { id: 'done',     label: 'Done',      type: 'command',  cx: 660, cy: 20 },
      { id: 'loop',     label: 'Loop',      type: 'loop',     cx: 360, cy: 100 },
    ],
    dag_edges: [
      ['plan', 'impl'], ['impl', 'validate'], ['validate', 'check'],
      ['check', 'done'], ['check', 'loop'], ['loop', 'impl'],
    ],
    yaml: `name: archon-piv-loop
version: "1.0.3"
description: Plan → Implement → Validate loop until passing.

required_inputs:
  - TASK_DESCRIPTION

optional_inputs:
  - MAX_CYCLES

when_to_use: |
  For complex tasks requiring iterative refinement. Each cycle presents
  results for human review before proceeding.

nodes:
  plan:
    type: prompt
    model: claude-opus-4
    prompt: "Plan implementation for: $TASK_DESCRIPTION"

  impl:
    type: bash
    depends_on: [plan]
    command: hermes implement --task "$TASK_DESCRIPTION"

  validate:
    type: bash
    depends_on: [impl]
    command: pnpm test && pnpm tsc --noEmit

  check:
    type: router
    depends_on: [validate]
    condition: "$VALIDATION_PASSED == true"
    on_true: done
    on_false: loop

  done:
    type: command
    depends_on: [check]
    command: echo "PIV loop completed successfully."

  loop:
    type: loop
    depends_on: [check]
    target: impl
    max_iterations: "{{ MAX_CYCLES | default(5) }}"
`,
  },
  {
    id: 'archon-resolve-conflicts',
    name: 'Resolve Merge Conflicts',
    description: 'Autonomously detect and resolve git merge conflicts with context-aware strategy.',
    source: 'bundled',
    tags: ['git', 'conflicts'],
    node_count: 4,
    last_used_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    version_tier: 'v1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['BRANCH', 'TARGET_BRANCH'],
    optional_inputs: [],
    when_to_use:
      'Use before merging to confirm no regressions. Runs full test suite on both branches in parallel and diffs the results.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 9,
    dag: [
      { id: 'detect',  label: 'Detect',   type: 'bash',    cx: 60,  cy: 50 },
      { id: 'resolve', label: 'Resolve',  type: 'prompt',  cx: 195, cy: 50 },
      { id: 'test',    label: 'Test',      type: 'bash',    cx: 330, cy: 50 },
      { id: 'push',    label: 'Push',     type: 'command', cx: 465, cy: 50 },
    ],
    dag_edges: [['detect', 'resolve'], ['resolve', 'test'], ['test', 'push']],
    yaml: `name: archon-resolve-conflicts
version: "1.0.0"
description: Autonomously detect and resolve git merge conflicts.

required_inputs:
  - BRANCH
  - TARGET_BRANCH

when_to_use: |
  Use before merging to confirm no regressions. Runs full test suite
  on both branches in parallel and diffs the results.

nodes:
  detect:
    type: bash
    command: git merge-tree $(git merge-base $BRANCH $TARGET_BRANCH) $BRANCH $TARGET_BRANCH

  resolve:
    type: prompt
    depends_on: [detect]
    model: claude-opus-4
    prompt: "Resolve the merge conflicts found. Prefer $TARGET_BRANCH semantics."

  test:
    type: bash
    depends_on: [resolve]
    command: pnpm test

  push:
    type: command
    depends_on: [test]
    command: git push origin $BRANCH
`,
  },

  // ── v1.1 deferred ────────────────────────────────────────────────────────────
  {
    id: 'archon-validate-pr',
    name: 'Validate PR',
    description: 'Run tests, lint, and type-check on a PR branch and report results.',
    source: 'bundled',
    tags: ['pr', 'validation', 'ci'],
    node_count: 5,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['PR_URL'],
    optional_inputs: [],
    when_to_use: 'Use to validate a PR without full review. Runs CI checks and reports.',
    dag_depth: 2,
    max_parallelism: 3,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-validate-pr\nversion "1.0.0"\n  description Run tests lint and type-check on a PR branch.\n  steps:\n    - name: lint\n      run: pnpm lint\n    - name: tsc\n      run: pnpm tsc --noEmit\n    {invalid_yaml_on_purpose\n`,
  },
  {
    id: 'archon-create-issue',
    name: 'Create Issue',
    description: 'Draft and file a GitHub issue from a natural-language description.',
    source: 'bundled',
    tags: ['github', 'issue'],
    node_count: 3,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['ISSUE_DESCRIPTION'],
    optional_inputs: ['LABELS', 'ASSIGNEE'],
    when_to_use: 'Use to quickly file a well-structured GitHub issue from plain text.',
    dag_depth: 2,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-create-issue\nversion: "1.0.0"\ndescription: Draft and file a GitHub issue.\n`,
  },
  {
    id: 'archon-architect',
    name: 'Architect',
    description: 'Deep architectural analysis and design doc generation for a codebase or feature.',
    source: 'bundled',
    tags: ['architecture', 'planning'],
    node_count: 4,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['TARGET_PATH'],
    optional_inputs: ['FOCUS'],
    when_to_use: 'Use for architectural analysis and design doc generation.',
    dag_depth: 2,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-architect\nversion: "1.0.0"\ndescription: Deep architectural analysis.\n`,
  },
  {
    id: 'archon-refactor-safely',
    name: 'Refactor Safely',
    description: 'Refactor a file or module with automatic test coverage and rollback guards.',
    source: 'bundled',
    tags: ['refactor', 'safety'],
    node_count: 6,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['TARGET_PATH'],
    optional_inputs: ['REFACTOR_GOAL'],
    when_to_use:
      'For structural code changes where correctness must be continuously verified. Each refactor step is validated before the next begins.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-refactor-safely\nversion: "1.0.0"\ndescription: Safe refactoring with rollback guards.\n`,
  },
  {
    id: 'archon-adversarial-dev',
    name: 'Adversarial Dev',
    description: 'State-machine loop: implement → red-team → score-threshold branch → iterate.',
    source: 'bundled',
    tags: ['loop', 'adversarial', 'quality'],
    node_count: 8,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: true,
    has_approval: false,
    required_inputs: ['TASK_DESCRIPTION'],
    optional_inputs: ['SCORE_THRESHOLD'],
    when_to_use:
      'For building complete applications from scratch. A planner designs the architecture, a builder implements it, and an evaluator adversarially tests and critiques. Cycles until approved.',
    dag_depth: 4,
    max_parallelism: 2,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-adversarial-dev\nversion: "1.0.0"\ndescription: State-machine loop with red-team scoring.\n`,
  },
  {
    id: 'archon-ralph-dag',
    name: 'Ralph DAG',
    description: 'Self-referential DAG with branching input detection and story-driven scheduling.',
    source: 'bundled',
    tags: ['dag', 'scheduling', 'loop'],
    node_count: 10,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: true,
    has_approval: false,
    required_inputs: ['STORY_LIST'],
    optional_inputs: [],
    when_to_use: 'Self-referential DAG for story-driven autonomous scheduling.',
    dag_depth: 5,
    max_parallelism: 4,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-ralph-dag\nversion: "1.0.0"\ndescription: Self-referential DAG scheduler.\n`,
  },
  {
    id: 'archon-comprehensive-pr-review',
    name: 'Comprehensive PR Review',
    description: '5 parallel review agents forced to review all dimensions regardless of classifier.',
    source: 'bundled',
    tags: ['pr', 'review', 'parallel'],
    node_count: 9,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['PR_URL'],
    optional_inputs: [],
    when_to_use:
      'For high-stakes PRs: security-sensitive changes, public API changes, large refactors. Runs 5 specialized agents in parallel: correctness, security, performance, style, and test coverage.',
    dag_depth: 3,
    max_parallelism: 5,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-comprehensive-pr-review\nversion: "1.0.0"\ndescription: 5 parallel review agents on all dimensions.\n`,
  },
  {
    id: 'archon-issue-review-full',
    name: 'Issue Review Full',
    description: 'Full audit of a GitHub issue: triage, context, duplicates, fix estimate.',
    source: 'bundled',
    tags: ['github', 'issue', 'review'],
    node_count: 5,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['ISSUE_URL'],
    optional_inputs: [],
    when_to_use: 'Full audit of a GitHub issue including duplicate detection and fix estimate.',
    dag_depth: 2,
    max_parallelism: 2,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-issue-review-full\nversion: "1.0.0"\ndescription: Full GitHub issue audit.\n`,
  },
  {
    id: 'archon-test-loop-dag',
    name: 'Test Loop DAG',
    description: 'Iterative test-fix loop: run tests → identify failures → patch → repeat.',
    source: 'bundled',
    tags: ['testing', 'loop', 'dag'],
    node_count: 5,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: true,
    has_approval: false,
    required_inputs: ['TEST_COMMAND'],
    optional_inputs: ['MAX_ITERATIONS'],
    when_to_use: 'Iterative test-fix loop until all tests pass.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-test-loop-dag\nversion: "1.0.0"\ndescription: Iterative test-fix loop.\n`,
  },
  {
    id: 'archon-assist',
    name: 'Assist',
    description: 'General-purpose assistant workflow — flexible prompt with tool access.',
    source: 'bundled',
    tags: ['general', 'assistant'],
    node_count: 2,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['TASK'],
    optional_inputs: [],
    when_to_use:
      "Fallback workflow for tasks that don't match any specialist workflow. Routes through a general-purpose Hermes session with output summarization.",
    dag_depth: 1,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-assist\nversion: "1.0.0"\ndescription: General-purpose assistant workflow.\n`,
  },
  {
    id: 'archon-workflow-builder',
    name: 'Workflow Builder',
    description: 'Meta-workflow: generate a new workflow YAML from a natural-language spec.',
    source: 'bundled',
    tags: ['meta', 'builder'],
    node_count: 4,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: true,
    required_inputs: ['WORKFLOW_DESCRIPTION'],
    optional_inputs: [],
    when_to_use:
      'Use when you want to create a new custom workflow. Describe what you want in natural language; Hermes generates a valid YAML DAG, validates it, and saves it.',
    dag_depth: 2,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-workflow-builder\nversion: "1.0.0"\ndescription: Generate workflow YAML from natural language.\n`,
  },
  {
    id: 'archon-remotion-generate',
    name: 'Remotion Generate',
    description: 'Generate a Remotion video composition from a script and render to mp4.',
    source: 'bundled',
    tags: ['video', 'remotion'],
    node_count: 5,
    last_used_at: null,
    version_tier: 'v1.1',
    has_loop: false,
    has_approval: false,
    required_inputs: ['SCRIPT_PATH'],
    optional_inputs: ['OUTPUT_DIR'],
    when_to_use:
      'Automates Remotion video generation from a script. Renders to mp4 and saves to the configured output directory.',
    dag_depth: 3,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: `name: archon-remotion-generate\nversion: "1.0.0"\ndescription: Generate and render a Remotion composition.\n`,
  },
]

/** Return human-readable relative time ("3h ago", "2d ago") or "—" if null. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
