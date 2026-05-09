/* Hermes Primary Nav v2 — canonical, sourced from src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx
   Renders a 232px primary nav matching the shipped design.
   Usage in any HTML page that loads React + Babel + matrix-system.css:
     <script type="text/babel" src="primary-nav-v2.jsx"></script>
     ...
     <div id="primary-nav-mount"></div>
     <script type="text/babel">
       ReactDOM.createRoot(document.getElementById('primary-nav-mount'))
         .render(<PrimaryNavV2 active="chat" sessionsBadge={10} />);
     </script>
*/

const PNV2_ICONS = {
  dashboard:'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  chat:'M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z',
  files:'M3 2h6l4 4v9H3V2zM9 2v4h4',
  terminal:'M2 3h12v10H2V3zM5 7l3-2-3-2M8 11h4',
  jobs:'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5l2.5 1.5',
  tasks:'M3 4h10M3 8h7M3 12h5',
  conductor:'M8 2L2 14h12L8 2zM8 8v3',
  operations:'M3 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM1 14c0-2.5 2-4 5-4s5 1.5 5 4M11 11c1.5 0 3 .8 3 3',
  swarm:'M5 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 5l3 4M11 5L8 9',
  memory:'M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM6 7h4M6 9h2',
  skills:'M8 2l1.8 3.8 4.2.6-3 3 .7 4.1L8 11.5l-3.7 2L5 9.4l-3-3 4.2-.6z',
  mcp:'M4 8h8M8 4v8M3 3l10 10M13 3L3 13',
  profiles:'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 2.7-5 6-5s6 2 6 5',
  search:'M6.5 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.5 10.5l4 4',
  newchat:'M3 8h10M8 3v10',
  cog:'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4',
  collapse:'M10 3L5 8l5 5',
  expand:'M6 3l5 5-5 5',
};
function PNVIcon({d, size=15}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{flexShrink:0}}><path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function PNVItem({label, iconKey, active, badge}) {
  return (
    <a href="#" className="m-mono pnv-item" data-active={active?'true':undefined}>
      <PNVIcon d={PNV2_ICONS[iconKey]} />
      <span style={{flex:1}}>{label}</span>
      {badge!=null && <span className="pnv-badge">{badge}</span>}
    </a>
  );
}
function PNVGroup({label}) {
  return <div className="m-label pnv-group">{label}</div>;
}
function PrimaryNavV2({active='chat', sessionsBadge=null}) {
  const items = [
    ['dashboard','Dashboard'],['chat','Chat'],['files','Files'],['terminal','Terminal'],
    ['jobs','Jobs'],['tasks','Tasks'],['conductor','Conductor'],['operations','Operations'],['swarm','Swarm'],
  ];
  const know = [['memory','Memory'],['skills','Skills'],['mcp','MCP'],['profiles','Profiles']];
  return (
    <div className="pnv-root">
      <div className="pnv-brand">
        <div className="pnv-brand-l">
          <div className="pnv-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4 L20 4 L20 20 L4 20 Z M4 12 L20 12 M12 4 L12 20"/></svg></div>
          <div>
            <div className="m-mono pnv-name">HERMES</div>
            <div className="m-label pnv-ver">v2.3.0</div>
          </div>
        </div>
        <button className="pnv-icon-btn" title="Collapse"><PNVIcon d={PNV2_ICONS.collapse}/></button>
      </div>
      <div className="pnv-body">
        <button className="m-mono pnv-search">
          <PNVIcon d={PNV2_ICONS.search}/>
          <span style={{flex:1, textAlign:'left'}}>Search</span>
          <span className="m-mono pnv-kbd">⌘K</span>
        </button>
        <a href="#" className="m-mono pnv-newsess">
          <PNVIcon d={PNV2_ICONS.newchat}/>+ New Session
        </a>
        <PNVGroup label="Main"/>
        {items.map(([k,l]) => <PNVItem key={k} label={l} iconKey={k} active={active===k} badge={k===active && sessionsBadge!=null ? sessionsBadge : null}/>)}
        <PNVGroup label="Knowledge"/>
        {know.map(([k,l]) => <PNVItem key={k} label={l} iconKey={k} active={active===k} badge={k===active && sessionsBadge!=null ? sessionsBadge : null}/>)}
      </div>
      <div className="pnv-foot">
        <button className="pnv-foot-btn"><PNVIcon d={PNV2_ICONS.cog} size={14}/><span>Settings</span></button>
        <button className="pnv-foot-btn pnv-foot-theme" title="Toggle theme"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></button>
      </div>
    </div>
  );
}
window.PrimaryNavV2 = PrimaryNavV2;
