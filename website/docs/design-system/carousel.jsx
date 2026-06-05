// carousel.jsx — UI mockup carousel for Hermes Switch UI landing page
// 4 slides showing different aspects of the workspace interface

var { useState, useEffect, useRef } = React;

/* ── Individual slide UI mockups ─────────────────────────────────── */

const AgentChatSlide = () => (
  <div style={{ padding:'20px 24px', fontFamily:"'JetBrains Mono',monospace", fontSize:13, lineHeight:1.82, minHeight:300 }}>
    <div style={{ color:'rgba(216,255,227,.38)', marginBottom:14, fontSize:11, borderBottom:'1px solid rgba(0,255,65,.1)', paddingBottom:10 }}>
      session :: neo  ·  claude-sonnet-4  ·  48,204 tokens
    </div>
    <div style={{ marginBottom:12 }}>
      <span style={{ color:'#00ff41' }}>▸ </span>
      <span style={{ color:'#eaffef' }}>refactor auth module to use JWT rotation</span>
    </div>
    <div style={{ color:'rgba(216,255,227,.45)', marginBottom:3 }}>  reading src/auth/session.ts...</div>
    <div style={{ color:'rgba(216,255,227,.45)', marginBottom:3 }}>  reading src/api/middleware.ts...</div>
    <div style={{ color:'rgba(216,255,227,.45)', marginBottom:14 }}>  found 3 files  ·  analyzing patterns...</div>
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <div style={{ flex:1, height:8, background:'rgba(0,255,65,.12)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ width:'78%', height:'100%', background:'linear-gradient(90deg,#006a1c,#00ff41)', boxShadow:'0 0 8px rgba(0,255,65,.5)' }}></div>
        </div>
        <span style={{ fontSize:10, color:'rgba(216,255,227,.45)', flexShrink:0 }}>78%  patching session.ts</span>
      </div>
    </div>
    <div style={{ color:'#7cff9b', marginBottom:4 }}>[ DONE ]  3 files modified  ·  14 tests passing</div>
    <div style={{ marginTop:10 }}>
      <span style={{ color:'rgba(216,255,227,.32)' }}>$ </span><span className="m-cursor"></span>
    </div>
  </div>
);

const WorkspaceDashSlide = () => {
  const agents = [
    { name:'neo',      model:'claude-sonnet-4', status:'CODING',   tokens:'48,204', on:true  },
    { name:'trinity',  model:'claude-sonnet-4', status:'FINANCE',  tokens:'31,847', on:true  },
    { name:'morpheus', model:'claude-opus-4',   status:'REVIEW',   tokens:'23,104', pulse:true },
    { name:'oracle',   model:'claude-opus-4',   status:'IDLE',     tokens:'—',      off:true },
  ];
  return (
    <div style={{ padding:'20px 24px', fontFamily:"'JetBrains Mono',monospace", fontSize:12, lineHeight:1.8, minHeight:300 }}>
      <div style={{ color:'rgba(216,255,227,.38)', marginBottom:14, fontSize:11, borderBottom:'1px solid rgba(0,255,65,.1)', paddingBottom:10 }}>
        workspace dashboard  ·  4 agents  ·  uptime 4m 32s
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'14px 90px 1fr 80px 80px', gap:'0 12px', marginBottom:6, fontSize:9, color:'rgba(216,255,227,.3)', textTransform:'uppercase', letterSpacing:'.12em' }}>
        <div></div><div>agent</div><div>model</div><div>status</div><div style={{textAlign:'right'}}>tokens</div>
      </div>
      {agents.map(a => (
        <div key={a.name} style={{ display:'grid', gridTemplateColumns:'14px 90px 1fr 80px 80px', gap:'0 12px', padding:'6px 0', borderBottom:'1px solid rgba(0,255,65,.06)', alignItems:'center' }}>
          <div className={a.on ? 'm-dot m-dot-on' : a.pulse ? 'm-dot m-dot-pulse' : 'm-dot m-dot-off'}></div>
          <div style={{ color: a.off ? 'rgba(216,255,227,.35)' : '#eaffef', fontWeight:600 }}>{a.name}</div>
          <div style={{ color:'rgba(216,255,227,.45)', fontSize:11 }}>{a.model}</div>
          <div style={{ color: a.off ? 'rgba(216,255,227,.3)' : '#00ff41', fontSize:10, letterSpacing:'.08em' }}>{a.status}</div>
          <div style={{ color:'rgba(216,255,227,.45)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{a.tokens}</div>
        </div>
      ))}
      <div style={{ marginTop:16, display:'flex', gap:24, fontSize:11, color:'rgba(216,255,227,.38)' }}>
        <span>TOKENS <span style={{color:'#00ff41'}}>128,420</span></span>
        <span>TOOLS <span style={{color:'#00ff41'}}>2,847</span></span>
        <span>LOAD <span style={{color:'#d6ff5f'}}>6/10</span></span>
      </div>
    </div>
  );
};

const ToolLogSlide = () => {
  const tools = [
    { t:'  1ms', type:'READ',  detail:'src/auth/session.ts  ·  347 lines',          ok:true  },
    { t:'  2ms', type:'READ',  detail:'src/api/middleware.ts  ·  128 lines',         ok:true  },
    { t:' 18ms', type:'BASH',  detail:'npx tsc --noEmit',                            ok:true  },
    { t:' 24ms', type:'WRITE', detail:'session.ts  ·  patches applied',             ok:true  },
    { t:' 31ms', type:'BASH',  detail:'npm test --watchAll=false',                   ok:false },
    { t:'2.1s',  type:'TEST',  detail:'14 / 14 passing  ✓',                         ok:true  },
    { t:'3.4s',  type:'GIT',   detail:'commit -m "fix: auth JWT rotation"',          ok:true  },
  ];
  const typeColor = { READ:'#5fcfff', WRITE:'#d6ff5f', BASH:'rgba(216,255,227,.65)', TEST:'#00ff41', GIT:'#7cff9b' };
  return (
    <div style={{ padding:'20px 24px', fontFamily:"'JetBrains Mono',monospace", fontSize:12, lineHeight:1.9, minHeight:300 }}>
      <div style={{ color:'rgba(216,255,227,.38)', marginBottom:14, fontSize:11, borderBottom:'1px solid rgba(0,255,65,.1)', paddingBottom:10 }}>
        tool executor  ·  live log  ·  neo session
      </div>
      {tools.map((r, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 48px 1fr', gap:'0 14px', alignItems:'center' }}>
          <span style={{ color:'rgba(216,255,227,.28)', fontSize:10, fontVariantNumeric:'tabular-nums' }}>{r.t}</span>
          <span style={{ color: typeColor[r.type] || '#d8ffe3', fontSize:10, fontWeight:600 }}>{r.type}</span>
          <span style={{ color: r.ok ? 'rgba(216,255,227,.6)' : 'rgba(216,255,227,.35)' }}>{r.detail}</span>
        </div>
      ))}
    </div>
  );
};

const MemorySlide = () => {
  const entities = [
    { key:'auth-module',    val:'JWT rotation patterns, refresh token flow' },
    { key:'codebase',       val:'Next.js 14, TypeScript, Prisma ORM' },
    { key:'current-goal',   val:'Refactor auth to JWT v3 with rotation' },
    { key:'test-suite',     val:'14 tests · all passing · Jest config' },
    { key:'team-style',     val:'No comments, short functions, strict TS' },
  ];
  return (
    <div style={{ padding:'20px 24px', fontFamily:"'JetBrains Mono',monospace", fontSize:12, lineHeight:1.82, minHeight:300 }}>
      <div style={{ color:'rgba(216,255,227,.38)', marginBottom:14, fontSize:11, borderBottom:'1px solid rgba(0,255,65,.1)', paddingBottom:10 }}>
        memory  ·  1,247 entries  ·  12 sessions
      </div>
      <div style={{ fontSize:9, color:'rgba(216,255,227,.3)', textTransform:'uppercase', letterSpacing:'.15em', marginBottom:10 }}>entities</div>
      {entities.map((e, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'130px 1fr', gap:'0 14px', marginBottom:4 }}>
          <span style={{ color:'#00ff41', opacity:.75 }}>○  {e.key}</span>
          <span style={{ color:'rgba(216,255,227,.5)', fontSize:11 }}>{e.val}</span>
        </div>
      ))}
      <div style={{ marginTop:16 }}>
        <div style={{ fontSize:9, color:'rgba(216,255,227,.3)', textTransform:'uppercase', letterSpacing:'.15em', marginBottom:6 }}>context window</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:6, background:'rgba(0,255,65,.1)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ width:'72%', height:'100%', background:'linear-gradient(90deg,#006a1c,#00ff41)', boxShadow:'0 0 6px rgba(0,255,65,.5)' }}></div>
          </div>
          <span style={{ fontSize:10, color:'rgba(216,255,227,.4)', flexShrink:0 }}>72%  ·  128K / 200K</span>
        </div>
      </div>
    </div>
  );
};

/* ── Carousel shell ────────────────────────────────────────────── */

const CAROUSEL_SLIDES = [
  { id:'chat',      label:'Agent Chat',    title:'Live Agent Streams',   comp: AgentChatSlide  },
  { id:'workspace', label:'Workspace',     title:'Multi-Agent Dashboard', comp: WorkspaceDashSlide },
  { id:'tools',     label:'Tool Log',      title:'Tool Execution',       comp: ToolLogSlide    },
  { id:'memory',    label:'Memory',        title:'Persistent Memory',    comp: MemorySlide     },
];

const UICarousel = () => {
  const [idx, setIdx]         = useState(0);
  const [opacity, setOpacity] = useState(1);
  const timerRef              = useRef(null);

  const goTo = (next) => {
    setOpacity(0);
    setTimeout(() => {
      setIdx(next);
      setOpacity(1);
    }, 280);
  };

  const advance = () => goTo((idx + 1) % CAROUSEL_SLIDES.length);
  const prev    = () => goTo((idx - 1 + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length);

  useEffect(() => {
    timerRef.current = setInterval(advance, 4800);
    return () => clearInterval(timerRef.current);
  }, [idx]);

  const Slide = CAROUSEL_SLIDES[idx].comp;
  const G = '#00ff41';

  return (
    <div style={{ maxWidth:860, margin:'0 auto' }}>
      {/* Slide labels */}
      <div style={{ display:'flex', gap:4, marginBottom:20, justifyContent:'center' }}>
        {CAROUSEL_SLIDES.map((s, i) => (
          <button key={s.id} onClick={() => goTo(i)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:600,
            textTransform:'uppercase', letterSpacing:'.1em',
            padding:'5px 14px',
            background: i===idx ? 'rgba(0,255,65,.12)' : 'transparent',
            border: `1px solid ${i===idx ? G : 'rgba(0,255,65,.2)'}`,
            borderRadius:999, color: i===idx ? G : 'rgba(216,255,227,.45)',
            cursor:'pointer', transition:'all 150ms',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Terminal window with slide content */}
      <div style={{ position:'relative' }}>
        {/* Prev/next arrows */}
        {[['←',prev,'left:-44px'],['→',advance,'right:-44px']].map(([ch,fn,pos]) => (
          <button key={ch} onClick={fn} style={{
            position:'absolute', top:'50%', [pos.split(':')[0]]: pos.split(':')[1],
            transform:'translateY(-50%)',
            width:34, height:34, borderRadius:'50%',
            background:'rgba(2,8,4,.9)', border:'1px solid rgba(0,255,65,.25)',
            color:'rgba(216,255,227,.6)', fontSize:14, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all 150ms', zIndex:10,
          }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=G;e.currentTarget.style.color=G;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,255,65,.25)';e.currentTarget.style.color='rgba(216,255,227,.6)';}}
          >{ch}</button>
        ))}

        {/* Window chrome */}
        <div style={{ background:'#010402', border:'1px solid rgba(0,255,65,.28)', borderRadius:6, overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,.72), 0 0 0 1px rgba(0,255,65,.06)' }}>
          {/* Title bar */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 16px', background:'#030d06', borderBottom:'1px solid rgba(0,255,65,.13)' }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#ff5f6d' }}></div>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#d6ff5f' }}></div>
            <div style={{ width:10, height:10, borderRadius:'50%', background:G, boxShadow:'0 0 6px rgba(0,255,65,.4)' }}></div>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(216,255,227,.38)', textTransform:'uppercase', letterSpacing:'.1em', marginLeft:'auto' }}>
              hermes switch ui  ·  {CAROUSEL_SLIDES[idx].title.toLowerCase()}
            </span>
          </div>
          {/* Content */}
          <div style={{ transition:'opacity 280ms ease', opacity }}>
            <Slide />
          </div>
        </div>
      </div>

      {/* Dot indicators */}
      <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:20 }}>
        {CAROUSEL_SLIDES.map((_, i) => (
          <button key={i} onClick={() => goTo(i)} style={{
            width: i===idx ? 24 : 8, height:8, borderRadius:999,
            background: i===idx ? G : 'rgba(0,255,65,.25)',
            boxShadow: i===idx ? '0 0 8px rgba(0,255,65,.5)' : 'none',
            border:'none', cursor:'pointer', transition:'all 300ms', padding:0,
          }}></button>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { UICarousel });
