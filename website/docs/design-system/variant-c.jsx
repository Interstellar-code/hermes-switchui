// VARIANT C — BREACH
// Matrix landing: active infiltration / hacker aesthetic
// Top: scrolling status ticker · Hero: animated boot sequence · Features: classified file cards

var { useState, useEffect } = React;

const TICKER = '■  SYS_STATUS: ONLINE  ·  AGENTS: 4 ACTIVE  ·  TOKENS: 128,420  ·  UPTIME: 99.98%  ·  MODEL: claude-sonnet-4  ·  CLEARANCE: LEVEL-5  ·  ';

const BOOT_SEQ = [
  { ms:180,  type:'inf',  text:'INITIALIZING HERMES PROTOCOL v2.3...' },
  { ms:580,  type:'bar',  text:'' },
  { ms:980,  type:'gap',  text:'' },
  { ms:1180, type:'ok',   text:'✓  CORE KERNEL                  ONLINE' },
  { ms:1500, type:'ok',   text:'✓  AGENT MESH LAYER             ARMED' },
  { ms:1820, type:'ok',   text:'✓  MEMORY LAYER                 LOADED' },
  { ms:2140, type:'ok',   text:'✓  TOOL EXECUTOR                READY' },
  { ms:2460, type:'ok',   text:'✓  SESSION MANAGER              ACTIVE' },
  { ms:2860, type:'gap',  text:'' },
  { ms:3060, type:'sys',  text:'SYSTEM: ALL SERVICES NOMINAL' },
  { ms:3440, type:'ent',  text:'> ENTERING MATRIX WORKSPACE...' },
];

function VariantC() {
  const [scrolled, setScrolled] = useState(false);
  const [lines, setLines]       = useState([]);
  const [done, setDone]         = useState(false);
  const [glitch, setGlitch]     = useState(false);

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'vc-styles';
    el.textContent = `
      .vc-ticker { display:flex; animation:vcTick 32s linear infinite; }
      @keyframes vcTick { from{transform:translateX(0)} to{transform:translateX(-50%)} }
      .vc-bootline { animation:vcFade .28s both; }
      @keyframes vcFade { from{opacity:0} to{opacity:1} }
      .vc-navlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.52); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .vc-navlink:hover { color:#00ff41; }
      .vc-card { border:1px solid rgba(0,255,65,.18); border-radius:4px; background:#07130a; transition:all 200ms; overflow:hidden; }
      .vc-card:hover { border-color:rgba(0,255,65,.52); box-shadow:0 0 18px rgba(0,255,65,.14); transform:translateY(-2px); }
      .vc-footlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.4); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .vc-footlink:hover { color:#00ff41; }
      .vc-glitch { animation:vcGlitch .35s steps(1) 3 forwards; }
      @keyframes vcGlitch {
        0%,100% { transform:none; clip-path:none; }
        20%     { transform:translateX(-3px); clip-path:polygon(0 12%,100% 12%,100% 38%,0 38%); color:#5fcfff; }
        40%     { transform:translateX(4px);  clip-path:polygon(0 58%,100% 58%,100% 82%,0 82%); }
        60%     { transform:translateX(-2px); clip-path:none; }
        80%     { transform:translateX(1px); }
      }
    `;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  useEffect(() => {
    const timers = BOOT_SEQ.map(({ ms, type, text }) =>
      setTimeout(() => setLines(prev => [...prev, { type, text }]), ms)
    );
    const t1 = setTimeout(() => setDone(true), 3900);
    const t2 = setTimeout(() => setGlitch(true), 4220);
    return () => [...timers, t1, t2].forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const G = '#00ff41';
  const GGLOW = '0 0 14px rgba(0,255,65,.7),0 0 2px rgba(0,255,65,.9)';

  const renderLine = (line, i) => {
    if (line.type === 'gap') return <div key={i} style={{ height:8 }}></div>;
    if (line.type === 'bar') return (
      <div key={i} className="vc-bootline">
        <span style={{ color:G, textShadow:GGLOW }}>{'[' + '█'.repeat(34) + '] 100%'}</span>
      </div>
    );
    const colors = { ok:'#00ff41', sys:'#5fcfff', ent:'#eaffef', inf:'rgba(216,255,227,.52)' };
    const shadows = { ok:'0 0 8px rgba(0,255,65,.42)', sys:'none', ent:'none', inf:'none' };
    return (
      <div key={i} className="vc-bootline" style={{ color:colors[line.type]||'#d8ffe3', textShadow:shadows[line.type]||'none' }}>{line.text}</div>
    );
  };

  return (
    <div style={{ background:'#020804', color:'#d8ffe3', fontFamily:"'JetBrains Mono',monospace", minHeight:'100vh', overflowX:'hidden' }}>

      {/* ── TICKER ── */}
      <div style={{ height:28, background:'#030d06', borderBottom:'1px solid rgba(0,255,65,.18)', overflow:'hidden', display:'flex', alignItems:'center' }}>
        <div className="vc-ticker" style={{ whiteSpace:'nowrap' }}>
          {[0,1,2,3].map(i => (
            <span key={i} style={{ fontSize:10, color:'rgba(216,255,227,.38)', letterSpacing:'.12em' }}>{TICKER}</span>
          ))}
        </div>
      </div>

      {/* ── NAV ── */}
      <nav style={{ position:'sticky', top:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 32px', height:50, background:'rgba(2,8,4,.96)', backdropFilter:'blur(12px)', borderBottom:'1px solid rgba(0,255,65,.18)' }}>
        <a href="#" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
          <div style={{ width:28, height:28, border:`1.5px solid ${G}`, borderRadius:3, display:'grid', placeItems:'center', color:G, fontSize:14, fontWeight:700, boxShadow:'0 0 8px rgba(0,255,65,.35)' }}>ᕼ</div>
          <span style={{ fontSize:13, fontWeight:700, color:'#eaffef', letterSpacing:'.12em' }}>HERMES</span>
        </a>
        <div style={{ display:'flex', alignItems:'center', gap:20 }}>
          {['Features','Workspace','Stack','GitHub'].map(l => <a key={l} href="#" className="vc-navlink">{l}</a>)}
          <span style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.15em', padding:'3px 10px', border:'1px solid rgba(0,255,65,.38)', borderRadius:999, color:G, background:'rgba(0,255,65,.08)' }}>ACCESS GRANTED</span>
          <a href="#" className="m-btn m-btn-primary m-btn-sm">Execute →</a>
        </div>
      </nav>

      {/* ── HERO — boot sequence ── */}
      <section style={{ position:'relative', minHeight:'calc(100vh - 78px)', display:'flex', flexDirection:'column', justifyContent:'center', padding:'60px 64px', overflow:'hidden' }}>
        <MatrixRain opacity={0.48} speed={1.15} />
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 30% 50%,rgba(2,8,4,.1) 0%,rgba(2,8,4,.84) 100%)', pointerEvents:'none', zIndex:1 }}></div>
        <div style={{ position:'relative', zIndex:2, maxWidth:860 }}>

          {/* Boot panel */}
          <div style={{ background:'rgba(1,4,2,.72)', border:'1px solid rgba(0,255,65,.22)', borderRadius:4, padding:'24px 28px', marginBottom: done ? 40 : 0, fontSize:13, lineHeight:1.92, backdropFilter:'blur(8px)' }}>
            {lines.map((line, i) => renderLine(line, i))}
            {!done && <div className="vc-bootline" style={{ color:G }}><span className="m-cursor"></span></div>}
          </div>

          {/* Main headline — appears post-boot */}
          {done && (
            <div style={{ animation:'vcFade .5s both' }}>
              <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.25em', marginBottom:18, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
                HERMES SWITCH UI
              </div>
              <h1 className={glitch ? 'vc-glitch' : ''} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(38px,6.5vw,76px)', fontWeight:600, lineHeight:1.05, color:'#eaffef', letterSpacing:'-0.02em', margin:'0 0 22px' }}>
                YOUR AGENTS.<br/>
                <span style={{ color:G, textShadow:GGLOW }}>ONE WORKSPACE.</span>
              </h1>
              <p style={{ fontFamily:"'Inter',sans-serif", fontSize:15, lineHeight:1.72, color:'rgba(216,255,227,.54)', maxWidth:520, marginBottom:36 }}>
                The terminal-native AI workspace where agents think, tools execute, and you stay in control.
              </p>
              <div style={{ display:'flex', gap:10 }}>
                <a href="#" className="m-btn m-btn-primary m-btn-lg">EXECUTE PROTOCOL</a>
                <a href="#" className="m-btn m-btn-lg">VIEW MANIFEST →</a>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── FEATURES — classified file cards ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.55),transparent)', margin:'0 64px' }}></div>
      <section id="features" style={{ maxWidth:1200, margin:'0 auto', padding:'88px 64px' }}>
        <div style={{ marginBottom:48 }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
            01 // CLASSIFIED CAPABILITIES
          </div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(20px,3vw,32px)', fontWeight:600, color:'#eaffef', lineHeight:1.2, maxWidth:520 }}>Six active services — all observable, all auditable.</h2>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
          {FEATURES.map((f, i) => (
            <div key={f.pid} className="vc-card">
              {/* File header */}
              <div style={{ padding:'9px 16px', borderBottom:'1px solid rgba(0,255,65,.13)', background:'#041008', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.14em', color:'rgba(216,255,227,.3)' }}>[CLASSIFIED]</span>
                <span style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.12em', color:'rgba(216,255,227,.3)' }}>FILE-{String(i+1).padStart(3,'0')}</span>
              </div>
              {/* Body */}
              <div style={{ padding:'20px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                  <div style={{ width:32, height:32, border:'1px solid rgba(0,255,65,.35)', borderRadius:4, display:'grid', placeItems:'center', color:G, background:'#010402', flexShrink:0 }}>{ICONS[f.key]}</div>
                  <div style={{ fontSize:9, color:'rgba(216,255,227,.34)', textTransform:'uppercase', letterSpacing:'.1em' }}>CLEARANCE: LEVEL-{i+1}</div>
                </div>
                <h3 style={{ fontSize:14, fontWeight:600, color:'#eaffef', margin:'0 0 8px', letterSpacing:'.01em' }}>{f.name}</h3>
                <p style={{ fontFamily:"'Inter',sans-serif", fontSize:12, lineHeight:1.65, color:'rgba(216,255,227,.52)', margin:'0 0 16px' }}>{f.desc}</p>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:9, color:G, textTransform:'uppercase', letterSpacing:'.12em', textShadow:'0 0 6px rgba(0,255,65,.4)' }}>● ACTIVE</span>
                  <span style={{ fontSize:9, fontWeight:500, textTransform:'uppercase', letterSpacing:'.1em', padding:'2px 8px', border:'1px solid rgba(0,255,65,.22)', borderRadius:999, color:'rgba(216,255,227,.5)' }}>{f.tag}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.55),transparent)', margin:'0 64px' }}></div>
      <section style={{ padding:'92px 64px', textAlign:'center', position:'relative', overflow:'hidden', background:'linear-gradient(to bottom,transparent,rgba(0,255,65,.04))' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(0,255,65,.038) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.038) 1px,transparent 1px)', backgroundSize:'24px 24px', opacity:.5, pointerEvents:'none' }}></div>
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:14 }}>02 // EXECUTE</div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(28px,4.5vw,52px)', fontWeight:600, color:'#eaffef', marginBottom:14, lineHeight:1.15 }}>
            Deploy the <span style={{ color:G, textShadow:GGLOW }}>protocol.</span>
          </h2>
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:'rgba(216,255,227,.52)', maxWidth:420, margin:'0 auto 32px', lineHeight:1.72 }}>Open source. Self-hosted. Agent-native. Deploy in minutes, scale as needed.</p>
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:44 }}>
            <a href="#" className="m-btn m-btn-primary m-btn-lg">EXECUTE PROTOCOL</a>
            <a href="https://github.com/nousresearch/hermes-agent" target="_blank" className="m-btn m-btn-lg">View Source</a>
          </div>
          <TerminalWin title="mission terminal" style={{ maxWidth:580, margin:'0 auto', textAlign:'left' }}>
            {[
              { k:'cmd', t:'npm install -g hermes-agent' },
              { k:'cmd', t:'hermes setup' },
              { k:'ok',  t:'✓ connected · breach theme active' },
              { k:'cur', t:'' },
            ].map((l,i) => (
              <div key={i}>
                {l.k==='cmd' && <><span style={{color:'rgba(216,255,227,.32)'}}>$ </span><span style={{color:'#eaffef'}}>{l.t}</span></>}
                {l.k==='ok'  && <span style={{color:G,textShadow:'0 0 8px rgba(0,255,65,.4)'}}>{l.t}</span>}
                {l.k==='cur' && <><span style={{color:'rgba(216,255,227,.32)'}}>$ </span><span className="m-cursor"></span></>}
              </div>
            ))}
          </TerminalWin>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.28),transparent)', margin:'0 64px' }}></div>
      <footer style={{ padding:'24px 64px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
        <span style={{ fontSize:11, color:'rgba(216,255,227,.3)' }}>
          <span style={{color:G}}>//</span> hermes-switchui · breach theme · <span style={{color:G}}>SYS::ONLINE</span>
        </span>
        <div style={{ display:'flex', gap:24 }}>
          {[['Docs','#'],['GitHub','https://github.com/nousresearch/hermes-agent'],['Discord','#']].map(([n,h]) => (
            <a key={n} href={h} className="vc-footlink">{n}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}

Object.assign(window, { VariantC });
