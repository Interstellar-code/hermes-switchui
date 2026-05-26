// shared.jsx — Matrix Rain, Terminal Window, shared data
// Exported to window for use by all variant files

var { useRef, useEffect } = React;

const MatrixRain = ({ opacity = 0.85, speed = 1, fade = 0.11 }) => {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let drops, cols, w, h, raf;
    let running = true;
    const chars = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF<>/$#%&'.split('');

    function size() {
      const r = cv.parentElement.getBoundingClientRect();
      w = r.width; h = r.height;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(w / 14);
      drops = Array.from({ length: cols }, () => Math.random() * h / 14);
    }

    function frame() {
      if (!running) return;
      ctx.fillStyle = `rgba(2,8,4,${fade})`;
      ctx.fillRect(0, 0, w, h);
      ctx.font = "14px 'JetBrains Mono', monospace";
      for (let i = 0; i < cols; i++) {
        const x = i * 14; const y = drops[i] * 14;
        ctx.fillStyle = `rgba(234,255,239,${opacity})`;
        ctx.shadowColor = '#00ff41'; ctx.shadowBlur = 8;
        ctx.fillText(chars[(Math.random() * chars.length) | 0], x, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(0,255,65,${opacity * 0.55})`;
        ctx.fillText(chars[(Math.random() * chars.length) | 0], x, y - 14);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.45 * speed * (1 + Math.random() * 0.4);
      }
      raf = requestAnimationFrame(frame);
    }

    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv.parentElement);
    frame();
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
};

const TerminalWin = ({ title = 'terminal', children, style }) => (
  <div style={{
    background: '#010402', border: '1px solid rgba(0,255,65,.28)',
    borderRadius: 6, overflow: 'hidden',
    boxShadow: '0 18px 54px rgba(0,0,0,.72)', ...style
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px', background: '#030d06',
      borderBottom: '1px solid rgba(0,255,65,.13)',
    }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f6d' }}></div>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#d6ff5f' }}></div>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#00ff41', boxShadow: '0 0 6px rgba(0,255,65,.4)' }}></div>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 500, color: 'rgba(216,255,227,.45)', textTransform: 'uppercase', letterSpacing: '.1em', marginLeft: 'auto' }}>{title}</span>
    </div>
    <div style={{ padding: '20px 24px', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.85, color: '#d8ffe3', minHeight: 200 }}>
      {children}
    </div>
  </div>
);

const ICONS = {
  chat:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><path d="M4 5h16v11H8l-4 4z"/></svg>,
  cpu:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>,
  data:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.6 3.6 3 8 3s8-1.4 8-3V6M4 12v6c0 1.6 3.6 3 8 3s8-1.4 8-3v-6"/></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/></svg>,
  agent:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>,
  cog:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1-.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.6 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
};

const FEATURES = [
  { key: 'chat',   pid: 'SRV-001', name: 'Live Agent Streams',  tag: 'real-time',     desc: 'Token-by-token streaming with full context visibility. Watch agents reason in real-time — no black boxes, no mystery.' },
  { key: 'cpu',    pid: 'SRV-002', name: 'Tool Execution',       tag: 'observable',    desc: 'Terminal, browser, file ops, and API calls — all observable, all auditable. Every invocation logged and inspectable.' },
  { key: 'data',   pid: 'SRV-003', name: 'Persistent Memory',   tag: 'cross-session', desc: 'Agents remember across sessions. Searchable long-term memory accumulating context, project knowledge and history.' },
  { key: 'shield', pid: 'SRV-004', name: 'Multi-Provider Auth', tag: 'pluggable',     desc: 'Plug in OpenAI, Anthropic, Google, or local models. One config, seamless switching, no vendor lock-in whatsoever.' },
  { key: 'agent',  pid: 'SRV-005', name: 'Subagent Delegation', tag: 'parallel',      desc: 'Orchestrate multiple agents in parallel. Delegate tasks, collect results, and synthesize outputs autonomously.' },
  { key: 'cog',    pid: 'SRV-006', name: 'Cron & Scheduling',   tag: 'automated',     desc: 'Scheduled tasks, periodic check-ins, and autonomous pipelines running on your cadence. Set it and forget it.' },
];

Object.assign(window, { MatrixRain, TerminalWin, ICONS, FEATURES });
