// VARIANT B — PHOSPHOR
// Matrix landing: cinematic editorial aesthetic
// Hero: massive EB Garamond headline over rain · Features: numbered manifesto list

var { useState, useEffect } = React;

function VariantB() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'vb-styles';
    el.textContent = `
      .vb-navlink  { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.52); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .vb-navlink:hover  { color:#00ff41; }
      .vb-footlink { font:500 11px 'JetBrains Mono',monospace; color:rgba(216,255,227,.4); text-decoration:none; text-transform:uppercase; letter-spacing:.1em; transition:color 120ms; }
      .vb-footlink:hover { color:#00ff41; }
      .vb-feat { border-top:1px solid rgba(0,255,65,.12); display:grid; grid-template-columns:80px 1fr; gap:40px; padding:44px 0; transition:border-color 200ms; }
      .vb-feat:hover { border-top-color:rgba(0,255,65,.45); }
      .vb-arch-node { padding:10px 18px; background:#010402; border:1px solid rgba(0,255,65,.18); border-radius:4px; font:500 12px 'JetBrains Mono',monospace; color:rgba(216,255,227,.52); text-transform:uppercase; letter-spacing:.06em; text-align:center; flex:1; min-width:90px; transition:all 150ms; }
      .vb-arch-node:hover { border-color:rgba(0,255,65,.5); color:#eaffef; }
      .vb-arch-node.vb-primary { border-color:#00ff41; color:#00ff41; background:rgba(0,255,65,.06); box-shadow:0 0 8px rgba(0,255,65,.25); }
    `;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const G = '#00ff41';
  const GGLOW = '0 0 14px rgba(0,255,65,.7),0 0 2px rgba(0,255,65,.9)';

  const layers = [
    { label:'INTERFACE', nodes:[{n:'Switch UI',p:true},{n:'Telegram'},{n:'CLI'},{n:'Discord'}] },
    { label:'GATEWAY',   nodes:[{n:'Hermes Core',p:true},{n:'Session Mgr'},{n:'Router'}] },
    { label:'AGENTS',    nodes:[{n:'Neo'},{n:'Trinity'},{n:'Morpheus'},{n:'Oracle'}] },
    { label:'INFRA',     nodes:[{n:'Terminal'},{n:'Browser'},{n:'Files'},{n:'Memory'},{n:'Cron'}] },
  ];

  return (
    <div style={{ background:'#020804', color:'#d8ffe3', fontFamily:"'JetBrains Mono',monospace", minHeight:'100vh', overflowX:'hidden' }}>

      {/* ── NAV — minimal floating ── */}
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:100,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'18px 48px',
        background: scrolled ? 'rgba(2,8,4,.92)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: `1px solid ${scrolled ? 'rgba(0,255,65,.18)' : 'transparent'}`,
        transition:'all 320ms',
      }}>
        <a href="#" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
          <div style={{ width:26, height:26, border:`1.5px solid ${G}`, borderRadius:3, display:'grid', placeItems:'center', color:G, fontSize:13, fontWeight:700, boxShadow:'0 0 8px rgba(0,255,65,.35)' }}>ᕼ</div>
          <span style={{ fontSize:12, fontWeight:700, color:'#eaffef', letterSpacing:'.15em' }}>HERMES</span>
        </a>
        <div style={{ display:'flex', alignItems:'center', gap:32 }}>
          {['Features','Architecture','Stack'].map(l => <a key={l} href="#" className="vb-navlink">{l}</a>)}
          <a href="#" className="m-btn m-btn-primary m-btn-sm">Get Started</a>
        </div>
      </nav>

      {/* ── HERO — full viewport, massive Garamond over rain ── */}
      <section style={{ position:'relative', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', overflow:'hidden', textAlign:'center', padding:'0 32px' }}>
        <MatrixRain opacity={0.72} speed={0.75} />
        {/* Vignette */}
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center,transparent 25%,rgba(2,8,4,.78) 100%)', pointerEvents:'none', zIndex:1 }}></div>
        {/* Scanlines */}
        <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(to bottom,rgba(0,255,65,.016) 0,rgba(0,255,65,.016) 1px,transparent 1px,transparent 3px)', mixBlendMode:'screen', pointerEvents:'none', zIndex:2 }}></div>

        <div style={{ position:'relative', zIndex:3 }}>
          {/* Eyebrow */}
          <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'.32em', color:G, marginBottom:44, display:'flex', alignItems:'center', justifyContent:'center', gap:18 }}>
            <span style={{ width:32, height:1, background:G, boxShadow:'0 0 8px rgba(0,255,65,.5)', display:'inline-block' }}></span>
            SWITCH UI · v2.3 · OPEN SOURCE
            <span style={{ width:32, height:1, background:G, boxShadow:'0 0 8px rgba(0,255,65,.5)', display:'inline-block' }}></span>
          </div>

          {/* Massive Garamond headline */}
          <h1 style={{
            fontFamily:"'EB Garamond',Georgia,serif",
            fontSize:'clamp(76px,15vw,196px)',
            fontWeight:500,
            lineHeight:0.88,
            color:'#eaffef',
            letterSpacing:'0.12em',
            textShadow:'0 0 80px rgba(0,255,65,.18),0 0 20px rgba(0,255,65,.08)',
            margin:0, marginBottom:40,
          }}>
            HER<span style={{ color:G, textShadow:GGLOW }}>M</span>ES
          </h1>

          {/* Subtitle */}
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:15, lineHeight:1.7, color:'rgba(216,255,227,.56)', maxWidth:480, margin:'0 auto 40px' }}>
            The terminal-native AI workspace where agents think,<br/>tools execute, and you stay in control.
          </p>

          {/* Actions */}
          <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:44 }}>
            <a href="#" className="m-btn m-btn-primary m-btn-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
              Install Hermes
            </a>
            <a href="#" className="m-btn m-btn-lg">Explore Features →</a>
          </div>

          {/* Badges */}
          <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
            <span className="m-badge m-badge-accent">v2.3</span>
            <span className="m-badge">Open Source</span>
            <span className="m-badge">Self-Hosted</span>
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{ position:'absolute', bottom:40, left:'50%', transform:'translateX(-50%)', zIndex:3, textAlign:'center', color:'rgba(216,255,227,.3)', fontSize:9, letterSpacing:'.22em', textTransform:'uppercase' }}>
          <div style={{ marginBottom:8 }}>scroll</div>
          <div style={{ width:14, height:14, borderRight:'1.5px solid rgba(216,255,227,.3)', borderBottom:'1.5px solid rgba(216,255,227,.3)', transform:'rotate(45deg)', margin:'0 auto' }}></div>
        </div>
      </section>

      {/* ── FEATURES — numbered manifesto list ── */}
      <section id="features" style={{ maxWidth:1060, margin:'0 auto', padding:'110px 48px' }}>
        <div style={{ marginBottom:72 }}>
          <div style={{ fontSize:10, fontWeight:600, color:G, textTransform:'uppercase', letterSpacing:'.25em', marginBottom:18, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
            01 · CAPABILITIES
          </div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(22px,3vw,36px)', fontWeight:600, color:'#eaffef', lineHeight:1.2, maxWidth:560 }}>Built for the way agents actually work</h2>
        </div>

        {FEATURES.map((f, i) => (
          <div key={f.pid} className="vb-feat">
            {/* Large faded number */}
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:52, fontWeight:600, color:'rgba(0,255,65,.15)', lineHeight:1, userSelect:'none', letterSpacing:'-2px', paddingTop:4 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            {/* Content */}
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                <div style={{ width:32, height:32, border:'1px solid rgba(0,255,65,.4)', borderRadius:4, display:'grid', placeItems:'center', color:G, background:'#010402', flexShrink:0 }}>{ICONS[f.key]}</div>
                <h3 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:600, color:'#eaffef', margin:0 }}>{f.name}</h3>
                <span style={{ fontSize:9, fontWeight:500, textTransform:'uppercase', letterSpacing:'.14em', padding:'2px 8px', border:'1px solid rgba(0,255,65,.2)', borderRadius:999, color:'rgba(216,255,227,.52)', flexShrink:0 }}>{f.tag}</span>
              </div>
              <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, lineHeight:1.72, color:'rgba(216,255,227,.54)', maxWidth:540, margin:0 }}>{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── ARCHITECTURE — clean layered view ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.45),transparent)', margin:'0 48px' }}></div>
      <section id="architecture" style={{ maxWidth:1060, margin:'0 auto', padding:'100px 48px' }}>
        <div style={{ marginBottom:56 }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.25em', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:16, height:1, background:G, display:'inline-block' }}></span>
            02 · ARCHITECTURE
          </div>
          <h2 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(20px,3vw,34px)', fontWeight:600, color:'#eaffef', lineHeight:1.2, maxWidth:500 }}>Stack that stays out of your way</h2>
        </div>
        <div style={{ background:'#07130a', border:'1px solid rgba(0,255,65,.16)', borderRadius:6, padding:'40px' }}>
          {layers.map((layer, i) => (
            <div key={layer.label}>
              <div style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'.2em', color:'rgba(216,255,227,.32)', marginBottom:10 }}>{layer.label}</div>
              <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
                {layer.nodes.map(nd => <div key={nd.n} className={`vb-arch-node${nd.p?' vb-primary':''}`}>{nd.n}</div>)}
              </div>
              {i < layers.length - 1 && <div style={{ textAlign:'center', color:'rgba(0,255,65,.35)', fontSize:12, margin:'8px 0 14px', letterSpacing:'.1em' }}>↕</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.45),transparent)', margin:'0 48px' }}></div>
      <section style={{ padding:'110px 48px', textAlign:'center', position:'relative', overflow:'hidden', background:'radial-gradient(ellipse at 50% 0%,rgba(0,255,65,.06) 0%,transparent 60%)' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(0,255,65,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.035) 1px,transparent 1px)', backgroundSize:'24px 24px', opacity:.5, pointerEvents:'none' }}></div>
        <div style={{ position:'relative', zIndex:1, maxWidth:680, margin:'0 auto' }}>
          <div style={{ fontSize:10, color:G, textTransform:'uppercase', letterSpacing:'.25em', marginBottom:20 }}>03 · GET STARTED</div>
          <h2 style={{ fontFamily:"'EB Garamond',serif", fontSize:'clamp(38px,6vw,74px)', fontWeight:500, lineHeight:1.1, color:'#eaffef', marginBottom:20, letterSpacing:'.02em' }}>
            Ready to <em style={{ color:G, fontStyle:'italic', textShadow:GGLOW }}>switch</em> on?
          </h2>
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:14, lineHeight:1.72, color:'rgba(216,255,227,.52)', marginBottom:36 }}>Open source. Self-hosted. Agent-native. Deploy in minutes.</p>
          <div style={{ display:'flex', gap:12, justifyContent:'center' }}>
            <a href="#" className="m-btn m-btn-primary m-btn-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 12 16-8-5 18-3-7-8-3z"/></svg>
              Install Hermes
            </a>
            <a href="https://github.com/nousresearch/hermes-agent" target="_blank" className="m-btn m-btn-lg">GitHub</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(0,255,65,.28),transparent)', margin:'0 48px' }}></div>
      <footer style={{ padding:'28px 48px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, maxWidth:1060, margin:'0 auto' }}>
        <span style={{ fontSize:11, color:'rgba(216,255,227,.3)', letterSpacing:'.05em' }}><span style={{color:G}}>//</span> hermes-switchui · phosphor theme</span>
        <div style={{ display:'flex', gap:24 }}>
          {[['Docs','#'],['GitHub','https://github.com/nousresearch/hermes-agent'],['Discord','#']].map(([n,h]) => (
            <a key={n} href={h} className="vb-footlink">{n}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}

Object.assign(window, { VariantB });
