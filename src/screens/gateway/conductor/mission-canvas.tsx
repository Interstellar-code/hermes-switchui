import { useConductorUIStore } from '@/stores/conductor-ui-store'

interface MissionCanvasData {
  title: string
  subtitle: string
}

interface MissionCanvasProps {
  data?: MissionCanvasData
}

const DEFAULT_DATA: MissionCanvasData = {
  title: 'Mission DAG',
  subtitle: '· 3-tier orchestration · plan → route → execute ↺ review → report',
}

function DagFlow() {
  return (
    <svg
      className="dag"
      id="dag-flow"
      viewBox="0 0 1200 380"
      preserveAspectRatio="xMidYMid meet"
      style={{ height: 380 }}
    >
      <defs>
        <linearGradient id="edge-active" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,255,65,.05)" />
          <stop offset="50%" stopColor="rgba(0,255,65,1)" />
          <stop offset="100%" stopColor="rgba(0,255,65,.05)" />
        </linearGradient>
        <linearGradient id="edge-active-cyan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(95,207,255,.05)" />
          <stop offset="50%" stopColor="rgba(95,207,255,.95)" />
          <stop offset="100%" stopColor="rgba(95,207,255,.05)" />
        </linearGradient>
        <linearGradient id="edge-active-pink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,95,162,.05)" />
          <stop offset="50%" stopColor="rgba(255,95,162,.95)" />
          <stop offset="100%" stopColor="rgba(255,95,162,.05)" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2.5" /></filter>
        <marker id="arrow-loop" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d6ff5f" />
        </marker>
      </defs>

      {/* tier band guides */}
      <g>
        <rect x="0" y="20" width="1200" height="120" fill="rgba(0,255,65,.025)" />
        <line x1="0" y1="20" x2="1200" y2="20" stroke="rgba(0,255,65,.18)" strokeDasharray="2 4" />
        <line x1="0" y1="140" x2="1200" y2="140" stroke="rgba(0,255,65,.12)" strokeDasharray="2 4" />
        <text x="14" y="36" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(0,255,65,.7)" letterSpacing="2" fontWeight="600">T1 · SWITCH · ORCHESTRATOR</text>
        <line x1="0" y1="240" x2="1200" y2="240" stroke="rgba(95,207,255,.12)" strokeDasharray="2 4" />
        <text x="14" y="156" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.45)" letterSpacing="2" fontWeight="600">T2 · DOMAIN HEADS</text>
        <line x1="0" y1="370" x2="1200" y2="370" stroke="rgba(214,255,95,.10)" strokeDasharray="2 4" />
        <text x="14" y="256" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.35)" letterSpacing="2" fontWeight="600">T3 · TRANSIENT SPECIALISTS</text>
      </g>

      {/* edges */}
      <g strokeWidth="1.5" fill="none">
        <path d="M 165 90 C 220 90, 240 90, 295 90" stroke="rgba(0,255,65,.55)" />
        <path d="M 405 90 C 540 90, 600 90, 920 90" stroke="rgba(0,255,65,.18)" strokeDasharray="3 4" />
        <path d="M 990 90 L 1100 90" stroke="rgba(0,255,65,.22)" />
        <path d="M 305 120 C 305 160, 540 160, 540 168" stroke="url(#edge-active-cyan)" strokeDasharray="4 4">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="0.6s" repeatCount="indefinite" />
        </path>
        <path d="M 335 120 L 335 175 L 760 175 L 760 168" stroke="rgba(214,255,95,.30)" strokeDasharray="4 4" />
        <path d="M 365 120 C 365 130, 365 152, 410 152 L 880 152 C 980 152, 980 158, 980 168" stroke="url(#edge-active-pink)" strokeDasharray="4 4">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="0.6s" repeatCount="indefinite" />
        </path>
        <path d="M 510 232 L 510 280 L 380 280 L 380 310" stroke="url(#edge-active-cyan)" strokeDasharray="3 3">
          <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.6s" repeatCount="indefinite" />
        </path>
        <path d="M 570 232 L 570 280 L 540 280 L 540 310" stroke="rgba(95,207,255,.35)" strokeDasharray="3 3" />
        <path d="M 760 232 L 760 280 L 720 280 L 720 310" stroke="rgba(214,255,95,.18)" strokeDasharray="3 3" />
        <path d="M 950 232 L 950 280 L 880 280 L 880 310" stroke="url(#edge-active-pink)" strokeDasharray="3 3">
          <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.6s" repeatCount="indefinite" />
        </path>
        <path d="M 1010 232 L 1010 280 L 1040 280 L 1040 310" stroke="rgba(255,95,162,.30)" strokeDasharray="3 3" />
        <path d="M 510 168 C 510 152, 510 132, 560 132 L 890 132 C 920 132, 920 124, 920 120" stroke="rgba(95,207,255,.32)" />
        <path d="M 790 168 C 790 152, 790 140, 830 140 L 920 140 C 950 140, 950 130, 950 120" stroke="rgba(214,255,95,.22)" />
        <path d="M 950 168 C 950 152, 950 124, 970 124 C 980 124, 980 122, 980 120" stroke="rgba(255,95,162,.32)" />
      </g>

      {/* REVIEW ↺ ROUTE feedback loop */}
      <g fill="none">
        <path d="M 920 68 C 880 8, 420 8, 365 68" stroke="#d6ff5f" strokeWidth="1.4" strokeDasharray="5 5" opacity="0.85" markerEnd="url(#arrow-loop)">
          <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.4s" repeatCount="indefinite" />
        </path>
        <text x="640" y="14" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#d6ff5f" letterSpacing="2" fontWeight="600">REVIEW ↺ ROUTE · until goal achieved</text>
      </g>

      {/* T1 NODES — SWITCH band */}
      {/* PLAN (done) */}
      <g transform="translate(85, 90)">
        <rect x="-80" y="-26" width="160" height="52" rx="5" fill="rgba(0,255,65,.10)" stroke="rgba(0,255,65,.5)" />
        <text x="-66" y="-9" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(0,255,65,.65)" letterSpacing="1.5" fontWeight="600">SWITCH ·</text>
        <text x="0" y="6" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fill="#d8ffe3" fontWeight="700">PLAN</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.5)">done · 02:08 · 3 subgoals</text>
      </g>

      {/* ROUTE (live, the brains) */}
      <g transform="translate(335, 90)">
        <rect x="-70" y="-30" width="140" height="60" rx="5" fill="rgba(0,255,65,.20)" stroke="#00ff41" filter="url(#glow)" opacity="0.45" />
        <rect x="-70" y="-30" width="140" height="60" rx="5" fill="rgba(0,255,65,.18)" stroke="#00ff41" />
        <circle cx="58" cy="-18" r="3.5" fill="#00ff41"><animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" /></circle>
        <text x="-58" y="-13" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" letterSpacing="1.5" fontWeight="600">SWITCH ·</text>
        <text x="0" y="3" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="14" fill="#00ff41" fontWeight="700">ROUTE</text>
        <text x="0" y="18" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(0,255,65,.85)">3 domains · 7 tasks</text>
      </g>

      {/* REVIEW (awaiting) */}
      <g transform="translate(950, 90)">
        <rect x="-60" y="-26" width="120" height="52" rx="5" fill="rgba(216,255,227,.04)" stroke="rgba(216,255,227,.22)" />
        <text x="-46" y="-9" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.4)" letterSpacing="1.5" fontWeight="600">SWITCH ·</text>
        <text x="0" y="6" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fill="rgba(216,255,227,.65)" fontWeight="700">REVIEW</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.35)">awaiting · loop ↺</text>
      </g>

      {/* REPORT (awaiting) */}
      <g transform="translate(1140, 90)">
        <rect x="-50" y="-26" width="100" height="52" rx="5" fill="rgba(216,255,227,.04)" stroke="rgba(216,255,227,.18)" />
        <text x="-36" y="-9" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.4)" letterSpacing="1.5" fontWeight="600">SWITCH ·</text>
        <text x="0" y="6" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fill="rgba(216,255,227,.65)" fontWeight="700">REPORT</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.3)">on goal achieved</text>
      </g>

      {/* T2 NODES — DOMAIN HEADS */}
      {/* NEO · technical · live */}
      <g transform="translate(540, 200)">
        <rect x="-90" y="-32" width="180" height="64" rx="5" fill="rgba(95,207,255,.16)" stroke="#5fcfff" filter="url(#glow)" opacity="0.4" />
        <rect x="-90" y="-32" width="180" height="64" rx="5" fill="rgba(95,207,255,.12)" stroke="#5fcfff" />
        <circle cx="78" cy="-20" r="3.5" fill="#5fcfff"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-78" y="-15" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(95,207,255,.85)" letterSpacing="1.5" fontWeight="600">T2 · TECHNICAL</text>
        <text x="0" y="2" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="14" fill="#5fcfff" fontWeight="700">NEO</text>
        <text x="0" y="17" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.6)">tasks · 12/48 · 2 specialists</text>
      </g>

      {/* TRINITY · finance · idle/awaiting */}
      <g transform="translate(760, 200)">
        <rect x="-90" y="-32" width="180" height="64" rx="5" fill="rgba(214,255,95,.06)" stroke="rgba(214,255,95,.5)" />
        <text x="-78" y="-15" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(214,255,95,.7)" letterSpacing="1.5" fontWeight="600">T2 · FINANCE</text>
        <text x="0" y="2" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="14" fill="#d6ff5f" fontWeight="700">TRINITY</text>
        <text x="0" y="17" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.45)">budget audit · 1 task · queued</text>
      </g>

      {/* MORPHEUS · marketing · live */}
      <g transform="translate(980, 200)">
        <rect x="-90" y="-32" width="180" height="64" rx="5" fill="rgba(255,95,162,.14)" stroke="#ff5fa2" filter="url(#glow)" opacity="0.4" />
        <rect x="-90" y="-32" width="180" height="64" rx="5" fill="rgba(255,95,162,.10)" stroke="#ff5fa2" />
        <circle cx="78" cy="-20" r="3.5" fill="#ff5fa2"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-78" y="-15" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,95,162,.85)" letterSpacing="1.5" fontWeight="600">T2 · MARKETING</text>
        <text x="0" y="2" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="14" fill="#ff5fa2" fontWeight="700">MORPHEUS</text>
        <text x="0" y="17" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.6)">launch tweet · 3 tasks</text>
      </g>

      {/* T3 NODES — TRANSIENT SPECIALISTS */}
      {/* DRIFT */}
      <g transform="translate(380, 332)">
        <rect x="-70" y="-22" width="140" height="48" rx="4" fill="rgba(95,207,255,.06)" stroke="rgba(95,207,255,.55)" strokeDasharray="4 3" />
        <circle cx="58" cy="-12" r="3" fill="#5fcfff"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-58" y="-7" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(95,207,255,.7)" letterSpacing="1.4" fontWeight="600">T3 · TRANSIENT</text>
        <text x="0" y="8" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="#d8ffe3" fontWeight="600">DRIFT</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.5)">benchloop · 60% · 8 calls</text>
      </g>
      {/* WORKSPACE */}
      <g transform="translate(540, 332)">
        <rect x="-70" y="-22" width="140" height="48" rx="4" fill="rgba(95,207,255,.04)" stroke="rgba(95,207,255,.4)" strokeDasharray="4 3" />
        <text x="-58" y="-7" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(95,207,255,.55)" letterSpacing="1.4" fontWeight="600">T3 · PROMOTING ★</text>
        <text x="0" y="8" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="#d8ffe3" fontWeight="600">WORKSPACE</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.5)">queued · 142 calls / 30d</text>
      </g>
      {/* ECHO */}
      <g transform="translate(720, 332)">
        <rect x="-70" y="-22" width="140" height="48" rx="4" fill="rgba(216,255,227,.03)" stroke="rgba(214,255,95,.3)" strokeDasharray="4 3" />
        <text x="-58" y="-7" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(214,255,95,.55)" letterSpacing="1.4" fontWeight="600">T3 · TRANSIENT</text>
        <text x="0" y="8" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="rgba(216,255,227,.6)" fontWeight="600">ECHO</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.35)">queued · awaiting trinity</text>
      </g>
      {/* BLAZE */}
      <g transform="translate(880, 332)">
        <rect x="-70" y="-22" width="140" height="48" rx="4" fill="rgba(255,95,162,.06)" stroke="rgba(255,95,162,.55)" strokeDasharray="4 3" />
        <circle cx="58" cy="-12" r="3" fill="#ff5fa2"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-58" y="-7" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(255,95,162,.75)" letterSpacing="1.4" fontWeight="600">T3 · TRANSIENT</text>
        <text x="0" y="8" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="#d8ffe3" fontWeight="600">BLAZE</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.5)">copywriter · drafting</text>
      </g>
      {/* PIXEL */}
      <g transform="translate(1040, 332)">
        <rect x="-70" y="-22" width="140" height="48" rx="4" fill="rgba(255,95,162,.05)" stroke="rgba(255,95,162,.4)" strokeDasharray="4 3" />
        <text x="-58" y="-7" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(255,95,162,.6)" letterSpacing="1.4" fontWeight="600">T3 · TRANSIENT</text>
        <text x="0" y="8" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="rgba(216,255,227,.7)" fontWeight="600">PIXEL</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(216,255,227,.4)">image gen · queued</text>
      </g>

      {/* LEGEND */}
      <g transform="translate(1080, 156)">
        <rect x="-10" y="-12" width="120" height="76" rx="4" fill="rgba(7,19,10,.8)" stroke="rgba(0,255,65,.2)" />
        <text x="0" y="0" fontFamily="JetBrains Mono" fontSize="8" fill="rgba(216,255,227,.5)" letterSpacing="1.5" fontWeight="600">STAGES</text>
        <rect x="0" y="6" width="10" height="4" rx="1" fill="#00ff41" /><text x="16" y="11" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">plan · route</text>
        <rect x="0" y="18" width="10" height="4" rx="1" fill="#5fcfff" /><text x="16" y="23" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">execute (T2/T3)</text>
        <line x1="0" y1="32" x2="10" y2="32" stroke="#d6ff5f" strokeWidth="1.4" strokeDasharray="3 2" /><text x="16" y="35" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">review ↺ loop</text>
        <rect x="0" y="42" width="10" height="4" rx="1" fill="rgba(216,255,227,.5)" /><text x="16" y="47" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">report</text>
        <text x="0" y="59" fontFamily="JetBrains Mono" fontSize="7.5" fill="rgba(216,255,227,.4)" letterSpacing="1">— — —  transient (T3)</text>
      </g>
    </svg>
  )
}

function DagOrg() {
  return (
    <svg
      className="dag"
      id="dag-org"
      viewBox="0 0 1200 240"
      preserveAspectRatio="xMidYMid meet"
      style={{ height: 240 }}
    >
      {/* edges */}
      <g strokeWidth="1.4" fill="none">
        <path d="M 600 56 L 600 80 L 250 80 L 250 100" stroke="rgba(0,255,65,.45)" />
        <path d="M 600 80 L 600 100" stroke="rgba(0,255,65,.45)" />
        <path d="M 600 80 L 950 80 L 950 100" stroke="rgba(0,255,65,.45)" />
        <path d="M 250 156 L 250 178 L 130 178 L 130 200" stroke="rgba(255,95,162,.5)" />
        <path d="M 250 178 L 370 178 L 370 200" stroke="rgba(255,95,162,.5)" />
        <path d="M 600 156 L 600 200" stroke="rgba(95,207,255,.55)" />
        <path d="M 950 156 L 950 178 L 830 178 L 830 200" stroke="rgba(214,255,95,.55)" />
        <path d="M 950 178 L 1070 178 L 1070 200" stroke="rgba(214,255,95,.55)" />
      </g>

      {/* T1 CORE */}
      <g transform="translate(600, 28)">
        <rect x="-110" y="-22" width="220" height="56" rx="5" fill="rgba(0,255,65,.13)" stroke="#00ff41" />
        <circle cx="-92" cy="-2" r="4" fill="#00ff41"><animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-78" y="3" fontFamily="JetBrains Mono" fontSize="13" fill="#eaffef" fontWeight="700">SAGE</text>
        <text x="96" y="3" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-92" y="14" width="54" height="14" rx="2" fill="rgba(0,255,65,.18)" stroke="rgba(0,255,65,.4)" />
        <text x="-65" y="24" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="middle" fontWeight="600">T1 CORE</text>
      </g>

      {/* T2 DEPT HEADS */}
      <g transform="translate(250, 128)">
        <rect x="-90" y="-22" width="180" height="50" rx="5" fill="rgba(255,95,162,.06)" stroke="rgba(255,95,162,.45)" />
        <circle cx="-74" cy="-4" r="3.5" fill="#ff5fa2" />
        <text x="-62" y="1" fontFamily="JetBrains Mono" fontSize="12" fill="#eaffef" fontWeight="600">MORPHEUS</text>
        <text x="76" y="1" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-74" y="10" width="68" height="13" rx="2" fill="rgba(255,95,162,.13)" stroke="rgba(255,95,162,.35)" />
        <text x="-40" y="19" fontFamily="JetBrains Mono" fontSize="8.5" fill="#ff5fa2" textAnchor="middle" fontWeight="600">T2 DEPT HEAD</text>
        <text x="40" y="20" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(216,255,227,.5)">marketing</text>
      </g>
      <g transform="translate(600, 128)">
        <rect x="-90" y="-22" width="180" height="50" rx="5" fill="rgba(95,207,255,.07)" stroke="rgba(95,207,255,.5)" />
        <circle cx="-74" cy="-4" r="3.5" fill="#5fcfff"><animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-62" y="1" fontFamily="JetBrains Mono" fontSize="12" fill="#eaffef" fontWeight="600">NEO</text>
        <text x="76" y="1" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-74" y="10" width="68" height="13" rx="2" fill="rgba(95,207,255,.13)" stroke="rgba(95,207,255,.4)" />
        <text x="-40" y="19" fontFamily="JetBrains Mono" fontSize="8.5" fill="#5fcfff" textAnchor="middle" fontWeight="600">T2 DEPT HEAD</text>
        <text x="40" y="20" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(216,255,227,.5)">engineering</text>
      </g>
      <g transform="translate(950, 128)">
        <rect x="-90" y="-22" width="180" height="50" rx="5" fill="rgba(214,255,95,.06)" stroke="rgba(214,255,95,.5)" />
        <circle cx="-74" cy="-4" r="3.5" fill="#d6ff5f" />
        <text x="-62" y="1" fontFamily="JetBrains Mono" fontSize="12" fill="#eaffef" fontWeight="600">TRINITY</text>
        <text x="76" y="1" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-74" y="10" width="68" height="13" rx="2" fill="rgba(214,255,95,.13)" stroke="rgba(214,255,95,.4)" />
        <text x="-40" y="19" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d6ff5f" textAnchor="middle" fontWeight="600">T2 DEPT HEAD</text>
        <text x="40" y="20" fontFamily="JetBrains Mono" fontSize="8.5" fill="rgba(216,255,227,.5)">finance</text>
      </g>

      {/* T3 SPECIALISTS */}
      <g transform="translate(130, 222)">
        <rect x="-78" y="-22" width="156" height="42" rx="4" fill="rgba(255,95,162,.04)" stroke="rgba(255,95,162,.3)" />
        <circle cx="-64" cy="-6" r="3" fill="#ff5fa2" />
        <text x="-54" y="-2" fontFamily="JetBrains Mono" fontSize="10.5" fill="#eaffef" fontWeight="600">DRIFT</text>
        <text x="66" y="-2" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-64" y="6" width="60" height="11" rx="2" fill="rgba(255,95,162,.1)" stroke="rgba(255,95,162,.3)" />
        <text x="-34" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#ff5fa2" textAnchor="middle" fontWeight="600">T3 SPECIALIST</text>
      </g>
      <g transform="translate(370, 222)">
        <rect x="-78" y="-22" width="156" height="42" rx="4" fill="rgba(255,95,162,.04)" stroke="rgba(255,95,162,.3)" />
        <circle cx="-64" cy="-6" r="3" fill="#ff5fa2" />
        <text x="-54" y="-2" fontFamily="JetBrains Mono" fontSize="10.5" fill="#eaffef" fontWeight="600">BLAZE</text>
        <text x="66" y="-2" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-64" y="6" width="60" height="11" rx="2" fill="rgba(255,95,162,.1)" stroke="rgba(255,95,162,.3)" />
        <text x="-34" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#ff5fa2" textAnchor="middle" fontWeight="600">T3 SPECIALIST</text>
      </g>
      <g transform="translate(600, 222)">
        <rect x="-78" y="-22" width="156" height="42" rx="4" fill="rgba(95,207,255,.05)" stroke="rgba(95,207,255,.4)" />
        <circle cx="-64" cy="-6" r="3" fill="#5fcfff"><animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" /></circle>
        <text x="-54" y="-2" fontFamily="JetBrains Mono" fontSize="10.5" fill="#eaffef" fontWeight="600">WORKSPACE</text>
        <text x="66" y="-2" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-64" y="6" width="60" height="11" rx="2" fill="rgba(95,207,255,.13)" stroke="rgba(95,207,255,.3)" />
        <text x="-34" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#5fcfff" textAnchor="middle" fontWeight="600">T3 SPECIALIST</text>
      </g>
      <g transform="translate(830, 222)">
        <rect x="-78" y="-22" width="156" height="42" rx="4" fill="rgba(214,255,95,.04)" stroke="rgba(214,255,95,.4)" />
        <circle cx="-64" cy="-6" r="3" fill="#d6ff5f" />
        <text x="-54" y="-2" fontFamily="JetBrains Mono" fontSize="10.5" fill="#eaffef" fontWeight="600">PIXEL</text>
        <text x="66" y="-2" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-64" y="6" width="60" height="11" rx="2" fill="rgba(214,255,95,.1)" stroke="rgba(214,255,95,.3)" />
        <text x="-34" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#d6ff5f" textAnchor="middle" fontWeight="600">T3 SPECIALIST</text>
      </g>
      <g transform="translate(1070, 222)">
        <rect x="-78" y="-22" width="156" height="42" rx="4" fill="rgba(214,255,95,.04)" stroke="rgba(214,255,95,.4)" />
        <circle cx="-64" cy="-6" r="3" fill="#d6ff5f" />
        <text x="-54" y="-2" fontFamily="JetBrains Mono" fontSize="10.5" fill="#eaffef" fontWeight="600">NOVA</text>
        <text x="66" y="-2" fontFamily="JetBrains Mono" fontSize="9" fill="#00ff41" textAnchor="end">✓</text>
        <rect x="-64" y="6" width="60" height="11" rx="2" fill="rgba(214,255,95,.1)" stroke="rgba(214,255,95,.3)" />
        <text x="-34" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#d6ff5f" textAnchor="middle" fontWeight="600">T3 SPECIALIST</text>
      </g>

      {/* legend */}
      <g transform="translate(1080, 22)">
        <rect x="-8" y="-12" width="112" height="60" rx="4" fill="rgba(7,19,10,.7)" stroke="rgba(0,255,65,.18)" />
        <text x="0" y="0" fontFamily="JetBrains Mono" fontSize="8" fill="rgba(216,255,227,.5)" letterSpacing="1.5">TIERS</text>
        <rect x="0" y="6" width="10" height="4" rx="1" fill="#00ff41" /><text x="16" y="11" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">T1 Core</text>
        <rect x="0" y="18" width="10" height="4" rx="1" fill="#5fcfff" /><text x="16" y="23" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">T2 Dept Head</text>
        <rect x="0" y="30" width="10" height="4" rx="1" fill="#ff5fa2" /><text x="16" y="35" fontFamily="JetBrains Mono" fontSize="8.5" fill="#d8ffe3">T3 Specialist</text>
      </g>
    </svg>
  )
}

export function MissionCanvas({ data = DEFAULT_DATA }: MissionCanvasProps) {
  const canvasView = useConductorUIStore((s) => s.canvasView)
  const setCanvasView = useConductorUIStore((s) => s.setCanvasView)

  return (
    <div className="dag-wrap">
      <div className="dag-head">
        <h3 id="canvas-title">{data.title}</h3>
        <span className="ct" id="canvas-sub">
          {data.subtitle}
        </span>
        <div className="right">
          <div className="view-toggle" role="tablist">
            <button
              id="view-flow"
              className={canvasView === 'flow' ? 'on' : undefined}
              type="button"
              onClick={() => setCanvasView('flow')}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="6" r="2" />
                <circle cx="19" cy="18" r="2" />
                <path d="M7 12h4M14 7l-3 4M14 17l-3-4" />
              </svg>
              flow
            </button>
            <button
              id="view-org"
              className={canvasView === 'org' ? 'on' : undefined}
              type="button"
              onClick={() => setCanvasView('org')}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <rect x="9" y="3" width="6" height="5" rx="1" />
                <rect x="3" y="16" width="6" height="5" rx="1" />
                <rect x="15" y="16" width="6" height="5" rx="1" />
                <path d="M12 8v4M6 16v-2h12v2" />
              </svg>
              org
            </button>
          </div>
          <button type="button" className="dag-txt-btn">auto-fit</button>
          <button type="button" className="ico-btn">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" />
            </svg>
          </button>
        </div>
      </div>
      {canvasView === 'flow' ? <DagFlow /> : <DagOrg />}
    </div>
  )
}
