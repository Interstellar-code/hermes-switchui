/* Hermes · Boards App — React components for Boards.html */
const { useState } = React;

// ── Data ──────────────────────────────────────────────────────────────
const COLORS = ['#00ff41','#5ad3ff','#ffb454','#b07cff','#ff5fa2','#d6ff5f'];
const BOARD_TYPES = [
  {value:'project',  label:'Project',    desc:'General-purpose project workspace'},
  {value:'research', label:'Research',   desc:'Investigation & discovery tasks'},
  {value:'sprint',   label:'Sprint',     desc:'Time-boxed iteration board'},
  {value:'ops',      label:'Operations', desc:'Infra, DevOps & systems work'},
];
const DEFAULT_COLS = {
  project:  ['Backlog','Todo','In Progress','Review','Done'],
  research: ['Backlog','Todo','Running','Review','Done'],
  sprint:   ['Backlog / Triage','Todo','Ready','Running','Blocked','Done'],
  ops:      ['Backlog','Todo','Running','Blocked','Done'],
};
const WIZARD_INIT = {
  step:1, name:'', desc:'', color:'#00ff41', type:'project',
  path:'/workspace/hermes-switchui/.boards/', workDir:'/workspace/hermes-switchui',
  columns:[...DEFAULT_COLS.project], newCol:'',
};
const INITIAL_BOARDS = [
  { id:'b-001', name:'GTW#33 Integration',
    desc:'Gateway 33 toolchain integration and validation batches.',
    color:'#ffb454', type:'sprint',
    path:'/workspace/hermes-switchui/.boards/gtw33',
    workDir:'/workspace/hermes-switchui',
    status:'active', agents:3,
    tasks:{backlog:2,todo:1,ready:0,running:4,blocked:0,done:154},
    columns:['Backlog / Triage','Todo','Ready','Running','Blocked','Done'],
    created:'May 1, 2025', lastActivity:'2 min ago' },
  { id:'b-002', name:'DeepSeek V4 Research',
    desc:'Evaluate DeepSeek V4 and V4 Pro — pricing, latency, tool-use parity.',
    color:'#5ad3ff', type:'research',
    path:'/workspace/hermes-switchui/.boards/research-deepseek',
    workDir:'/workspace/hermes-switchui',
    status:'active', agents:1,
    tasks:{backlog:3,todo:2,ready:0,running:1,blocked:1,done:1},
    columns:['Backlog','Todo','Running','Review','Done'],
    created:'May 8, 2025', lastActivity:'14 min ago' },
  { id:'b-003', name:'Hermes v2.4 Roadmap',
    desc:'Feature planning and execution for the v2.4 release cycle.',
    color:'#00ff41', type:'project',
    path:'/workspace/hermes-switchui/.boards/v2.4-roadmap',
    workDir:'/workspace/hermes-switchui',
    status:'active', agents:5,
    tasks:{backlog:8,todo:6,ready:2,running:3,blocked:1,done:4},
    columns:['Icebox','Backlog','Todo','In Progress','Review','Done'],
    created:'Apr 15, 2025', lastActivity:'1 hr ago' },
  { id:'b-004', name:'SwitchUI Refactor',
    desc:'Full refactor of the SwitchUI frontend — migration to v2 design system.',
    color:'#b07cff', type:'project',
    path:'/workspace/hermes-switchui/.boards/switchui-refactor',
    workDir:'/workspace/hermes-switchui',
    status:'archived', agents:0,
    tasks:{backlog:0,todo:0,ready:0,running:0,blocked:0,done:52},
    columns:['Backlog','Todo','Running','Done'],
    created:'Mar 10, 2025', lastActivity:'3 days ago' },
  { id:'b-005', name:'Infra / DevOps Sprint',
    desc:'Docker, CI/CD pipeline hardening, and deployment automation tasks.',
    color:'#ff5fa2', type:'ops',
    path:'/workspace/hermes-switchui/.boards/infra-sprint',
    workDir:'/workspace/hermes-switchui',
    status:'active', agents:2,
    tasks:{backlog:4,todo:3,ready:1,running:2,blocked:1,done:0},
    columns:['Backlog','Todo','Running','Blocked','Done'],
    created:'May 10, 2025', lastActivity:'45 min ago' },
];

// ── Utils ─────────────────────────────────────────────────────────────
function totalTasks(b) { return Object.values(b.tasks).reduce((a,v)=>a+v,0); }
function glyph(name='?') { return (name.split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'??').slice(0,2); }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

// ── Shared micro-components ───────────────────────────────────────────
function SearchInput({value, onChange, placeholder='Search…'}) {
  return (
    <div className="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input className="search-inp" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function StatusPill({status}) {
  return (
    <span className={`status-pill ${status}`}>
      <span className="d"></span>{status}
    </span>
  );
}

function IcoBtn({title, onClick, children}) {
  return <button className="ico-btn" title={title} onClick={onClick}>{children}</button>;
}

// ── Left panel: boards list ───────────────────────────────────────────
function BoardsList({boards, filter, onFilter, onSelect, activeId, onNew}) {
  const [search, setSearch] = useState('');
  const items = boards.filter(b => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const active = boards.filter(b=>b.status==='active').length;
  const archived = boards.filter(b=>b.status==='archived').length;

  return (
    <>
      <div className="brdl-head">
        <h3>Boards</h3>
        <span className="ct">{boards.length}</span>
        <IcoBtn title="New board" onClick={onNew}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
        </IcoBtn>
      </div>

      <div className="brdl-search">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter boards…" />
      </div>

      <div className="brdl-tabs">
        {['all','active','archived'].map(f=>(
          <button key={f} className={filter===f?'on':''} onClick={()=>onFilter(f)}>{f}</button>
        ))}
      </div>

      <div className="brdl-body">
        {items.length === 0 && (
          <div className="brdl-empty">No boards match</div>
        )}
        {items.map(b=>{
          const isActive = activeId === b.id;
          return (
            <div key={b.id}
              className={`brdl-row${b.status==='archived'?' arch':''}${isActive?' sel':''}`}
              style={{'--bc': b.color}}
              onClick={()=>onSelect(b.id)}
            >
              <span className="brdl-pip"></span>
              <span className="brdl-name">{b.name}</span>
              {b.status==='active' && b.tasks.running>0 && <span className="brdl-pulse"></span>}
              <span className="brdl-ct">{totalTasks(b)}</span>
            </div>
          );
        })}
      </div>

      <div className="brdl-foot">
        <span><b>{active}</b> Active</span>
        <span><b>{archived}</b> Archived</span>
      </div>
    </>
  );
}

// ── Board card (grid view) ────────────────────────────────────────────
function BoardCard({board, onOpen, onDelete}) {
  const t = board.tasks;
  const tot = totalTasks(board);
  return (
    <div className={`brd-card${board.status==='archived'?' archived':''}`}
      style={{'--bc': board.color}}
      onClick={()=>onOpen(board.id)}
    >
      <div className="bc-head">
        <div className="bc-glyph">{glyph(board.name)}</div>
        <div className="bc-info">
          <div className="bc-name">{board.name}</div>
          <div className="bc-type">{board.type}</div>
        </div>
        <div className="bc-right"><StatusPill status={board.status}/></div>
      </div>

      <div className="bc-path">
        <span className="scheme">{board.path.replace(/^(\/[^/]+\/[^/]+\/).*/,'$1')}</span>
        {board.path.replace(/^\/[^/]+\/[^/]+\//,'')}
      </div>

      <div className="bc-stats">
        {[['Backlog',t.backlog,''],['Todo',t.todo,''],['Running',t.running,' run'],['Blocked',t.blocked,' bl'],['Done',t.done,' ok']].map(([l,v,cls])=>(
          <div key={l} className="bc-stat">
            <span className={`bsv${cls}`}>{v}</span>
            <span className="bsl">{l}</span>
          </div>
        ))}
      </div>

      <div className="bc-cols">
        {board.columns.map((c,i)=><span key={i} className="bc-col-tag">{c}</span>)}
      </div>

      <div className="bc-foot">
        <div className="bc-agents">
          {board.agents > 0
            ? <><span className="bc-av">{board.agents}</span><span>{board.agents} agent{board.agents!==1?'s':''}</span></>
            : <span>No agents</span>}
        </div>
        <span className="bc-time">{board.lastActivity}</span>
        <div className="bc-acts" onClick={e=>e.stopPropagation()}>
          <button className="btn-mini" onClick={()=>onOpen(board.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11"><rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="11"/><rect x="17" y="4" width="4" height="7"/></svg>
            Open
          </button>
          <button className="btn-mini danger" title="Delete board" onClick={()=>onDelete(board)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Board table row (list view) ───────────────────────────────────────
function BoardRow({board, onOpen, onDelete}) {
  const tot = totalTasks(board);
  return (
    <tr style={{'--bc': board.color}} onClick={()=>onOpen(board.id)}>
      <td>
        <div className="tbl-name-cell">
          <div className="tbl-glyph">{glyph(board.name)}</div>
          <div>
            <div className="tbl-nm">{board.name}</div>
            <div className="tbl-tp">{board.type}</div>
          </div>
        </div>
      </td>
      <td className="tbl-path-cell">{board.path}</td>
      <td style={{fontVariantNumeric:'tabular-nums'}}>{tot}</td>
      <td><StatusPill status={board.status}/></td>
      <td className="tbl-time">{board.lastActivity}</td>
      <td onClick={e=>e.stopPropagation()}>
        <div className="tbl-acts">
          <button className="btn-mini" onClick={()=>onOpen(board.id)}>Open</button>
          <button className="btn-mini danger" onClick={()=>onDelete(board)}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

// ── Main area top + toolbar ───────────────────────────────────────────
function MainTop({allBoards, boards, view, setView, search, setSearch, filter, setFilter, onNew}) {
  const activeCount = allBoards.filter(b=>b.status==='active').length;
  const archivedCount = allBoards.filter(b=>b.status==='archived').length;
  const allTasks = allBoards.reduce((a,b)=>a+totalTasks(b),0);

  return (
    <>
      <div className="brd-top">
        <div>
          <div className="crumbs">Workspace<span className="sep">/</span>Tasks<span className="sep">/</span><span className="cur">Boards</span></div>
          <h1>Boards</h1>
          <div className="top-sub">Isolated project workspaces — each board has its own Kanban structure, agent assignments, and task database.</div>
        </div>
        <div className="top-right">
          <div className="top-stat"><b>{allBoards.length}</b>Boards</div>
          <div className="top-stat"><b>{activeCount}</b>Active</div>
          <div className="top-stat"><b>{allTasks}</b>Tasks</div>
          <button className="btn-prim" onClick={onNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M12 5v14M5 12h14"/></svg>
            New Board
          </button>
        </div>
      </div>

      <div className="brd-toolbar">
        {/* Filter tabs */}
        <div className="tb-filters">
          <button className={`tb-filter-btn${filter==='all'?' on':''}`} onClick={()=>setFilter('all')}>
            All <span className="tb-ct">{allBoards.length}</span>
          </button>
          <button className={`tb-filter-btn${filter==='active'?' on':''}`} onClick={()=>setFilter('active')}>
            Active <span className="tb-ct">{activeCount}</span>
          </button>
          <button className={`tb-filter-btn${filter==='archived'?' on':''}`} onClick={()=>setFilter('archived')}>
            Archived <span className="tb-ct">{archivedCount}</span>
          </button>
        </div>

        <div className="tb-grow"><SearchInput value={search} onChange={setSearch} placeholder="Search boards…" /></div>

        <div className="view-toggle">
          <button className={view==='grid'?'on':''} onClick={()=>setView('grid')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Grid
          </button>
          <button className={view==='list'?'on':''} onClick={()=>setView('list')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            List
          </button>
        </div>
      </div>
    </>
  );
}

// ── Canvas (grid / list) ──────────────────────────────────────────────
function BoardsCanvas({boards, view, onOpen, onDelete}) {
  if (boards.length === 0) {
    return (
      <div className="brd-canvas">
        <div className="empty-state">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" width="48" height="48">
            <rect x="4" y="4" width="18" height="18" rx="2"/><rect x="26" y="4" width="18" height="18" rx="2"/>
            <rect x="4" y="26" width="18" height="18" rx="2"/><rect x="26" y="26" width="18" height="18" rx="2"/>
          </svg>
          <div className="es-title">No boards found</div>
          <div className="es-sub">Create your first board to start a dedicated workspace for your agents.</div>
        </div>
      </div>
    );
  }

  if (view === 'list') {
    return (
      <div className="brd-canvas">
        <table className="brd-table">
          <thead><tr>
            <th>Name</th><th>Path</th><th>Tasks</th><th>Status</th><th>Last Activity</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {boards.map(b=><BoardRow key={b.id} board={b} onOpen={onOpen} onDelete={onDelete}/>)}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="brd-canvas">
      <div className="brd-grid">
        {boards.map(b=><BoardCard key={b.id} board={b} onOpen={onOpen} onDelete={onDelete}/>)}
      </div>
    </div>
  );
}

// ── Board Drawer ──────────────────────────────────────────────────────
function BoardDrawer({board, onClose, onDelete, onUpdate}) {
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(board.name);
  const [editDesc, setEditDesc] = useState(board.desc);
  const t = board.tasks;
  const tot = totalTasks(board);

  function saveEdit() {
    onUpdate({...board, name:editName, desc:editDesc});
    setEditing(false);
  }

  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="drawer" role="dialog" aria-label={board.name}>

        <div className="dr-head">
          <div>
            <div className="dr-title-row">
              <div className="dr-glyph" style={{'--bc':board.color}}>{glyph(board.name)}</div>
              <div>
                <h2>{board.name}</h2>
                <div className="dr-meta">
                  <span>{board.type}</span><span>{board.status}</span><span>Created {board.created}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="dr-acts">
            <button className="btn-mini danger" onClick={()=>{onClose();onDelete(board);}}>Delete</button>
            <IcoBtn title="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </IcoBtn>
          </div>
        </div>

        <div className="dr-tabs">
          {['overview','columns','settings'].map(t2=>(
            <button key={t2} className={tab===t2?'on':''} onClick={()=>setTab(t2)}>
              {t2.charAt(0).toUpperCase()+t2.slice(1)}
            </button>
          ))}
        </div>

        <div className="dr-body">
          {tab==='overview' && <>
            <div className="dr-stat-row">
              {[['Total',tot,''],['Running',t.running,'#ffb454'],['Done',t.done,'var(--m-green-500)'],['Blocked',t.blocked,'#ff5fa2']].map(([l,v,c])=>(
                <div key={l} className="dr-stat-card">
                  <div className="dsc-lbl">{l}</div>
                  <b style={c?{color:c,textShadow:`0 0 8px ${c}60`}:{}}>{v}</b>
                </div>
              ))}
            </div>

            <div className="panel-card">
              <div className="pc-head">Task Breakdown</div>
              <div className="pc-body">
                <div className="task-breakdown">
                  {[['Backlog',t.backlog,'#b07cff'],['Todo',t.todo,'#5ad3ff'],['Running',t.running,'#ffb454'],['Blocked',t.blocked,'#ff5fa2'],['Done',t.done,'#00ff41']].map(([l,v,c])=>(
                    <div key={l} className="tbk-cell">
                      <div className="tbk-v" style={{color:c,textShadow:`0 0 8px ${c}60`}}>{v}</div>
                      <div className="tbk-l">{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel-card">
              <div className="pc-head">Workspace</div>
              <div className="pc-body ws-grid">
                <div className="ws-lbl">Board Path</div>
                <div className="ws-val path">{board.path}</div>
                <div className="ws-lbl">Working Dir</div>
                <div className="ws-val">{board.workDir}</div>
                <div className="ws-lbl">Agents</div>
                <div className="ws-val">{board.agents > 0 ? `${board.agents} assigned` : 'None assigned'}</div>
              </div>
            </div>

            {board.desc && (
              <div className="panel-card">
                <div className="pc-head">Description</div>
                <div className="pc-body" style={{font:'400 13px var(--m-font-sans)',color:'var(--m-text-muted)',lineHeight:'1.6'}}>{board.desc}</div>
              </div>
            )}
          </>}

          {tab==='columns' && (
            <div className="panel-card">
              <div className="pc-head">
                Columns
                <span className="pc-head-ct">{board.columns.length} configured</span>
              </div>
              <div className="pc-body col-list">
                {board.columns.map((c,i)=>(
                  <div key={i} className="col-list-row">
                    <span className="col-list-n">#{i+1}</span>
                    <span className="col-list-name">{c}</span>
                    <span className="col-list-pip" style={{background:board.color,boxShadow:`0 0 6px ${board.color}`}}></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab==='settings' && <>
            <div className="panel-card">
              <div className="pc-head">
                Board Details
                <div className="pc-head-right">
                  <button className="btn-mini" onClick={()=>setEditing(!editing)}>{editing?'Cancel':'Edit'}</button>
                </div>
              </div>
              <div className="pc-body settings-grid">
                <div className="form-row">
                  <label>Name</label>
                  {editing
                    ? <input className="form-inp" value={editName} onChange={e=>setEditName(e.target.value)}/>
                    : <div className="field-val">{board.name}</div>}
                </div>
                <div className="form-row">
                  <label>Description</label>
                  {editing
                    ? <textarea className="form-ta" value={editDesc} onChange={e=>setEditDesc(e.target.value)}/>
                    : <div className="field-val muted">{board.desc||'—'}</div>}
                </div>
              </div>
            </div>
            {editing && (
              <div className="settings-save-row">
                <button className="btn-mini" onClick={()=>setEditing(false)}>Cancel</button>
                <button className="btn-mini prim" onClick={saveEdit}>Save Changes</button>
              </div>
            )}

            <div className="panel-card danger-card">
              <div className="pc-head danger-head">Danger Zone</div>
              <div className="pc-body">
                <div className="danger-row">
                  <div>
                    <div className="danger-action-title">{board.status==='archived'?'Unarchive Board':'Archive Board'}</div>
                    <div className="danger-action-desc">Freeze the board — agents are detached, tasks are preserved.</div>
                  </div>
                  <button className="btn-mini" onClick={()=>onUpdate({...board, status:board.status==='archived'?'active':'archived'})}>
                    {board.status==='archived'?'Unarchive':'Archive'}
                  </button>
                </div>
                <div className="danger-row danger-row-del">
                  <div>
                    <div className="danger-action-title del">Delete Board</div>
                    <div className="danger-action-desc">Permanently delete this board and all its tasks. Cannot be undone.</div>
                  </div>
                  <button className="btn-mini danger" onClick={()=>{onClose();onDelete(board);}}>Delete</button>
                </div>
              </div>
            </div>
          </>}
        </div>

        <div className="dr-foot">
          <span className="dr-foot-time">Last activity: {board.lastActivity}</span>
          <div className="dr-foot-acts">
            <button className="btn-mini" onClick={onClose}>Close</button>
            <button className="btn-mini prim" onClick={()=>{ window.location.href='Tasks.html'; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11"><rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="11"/><rect x="17" y="4" width="4" height="7"/></svg>
              Open Board
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Create Wizard ─────────────────────────────────────────────────────
function CreateWizard({state, onChange, onClose, onCreate}) {
  const STEPS = ['Identity','Workspace','Columns','Review'];
  const cur = state.step;

  function set(k,v) { onChange({...state,[k]:v}); }

  function onNameChange(v) {
    const s = slugify(v);
    onChange({...state, name:v, path:`/workspace/hermes-switchui/.boards/${s}`});
  }

  function onTypeChange(v) {
    onChange({...state, type:v, columns:[...DEFAULT_COLS[v]]});
  }

  function addCol() {
    const c = state.newCol.trim();
    if (!c) return;
    onChange({...state, columns:[...state.columns, c], newCol:''});
  }

  function removeCol(i) {
    onChange({...state, columns:state.columns.filter((_,idx)=>idx!==i)});
  }

  function handleCreate() {
    onCreate({
      id:'b-'+Date.now(),
      name:state.name, desc:state.desc,
      color:state.color, type:state.type,
      path:state.path, workDir:state.workDir,
      status:'active', agents:0,
      tasks:{backlog:0,todo:0,ready:0,running:0,blocked:0,done:0},
      columns:state.columns,
      created: new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
      lastActivity:'just now',
    });
  }

  const canNext = [
    state.name.trim().length >= 2,
    state.path.trim().length > 0,
    state.columns.length > 0,
    true,
  ];

  return (
    <div className="wizard-scrim" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="wizard-modal">

        {/* Header */}
        <div className="wz-head">
          <div className="wz-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18">
              <rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="16"/><rect x="17" y="4" width="4" height="16"/>
            </svg>
          </div>
          <div>
            <h2>New Board</h2>
            <div className="wz-sub">Step {cur} of {STEPS.length} — {STEPS[cur-1]}</div>
          </div>
          <button className="wz-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="wz-steps">
          <div className="wz-steps-line"></div>
          {STEPS.map((label,i)=>{
            const n = i+1;
            const cls = n < cur ? 'done' : n === cur ? 'cur' : '';
            return (
              <div key={n} className={`wz-step ${cls}`}>
                <div className="wz-dot">{n < cur ? '✓' : n}</div>
                <div className="wz-lbl">{label}</div>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="wz-body">

          {cur===1 && <>
            <div className="form-row">
              <label>Board Name <span className="req">*</span></label>
              <input className="form-inp" autoFocus placeholder="e.g. GTW#34 Integration" value={state.name} onChange={e=>onNameChange(e.target.value)}/>
              <span className="form-hint">Minimum 2 characters. Used to derive the storage path.</span>
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea className="form-ta" placeholder="What will agents be working on in this board?" value={state.desc} onChange={e=>set('desc',e.target.value)}/>
            </div>
            <div className="form-row">
              <label>Board Type</label>
              <div className="type-grid">
                {BOARD_TYPES.map(tp=>(
                  <div key={tp.value} className={`type-card${state.type===tp.value?' sel':''}`} onClick={()=>onTypeChange(tp.value)}>
                    <div className="tc-name">{tp.label}</div>
                    <div className="tc-desc">{tp.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>Accent Color</label>
              <div className="color-swatches">
                {COLORS.map(c=>(
                  <div key={c} className={`color-swatch${state.color===c?' sel':''}`}
                    style={{background:c,boxShadow:`0 0 8px ${c}60`,'--sw':c}}
                    onClick={()=>set('color',c)}
                  ></div>
                ))}
              </div>
            </div>
          </>}

          {cur===2 && <>
            <div className="form-row">
              <label>Board Path <span className="req">*</span></label>
              <input className="form-inp" value={state.path} onChange={e=>set('path',e.target.value)}/>
              <span className="form-hint">Where this board's data will be stored. Auto-generated from the board name.</span>
            </div>
            <div className="form-row">
              <label>Working Directory</label>
              <input className="form-inp" value={state.workDir} onChange={e=>set('workDir',e.target.value)}/>
              <span className="form-hint">The root agents will operate in when executing tasks on this board.</span>
            </div>
            <div className="path-preview">
              <div className="path-preview-lbl">Resolved Path</div>
              <div className="path-preview-val">
                <span className="scheme">{state.path.split('/').slice(0,3).join('/')}/</span>
                {state.path.split('/').slice(3).join('/')}
              </div>
            </div>
          </>}

          {cur===3 && <>
            <p className="wz-p">Define the workflow columns (stages) tasks will move through. Pre-filled from the <b>{state.type}</b> template — add or remove to match your process.</p>
            <div className="form-row">
              <label>Columns <span style={{marginLeft:'6px',font:'500 10px var(--m-font-mono)',color:'var(--m-text-faint)',letterSpacing:'.1em'}}>{state.columns.length} configured</span></label>
              <div className="col-chips">
                {state.columns.map((c,i)=>(
                  <div key={i} className="col-chip">
                    <span className="col-chip-n">#{i+1}</span>
                    {c}
                    <span className="col-remove" onClick={()=>removeCol(i)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="11" height="11"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </span>
                  </div>
                ))}
              </div>
              <div className="add-col-row">
                <input className="form-inp" style={{flex:1}} placeholder="Column name…" value={state.newCol}
                  onChange={e=>set('newCol',e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter')addCol();}}/>
                <button className="btn-mini prim" onClick={addCol}>Add</button>
              </div>
            </div>
          </>}

          {cur===4 && <>
            <p className="wz-p">Review your configuration. All settings can be changed later from the board's settings panel.</p>

            <div className="review-header">
              <div className="rh-glyph" style={{borderColor:state.color,color:state.color,boxShadow:`0 0 14px ${state.color}60`}}>
                {glyph(state.name||'?')}
              </div>
              <div>
                <div className="rh-name">{state.name || <span style={{color:'var(--m-text-ghost)'}}>Unnamed Board</span>}</div>
                <div className="rh-type">{state.type}</div>
              </div>
              <StatusPill status="active"/>
            </div>

            <div className="review-block">
              {[
                ['Description', state.desc || '—'],
                ['Board Path',  state.path,  'path'],
                ['Working Dir', state.workDir,'path'],
                ['Columns',     state.columns.join(' → ')],
                ['Color',       state.color,  'color'],
              ].map(([k,v,mod])=>(
                <div key={k} className="rb-row">
                  <span className="rb-k">{k}</span>
                  <span className={`rb-v${mod?' '+mod:''}`}>
                    {mod==='color'
                      ? <><span style={{display:'inline-block',width:'11px',height:'11px',borderRadius:'50%',background:v,boxShadow:`0 0 6px ${v}`,marginRight:'7px',verticalAlign:'middle'}}></span>{v}</>
                      : v}
                  </span>
                </div>
              ))}
            </div>
          </>}
        </div>

        {/* Footer nav */}
        <div className="wz-foot">
          <span className="wz-foot-step">Step {cur} / {STEPS.length}</span>
          <div className="wz-nav">
            {cur > 1 && <button className="btn-mini" onClick={()=>onChange({...state,step:cur-1})}>← Back</button>}
            {cur < 4 && (
              <button className="btn-mini prim"
                disabled={!canNext[cur-1]}
                style={{opacity:canNext[cur-1]?1:.45,cursor:canNext[cur-1]?'pointer':'not-allowed'}}
                onClick={()=>onChange({...state,step:cur+1})}
              >Next →</button>
            )}
            {cur === 4 && (
              <button className="btn-mini prim" onClick={handleCreate}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>
                Create Board
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────
function DeleteConfirm({board, onCancel, onConfirm}) {
  return (
    <div className="confirm-scrim">
      <div className="confirm-box">
        <h3>Delete Board</h3>
        <p>Are you sure you want to permanently delete <span className="conf-name">{board.name}</span>? All tasks and configuration will be removed. This cannot be undone.</p>
        <div className="conf-acts">
          <button className="btn-mini" onClick={onCancel}>Cancel</button>
          <button className="btn-mini danger" onClick={onConfirm}>Delete Board</button>
        </div>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────
function BoardsApp() {
  const [boards, setBoards] = useState(INITIAL_BOARDS);
  const [view, setView] = useState('grid');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [wizard, setWizard] = useState(null);

  const filtered = boards.filter(b => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const activeBoard = activeId ? boards.find(b=>b.id===activeId) : null;

  return (
    <>
      <div className="brd-main">
        <MainTop
          allBoards={boards}
          boards={filtered}
          view={view} setView={setView}
          search={search} setSearch={setSearch}
          filter={filter} setFilter={setFilter}
          onNew={()=>setWizard({...WIZARD_INIT, columns:[...WIZARD_INIT.columns]})}
        />
        <BoardsCanvas boards={filtered} view={view}
          onOpen={setActiveId}
          onDelete={setConfirmDel}/>
      </div>

      {activeBoard && (
        <BoardDrawer
          board={activeBoard}
          onClose={()=>setActiveId(null)}
          onDelete={(b)=>{setActiveId(null); setConfirmDel(b);}}
          onUpdate={(upd)=>setBoards(prev=>prev.map(b=>b.id===upd.id?upd:b))}
        />
      )}

      {wizard && (
        <CreateWizard
          state={wizard} onChange={setWizard}
          onClose={()=>setWizard(null)}
          onCreate={(board)=>{
            setBoards(prev=>[board,...prev]);
            setWizard(null);
          }}
        />
      )}

      {confirmDel && (
        <DeleteConfirm
          board={confirmDel}
          onCancel={()=>setConfirmDel(null)}
          onConfirm={()=>{
            setBoards(prev=>prev.filter(b=>b.id!==confirmDel.id));
            if (activeId===confirmDel.id) setActiveId(null);
            setConfirmDel(null);
          }}
        />
      )}
    </>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('primary-nav-mount'))
  .render(<PrimaryNavV2 active="tasks"/>);

ReactDOM.createRoot(document.getElementById('boards-root'))
  .render(<BoardsApp/>);
