/* Hermes · Workflows — React app */
const { useState, useMemo } = React;

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════
const CAT_COLOR = {
  pipeline:'#ffb454', review:'#5ad3ff', interactive:'#b07cff',
  specialist:'#00ff41', implementation:'#ff5fa2', utility:'#d6ff5f', ops:'#d6ff5f',
};
const NODE_COLOR = {
  prompt:'#5ad3ff', bash:'#ffb454', script:'#b07cff',
  command:'#00ff41', loop:'#d6ff5f', approval:'#ff5fa2',
};
const SOURCE_LABEL = { bundled:'Bundled', user:'User', project:'Project' };

// ═══════════════════════════════════════════════════════
// WORKFLOW DATA
// ═══════════════════════════════════════════════════════
const WORKFLOWS = [
  { id:'archon-fix-github-issue', name:'Fix GitHub Issue',
    desc:'Classify → investigate root cause → fix → PR → review → merge.',
    source:'bundled', category:'pipeline',
    path:'~/.hermes/workflows/defaults/archon-fix-github-issue.yaml',
    tags:['github','fix','pr'], nodes:7, depth:4, parallel:2,
    required:['GITHUB_ISSUE_URL','BASE_BRANCH'], optional:['REVIEWER_NOTES','MAX_ATTEMPTS'],
    last_run:'2 hr ago', runs:47, version:'1.4.2', checksum:'a8f2c1d4e9b3',
    when_to_use:'Use when a GitHub issue needs autonomous resolution — bug fixes, small features with clear acceptance criteria. Produces a validated PR ready for human review. Requires a public or accessible repository.',
    dag:[
      {id:'classify',  label:'Classify Issue', type:'prompt',   cx:60,  cy:50},
      {id:'invest',    label:'Investigate',    type:'prompt',   cx:195, cy:50},
      {id:'fix',       label:'Generate Fix',   type:'bash',     cx:330, cy:50},
      {id:'validate',  label:'Validate',       type:'bash',     cx:465, cy:20},
      {id:'create-pr', label:'Create PR',      type:'command',  cx:465, cy:82},
      {id:'review',    label:'Review PR',      type:'prompt',   cx:600, cy:50},
      {id:'merge',     label:'Merge',          type:'approval', cx:735, cy:50},
    ],
    edges:[['classify','invest'],['invest','fix'],['fix','validate'],['fix','create-pr'],['validate','review'],['create-pr','review'],['review','merge']],
  },
  { id:'archon-idea-to-pr', name:'Idea → PR',
    desc:'End-to-end: autonomous plan → implement → PR → review → merge.',
    source:'bundled', category:'pipeline',
    path:'~/.hermes/workflows/defaults/archon-idea-to-pr.yaml',
    tags:['idea','planning','pr'], nodes:9, depth:5, parallel:3,
    required:['IDEA_DESCRIPTION','BASE_BRANCH'], optional:['DOCS_DIR','REVIEWER_NOTES'],
    last_run:'4 hr ago', runs:23, version:'1.2.0', checksum:'b3d7f2a1c4e8',
    when_to_use:'Use for new feature requests where no prior plan exists. Hermes autonomously creates a plan, implements it across parallel sub-agents, and produces a fully reviewed PR.',
    dag:[], edges:[],
  },
  { id:'archon-plan-to-pr', name:'Plan → PR',
    desc:'Existing plan → implement → PR → review.',
    source:'bundled', category:'pipeline',
    path:'~/.hermes/workflows/defaults/archon-plan-to-pr.yaml',
    tags:['plan','pr'], nodes:6, depth:4, parallel:2,
    required:['PLAN_PATH','BASE_BRANCH'], optional:['REVIEWER_NOTES'],
    last_run:'1 day ago', runs:31, version:'1.3.1', checksum:'c1a9e3d7f2b4',
    when_to_use:'Use when a plan document already exists and needs execution. Skips the planning phase for faster iteration on well-scoped work.',
    dag:[], edges:[],
  },
  { id:'archon-feature-development', name:'Feature Development',
    desc:'Implement from existing plan → validate → PR.',
    source:'bundled', category:'pipeline',
    path:'~/.hermes/workflows/defaults/archon-feature-development.yaml',
    tags:['feature','implement'], nodes:5, depth:3, parallel:2,
    required:['FEATURE_PLAN','BASE_BRANCH'], optional:['TEST_PATTERN'],
    last_run:'6 hr ago', runs:18, version:'1.1.0', checksum:'d4b2f8c3a1e7',
    when_to_use:'Lighter than idea-to-pr. Best for bounded feature work with a clear spec. Skips planning and review orchestration.',
    dag:[], edges:[],
  },
  { id:'archon-comprehensive-pr-review', name:'Comprehensive PR Review',
    desc:'5 parallel review agents → synthesize → fix suggestions.',
    source:'bundled', category:'review',
    path:'~/.hermes/workflows/defaults/archon-comprehensive-pr-review.yaml',
    tags:['review','pr','parallel'], nodes:8, depth:3, parallel:5,
    required:['PR_URL'], optional:['REVIEW_FOCUS'],
    last_run:'30 min ago', runs:82, version:'1.5.0', checksum:'e7c3a9d2f4b1',
    when_to_use:'For high-stakes PRs: security-sensitive changes, public API changes, large refactors. Runs 5 specialized agents in parallel: correctness, security, performance, style, and test coverage.',
    dag:[], edges:[],
  },
  { id:'archon-smart-pr-review', name:'Smart PR Review',
    desc:'Complexity-adaptive review — spawns only relevant agents.',
    source:'bundled', category:'review',
    path:'~/.hermes/workflows/defaults/archon-smart-pr-review.yaml',
    tags:['review','pr','adaptive'], nodes:5, depth:3, parallel:3,
    required:['PR_URL'], optional:[],
    last_run:'45 min ago', runs:134, version:'1.3.0', checksum:'f2e4b1c8d3a7',
    when_to_use:'Default PR review. Analyzes PR complexity first, then spawns only the relevant review agents. Faster than comprehensive for routine changes.',
    dag:[], edges:[],
  },
  { id:'archon-validate-pr', name:'Validate PR',
    desc:'Parallel test run on main vs feature branch — diff results.',
    source:'bundled', category:'review',
    path:'~/.hermes/workflows/defaults/archon-validate-pr.yaml',
    tags:['test','validation'], nodes:4, depth:2, parallel:2,
    required:['PR_URL','BASE_BRANCH'], optional:['TEST_COMMAND'],
    last_run:'1 hr ago', runs:56, version:'1.2.1', checksum:'a3d7b2e9c4f1',
    when_to_use:'Use before merging to confirm no regressions. Runs full test suite on both branches in parallel and diffs the results.',
    dag:[], edges:[],
  },
  { id:'archon-interactive-prd', name:'Interactive PRD',
    desc:'Guided multi-round PRD creation with human-in-the-loop approval gates.',
    source:'bundled', category:'interactive',
    path:'~/.hermes/workflows/defaults/archon-interactive-prd.yaml',
    tags:['prd','planning','interactive'], nodes:6, depth:4, parallel:1,
    required:['FEATURE_BRIEF'], optional:['STAKEHOLDER_NOTES'],
    last_run:'2 days ago', runs:12, version:'1.0.3', checksum:'b4a1c9e2d7f3',
    when_to_use:'Use when a feature needs a properly scoped PRD before implementation. Guides through goal alignment, user stories, acceptance criteria, and technical constraints with approval gates.',
    dag:[], edges:[],
  },
  { id:'archon-piv-loop', name:'Plan-Implement-Validate',
    desc:'Iterative PIV loop with human-in-the-loop checkpoints at each cycle.',
    source:'bundled', category:'interactive',
    path:'~/.hermes/workflows/defaults/archon-piv-loop.yaml',
    tags:['loop','iterative','guided'], nodes:5, depth:3, parallel:1,
    required:['TASK_DESCRIPTION'], optional:['MAX_ITERATIONS'],
    last_run:'3 days ago', runs:8, version:'1.0.1', checksum:'c9f2d4a3b1e8',
    when_to_use:'For complex tasks requiring iterative refinement. Each cycle presents results for human review before proceeding. Best for novel or high-risk implementations.',
    dag:[], edges:[],
  },
  { id:'archon-refactor-safely', name:'Refactor Safely',
    desc:'Safe refactoring with continuous validation at each stage.',
    source:'bundled', category:'specialist',
    path:'~/.hermes/workflows/defaults/archon-refactor-safely.yaml',
    tags:['refactor','safety'], nodes:6, depth:4, parallel:1,
    required:['TARGET_PATH','REFACTOR_GOAL'], optional:['TEST_PATTERN','SCOPE_LIMIT'],
    last_run:'5 hr ago', runs:21, version:'1.2.0', checksum:'d1b7e3f4c2a9',
    when_to_use:'For structural code changes where correctness must be continuously verified. Each refactor step is validated before the next begins.',
    dag:[], edges:[],
  },
  { id:'archon-architect', name:'Architect',
    desc:'Architecture sweep — complexity reduction and structural improvement.',
    source:'bundled', category:'specialist',
    path:'~/.hermes/workflows/defaults/archon-architect.yaml',
    tags:['architecture','health'], nodes:7, depth:3, parallel:3,
    required:['CODEBASE_PATH'], optional:['FOCUS_AREAS'],
    last_run:'1 week ago', runs:7, version:'1.1.0', checksum:'e8c4d2f1a3b7',
    when_to_use:'For codebase health improvements: dependency cleanup, dead code removal, module boundary clarification, and complexity reduction. Produces a structured refactoring roadmap.',
    dag:[], edges:[],
  },
  { id:'archon-adversarial-dev', name:'Adversarial Dev',
    desc:'GAN-style: planner vs builder vs evaluator. Full app from scratch.',
    source:'bundled', category:'implementation',
    path:'~/.hermes/workflows/defaults/archon-adversarial-dev.yaml',
    tags:['adversarial','full-build'], nodes:10, depth:5, parallel:3,
    required:['APP_SPEC','BASE_BRANCH'], optional:['TECHNOLOGY_STACK'],
    last_run:'2 weeks ago', runs:4, version:'1.0.0', checksum:'f3a9b2d7c4e1',
    when_to_use:'For building complete applications from scratch. A planner designs the architecture, a builder implements it, and an evaluator adversarially tests and critiques. Cycles until approved.',
    dag:[], edges:[],
  },
  { id:'archon-assist', name:'Assist',
    desc:'Catch-all: questions, debugging, exploration, and open-ended requests.',
    source:'bundled', category:'utility',
    path:'~/.hermes/workflows/defaults/archon-assist.yaml',
    tags:['fallback','debug'], nodes:3, depth:2, parallel:1,
    required:['USER_REQUEST'], optional:[],
    last_run:'10 min ago', runs:203, version:'1.0.5', checksum:'a1d3f7b2c9e4',
    when_to_use:'Fallback workflow for tasks that don\'t match any specialist workflow. Routes through a general-purpose Hermes session with output summarization.',
    dag:[], edges:[],
  },
  { id:'archon-workflow-builder', name:'Workflow Builder',
    desc:'Generates new custom workflow YAML from a natural language description.',
    source:'bundled', category:'utility',
    path:'~/.hermes/workflows/defaults/archon-workflow-builder.yaml',
    tags:['meta','generator'], nodes:4, depth:3, parallel:1,
    required:['WORKFLOW_DESCRIPTION'], optional:['EXAMPLE_WORKFLOW'],
    last_run:'3 days ago', runs:14, version:'1.1.0', checksum:'b7e4c1d3a9f2',
    when_to_use:'Use when you want to create a new custom workflow. Describe what you want in natural language; Hermes generates a valid YAML DAG, validates it, and saves it to your user workflow directory.',
    dag:[], edges:[],
  },
  { id:'docs-generator', name:'Docs Generator',
    desc:'Generates API docs from TypeScript source and publishes to Confluence.',
    source:'user', category:'pipeline',
    path:'~/.hermes/workflows/user/docs-generator.yaml',
    tags:['docs','api'], nodes:5, depth:3, parallel:2,
    required:['SOURCE_DIR','CONFLUENCE_SPACE'], optional:['OUTPUT_FORMAT'],
    last_run:'1 day ago', runs:8, version:'0.3.1', checksum:'c2f9a4d1b7e3',
    when_to_use:'Automates documentation generation from TypeScript source files. Parses JSDoc, generates Markdown, and pushes to the configured Confluence space.',
    dag:[], edges:[],
  },
  { id:'deploy-and-notify', name:'Deploy + Notify',
    desc:'Build → deploy to staging → smoke tests → Slack notification.',
    source:'project', category:'ops',
    path:'.hermes/workflows/deploy-and-notify.yaml',
    tags:['deploy','staging','notify'], nodes:6, depth:4, parallel:2,
    required:['BRANCH','ENVIRONMENT'], optional:['SLACK_CHANNEL'],
    last_run:'6 hr ago', runs:22, version:'1.0.0', checksum:'d4b2c8e3f1a7',
    when_to_use:'Project-specific deployment workflow. Builds the project, deploys to the specified environment, runs smoke tests, and posts a summary to Slack.',
    dag:[], edges:[],
  },
];

const YAML_STR = `name: archon-fix-github-issue
description: |
  Classify GitHub issue → investigate root cause → generate fix →
  validate → create PR → review → merge.
version: "1.4.2"
source: bundled

required_inputs:
  - GITHUB_ISSUE_URL    # The issue to resolve
  - BASE_BRANCH         # Branch to create fix from

optional_inputs:
  - REVIEWER_NOTES      # Guidance hints for the review agent
  - MAX_ATTEMPTS        # Retry limit for fix generation (default: 3)

when_to_use: |
  Use when a GitHub issue needs autonomous resolution. Best for
  well-scoped bug reports and small features with clear acceptance
  criteria.

nodes:
  classify-issue:
    type: prompt
    provider: hermes
    outputs: [type, complexity, affected_files, is_actionable]

  investigate-root-cause:
    type: prompt
    provider: claude
    depends_on: [classify-issue]
    outputs: [root_cause, fix_strategy, affected_files]

  generate-fix:
    type: bash
    provider: claude
    depends_on: [investigate-root-cause]
    script: |
      git checkout -b fix/issue-\$GITHUB_ISSUE_NUMBER \$BASE_BRANCH
    outputs: [patch_path, changed_files]

  validate-fix:
    type: bash
    depends_on: [generate-fix]
    script: npm test -- --testPathPattern=\${{ investigate-root-cause.output.affected_files }}
    outputs: [test_results, coverage_delta]

  create-pr:
    type: command
    depends_on: [generate-fix]
    command: create-pull-request
    inputs:
      title: "fix: \${{ classify-issue.output.title }}"
      base: \$BASE_BRANCH
    outputs: [pr_url, pr_number]

  review-pr:
    type: prompt
    provider: claude
    depends_on: [validate-fix, create-pr]
    inputs:
      pr_url: \${{ create-pr.output.pr_url }}
    outputs: [approved, review_comments]

  merge-pr:
    type: approval
    depends_on: [review-pr]
    condition: \${{ review-pr.output.approved }}
    message: |
      PR \${{ create-pr.output.pr_url }} is ready to merge.`;

const HISTORY = [
  {id:'run-0047', started:'2 hr ago',   status:'completed', duration:'4m 12s', who:'default', phase:'merge'},
  {id:'run-0046', started:'8 hr ago',   status:'completed', duration:'5m 44s', who:'default', phase:'merge'},
  {id:'run-0045', started:'1 day ago',  status:'failed',    duration:'2m 08s', who:'neo',     phase:'validate'},
  {id:'run-0044', started:'1 day ago',  status:'completed', duration:'6m 01s', who:'default', phase:'merge'},
  {id:'run-0043', started:'2 days ago', status:'aborted',   duration:'1m 33s', who:'default', phase:'generate-fix'},
  {id:'run-0042', started:'2 days ago', status:'completed', duration:'4m 55s', who:'trinity', phase:'merge'},
];

const WIZARD_CHAT = [
  {role:'assistant', msg:"I'll launch **Fix GitHub Issue** for you. What's the GitHub issue URL?"},
  {role:'user',      msg:'https://github.com/hermes-switchui/issues/1247'},
  {role:'assistant', msg:"Got it — issue #1247: *\"Kanban board doesn't refresh after SSE task status change\"*. Well-scoped bug.\n\nWhich base branch?"},
  {role:'user',      msg:'main'},
  {role:'assistant', msg:"**Plan confirmed.**\n\n- Issue: #1247 — SSE task refresh bug\n- Base: `main`\n- Path: classify → investigate → fix → validate → PR → review → merge\n- Est. time: 4–6 min\n\nAll required inputs are set. Ready to route."},
];

// ═══════════════════════════════════════════════════════
// MICRO-COMPONENTS
// ═══════════════════════════════════════════════════════
function SearchInput({value, onChange, placeholder='Search…'}) {
  return (
    <div className="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input className="search-inp" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );
}

function SourceBadge({source}) {
  const cls = {bundled:'src-bundled', user:'src-user', project:'src-project'}[source]||'src-bundled';
  return <span className={`src-badge ${cls}`}>{SOURCE_LABEL[source]||source}</span>;
}

function NodeTypeBadge({type}) {
  return <span className="node-type-badge" style={{color:NODE_COLOR[type]||'#aaa',borderColor:(NODE_COLOR[type]||'#aaa')+'55'}}>{type}</span>;
}

function RunStatus({status}) {
  const c = {completed:'var(--m-green-500)',failed:'#ff5fa2',aborted:'#ffb454',running:'#5ad3ff'}[status]||'var(--m-text-faint)';
  return <span style={{display:'inline-flex',alignItems:'center',gap:'5px',font:'500 10px var(--m-font-mono)',textTransform:'uppercase',letterSpacing:'.12em',color:c}}>
    <span style={{width:'5px',height:'5px',borderRadius:'50%',background:c,boxShadow:`0 0 5px ${c}`}}></span>{status}
  </span>;
}

function IcoBtn({title,onClick,children}) {
  return <button className="ico-btn" title={title} onClick={onClick}>{children}</button>;
}

// ═══════════════════════════════════════════════════════
// LIBRARY (left panel)
// ═══════════════════════════════════════════════════════
function WorkflowLibrary({workflows, selected, onSelect, onNew, onImport, collapsed, setCollapsed}) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');

  const filtered = useMemo(()=>workflows.filter(w=>{
    if (scope!=='all' && w.source!==scope) return false;
    if (search && !w.name.toLowerCase().includes(search.toLowerCase()) && !w.tags.some(t=>t.includes(search.toLowerCase()))) return false;
    return true;
  }), [workflows, scope, search]);

  const counts = useMemo(()=>({
    all: workflows.length,
    bundled: workflows.filter(w=>w.source==='bundled').length,
    user: workflows.filter(w=>w.source==='user').length,
    project: workflows.filter(w=>w.source==='project').length,
  }), [workflows]);

  if (collapsed) {
    return (
      <div className="wf-library is-collapsed">
        <div className="lib-head" style={{justifyContent:'center',padding:'12px 0 10px'}}>
          <IcoBtn title="Expand library" onClick={()=>setCollapsed(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18l6-6-6-6"/></svg>
          </IcoBtn>
        </div>
        <div className="lib-rail">
          <span className="vlabel">Workflows</span>
          <span className="rail-ct">{workflows.length}</span>
          <IcoBtn title="Search workflows" onClick={()=>setCollapsed(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </IcoBtn>
          <IcoBtn title="New workflow" onClick={onNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          </IcoBtn>
        </div>
      </div>
    );
  }

  return (
    <div className="wf-library">
      <div className="lib-head">
        <div className="lib-title">
          <span className="lib-label">Workflows</span>
          <span className="lib-ct">{workflows.length}</span>
        </div>
        <div className="lib-ctas">
          <button className="btn-mini prim" onClick={onNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="11" height="11"><path d="M12 5v14M5 12h14"/></svg>
            New
          </button>
          <button className="btn-mini" onClick={onImport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Import
          </button>
          <IcoBtn title="Collapse library" onClick={()=>setCollapsed(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M15 18l-6-6 6-6"/></svg>
          </IcoBtn>
        </div>
      </div>

      <div className="lib-search"><SearchInput value={search} onChange={setSearch} placeholder="Search workflows…"/></div>

      <div className="lib-scope-tabs">
        {['all','bundled','user','project'].map(s=>(
          <button key={s} className={scope===s?'on':''} onClick={()=>setScope(s)}>
            {s}<span className="scope-ct">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="lib-list">
        {filtered.length===0 && <div className="lib-empty">No workflows match</div>}
        {filtered.map(w=>(
          <div key={w.id}
            className={`lib-row${selected?.id===w.id?' sel':''}`}
            style={{'--wc':CAT_COLOR[w.category]||'#00ff41'}}
            onClick={()=>onSelect(w)}
          >
            <span className="lib-pip"></span>
            <div className="lib-row-body">
              <div className="lib-row-top">
                <span className="lib-row-name">{w.name}</span>
                <SourceBadge source={w.source}/>
              </div>
              <div className="lib-row-desc">{w.desc}</div>
              <div className="lib-row-foot">
                <span className="lib-meta">{w.nodes}n · d{w.depth}</span>
                {w.tags.slice(0,2).map(t=><span key={t} className="lib-tag">{t}</span>)}
                <span className="lib-last">{w.last_run}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// VISUAL DAG
// ═══════════════════════════════════════════════════════
function DagSvg({dag, edges}) {
  if (!dag || dag.length===0) {
    return (
      <div className="dag-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="36" height="36" style={{opacity:.3}}>
          <rect x="3" y="8" width="6" height="8" rx="1"/><rect x="9" y="5" width="6" height="5" rx="1"/>
          <rect x="9" y="14" width="6" height="5" rx="1"/><rect x="15" y="8" width="6" height="8" rx="1"/>
          <path d="M9 12H9M15 12H15M9 7.5h-3M15 7.5h3M9 16.5h-3M15 16.5h3"/>
        </svg>
        <div style={{font:'500 11px var(--m-font-mono)',color:'var(--m-text-faint)',textTransform:'uppercase',letterSpacing:'.15em',marginTop:'10px'}}>Visual DAG — view only</div>
        <div style={{font:'400 12px var(--m-font-sans)',color:'var(--m-text-ghost)',marginTop:'4px'}}>No DAG defined for this workflow</div>
      </div>
    );
  }

  // Node dimensions
  const W=110, H=34, R=5;

  // Build position map
  const pos = {};
  dag.forEach(n=>{ pos[n.id]={x:n.cx,y:n.cy}; });

  const svgW = Math.max(...dag.map(n=>n.cx+W/2)) + 20;
  const svgH = Math.max(...dag.map(n=>n.cy+H/2)) + 20;

  return (
    <div className="dag-canvas">
      <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{width:'100%',maxWidth:`${svgW}px`}}>
        <defs>
          {Object.entries(NODE_COLOR).map(([t,c])=>(
            <filter key={t} id={`glow-${t}`} x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="2" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          ))}
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 2 L 8 5 L 0 8 z" fill="rgba(0,255,65,.35)"/>
          </marker>
        </defs>

        {/* edges */}
        {edges.map(([a,b],i)=>{
          const s=pos[a], t=pos[b]; if(!s||!t) return null;
          const sx=s.x+W/2, sy=s.y;
          const tx=t.x-W/2, ty=t.y;
          const mx=(sx+tx)/2;
          return <path key={i} d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
            fill="none" stroke="rgba(0,255,65,.25)" strokeWidth="1.5" markerEnd="url(#arrow)"/>;
        })}

        {/* nodes */}
        {dag.map(n=>{
          const c=NODE_COLOR[n.type]||'#00ff41';
          return (
            <g key={n.id} className="dag-node" style={{cursor:'default'}}>
              <rect x={n.cx-W/2} y={n.cy-H/2} width={W} height={H} rx={R}
                fill="rgba(4,16,8,.9)" stroke={c} strokeWidth="1"
                style={{filter:`0 0 8px ${c}44`}}/>
              <rect x={n.cx-W/2} y={n.cy-H/2} width={W} height={H} rx={R}
                fill="none" stroke={c} strokeWidth="1" opacity=".5"/>
              <text x={n.cx} y={n.cy-6} textAnchor="middle"
                style={{font:'600 10px var(--m-font-mono)',fill:'var(--m-text-strong)',letterSpacing:'.04em'}}>
                {n.label}
              </text>
              <text x={n.cx} y={n.cy+8} textAnchor="middle"
                style={{font:'500 9px var(--m-font-mono)',fill:c,letterSpacing:'.12em',textTransform:'uppercase'}}>
                {n.type}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="dag-legend">
        {Object.entries(NODE_COLOR).map(([t,c])=>(
          <span key={t} className="dag-leg-item"><span style={{background:c,width:'8px',height:'8px',borderRadius:'2px',display:'inline-block',marginRight:'5px',boxShadow:`0 0 4px ${c}`}}></span>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// YAML TAB
// ═══════════════════════════════════════════════════════
function yamlLine(line, i) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    return <div key={i} className="yl"><span style={{color:'var(--m-text-ghost)'}}>{line}</span></div>;
  }
  const keyMatch = line.match(/^(\s*)([\w-]+)(:)(.*)$/);
  if (keyMatch) {
    const [,indent,key,colon,rest] = keyMatch;
    const valColor = rest.trim().startsWith('"') || rest.trim().startsWith("'") ? '#5fcfff'
      : /^\s+\d/.test(rest) ? '#ffb454' : 'var(--m-text-muted)';
    return <div key={i} className="yl">{indent}<span style={{color:'var(--m-green-500)'}}>{key}</span><span style={{color:'var(--m-text-ghost)'}}>{colon}</span><span style={{color:valColor}}>{rest}</span></div>;
  }
  if (trimmed.startsWith('-')) {
    const indent2 = line.match(/^(\s*)/)[1];
    return <div key={i} className="yl">{indent2}<span style={{color:'var(--m-text-ghost)'}}>-</span><span style={{color:'#5fcfff'}}>{line.slice(indent2.length+1)}</span></div>;
  }
  return <div key={i} className="yl"><span style={{color:'var(--m-text-muted)'}}>{line}</span></div>;
}

function YamlTab({wf}) {
  const lines = YAML_STR.split('\n');
  const isEditable = wf.source !== 'bundled';
  return (
    <div className="yaml-tab">
      <div className="yaml-toolbar">
        <div className="yt-left">
          {!isEditable && <span className="bundled-lock">🔒 bundled — read-only</span>}
          {isEditable && <span style={{font:'500 10px var(--m-font-mono)',color:'var(--m-green-500)',letterSpacing:'.14em',textTransform:'uppercase'}}>● Editable</span>}
        </div>
        <div className="yt-right">
          <button className="btn-mini">Validate</button>
          <button className="btn-mini">Format</button>
          {isEditable && <><button className="btn-mini">Revert</button><button className="btn-mini prim">Save</button></>}
          {!isEditable && <button className="btn-mini prim">Duplicate as User</button>}
        </div>
      </div>
      <div className="yaml-editor">
        <div className="yaml-gutter">{lines.map((_,i)=><div key={i} className="yn">{i+1}</div>)}</div>
        <pre className="yaml-code">{lines.map((l,i)=>yamlLine(l,i))}</pre>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════
function OverviewTab({wf}) {
  const color = CAT_COLOR[wf.category]||'#00ff41';
  const nodeBreakdown = {prompt:3,bash:2,command:1,approval:1};
  return (
    <div className="overview-tab">
      <div className="ov-hero">
        <div className="ov-icon" style={{'--wc':color}}>{wf.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div className="ov-title-block">
          <h2 className="ov-name">{wf.name}</h2>
          <div className="ov-meta">
            <span className="ov-cat" style={{color}}>{wf.category}</span>
            <span className="ov-sep">·</span>
            <SourceBadge source={wf.source}/>
            <span className="ov-sep">·</span>
            <span style={{font:'500 11px var(--m-font-mono)',color:'var(--m-text-faint)'}}>v{wf.version}</span>
          </div>
        </div>
      </div>

      <p className="ov-desc">{wf.desc}</p>

      <div className="ov-stat-row">
        {[['Nodes',wf.nodes,''],['DAG Depth',wf.depth,''],['Parallelism',wf.parallel,''],['Runs',wf.runs,'ok']].map(([l,v,cls])=>(
          <div key={l} className="ov-stat">
            <span className={`ov-sv${cls?' '+cls:''}`}>{v}</span>
            <span className="ov-sl">{l}</span>
          </div>
        ))}
      </div>

      <div className="panel-card">
        <div className="pc-head">Required Inputs</div>
        <div className="pc-body">
          {wf.required.map(r=>(
            <div key={r} className="input-row req">
              <span className="ir-name">{r}</span>
              <span className="ir-badge req">required</span>
            </div>
          ))}
          {wf.optional.map(o=>(
            <div key={o} className="input-row">
              <span className="ir-name">{o}</span>
              <span className="ir-badge">optional</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ov-grid2">
        <div className="panel-card">
          <div className="pc-head">Node Breakdown</div>
          <div className="pc-body node-breakdown">
            {Object.entries(nodeBreakdown).map(([t,n])=>(
              <div key={t} className="nb-row">
                <span className="nb-dot" style={{background:NODE_COLOR[t]||'#aaa',boxShadow:`0 0 5px ${NODE_COLOR[t]||'#aaa'}`}}></span>
                <span className="nb-type">{t}</span>
                <span className="nb-n">{n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel-card">
          <div className="pc-head">Tags</div>
          <div className="pc-body tag-list">
            {wf.tags.map(t=><span key={t} className="tag-chip">{t}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WHEN-TO-USE TAB
// ═══════════════════════════════════════════════════════
function WhenToUseTab({wf}) {
  return (
    <div className="wtu-tab">
      <div className="wtu-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="14" height="14" style={{color:'#5fcfff',flexShrink:0}}>
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
        </svg>
        <span>The <code>when_to_use</code> field powers Hermes' plan-phase suggestions — it's how the agent decides when to route a mission to this workflow.</span>
      </div>
      <div className="panel-card">
        <div className="pc-head">when_to_use
          <span style={{marginLeft:'auto',font:'500 9px var(--m-font-mono)',color:'var(--m-text-ghost)',letterSpacing:'.14em'}}>MARKDOWN</span>
        </div>
        <div className="pc-body">
          <textarea className="wtu-editor" defaultValue={wf.when_to_use}/>
        </div>
      </div>
      <div className="panel-card">
        <div className="pc-head">Required Inputs Preview</div>
        <div className="pc-body">
          <div style={{font:'400 12px var(--m-font-sans)',color:'var(--m-text-muted)',lineHeight:'1.55',marginBottom:'10px'}}>These are surfaced to the user during the plan phase when this workflow is proposed.</div>
          {wf.required.map(r=><div key={r} className="input-row req"><span className="ir-name">{r}</span><span className="ir-badge req">required</span></div>)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════
function HistoryTab({wf}) {
  return (
    <div className="history-tab">
      <div className="history-header">
        <span style={{font:'500 12px var(--m-font-mono)',color:'var(--m-text-muted)'}}>Showing last {HISTORY.length} runs of <b style={{color:'var(--m-text)'}}>{wf.name}</b></span>
        <a href="Conductor.html" className="link-out">View all in Conductor →</a>
      </div>
      <table className="hist-table">
        <thead><tr>
          <th>Run ID</th><th>Started</th><th>Status</th><th>Duration</th><th>Triggered by</th><th>Phase reached</th><th></th>
        </tr></thead>
        <tbody>
          {HISTORY.map(r=>(
            <tr key={r.id}>
              <td className="run-id">{r.id}</td>
              <td>{r.started}</td>
              <td><RunStatus status={r.status}/></td>
              <td style={{font:'500 11px var(--m-font-mono)',color:'var(--m-text-muted)'}}>{r.duration}</td>
              <td><span className="run-who">{r.who}</span></td>
              <td style={{font:'500 11px var(--m-font-mono)',color:'var(--m-text-faint)'}}>{r.phase}</td>
              <td><a href="Conductor.html" className="link-out" style={{fontSize:'10px'}}>View →</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// EDITOR (center region)
// ═══════════════════════════════════════════════════════
const TABS = ['Overview','Visual DAG','YAML','When-to-Use','History'];

function WorkflowEditor({wf}) {
  const [tab, setTab] = useState('Overview');
  if (!wf) {
    return (
      <div className="wf-editor wf-editor-empty">
        <div className="empty-state">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="52" height="52" style={{opacity:.22}}>
            <rect x="4" y="8" width="12" height="32" rx="2"/><rect x="20" y="8" width="8" height="20" rx="2"/>
            <rect x="20" y="32" width="8" height="8" rx="2"/><rect x="32" y="8" width="12" height="32" rx="2"/>
            <path d="M16 16h4M16 24h4M16 32h4"/>
          </svg>
          <div className="es-title">No workflow selected</div>
          <div className="es-sub">Choose a workflow from the library or create a new one.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="wf-editor" data-screen-label="Workflow Editor">
      <div className="ed-topbar">
        <div className="ed-crumbs">
          <span>Workflows</span><span className="sep">/</span>
          <span className="cur">{wf.name}</span>
        </div>
        <div className="ed-tabs">
          {TABS.map(t=>(
            <button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="ed-body">
        {tab==='Overview'    && <OverviewTab wf={wf}/>}
        {tab==='Visual DAG'  && <DagSvg dag={wf.dag} edges={wf.edges}/>}
        {tab==='YAML'        && <YamlTab wf={wf}/>}
        {tab==='When-to-Use' && <WhenToUseTab wf={wf}/>}
        {tab==='History'     && <HistoryTab wf={wf}/>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ACTIONS PANEL (right region)
// ═══════════════════════════════════════════════════════
function ActionsPanel({wf, onLaunch}) {
  if (!wf) return <div className="wf-actions wf-actions-empty"><div style={{padding:'20px',color:'var(--m-text-ghost)',font:'500 11px var(--m-font-mono)',textAlign:'center'}}>Select a workflow</div></div>;
  const color = CAT_COLOR[wf.category]||'#00ff41';
  const isEditable = wf.source !== 'bundled';
  return (
    <div className="wf-actions">
      <div className="act-section">
        <button className="launch-btn" onClick={onLaunch} style={{'--wc':color}}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M5 3l14 9-14 9V3z"/></svg>
          Launch Workflow Run
        </button>
        <div className="act-sub-note">Opens the 4-step launch wizard — this is the handoff to the Conductor.</div>
      </div>

      <div className="act-divider"></div>

      <div className="act-section">
        <button className="btn-mini full-w">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Duplicate
        </button>
        <button className="btn-mini full-w">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Export YAML
        </button>
        {isEditable && (
          <button className="btn-mini full-w danger">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            Delete
          </button>
        )}
      </div>

      <div className="act-divider"></div>

      <div className="act-section">
        <div className="act-lbl">Live Status</div>
        <div className="live-panel">
          <div className="live-row">
            <span className="live-pulse"></span>
            <span className="live-text">2 runs active</span>
            <a href="Conductor.html" className="link-out" style={{marginLeft:'auto',fontSize:'10px'}}>→ Conductor</a>
          </div>
          <div className="live-sub">run-0048 · run-0049</div>
        </div>
      </div>

      <div className="act-divider"></div>

      <div className="act-section act-meta">
        <div className="act-lbl">Metadata</div>
        {[
          ['Version',  wf.version],
          ['Source',   wf.source],
          ['Checksum', wf.checksum],
          ['Path',     wf.path],
        ].map(([k,v])=>(
          <div key={k} className="meta-kv">
            <span className="mk">{k}</span>
            <span className="mv" title={v}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LAUNCH WIZARD
// ═══════════════════════════════════════════════════════
function LaunchWizard({wf, onClose}) {
  const [step, setStep] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [schedule, setSchedule] = useState('now');
  const color = CAT_COLOR[wf.category]||'#00ff41';
  const STEPS = ['Plan','Route','Schedule','Confirm'];

  return (
    <div className="wizard-scrim" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="wizard-modal">

        {/* Header */}
        <div className="wz-head">
          <div className="wz-icon" style={{'--wc':color}}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d="M5 3l14 9-14 9V3z"/></svg>
          </div>
          <div>
            <h2>Launch Workflow Run</h2>
            <div className="wz-sub">{wf.name} · Step {step} of 4 — {STEPS[step-1]}</div>
          </div>
          <button className="wz-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="15" height="15"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Step bar */}
        <div className="wz-steps">
          <div className="wz-steps-line"></div>
          {STEPS.map((l,i)=>{
            const n=i+1, cls=n<step?'done':n===step?'cur':'';
            return <div key={n} className={`wz-step ${cls}`}><div className="wz-dot">{n<step?'✓':n}</div><div className="wz-lbl">{l}</div></div>;
          })}
        </div>

        {/* Step content */}
        <div className="wz-body">

          {step===1 && (
            <div className="wz-plan">
              <div className="plan-summary">
                <div className="ps-title">{wf.name}</div>
                <div className="ps-meta"><SourceBadge source={wf.source}/> · {wf.nodes} nodes · d{wf.depth}</div>
                <div className="ps-inputs">
                  {wf.required.map(r=><div key={r} className="ps-inp req"><span>{r}</span><span className="ir-badge req">required</span></div>)}
                </div>
              </div>
              <div className="plan-chat">
                <div className="chat-msgs">
                  {WIZARD_CHAT.map((m,i)=>(
                    <div key={i} className={`chat-msg ${m.role}`}>
                      <span className="chat-who">{m.role==='assistant'?'Hermes':'You'}</span>
                      <div className="chat-text">{m.msg.split('\n').map((l,j)=><p key={j}>{l}</p>)}</div>
                    </div>
                  ))}
                </div>
                <div className="chat-input-row">
                  <input className="chat-inp" placeholder="Type to refine the plan…" value={chatInput} onChange={e=>setChatInput(e.target.value)} readOnly/>
                  <button className="btn-mini prim">Send</button>
                </div>
              </div>
            </div>
          )}

          {step===2 && (
            <div className="wz-route">
              <div className="route-note">Agent assignments for each node — click a node to override.</div>
              <div className="route-dag">
                {wf.dag.length>0 ? wf.dag.map(n=>(
                  <div key={n.id} className="route-node" style={{'--nc':NODE_COLOR[n.type]||'#00ff41'}}>
                    <div className="rn-head">
                      <span className="rn-name">{n.label}</span>
                      <NodeTypeBadge type={n.type}/>
                    </div>
                    <div className="rn-agent">
                      <span className="rn-av">S</span>
                      <span className="rn-aname">switch</span>
                      <button className="rn-override">↓</button>
                    </div>
                  </div>
                )) : (
                  <div style={{padding:'20px',color:'var(--m-text-faint)',font:'500 11px var(--m-font-mono)'}}>DAG routing preview not available for this workflow.</div>
                )}
              </div>
              <div className="route-vars">
                <div className="act-lbl" style={{marginBottom:'8px'}}>Resolved Variables</div>
                <div className="var-row"><span className="var-k">$GITHUB_ISSUE_URL</span><span className="var-v">https://github.com/hermes-switchui/issues/1247</span></div>
                <div className="var-row"><span className="var-k">$BASE_BRANCH</span><span className="var-v">main</span></div>
              </div>
            </div>
          )}

          {step===3 && (
            <div className="wz-schedule">
              <div className="sched-options">
                {[['now','Run now','Start immediately after submit'],
                  ['at','Run at…','Schedule for a specific date and time'],
                  ['cron','On schedule','Repeating cron expression']].map(([v,l,d])=>(
                  <label key={v} className={`sched-opt${schedule===v?' sel':''}`} onClick={()=>setSchedule(v)}>
                    <input type="radio" name="sched" value={v} checked={schedule===v} onChange={()=>setSchedule(v)}/>
                    <div>
                      <div className="so-label">{l}</div>
                      <div className="so-desc">{d}</div>
                    </div>
                  </label>
                ))}
              </div>
              {schedule==='at' && (
                <div className="sched-dt"><input type="datetime-local" className="form-inp" style={{width:'auto'}}/></div>
              )}
              {schedule==='cron' && (
                <div className="sched-cron">
                  <input className="form-inp" placeholder="0 9 * * 1-5" defaultValue="0 9 * * 1-5"/>
                  <div className="cron-preview">Weekdays at 09:00 · Next: Mon 19 May 09:00</div>
                </div>
              )}
              <div className="sched-priority">
                <label>Priority</label>
                <select className="form-sel"><option>Normal</option><option>High</option><option>Low</option></select>
              </div>
            </div>
          )}

          {step===4 && (
            <div className="wz-confirm">
              <div className="confirm-card">
                <div className="cc-row"><span className="cc-k">Workflow</span><span className="cc-v">{wf.name}</span></div>
                <div className="cc-row"><span className="cc-k">Source</span><span className="cc-v"><SourceBadge source={wf.source}/></span></div>
                <div className="cc-row"><span className="cc-k">Nodes</span><span className="cc-v">{wf.nodes} nodes · depth {wf.depth}</span></div>
                <div className="cc-row"><span className="cc-k">Schedule</span><span className="cc-v" style={{color:'var(--m-green-500)'}}>{schedule==='now'?'Run immediately':schedule==='at'?'Scheduled':'Repeating cron'}</span></div>
                <div className="cc-row"><span className="cc-k">$GITHUB_ISSUE_URL</span><span className="cc-v" style={{color:'#5fcfff',fontSize:'11px'}}>https://github.com/hermes-switchui/issues/1247</span></div>
                <div className="cc-row"><span className="cc-k">$BASE_BRANCH</span><span className="cc-v" style={{color:'#5fcfff'}}>main</span></div>
              </div>
              <div className="confirm-note">
                On submit this workflow run will be created with status <b>pending</b> and appear in the Conductor with a pre-selected run detail view.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="wz-foot">
          <span className="wz-foot-step">Step {step} / 4</span>
          <div className="wz-nav">
            {step>1 && <button className="btn-mini" onClick={()=>setStep(s=>s-1)}>← Back</button>}
            {step<4 && <button className="btn-mini prim" onClick={()=>setStep(s=>s+1)}>Next →</button>}
            {step===4 && (
              <button className="btn-mini prim" onClick={onClose} style={{minWidth:'180px'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>
                Submit as Workflow Run
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════
function WorkflowsApp() {
  const [selected, setSelected] = useState(WORKFLOWS[0]);
  const [launching, setLaunching] = useState(false);
  const [libCollapsed, setLibCollapsed] = useState(false);

  React.useEffect(()=>{
    const shell = document.querySelector('.wf-shell');
    if (shell) shell.style.setProperty('--wf-lib-w', libCollapsed ? '44px' : '290px');
  }, [libCollapsed]);

  return (
    <>
      <WorkflowLibrary
        workflows={WORKFLOWS}
        selected={selected}
        onSelect={setSelected}
        onNew={()=>setSelected(null)}
        onImport={()=>{}}
        collapsed={libCollapsed}
        setCollapsed={setLibCollapsed}
      />
      <WorkflowEditor wf={selected}/>
      <ActionsPanel wf={selected} onLaunch={()=>setLaunching(true)}/>
      {launching && selected && (
        <LaunchWizard wf={selected} onClose={()=>setLaunching(false)}/>
      )}
    </>
  );
}

// ── Mount ──────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('primary-nav-mount'))
  .render(<PrimaryNavV2 active="conductor"/>);
ReactDOM.createRoot(document.getElementById('wf-root'))
  .render(<WorkflowsApp/>);
