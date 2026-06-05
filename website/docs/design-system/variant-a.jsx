// VARIANT A — CONSOLE
// Matrix landing: OS terminal / process-monitor aesthetic
// Hero: 60/40 split with animated terminal · Features: process table rows

var { useState, useEffect } = React;

function VariantA() {
  const [scrolled, setScrolled] = useState(false);
  const [uptime, setUptime]     = useState('00:00:00');

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'va-styles';
    el.textContent = `
      .va-row { transition: background 120ms; border-bottom: 1px solid rgba(0,255,65,.09); }
      .va-row:hover { background: rgba(0,255,65,.04); }
      .va-row:last-child { border-bottom: none; }
      .va-tline { animation: vaFade .38s both; }
      @keyframes vaFade { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
      .va-navlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.52); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .va-navlink:hover { color:#00ff41; }
      .va-footlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.42); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .va-footlink:hover { color:#00ff41; }
    `;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  useEffect(() => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      setUptime(`${h}:${m}:${sec}`);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const G = '#00ff41';
  const navBg = scrolled ? 'rgba(2,8,4,.97)' : 'rgba(2,8,4,.86)';
  const navBorder = scrolled ? 'rgba(0,255,65,.28)' : 'rgba(0,255,65,.12)';

  const tlines = [
    { k:'p', t:'hermes chat --agent neo' },
    { k:'o', t:'connecting to neo@claude-sonnet-4...' },
    { k:'s', t:'[ OK ] handshake complete' },
    { k:'p', t:'refactor the auth module to use JWT rotation' },
    { k:'o', t:'▸ reading src/auth/session.ts...' },
    { k:'o', t:'▸ found 3 files matching auth pattern' },
    { k:'o', t:'▸ patching — adding refresh token logic' },
    { k:'o', t:'▸ running test suite...' },
    { k:'d', t:'[ DONE ] 3 files modified · 14 tests passing' },
    { k:'c', t:'' },
  ];

  const bk = (pos) => {
    const base = { position:'absolute', width:18, height:18, border:'2px solid #00ff41' };
    if (pos==='tl') return { ...base, top:-12, left:-12, borderRight:'none', borderBottom:'none' };
    if (pos==='tr') return { ...base, top:-12, right:-12, borderLeft:'none',  borderBottom:'none' };
    if (pos==='bl') return { ...base, bottom:-12, left:-12, borderRight:'none', borderTop:'none' };
    return { ...base, bottom:-12, right:-12, borderLeft:'none', borderTop:'none' };
  };

  return (
    <div style={{ background:'#020804', color:'#d8ffe3', fontFamily:"'JetBrains Mono',monospace", minHeight:'100vh', overflowX:'hidden' }}>

      {/* ── NAV ── */}
      <nav style={{ position:'fixed', top:0, left:0, right:0, zIndex:100, height:52, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 32px', background:navBg, backdropFilter:'blur(12px)', borderBottom:`1px solid ${navBorder}`, transition:'all 200ms' }}>
        <a href="#" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
          <div style={{ width:28, height:28, border:`1.5px solid ${G}`, borderRadius:3, display:'grid', placeItems:'center', color:G, fontSize:14, fontWeight:700, boxShadow:'0 0 8px rgba(0,255,65,.35)' }}>ᕼ</div>
          <span style={{ fontSize:13, fontWeight:700, color:'#eaffef', letterSpacing:'.12em' }}>HERMES</span>
        </a>
        <div style={{ display:'flex', alignItems:'center', gap:22 }}>
          {['Features','Workspace','Stack','GitHub'].map(l => <a key={l} href="#" className="va-navlink">{l}</a>)}
          <a href="#" className="m-btn m-btn-primary m-btn-sm">Launch →</a>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:10, color:G, letterSpacing:'.12em', fontWeight:500 }}>
          <div style={{ width:6, height:6, background:G, borderRadius:'50%', boxShadow:`0 0 6px ${G}`, animation:'m-pulse 2s infinite' }}></div>
          UPTIME {uptime}
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ paddingTop:52, minHeight:'100vh', display:'grid', gridTemplateColumns:'1.1fr 0.9fr', position:'relative', overflow:'hidden' }}>

        {/* Left panel */}
        <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', padding:'80px 48px 80px 64px', borderRight:'1px solid rgba(0,255,65,.1)', position:'relative', zIndex:1 }}>
          <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(0,255,65,.028) 1px, transparent 1px),linear-gradient(90deg, rgba(0,255,65,.028) 1px, transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }}></div>
          <div style={{ position:'relative' }}>
            <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'.25em', color:'rgba(216,255,227,.32)', marginBottom:22, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ width:20, height:1, background:'rgba(0,255,65,.4)', display:'inline-block' }}></span>
              SYS::READY
              <span style={{ width:20, height:1, background:'rgba(0,255,65,.4)', display:'inline-block' }}></span>
            </div>
            <div style={{ fontSize:11, color:G, marginBottom:12, opacity:.65 }}>▸ hermes --workspace init</div>
            <h1 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(40px,5vw,68px)', fontWeight:600, lineHeight:1.05, color:'#eaffef', letterSpacing:'-0.02em', margin:0 }}>
              YOUR<br/>AGENTS.<br/>
              <span style={{ color:G, textShadow:'0 0 14px rgba(0,255,65,.7),0 0 2px rgba(0,255,65,.9)' }}>ONE WORKSPACE.</span>
            </h1>
            <p style={{ fontFamily:"'Inter',sans-serif", fontSize:15, lineHeight:1.72, color:'rgba(216,255,227,.54)', maxWidth:420, margin:'24px 0 36px' }}>
              The terminal-native AI workspace where agents think, tools execute, and you stay in control. Streams, memory, terminals — co-located and observable.
            </p>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <a href="#" className="m-btn m-btn-primary m-btn-lg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
                Install Hermes
              </a>
              <a href="#" className="m-btn m-btn-lg">Read Docs →</a>
            </div>
            <div style={{ display:'flex', gap:12, marginTop:40, flexWrap:'wrap' }}>
              {[['128K','max context'],['4','agents active'],['v2.3','stable release']].map(([v,l]) => (
                <div key={l} style={{ padding:'9px 14px', border:'1px solid rgba(0,255,65,.2)', borderRadius:4, background:'rgba(0,255,65,.05)' }}>
                  <div style={{ fontSize:17, fontWeight:600, color:G, textShadow:'0 0 8px rgba(0,255,65,.55)', fontFamily:"'JetBrains Mono',monospace" }}>{v}</div>
                  <div style={{ fontSize:9, color:'rgba(216,255,227,.36)', textTransform:'uppercase', letterSpacing:'.15em', marginTop:2 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel — rain + bracketed terminal */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 64px 80px 48px', position:'relative' }}>
          <MatrixRain opacity={0.62} />
          <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center, rgba(2,8,4,0) 18%, rgba(2,8,4,.72) 100%)', pointerEvents:'none', zIndex:1 }}></div>
          <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(to bottom,rgba(0,255,65,.013) 0,rgba(0,255,65,.013) 1px,transparent 1px,transparent 3px)', mixBlendMode:'screen', pointerEvents:'none', zIndex:2 }}></div>
          <div style={{ position:'relative', zIndex:3, width:'100%', maxWidth:460 }}>
            <div style={bk('tl')}></div>
            <div style={bk('tr')}></div>
            <div style={bk('bl')}></div>
            <div style={bk('br')}></div>
            <TerminalWin title="hermes :: neo">
              {tlines.map((l, i) => (
                <div key={i} className="va-tline" style={{ animationDelay:`${0.3 + i * 0.32}s` }}>
                  {l.k==='p' && <><span style={{color:G}}>▸ </span><span style={{color:'#eaffef'}}>{l.t}</span></>}
                  {l.k==='o' && <span style={{color:'rgba(216,255,227,.52)'}}>{l.t}</span>}
                  {l.k==='s' && <span style={{color:G,textShadow:'0 0 8px rgba(0,255,65,.5)'}}>{l.t}</span>}
                  {l.k==='d' && <span style={{color:'#7cff9b'}}>{l.t}</span>}
                  {l.k==='c' && <><span style={{color:'rgba(216,255,227,.32)'}}>$ </span><span className="m-cursor"></span></>}
                </div>
              ))}
            </TerminalWin>
          </div>
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.6),transparent)', boxShadow:'0 0 8px rgba(0,255,65,.22)', margin:'0 64px' }}></div>

      {/* ── FEATURES — process table ── */}
      <section id="features" style={{ maxWidth:1200, margin:'0 auto', padding:'96px 64px' }}>
        <div style={{ marginBottom:48 }}>
          <div style={{ fontSize:10, fontWeight:600, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:16, height:1, background:G, boxShadow:'0 0 6px rgba(0,255,65,.4)', display:'inline-block' }}></span>
            01 // FEATURES
          </div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(22px,3vw,34px)', fontWeight:600, color:'#eaffef', lineHeight:1.2, marginBottom:10, maxWidth:560 }}>Six active services. All observable.</h2>
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, lineHeight:1.7, color:'rgba(216,255,227,.52)', maxWidth:480 }}>Every capability exposed as a named, addressable process. Inspect, monitor, and control each service from one console.</p>
        </div>
        <div style={{ border:'1px solid rgba(0,255,65,.18)', borderRadius:6, overflow:'hidden', background:'#07130a' }}>
          <div style={{ display:'grid', gridTemplateColumns:'52px 190px 1fr 100px', gap:16, padding:'10px 20px', background:'#030d06', borderBottom:'1px solid rgba(0,255,65,.18)', fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.18em', color:'rgba(216,255,227,.32)' }}>
            <div></div><div>Process</div><div>Description</div><div>Tag</div>
          </div>
          {FEATURES.map((f) => (
            <div key={f.pid} className="va-row" style={{ display:'grid', gridTemplateColumns:'52px 190px 1fr 100px', gap:16, padding:'20px', alignItems:'start' }}>
              <div style={{ width:34, height:34, border:'1px solid rgba(0,255,65,.35)', borderRadius:4, display:'grid', placeItems:'center', color:G, background:'#010402' }}>{ICONS[f.key]}</div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#eaffef', marginBottom:3 }}>{f.name}</div>
                <div style={{ fontSize:9, color:'rgba(216,255,227,.32)', textTransform:'uppercase', letterSpacing:'.1em' }}>{f.pid}</div>
              </div>
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, lineHeight:1.65, color:'rgba(216,255,227,.52)' }}>{f.desc}</div>
              <div style={{ fontSize:9, fontWeight:500, textTransform:'uppercase', letterSpacing:'.1em', padding:'3px 9px', border:'1px solid rgba(0,255,65,.25)', borderRadius:999, color:'rgba(0,255,65,.8)', background:'rgba(0,255,65,.06)', whiteSpace:'nowrap', justifySelf:'start' }}>{f.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.6),transparent)', boxShadow:'0 0 8px rgba(0,255,65,.22)', margin:'0 64px' }}></div>

      {/* ── CTA ── */}
      <section id="cta" style={{ position:'relative', overflow:'hidden', padding:'100px 64px' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(0,255,65,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.04) 1px,transparent 1px)', backgroundSize:'24px 24px', opacity:.5, pointerEvents:'none' }}></div>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 50% 50%,rgba(0,255,65,.05) 0%,transparent 70%)', pointerEvents:'none' }}></div>
        <div style={{ maxWidth:1200, margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:64, alignItems:'center', position:'relative', zIndex:1 }}>
          <div>
            <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.22em', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
              02 // GET STARTED
            </div>
            <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(24px,3.5vw,42px)', fontWeight:600, lineHeight:1.15, color:'#eaffef', marginBottom:16 }}>
              Ready to <span style={{ color:G, textShadow:'0 0 14px rgba(0,255,65,.7)' }}>switch</span> on?
            </h2>
            <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, lineHeight:1.72, color:'rgba(216,255,227,.52)', maxWidth:400, marginBottom:28 }}>Open source. Self-hosted. Agent-native. Deploy in minutes, scale to as many agents as you need.</p>
            <div style={{ display:'flex', gap:10 }}>
              <a href="#" className="m-btn m-btn-primary m-btn-lg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
                Install Hermes
              </a>
              <a href="https://github.com/nousresearch/hermes-agent" target="_blank" className="m-btn m-btn-lg">GitHub</a>
            </div>
          </div>
          <TerminalWin title="terminal">
            {[
              { k:'cmd', t:'npm install -g hermes-agent' },
              { k:'cmd', t:'hermes setup' },
              { k:'ok',  t:'✓ connected · matrix theme active' },
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
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.35),transparent)', margin:'0 64px' }}></div>
      <footer style={{ padding:'28px 64px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, maxWidth:1200, margin:'0 auto' }}>
        <span style={{ fontSize:11, color:'rgba(216,255,227,.32)', letterSpacing:'.05em' }}><span style={{color:G}}>//</span> hermes-switchui · console theme · SYS::READY</span>
        <div style={{ display:'flex', gap:24 }}>
          {[['Docs','#'],['GitHub','https://github.com/nousresearch/hermes-agent'],['Discord','#']].map(([n,h]) => (
            <a key={n} href={h} className="va-footlink">{n}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}

Object.assign(window, { VariantA });
