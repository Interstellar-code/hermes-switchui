// hermes-landing.jsx — Hermes Switch UI landing page (Breach / Hacker variant)
// Features: ticker · GitHub stars · npm install boot · clean feature cards · UI carousel

var { useState, useEffect } = React;

var TICKER = '■  SYS_STATUS: ONLINE  ·  AGENTS: 4 ACTIVE  ·  TOKENS: 128,420  ·  UPTIME: 99.98%  ·  MODEL: claude-sonnet-4  ·  CLEARANCE: LEVEL-5  ·  ';

var BOOT_SEQ = [
  { ms:  140, type:'cmd', text:'$ npm install -g @hermes/switch-ui' },
  { ms:  500, type:'out', text:'  ↓  resolving 247 dependencies...' },
  { ms:  950, type:'bar', text:'install' },
  { ms: 1650, type:'ok',  text:'  added 247 packages in 3.2s' },
  { ms: 1950, type:'ok',  text:'  hermes-switch-ui@2.3.0  installed globally' },
  { ms: 2350, type:'gap', text:'' },
  { ms: 2550, type:'cmd', text:'$ hermes init' },
  { ms: 2870, type:'ok',  text:'  ✓  Node.js 20.x detected' },
  { ms: 3180, type:'ok',  text:'  ✓  API key validated' },
  { ms: 3480, type:'out', text:'  >  Pulling agent profiles...' },
  { ms: 3850, type:'bar', text:'agents' },
  { ms: 4600, type:'ok',  text:'  ✓  neo · trinity · morpheus · oracle  loaded' },
  { ms: 4950, type:'ok',  text:'  ✓  Connected  ·  claude-sonnet-4  active' },
  { ms: 5350, type:'sys', text:'WORKSPACE READY' },
  { ms: 5750, type:'ent', text:'> ENTERING MATRIX WORKSPACE...' },
];

var HL_FEATURES = [
  { key:'chat',   name:'Live Agent Streams',   tag:'real-time',     desc:'Token-by-token streaming with full context visibility. Watch agents reason in real-time — no black boxes, ever.' },
  { key:'cpu',    name:'Tool Execution',        tag:'observable',    desc:'Terminal, browser, file ops, and API calls — all observable and auditable. Every invocation logged and inspectable.' },
  { key:'data',   name:'Persistent Memory',    tag:'cross-session', desc:'Agents remember across sessions. Searchable long-term memory accumulating context, project knowledge and history.' },
  { key:'shield', name:'Multi-Provider Auth',  tag:'pluggable',     desc:'Plug in OpenAI, Anthropic, Google, or local models. One config, seamless switching, no vendor lock-in whatsoever.' },
  { key:'agent',  name:'Subagent Delegation',  tag:'parallel',      desc:'Orchestrate multiple agents in parallel. Delegate tasks, collect results, and synthesize outputs autonomously.' },
  { key:'cog',    name:'Cron & Scheduling',    tag:'automated',     desc:'Scheduled tasks, periodic check-ins, and autonomous pipelines running on your cadence. Set it and forget it.' },
];

var HL_ICONS = {
  chat:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d="M4 5h16v11H8l-4 4z"/></svg>,
  cpu:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>,
  data:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.6 3.6 3 8 3s8-1.4 8-3V6M4 12v6c0 1.6 3.6 3 8 3s8-1.4 8-3v-6"/></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/></svg>,
  agent:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>,
  cog:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1-.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.6 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
};

var fmtStars = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function HermesLanding() {
  const [lines,  setLines]  = useState([]);
  const [done,   setDone]   = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [stars,  setStars]  = useState(null);

  // GitHub stars fetch
  useEffect(() => {
    fetch('https://api.github.com/repos/nousresearch/hermes-agent')
      .then(r => r.json())
      .then(d => setStars(d.stargazers_count ?? null))
      .catch(() => {});
  }, []);

  // Boot sequence
  useEffect(() => {
    const timers = BOOT_SEQ.map(({ ms, type, text }) =>
      setTimeout(() => setLines(prev => [...prev, { type, text }]), ms)
    );
    const t1 = setTimeout(() => setDone(true), 6200);
    const t2 = setTimeout(() => setGlitch(true), 6550);
    return () => [...timers, t1, t2].forEach(clearTimeout);
  }, []);

  // Inject page styles
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'hl-styles';
    el.textContent = `
      .hl-ticker  { display:flex; animation:hlTick 36s linear infinite; }
      @keyframes hlTick { from{transform:translateX(0)} to{transform:translateX(-50%)} }
      .hl-boot    { animation:hlSlide .16s ease-out; }
      @keyframes hlSlide { from{transform:translateX(-5px)} to{transform:none} }
      .hl-glitch  { animation:hlGlitch .32s steps(1) 3 forwards; }
      @keyframes hlGlitch {
        0%,100% { transform:none; clip-path:none; }
        20%     { transform:translateX(-3px); clip-path:polygon(0 12%,100% 12%,100% 38%,0 38%); color:#5fcfff; }
        40%     { transform:translateX(4px);  clip-path:polygon(0 60%,100% 60%,100% 82%,0 82%); }
        60%     { transform:translateX(-2px); clip-path:none; }
        80%     { transform:translateX(1px); }
      }
      .hl-fill    { animation:hlBarFill 0.8s ease-out both; }
      .hl-fill2   { animation:hlBarFill 1.3s ease-out both; }
      @keyframes hlBarFill { from{width:0} to{width:100%} }
      .hl-feat    { border:1px solid rgba(0,255,65,.18); border-radius:6px; background:#07130a; padding:26px; transition:all 200ms; position:relative; overflow:hidden; }
      .hl-feat::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,#00ff41,transparent); opacity:0; transition:opacity 200ms; }
      .hl-feat:hover { border-color:rgba(0,255,65,.5); box-shadow:0 0 22px rgba(0,255,65,.1); transform:translateY(-2px); }
      .hl-feat:hover::before { opacity:1; }
      .hl-navlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.5); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .hl-navlink:hover { color:#00ff41; }
      .hl-footlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.38); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .hl-footlink:hover { color:#00ff41; }
    `;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const G = '#00ff41';
  const GGLOW = '0 0 14px rgba(0,255,65,.7),0 0 2px rgba(0,255,65,.9)';

  const renderBootLine = (line, i) => {
    if (line.type === 'gap') return <div key={i} style={{ height:6 }}></div>;
    if (line.type === 'bar') return (
      <div key={i} className="hl-boot" style={{ display:'flex', alignItems:'center', gap:10, margin:'4px 0' }}>
        <div style={{ flex:1, height:14, border:'1px solid rgba(0,255,65,.35)', borderRadius:2, padding:'2px', overflow:'hidden' }}>
          <div className={line.text==='agents' ? 'hl-fill2' : 'hl-fill'} style={{ height:'100%', background:'linear-gradient(90deg,#006a1c,#00ff41)', boxShadow:'0 0 8px rgba(0,255,65,.55)', borderRadius:1 }}></div>
        </div>
        <span style={{ fontSize:11, color:G, fontWeight:600, flexShrink:0 }}>100%</span>
      </div>
    );
    const styles = {
      cmd: { color:'#eaffef' },
      out: { color:'rgba(216,255,227,.5)' },
      ok:  { color:G, textShadow:'0 0 8px rgba(0,255,65,.4)' },
      sys: { color:'#5fcfff' },
      ent: { color:'#eaffef', fontWeight:600 },
    };
    return (
      <div key={i} className="hl-boot" style={styles[line.type] || {}}>{line.text}</div>
    );
  };

  return (
    <div style={{ background:'#020804', color:'#d8ffe3', fontFamily:"'JetBrains Mono',monospace", minHeight:'100vh', overflowX:'hidden' }}>

      {/* ── TICKER ── */}
      <div style={{ height:28, background:'#030d06', borderBottom:'1px solid rgba(0,255,65,.18)', overflow:'hidden', display:'flex', alignItems:'center' }}>
        <div className="hl-ticker" style={{ whiteSpace:'nowrap' }}>
          {[0,1,2,3].map(i => <span key={i} style={{ fontSize:10, color:'rgba(216,255,227,.36)', letterSpacing:'.12em' }}>{TICKER}</span>)}
        </div>
      </div>

      {/* ── NAV ── */}
      <nav style={{ position:'sticky', top:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 40px', height:52, background:'rgba(2,8,4,.96)', backdropFilter:'blur(12px)', borderBottom:'1px solid rgba(0,255,65,.18)' }}>
        <a href="#" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
          <div style={{ width:30, height:30, border:`2px solid ${G}`, borderRadius:4, display:'grid', placeItems:'center', color:G, fontSize:14, fontWeight:700, boxShadow:'0 0 10px rgba(0,255,65,.35)' }}>ᕼ</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#eaffef', letterSpacing:'.1em', lineHeight:1 }}>HERMES</div>
            <div style={{ fontSize:9, color:'rgba(216,255,227,.4)', letterSpacing:'.18em', textTransform:'uppercase' }}>SWITCH UI</div>
          </div>
        </a>
        <div style={{ display:'flex', alignItems:'center', gap:22 }}>
          {['Features','Interface','Docs'].map(l => <a key={l} href="#" className="hl-navlink">{l}</a>)}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* GitHub stars */}
          <a href="https://github.com/nousresearch/hermes-agent" target="_blank" style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', border:'1px solid rgba(0,255,65,.22)', borderRadius:4, background:'rgba(0,255,65,.05)', textDecoration:'none', transition:'all 150ms' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=G;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,255,65,.22)';}}>
            <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" style={{color:G}}><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            <span style={{ fontSize:11, fontWeight:600, color:G, fontFamily:"'JetBrains Mono',monospace" }}>
              {stars !== null ? `★ ${fmtStars(stars)}` : '★ —'}
            </span>
          </a>
          {/* Version badge */}
          <span style={{ fontSize:10, fontWeight:600, padding:'5px 10px', border:`1px solid rgba(0,255,65,.3)`, borderRadius:4, color:G, background:'rgba(0,255,65,.07)', letterSpacing:'.06em' }}>v2.3.0</span>
          {/* Access badge */}
          <span style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.15em', padding:'5px 10px', border:'1px solid rgba(0,255,65,.38)', borderRadius:999, color:G, background:'rgba(0,255,65,.08)' }}>ACCESS GRANTED</span>
          <a href="#" className="m-btn m-btn-primary m-btn-sm">Install →</a>
        </div>
      </nav>

      {/* ── HERO — npm install boot sequence ── */}
      <section style={{ position:'relative', minHeight:'calc(100vh - 80px)', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'60px 64px', overflow:'hidden', textAlign:'center' }}>
        <MatrixRain opacity={0.18} speed={0.09} fade={0.022} />
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 28% 50%,rgba(2,8,4,.08) 0%,rgba(2,8,4,.82) 100%)', pointerEvents:'none', zIndex:1 }}></div>
        <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(to bottom,rgba(0,255,65,.013) 0,rgba(0,255,65,.013) 1px,transparent 1px,transparent 3px)', mixBlendMode:'screen', pointerEvents:'none', zIndex:2 }}></div>

        <div style={{ position:'relative', zIndex:3, maxWidth:900, width:'100%', margin:'0 auto' }}>
          {/* Boot panel */}
          <div style={{ background:'rgba(1,4,2,.78)', border:'1px solid rgba(0,255,65,.24)', borderRadius:6, padding:'22px 28px', marginBottom: done ? 44 : 0, fontSize:13, lineHeight:1.95, backdropFilter:'blur(10px)', fontFamily:"'JetBrains Mono',monospace" }}>
            {lines.map((line, i) => renderBootLine(line, i))}
            {!done && <div className="hl-boot" style={{ color:G }}><span className="m-cursor"></span></div>}
          </div>

          {/* Main headline */}
          {done && (
            <div style={{ animation:'hlSlide .4s ease-out' }}>
              <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.25em', marginBottom:18, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
                <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
                HERMES SWITCH UI
              </div>
              <h1 className={glitch ? 'hl-glitch' : ''} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(38px,6vw,76px)', fontWeight:700, lineHeight:1.05, color:'#eaffef', letterSpacing:'-0.02em', margin:'0 0 20px' }}>
                YOUR AGENTS.<br/>
                <span style={{ color:G, textShadow:GGLOW }}>ONE WORKSPACE.</span>
              </h1>
              <p style={{ fontFamily:"'Inter',sans-serif", fontSize:15, lineHeight:1.75, color:'rgba(216,255,227,.54)', maxWidth:520, marginBottom:32, margin:'0 auto 32px' }}>
                The terminal-native AI workspace where agents think, tools execute, and you stay in control. Open source. Self-hosted. Agent-native.
              </p>
              {/* Badges row */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:32, flexWrap:'wrap' }}>
                <a href="https://github.com/nousresearch/hermes-agent" target="_blank" style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', border:`1px solid rgba(0,255,65,.3)`, borderRadius:4, color:G, textDecoration:'none', fontSize:11, fontWeight:600, background:'rgba(0,255,65,.07)' }}>
                  <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  {stars !== null ? `★ ${fmtStars(stars)} on GitHub` : 'GitHub'}
                </a>
                <span style={{ fontSize:10, padding:'5px 10px', border:'1px solid rgba(0,255,65,.22)', borderRadius:4, color:'rgba(216,255,227,.55)' }}>v2.3.0 stable</span>
                <span style={{ fontSize:10, padding:'5px 10px', border:'1px solid rgba(0,255,65,.22)', borderRadius:4, color:'rgba(216,255,227,.55)' }}>MIT license</span>
                <span style={{ fontSize:10, padding:'5px 10px', border:'1px solid rgba(0,255,65,.22)', borderRadius:4, color:'rgba(216,255,227,.55)' }}>Open source</span>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                <a href="#" className="m-btn m-btn-primary m-btn-lg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
                  Install Hermes
                </a>
                <a href="https://github.com/nousresearch/hermes-agent" target="_blank" className="m-btn m-btn-lg">View on GitHub →</a>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.55),transparent)', margin:'0 64px' }}></div>
      <section id="features" style={{ maxWidth:1200, margin:'0 auto', padding:'96px 64px' }}>
        <div style={{ marginBottom:52 }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
            01 // FEATURES
          </div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(22px,3vw,34px)', fontWeight:600, color:'#eaffef', lineHeight:1.2, maxWidth:540 }}>Everything you need to run agents at scale.</h2>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:18 }}>
          {HL_FEATURES.map((f, i) => (
            <div key={f.key} className="hl-feat">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
                <div style={{ width:38, height:38, border:'1px solid rgba(0,255,65,.38)', borderRadius:5, display:'grid', placeItems:'center', color:G, background:'#010402' }}>{HL_ICONS[f.key]}</div>
                <span style={{ fontSize:11, fontWeight:600, color:'rgba(0,255,65,.3)', letterSpacing:'-1px' }}>{String(i+1).padStart(2,'0')}</span>
              </div>
              <h3 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight:600, color:'#eaffef', margin:'0 0 10px' }}>{f.name}</h3>
              <p style={{ fontFamily:"'Inter',sans-serif", fontSize:13, lineHeight:1.68, color:'rgba(216,255,227,.52)', margin:'0 0 18px' }}>{f.desc}</p>
              <span style={{ fontSize:9, fontWeight:500, textTransform:'uppercase', letterSpacing:'.12em', padding:'3px 9px', border:'1px solid rgba(0,255,65,.22)', borderRadius:999, color:'rgba(216,255,227,.5)' }}>{f.tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── UI CAROUSEL ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.55),transparent)', margin:'0 64px' }}></div>
      <section id="interface" style={{ padding:'96px 64px', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(0,255,65,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.03) 1px,transparent 1px)', backgroundSize:'24px 24px', pointerEvents:'none' }}></div>
        <div style={{ maxWidth:1100, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div style={{ marginBottom:52, textAlign:'center' }}>
            <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:14, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
              <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
              02 // INTERFACE
              <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
            </div>
            <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(22px,3vw,34px)', fontWeight:600, color:'#eaffef', lineHeight:1.2 }}>See the workspace in action.</h2>
            <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, lineHeight:1.7, color:'rgba(216,255,227,.5)', marginTop:12 }}>Four views. One workspace. Total observability.</p>
          </div>
          <UICarousel />
        </div>
      </section>

      {/* ── INSTALL STRIP ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.55),transparent)', margin:'0 64px' }}></div>
      <section style={{ padding:'72px 64px', textAlign:'center' }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:14 }}>03 // GET STARTED</div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(24px,3.5vw,40px)', fontWeight:600, color:'#eaffef', marginBottom:12, lineHeight:1.15 }}>
            Deploy in <span style={{ color:G, textShadow:GGLOW }}>minutes.</span>
          </h2>
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:'rgba(216,255,227,.5)', marginBottom:28, lineHeight:1.7 }}>Open source. Self-hosted. No lock-in.</p>
          <div style={{ display:'inline-flex', alignItems:'center', gap:0, background:'#010402', border:'1px solid rgba(0,255,65,.28)', borderRadius:6, padding:'12px 20px', fontSize:14, fontFamily:"'JetBrains Mono',monospace", marginBottom:28 }}>
            <span style={{ color:'rgba(216,255,227,.35)', marginRight:10 }}>$</span>
            <span style={{ color:'#eaffef' }}>npm install -g @hermes/switch-ui</span>
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <a href="#" className="m-btn m-btn-primary m-btn-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
              Install Hermes
            </a>
            <a href="https://github.com/nousresearch/hermes-agent" target="_blank" className="m-btn m-btn-lg">GitHub →</a>
            <a href="#" className="m-btn m-btn-lg">Docs →</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.28),transparent)', margin:'0 64px' }}></div>
      <footer style={{ padding:'24px 64px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:22, height:22, border:`1.5px solid ${G}`, borderRadius:3, display:'grid', placeItems:'center', color:G, fontSize:11, fontWeight:700, boxShadow:'0 0 6px rgba(0,255,65,.3)' }}>ᕼ</div>
          <span style={{ fontSize:11, color:'rgba(216,255,227,.3)' }}>Hermes Switch UI · v2.3.0 · MIT License · <span style={{color:G}}>SYS::ONLINE</span></span>
        </div>
        <div style={{ display:'flex', gap:24 }}>
          {[['Docs','#'],['GitHub','https://github.com/nousresearch/hermes-agent'],['Discord','#'],['Changelog','#']].map(([n,h]) => (
            <a key={n} href={h} className="hl-footlink">{n}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}

Object.assign(window, { HermesLanding });
