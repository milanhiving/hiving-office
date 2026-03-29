import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════
const DS = {
  bg:     { base:"#08090e", card:"#0c0d14", elevated:"#10121a", surface:"#141620", hover:"#1a1c28" },
  border: { subtle:"#151722", default:"#1e2030", active:"#2a2d42", glow:"#353a55" },
  text:   { primary:"#e2e4ec", secondary:"#9498b0", muted:"#5a5e78", dim:"#3a3e54" },
  status: { working:"#22c55e", idle:"#4a4e64", waiting:"#eab308", browsing:"#3b82f6", error:"#ef4444" },
  quest:  { URGENT:"#ef4444", MAIN:"#f59e0b", SIDE:"#3b82f6", DAILY:"#22c55e" },
  radius: { sm:4, md:8, lg:12 },
  font:   "'Inter',-apple-system,system-ui,sans-serif",
  mono:   "'JetBrains Mono','Fira Code',monospace",
};

// ═══════════════════════════════════════════════════════════════
// LIVE DATA
// ═══════════════════════════════════════════════════════════════
const DATA_URL = import.meta.env.BASE_URL + "data.json";
const SYNC_INTERVAL = 30000;

// ═══════════════════════════════════════════════════════════════
// TILE ENGINE
// ═══════════════════════════════════════════════════════════════
const TW = 56, TH = 28;
const MAP_W = 30, MAP_H = 20;
function ts(c, r) { return { x: (c - r) * (TW / 2), y: (c + r) * (TH / 2) }; }

const ZONES = {
  khan:          { c1:0,  r1:0,  c2:6,  r2:7,  label:"Bureau Khan",  icon:"👑", color:"#1a1208", dark:"#0e0a04", border:"#c8762e", accent:"#ffaa44" },
  bureau:        { c1:7,  r1:0,  c2:18, r2:9,  label:"Open Space",   icon:"💻", color:"#0c1420", dark:"#070d16", border:"#1a4a8a", accent:"#3a80d4" },
  couloir:       { c1:19, r1:0,  c2:20, r2:19, label:"Couloir",      icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565" },
  salle_reunion: { c1:21, r1:0,  c2:29, r2:9,  label:"War Room",     icon:"⚔️", color:"#120818", dark:"#0a0410", border:"#5a1aaa", accent:"#9944ee" },
  cuisine:       { c1:21, r1:10, c2:29, r2:19, label:"Taverne",      icon:"🍺", color:"#060e06", dark:"#040804", border:"#1a5a28", accent:"#33aa55" },
  couloir2:      { c1:7,  r1:10, c2:18, r2:19, label:"Couloir Sud",  icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565" },
};

function getZone(c, r) {
  for (const [k, z] of Object.entries(ZONES)) {
    if (c >= z.c1 && c <= z.c2 && r >= z.r1 && r <= z.r2) return k;
  }
  return null;
}

const DOORS = [
  {c:6,r:4},{c:7,r:4},{c:18,r:4},{c:19,r:4},{c:20,r:3},{c:21,r:3},
  {c:20,r:14},{c:21,r:14},{c:18,r:14},{c:19,r:14},
];
const DOOR_SET = new Set(DOORS.map(d=>`${d.c},${d.r}`));

// ═══════════════════════════════════════════════════════════════
// PATHFINDING
// ═══════════════════════════════════════════════════════════════
const BLOCKED_TYPES = new Set(["desk","shelf","ctable","cscreen","wboard","coffee","counter","fridge","sofa_back","golf_hole","armchair","window_wall","divider","barrel","throne"]);
let _walkCache = null;
function buildWalkCache(furn) {
  const blocked = new Set(furn.filter(f=>BLOCKED_TYPES.has(f.t)).map(f=>`${f.c},${f.r}`));
  return (c,r) => {
    if (c<0||r<0||c>=MAP_W||r>=MAP_H) return false;
    if (!getZone(c,r)) return false;
    return !blocked.has(`${c},${r}`);
  };
}
function aStar(isWalk, start, end) {
  const key = (c,r) => c*100+r;
  const open = [{c:start.c,r:start.r,g:0,h:Math.abs(start.c-end.c)+Math.abs(start.r-end.r),p:null}];
  const closed = new Set(), best = {[key(start.c,start.r)]:0};
  let iter = 0;
  while (open.length && iter++ < 600) {
    open.sort((a,b)=>(a.g+a.h)-(b.g+b.h));
    const cur = open.shift();
    if (cur.c===end.c&&cur.r===end.r) {
      const path=[]; let n=cur;
      while(n){path.unshift({c:n.c,r:n.r});n=n.p;}
      return path;
    }
    closed.add(key(cur.c,cur.r));
    for (const [dc,dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc=cur.c+dc, nr=cur.r+dr;
      if(!(nc===end.c&&nr===end.r)&&!isWalk(nc,nr)) continue;
      if(closed.has(key(nc,nr))) continue;
      const ng=cur.g+1;
      if(best[key(nc,nr)]!==undefined&&best[key(nc,nr)]<=ng) continue;
      best[key(nc,nr)]=ng;
      open.push({c:nc,r:nr,g:ng,h:Math.abs(nc-end.c)+Math.abs(nr-end.r),p:cur});
    }
  }
  return [start];
}

// ═══════════════════════════════════════════════════════════════
// FURNITURE
// ═══════════════════════════════════════════════════════════════
const FURN = [
  {c:0,r:0,t:"window_wall"},{c:1,r:0,t:"window_wall"},{c:2,r:0,t:"window_wall"},
  {c:3,r:0,t:"window_wall"},{c:4,r:0,t:"window_wall"},{c:5,r:0,t:"window_wall"},
  {c:2,r:3,t:"throne",l:"KHAN"},
  {c:1,r:5,t:"armchair"},
  {c:4,r:6,t:"golf_hole",l:"⛳"},{c:5,r:5,t:"golf_ball"},
  {c:0,r:6,t:"plant"},{c:6,r:0,t:"plant"},
  {c:5,r:2,t:"overview_screen",l:"LIVE"},
  {c:8,r:1,t:"desk",l:"🔮"},{c:11,r:1,t:"desk",l:"🐍"},
  {c:14,r:1,t:"desk",l:"🏹"},{c:17,r:1,t:"desk",l:"🏗️"},
  {c:8,r:5,t:"desk",l:"📯"},{c:11,r:5,t:"desk",l:"🛡️"},
  {c:7,r:8,t:"plant"},{c:18,r:0,t:"plant"},
  {c:17,r:8,t:"printer"},
  {c:7,r:0,t:"shelf"},
  {c:15,r:7,t:"sofa_back"},{c:16,r:7,t:"sofa_back"},
  {c:12,r:8,t:"coffee_table"},
  {c:23,r:2,t:"ctable"},{c:24,r:2,t:"ctable"},{c:25,r:2,t:"ctable"},
  {c:22,r:3,t:"ctable"},{c:23,r:3,t:"ctable"},{c:24,r:3,t:"ctable"},{c:25,r:3,t:"ctable"},{c:26,r:3,t:"ctable"},
  {c:23,r:4,t:"ctable"},{c:24,r:4,t:"ctable"},{c:25,r:4,t:"ctable"},
  {c:21,r:1,t:"wboard"},{c:28,r:0,t:"cscreen"},
  {c:29,r:1,t:"plant"},
  {c:21,r:11,t:"coffee"},{c:22,r:11,t:"counter"},{c:23,r:11,t:"counter"},
  {c:24,r:11,t:"counter"},{c:25,r:11,t:"barrel"},
  {c:26,r:11,t:"fridge"},
  {c:23,r:14,t:"ctable"},{c:24,r:14,t:"ctable"},
  {c:21,r:16,t:"sofa_back"},{c:22,r:16,t:"sofa_back"},
  {c:24,r:17,t:"low_table"},
  {c:29,r:17,t:"plant"},{c:21,r:19,t:"plant"},
];

// ═══════════════════════════════════════════════════════════════
// FURNITURE SPRITES (keep existing SVG engine)
// ═══════════════════════════════════════════════════════════════
function FurnSprite({ t, l, zk }) {
  const z = ZONES[zk] || ZONES.bureau;
  const B = z.accent, br = z.border;
  const s = {
    desk:<g><rect x="10" y="2" width="36" height="18" rx="2" fill="#0e1a2a" stroke={br} strokeWidth="0.7"/><rect x="12" y="4" width="14" height="10" rx="1" fill="#112244" stroke={B} strokeWidth="0.4"/><circle cx="19" cy="9" r="2" fill={B} opacity="0.3"/>{l&&<text x="28" y="19" fontSize="7" fill={B} fontFamily="monospace" textAnchor="middle" opacity="0.7">{l}</text>}</g>,
    throne:<g><rect x="14" y="-8" width="28" height="26" rx="3" fill="#1a1008" stroke="#c8762e" strokeWidth="1"/><rect x="16" y="-6" width="24" height="14" rx="2" fill="#2a1a08" stroke="#ffaa44" strokeWidth="0.5"/><text x="28" y="4" fontSize="8" fill="#ffaa44" fontFamily="monospace" textAnchor="middle" fontWeight="bold">👑</text>{l&&<text x="28" y="16" fontSize="5" fill="#ffaa44" fontFamily="monospace" textAnchor="middle">{l}</text>}</g>,
    shelf:<g><rect x="8" y="0" width="40" height="20" rx="1" fill="#1a1422" stroke={br} strokeWidth="0.6"/><line x1="10" y1="7" x2="46" y2="7" stroke={br} strokeWidth="0.4"/><line x1="10" y1="14" x2="46" y2="14" stroke={br} strokeWidth="0.4"/><rect x="12" y="2" width="6" height="4" fill={B} opacity="0.2" rx="0.5"/><rect x="22" y="9" width="8" height="4" fill={B} opacity="0.15" rx="0.5"/></g>,
    plant:<g><ellipse cx="28" cy="16" rx="6" ry="4" fill="#0a1a0a" stroke="#1a4a1a" strokeWidth="0.5"/><line x1="28" y1="16" x2="28" y2="2" stroke="#1a5a1a" strokeWidth="1.5"/><circle cx="24" cy="4" r="4" fill="#0d3d0d" opacity="0.8"/><circle cx="32" cy="3" r="3.5" fill="#0a330a" opacity="0.7"/><circle cx="28" cy="0" r="4" fill="#0e440e" opacity="0.9"/></g>,
    ctable:<g><polygon points={`${TW/2},4 ${TW-6},${TH/2} ${TW/2},${TH-4} 6,${TH/2}`} fill="#1a0e2a" stroke={br} strokeWidth="0.6"/></g>,
    wboard:<g><rect x="6" y="-10" width="44" height="28" rx="2" fill="#0a0a1a" stroke={B} strokeWidth="0.8"/><rect x="10" y="-6" width="36" height="18" rx="1" fill="#0e0e22" stroke={br} strokeWidth="0.4"/><text x="28" y="4" fontSize="6" fill={B} opacity="0.4" fontFamily="monospace" textAnchor="middle">STRATEGY</text></g>,
    cscreen:<g><rect x="6" y="-14" width="44" height="30" rx="2" fill="#060612" stroke={B} strokeWidth="0.7"/><rect x="10" y="-10" width="36" height="20" rx="1" fill="#0a0a1e"/><text x="28" y="2" fontSize="5" fill={B} opacity="0.5" fontFamily="monospace" textAnchor="middle">📊 LIVE</text></g>,
    coffee:<g><ellipse cx="28" cy="10" rx="12" ry="7" fill="#1a1208" stroke="#8a6020" strokeWidth="0.6"/><ellipse cx="28" cy="8" rx="10" ry="5" fill="#2a1a08"/><text x="28" y="11" fontSize="6" textAnchor="middle">☕</text></g>,
    counter:<g><rect x="4" y="2" width="48" height="16" rx="2" fill="#1a1a10" stroke={br} strokeWidth="0.5"/><rect x="6" y="4" width="44" height="8" rx="1" fill="#22220e"/></g>,
    fridge:<g><rect x="12" y="-6" width="32" height="26" rx="2" fill="#1a2a2a" stroke="#3a8a8a" strokeWidth="0.7"/><line x1="28" y1="-4" x2="28" y2="18" stroke="#3a8a8a" strokeWidth="0.4"/><rect x="30" y="0" width="2" height="6" rx="1" fill="#3a8a8a"/></g>,
    printer:<g><rect x="12" y="4" width="32" height="14" rx="2" fill="#1a1a20" stroke={br} strokeWidth="0.5"/><rect x="16" y="2" width="24" height="4" rx="1" fill="#0e0e18"/><circle cx="38" cy="12" r="2" fill="#44ff44" opacity="0.4"/></g>,
    overview_screen:<g><rect x="6" y="-8" width="44" height="24" rx="2" fill="#060610" stroke="#ffaa44" strokeWidth="0.8"/><rect x="10" y="-4" width="36" height="16" rx="1" fill="#0a0a14"/><text x="28" y="6" fontSize="5" fill="#ffaa44" opacity="0.6" fontFamily="monospace" textAnchor="middle">{l||"LIVE"}</text><circle cx="44" cy="-4" r="2" fill="#ff4444" opacity="0.6"/></g>,
    sofa_back:<g><rect x="6" y="2" width="44" height="14" rx="3" fill="#1a1020" stroke={br} strokeWidth="0.5"/><rect x="8" y="4" width="40" height="8" rx="2" fill="#140c1a"/></g>,
    coffee_table:<g><polygon points={`${TW/2},6 ${TW-10},${TH/2} ${TW/2},${TH-6} 10,${TH/2}`} fill="#1a1410" stroke={br} strokeWidth="0.4"/></g>,
    low_table:<g><polygon points={`${TW/2},8 ${TW-12},${TH/2} ${TW/2},${TH-8} 12,${TH/2}`} fill="#1a1410" stroke={br} strokeWidth="0.4"/></g>,
    golf_hole:<g><ellipse cx="28" cy="14" rx="8" ry="5" fill="#0a1a0a" stroke="#1a4a1a" strokeWidth="0.4"/><ellipse cx="28" cy="14" rx="3" ry="2" fill="#000"/><line x1="28" y1="14" x2="28" y2="2" stroke="#aaa" strokeWidth="0.5"/><polygon points="28,2 36,5 28,8" fill="#ff4444" opacity="0.6"/>{l&&<text x="28" y="22" fontSize="6" textAnchor="middle">{l}</text>}</g>,
    golf_ball:<g><circle cx="28" cy="14" r="2.5" fill="#eee" stroke="#ccc" strokeWidth="0.3"/></g>,
    armchair:<g><rect x="10" y="0" width="36" height="20" rx="4" fill="#1a1020" stroke={br} strokeWidth="0.5"/><rect x="14" y="4" width="28" height="12" rx="3" fill="#140c1a"/></g>,
    window_wall:<g><rect x="2" y="-4" width="52" height="22" rx="1" fill="#0a0a14" stroke="#2a2a44" strokeWidth="0.5"/><rect x="6" y="-2" width="20" height="14" rx="1" fill="#0c0c1e" stroke="#1a1a3a" strokeWidth="0.3"/><rect x="30" y="-2" width="20" height="14" rx="1" fill="#0c0c1e" stroke="#1a1a3a" strokeWidth="0.3"/></g>,
    barrel:<g><ellipse cx="28" cy="6" rx="10" ry="6" fill="#2a1a08" stroke="#8a6020" strokeWidth="0.6"/><rect x="18" y="6" width="20" height="12" fill="#2a1a08" stroke="#8a6020" strokeWidth="0.4"/><ellipse cx="28" cy="18" rx="10" ry="4" fill="#221608"/></g>,
  };
  return s[t] || <g><polygon points={`${TW/2},2 ${TW-2},${TH/2} ${TW/2},${TH-2} 2,${TH/2}`} fill="#111" stroke="#333" strokeWidth="0.3"/></g>;
}

// ═══════════════════════════════════════════════════════════════
// PNJ SPRITE
// ═══════════════════════════════════════════════════════════════
function PNJ({ color, accent, status, frame, selected, isKhan }) {
  const bob = Math.sin(frame*0.15)*1.5;
  const walkBob = status==="walking" ? Math.sin(frame*0.5)*2 : 0;
  const bodyY = TH/2 - 20 + bob + walkBob;
  const glow = selected ? `drop-shadow(0 0 6px ${accent})` : (status==="working" ? `drop-shadow(0 0 3px ${accent})` : "none");
  const headR = isKhan ? 7 : 6;
  return <g style={{filter:glow}}>
    <ellipse cx={TW/2} cy={TH/2+2} rx={8} ry={3} fill={color} opacity="0.3"/>
    <rect x={TW/2-6} y={bodyY+8} width={12} height={14} rx={2} fill={color} stroke={accent} strokeWidth="0.6"/>
    {status==="working"&&<rect x={TW/2-3} y={bodyY+12} width={6} height={3} rx={1} fill={accent} opacity="0.3"/>}
    <circle cx={TW/2} cy={bodyY+4} r={headR} fill={color} stroke={accent} strokeWidth="0.8"/>
    <circle cx={TW/2-2} cy={bodyY+2} r={1} fill={accent}/>
    <circle cx={TW/2+2} cy={bodyY+2} r={1} fill={accent}/>
    {isKhan&&<polygon points={`${TW/2-6},${bodyY-2} ${TW/2-4},${bodyY-7} ${TW/2},${bodyY-4} ${TW/2+4},${bodyY-7} ${TW/2+6},${bodyY-2}`} fill="#ffaa44" stroke="#cc8800" strokeWidth="0.4"/>}
    {status==="working"&&<circle cx={TW/2+10} cy={bodyY} r={2} fill={accent} opacity={0.4+Math.sin(frame*0.2)*0.3}/>}
    {status==="idle"&&frame%60<30&&<text x={TW/2+10} y={bodyY+4} fontSize="4" fill="#666" fontFamily="monospace">z</text>}
  </g>;
}

// ═══════════════════════════════════════════════════════════════
// AGENTS META & DATA
// ═══════════════════════════════════════════════════════════════
const AGENT_META = {
  "👑 KHAN":      { color:"#6b4200", accent:"#ffaa44", startC:2, startR:4, isKhan:true, cls:"Boss Final",  schedule:"Always",        real:"Milan — CEO oversight",     emoji:"👑" },
  "🔮 ORACLE":    { color:"#5b18a0", accent:"#a855f7", startC:8, startR:2, isKhan:false, cls:"Devin",       schedule:"Lun-Ven 10h",   real:"Agent CR Automatique",      emoji:"🔮" },
  "🐍 VIPER":     { color:"#8a1c1c", accent:"#ef4444", startC:11,startR:2, isKhan:false, cls:"Assassin",    schedule:"Lun-Ven 9h",    real:"Agent Relances",            emoji:"🐍" },
  "🏹 HUNTER":    { color:"#8a4a10", accent:"#f97316", startC:14,startR:2, isKhan:false, cls:"Ranger",      schedule:"Lundi 9h",      real:"Agent Prospection B2B",     emoji:"🏹" },
  "🏗️ ARCHITECT": { color:"#0a5a20", accent:"#22c55e", startC:17,startR:2, isKhan:false, cls:"Ingénieur",   schedule:"Jeudi 10h",     real:"Agent Marketing Site",      emoji:"🏗️" },
  "📯 HERALD":    { color:"#8a6800", accent:"#eab308", startC:8, startR:6, isKhan:false, cls:"Barde",       schedule:"Lun-Ven 8h",    real:"LinkedIn Daily",            emoji:"📯" },
  "🛡️ WARDEN":   { color:"#3a3a6a", accent:"#6366f1", startC:11,startR:6, isKhan:false, cls:"Gardien",     schedule:"Lundi 11h",     real:"Agent Meta Système",        emoji:"🛡️" },
  "📜 SAGE":      { color:"#1a3a8a", accent:"#3b82f6", startC:24,startR:5, isKhan:false, cls:"Archiviste",  schedule:"Vendredi 18h",  real:"Agent Recap Hebdo",         emoji:"📜" },
  "⚗️ ALCHEMIST": { color:"#6a0a8a", accent:"#d946ef", startC:26,startR:5, isKhan:false, cls:"Créateur",    schedule:"Mercredi 10h",  real:"Agent Dispositifs",         emoji:"⚗️" },
  "🔭 SCOUT":     { color:"#0a5a5a", accent:"#14b8a6", startC:24,startR:15,isKhan:false, cls:"Éclaireur",   schedule:"Mardi 10h",     real:"Agent Audit Créateurs",     emoji:"🔭" },
};

const ZONE_SLOTS = {
  khan:          [{c:2,r:4},{c:3,r:5},{c:1,r:3}],
  bureau:        [{c:8,r:2},{c:11,r:2},{c:14,r:2},{c:17,r:2},{c:8,r:6},{c:11,r:6},{c:14,r:6}],
  salle_reunion: [{c:24,r:5},{c:26,r:5},{c:22,r:6},{c:26,r:6}],
  cuisine:       [{c:24,r:15},{c:26,r:15},{c:24,r:18},{c:26,r:18}],
  couloir:       [{c:19,r:4},{c:20,r:8},{c:19,r:14}],
  couloir2:      [{c:12,r:14},{c:15,r:14}],
};

const INIT_AGENTS = [
  { id:"khan", name:"👑 KHAN",      room:"khan",     status:"idle",    c:2, r:4, xp:5000, mission:"Superviser tous les agents", context:"Vue d'ensemble", lastAction:"Morning check", nextStep:"Valider brief La Table", blockedOn:"", priority:"🔴 Urgent", message:"Watching the game 🏌️" },
  { id:"oracle", name:"🔮 ORACLE",    room:"bureau",   status:"working", c:8, r:2, xp:680,  mission:"Scanner les CR de calls", context:"Cross-ref Notion & calendrier", lastAction:"Scan CR calls semaine", nextStep:"Rapport anomalies", blockedOn:"", priority:"🟡 Normal", message:"Scanning call data..." },
  { id:"viper", name:"🐍 VIPER",     room:"bureau",   status:"working", c:11,r:2, xp:920,  mission:"Relancer les actions en retard", context:"12 actions overdue", lastAction:"Scan pipeline relances", nextStep:"Générer emails", blockedOn:"Retour Elle & Vire", priority:"🔴 Urgent", message:"12 relances en queue 🎯" },
  { id:"hunter", name:"🏹 HUNTER",    room:"bureau",   status:"working", c:14,r:2, xp:1100, mission:"Closer Elle & Vire + RDV LCL", context:"E&V 2 sem. LCL chaud", lastAction:"Relance email E&V", nextStep:"Appel LCL + follow-up", blockedOn:"Retour Elle & Vire", priority:"🔴 Urgent", message:"LCL chaud → RDV sem14 🔥" },
  { id:"architect", name:"🏗️ ARCHITECT", room:"bureau",   status:"idle",    c:17,r:2, xp:460,  mission:"Améliorer hivingfood.com", context:"SEO + backlog", lastAction:"Audit SEO pages", nextStep:"Meta tags + rapport", blockedOn:"", priority:"🟡 Normal", message:"SEO audit en cours 📊" },
  { id:"herald", name:"📯 HERALD",    room:"bureau",   status:"working", c:8, r:6, xp:350,  mission:"Post LinkedIn quotidien", context:"Contenu food + influence", lastAction:"Post LinkedIn lundi", nextStep:"Rédiger post du jour", blockedOn:"", priority:"🟢 Low", message:"Drafting today's post ✍️" },
  { id:"warden", name:"🛡️ WARDEN",   room:"bureau",   status:"idle",    c:11,r:6, xp:380,  mission:"Maintenance système Notion", context:"Templates OK", lastAction:"Vérif templates", nextStep:"Devis E&V", blockedOn:"Brief pas validé", priority:"🟡 Normal", message:"Prêt à générer devis 📄" },
  { id:"sage", name:"📜 SAGE",      room:"salle_reunion", status:"idle", c:24,r:5, xp:760, mission:"Roadmap Q2 Hiving Food", context:"Deals Q2, talents, offres", lastAction:"Analyse pipeline", nextStep:"Rédiger roadmap Q2", blockedOn:"", priority:"🟠 High", message:"Roadmap Q2 en cours 🗺️" },
  { id:"alchemist", name:"⚗️ ALCHEMIST", room:"salle_reunion", status:"working", c:26,r:5, xp:890, mission:"Brief La Table Hiving 80%", context:"Brief à 80%", lastAction:"Draft brief", nextStep:"Finaliser brief", blockedOn:"Validation angle créatif", priority:"🔴 Urgent", message:"Draft 80% terminé ✍️" },
  { id:"scout", name:"🔭 SCOUT",     room:"cuisine",  status:"working", c:24,r:15,xp:430,  mission:"Audit créateurs semaine", context:"Jules, Peppe, Vincent", lastAction:"Audit vidéos Jules", nextStep:"Dossier Jules Samsung", blockedOn:"Confirmation Jules", priority:"🟠 High", message:"Auditing creators 🔭" },
];

const INIT_QUESTS = [
  { id:"q1", name:"🔥 Closer Elle & Vire",       ag:"🏹 HUNTER",    type:"URGENT", xp:500, st:"en cours",   dl:"05/04", desc:"Obtenir accord ou RDV" },
  { id:"q2", name:"📞 RDV LCL confirmé",          ag:"🏹 HUNTER",    type:"URGENT", xp:300, st:"en cours",   dl:"07/04", desc:"Booker RDV semaine 14" },
  { id:"q3", name:"✍️ Brief La Table Hiving",     ag:"⚗️ ALCHEMIST", type:"MAIN",   xp:400, st:"en cours",   dl:"03/04", desc:"Finaliser brief event" },
  { id:"q4", name:"⭐ Jules → Samsung",            ag:"🔭 SCOUT",     type:"MAIN",   xp:450, st:"à faire",    dl:"10/04", desc:"Dossier talent Jules" },
  { id:"q5", name:"💰 Devis Elle & Vire",          ag:"🛡️ WARDEN",   type:"SIDE",   xp:200, st:"à faire",    dl:"06/04", desc:"Devis post-validation" },
  { id:"q6", name:"🎬 Reel 60s Peppe",             ag:"⚗️ ALCHEMIST", type:"SIDE",   xp:250, st:"à faire",    dl:"12/04", desc:"Brief format Reel 60s" },
  { id:"q7", name:"🗺️ Roadmap Q2",                ag:"📜 SAGE",      type:"MAIN",   xp:600, st:"en cours",   dl:"15/04", desc:"Roadmap Q2 complète" },
  { id:"q8", name:"📧 Outreach x20",               ag:"🏹 HUNTER",    type:"DAILY",  xp:100, st:"à faire",    dl:"30/03", desc:"20 emails Instantly" },
  { id:"q9", name:"📊 Audit créateurs semaine",     ag:"🔭 SCOUT",     type:"DAILY",  xp:150, st:"en cours",   dl:"01/04", desc:"Audit vidéos + scoring" },
  { id:"q10",name:"📯 Post LinkedIn quotidien",     ag:"📯 HERALD",    type:"DAILY",  xp:50,  st:"à faire",    dl:"30/03", desc:"Post du jour" },
  { id:"q11",name:"🔮 Scan CR calls",               ag:"🔮 ORACLE",    type:"DAILY",  xp:120, st:"en cours",   dl:"01/04", desc:"Cross-ref CR + calendrier" },
  { id:"q12",name:"🐍 Relances pipeline",            ag:"🐍 VIPER",     type:"URGENT", xp:350, st:"en cours",   dl:"31/03", desc:"Relancer 12 actions overdue" },
];

const PRIO_COLORS = {"🔴 Urgent":"#ef4444","🟠 High":"#f97316","🟡 Normal":"#eab308","🟢 Low":"#22c55e","👑 CEO":"#ffaa44"};

// ═══════════════════════════════════════════════════════════════
// LEVEL SYSTEM
// ═══════════════════════════════════════════════════════════════
function getLevel(xp) {
  const t = [0,500,1200,2500,5000,8000,12000,18000,25000,35000];
  let lv = 1;
  for (let i = 1; i < t.length; i++) { if (xp >= t[i]) lv = i+1; }
  const cur = t[lv-1]||0, next = t[lv]||t[lv-1]+10000;
  return { lv, cur, next, pct: (xp-cur)/(next-cur) };
}

// ═══════════════════════════════════════════════════════════════
// MERGE HELPERS (live data)
// ═══════════════════════════════════════════════════════════════
function mergeAgents(liveAgents, fallback) {
  if (!liveAgents || !liveAgents.length) return fallback;
  return liveAgents.map((la, i) => {
    const fb = fallback.find(f => f.name === la.name) || fallback[i] || {};
    const meta = AGENT_META[la.name] || {};
    return { id: la.id || fb.id, name: la.name, room: la.room || fb.room || "bureau",
      status: la.status || fb.status || "idle", c: meta.startC ?? fb.c ?? 10, r: meta.startR ?? fb.r ?? 5,
      xp: fb.xp || 0, mission: la.task || fb.mission || "", context: la.action || fb.context || "",
      lastAction: la.action || fb.lastAction || "", nextStep: fb.nextStep || "", blockedOn: fb.blockedOn || "",
      priority: fb.priority || "🟡 Normal", message: la.message || fb.message || "" };
  });
}
function mergeQuests(liveQuests, fallback) {
  if (!liveQuests || !liveQuests.length) return fallback;
  return liveQuests.map((lq, i) => ({ id:`lq${i}`, name:lq.title||"Untitled", ag:lq.agent||"", type:lq.type||"SIDE",
    xp:lq.xp||0, st:lq.status||"à faire", dl:lq.deadline||"", desc:lq.description||"" }));
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

// Status badge
function StatusBadge({ status }) {
  const c = DS.status[status] || DS.status.idle;
  const label = {working:"En cours",idle:"Inactif",waiting:"En attente",browsing:"Navigation"}[status]||status;
  return <div style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",borderRadius:10,background:`${c}15`,border:`1px solid ${c}30`}}>
    <div style={{width:6,height:6,borderRadius:"50%",background:c,boxShadow:status==="working"?`0 0 6px ${c}`:"",animation:status==="working"?"pulse 2s infinite":""}}/>
    <span style={{fontSize:10,color:c,fontWeight:500,fontFamily:DS.font}}>{label}</span>
  </div>;
}

// Quest type badge
function TypeBadge({ type }) {
  const c = DS.quest[type] || "#666";
  return <span style={{fontSize:9,fontWeight:700,color:c,padding:"2px 7px",borderRadius:4,background:`${c}18`,border:`1px solid ${c}25`,fontFamily:DS.mono,letterSpacing:0.5}}>{type}</span>;
}

// XP Badge
function XpBadge({ xp }) {
  return <span style={{fontSize:10,fontWeight:600,color:"#f59e0b",fontFamily:DS.mono}}>+{xp} XP</span>;
}

// Agent avatar (small circle with emoji + glow)
function AgentAvatar({ name, size=28, status="idle" }) {
  const meta = AGENT_META[name] || {};
  const c = meta.accent || "#666";
  return <div style={{width:size,height:size,borderRadius:"50%",background:`${c}20`,border:`2px solid ${c}${status==="working"?"80":"30"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.5,
    boxShadow:status==="working"?`0 0 8px ${c}40`:"none",transition:"all .3s",flexShrink:0}}>
    {meta.emoji||"🤖"}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// QUEST CARD (redesigned — the heart of the product)
// ═══════════════════════════════════════════════════════════════
function QuestCard({ quest, agents, onComplete, onSelect, selected }) {
  const meta = AGENT_META[quest.ag] || {};
  const ac = meta.accent || "#666";
  const tc = DS.quest[quest.type] || "#666";
  const agent = agents.find(a => a.name === quest.ag);
  const isActive = quest.st === "en cours";
  const isDone = quest.st === "complétée";
  const isFailed = quest.st === "échouée";
  const isBlocked = agent?.blockedOn;

  return <div onClick={()=>onSelect?.(quest)} style={{
    background: selected ? DS.bg.hover : DS.bg.card,
    border: `1px solid ${selected ? ac+"60" : isActive ? tc+"30" : DS.border.subtle}`,
    borderRadius: DS.radius.md,
    padding: "14px 16px",
    cursor: "pointer",
    transition: "all .2s ease",
    opacity: isDone ? 0.5 : isFailed ? 0.35 : 1,
    position:"relative",
    borderLeft: `3px solid ${tc}`,
  }}>
    {/* Header: type + XP */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <TypeBadge type={quest.type}/>
      <XpBadge xp={quest.xp}/>
    </div>

    {/* Title */}
    <div style={{fontSize:13,fontWeight:600,color:isDone?"#4a4e64":DS.text.primary,marginBottom:6,lineHeight:1.3,fontFamily:DS.font,
      textDecoration:isDone?"line-through":"none"}}>{quest.name}</div>

    {/* Description */}
    <div style={{fontSize:11,color:DS.text.muted,marginBottom:10,lineHeight:1.4,fontFamily:DS.font}}>{quest.desc}</div>

    {/* Footer: agent + deadline + action */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <AgentAvatar name={quest.ag} size={20} status={agent?.status}/>
        <span style={{fontSize:10,color:ac,fontFamily:DS.font}}>{quest.ag.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {quest.dl && <span style={{fontSize:9,color:DS.text.dim,fontFamily:DS.mono}}>📅 {quest.dl}</span>}
        {isBlocked && <span style={{fontSize:9,color:DS.status.error,fontFamily:DS.mono}}>⚠️</span>}
      </div>
    </div>

    {/* Complete button */}
    {isActive && <button onClick={(e)=>{e.stopPropagation();onComplete?.(quest.id);}}
      style={{width:"100%",marginTop:10,padding:"7px 0",background:"transparent",border:`1px solid ${DS.status.working}40`,
        color:DS.status.working,fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:DS.radius.sm,fontFamily:DS.font,
        transition:"all .2s",letterSpacing:0.3}}>
      ✓ Compléter cette quête
    </button>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// AGENT CARD (sidebar — with real presence)
// ═══════════════════════════════════════════════════════════════
function AgentCard({ agent, selected, onClick }) {
  const meta = AGENT_META[agent.name] || {};
  const ac = meta.accent || "#666";
  const isSel = selected?.id === agent.id;

  return <div onClick={onClick} style={{
    display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
    background: isSel ? `${ac}12` : "transparent",
    border: `1px solid ${isSel ? ac+"40" : "transparent"}`,
    borderRadius: DS.radius.md, cursor:"pointer", transition:"all .2s",
    marginBottom: 2,
  }}>
    <AgentAvatar name={agent.name} size={32} status={agent.status}/>
    <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:600,color:ac,fontFamily:DS.font}}>{agent.name.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()}</span>
        <StatusBadge status={agent.status}/>
      </div>
      <div style={{fontSize:9,color:DS.text.muted,fontFamily:DS.font,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {meta.cls} — {agent.mission?.slice(0,30) || meta.real}
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [agents, setAgents] = useState(INIT_AGENTS);
  const [quests, setQuests] = useState(INIT_QUESTS);
  const [paths, setPaths] = useState({});
  const [frame, setFrame] = useState(0);
  const [totalXp, setTotalXp] = useState(3170);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [viewMode, setViewMode] = useState("command"); // command | map | kanban
  const [cam, setCam] = useState({x:0,y:0});
  const [scale, setScale] = useState(1.1);
  const [drag, setDrag] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(false);
  const [questFilter, setQuestFilter] = useState("all"); // all | urgent | main | side | daily

  // ═══ LIVE DATA FETCH ═══
  useEffect(() => {
    let mounted = true;
    const doFetch = async () => {
      try {
        const res = await fetch(DATA_URL + "?t=" + Date.now());
        if (!res.ok) { setSyncError(true); return; }
        const data = await res.json();
        if (!mounted) return;
        setSyncError(false);
        setLastSync(data.lastSync || new Date().toISOString());
        setAgents(prev => {
          const merged = mergeAgents(data.agents, INIT_AGENTS);
          return merged.map(ma => {
            const existing = prev.find(p => p.name === ma.name);
            if (existing) return { ...ma, c: existing.c, r: existing.r, xp: existing.xp };
            return ma;
          });
        });
        if (data.quests && data.quests.length) setQuests(mergeQuests(data.quests, INIT_QUESTS));
      } catch(e) { setSyncError(true); }
    };
    doFetch();
    const id = setInterval(doFetch, SYNC_INTERVAL);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Tiles
  const tiles = [];
  for (let c=0;c<MAP_W;c++) for (let r=0;r<MAP_H;r++) {
    const z = getZone(c,r);
    if (z) tiles.push({c,r,z});
  }
  const sfurn = [...FURN].sort((a,b)=>(a.c+a.r)-(b.c+b.r));
  const sagents = [...agents].sort((a,b)=>(a.c+a.r)-(b.c+b.r));
  if (!_walkCache) _walkCache = buildWalkCache(FURN);

  // Animation loop
  useEffect(() => {
    const id = setInterval(()=>setFrame(f=>f+1), 120);
    return ()=>clearInterval(id);
  }, []);

  // Agent patrol
  useEffect(() => {
    if (frame%30!==0) return;
    setAgents(prev => {
      const next = [...prev];
      next.forEach(agent => {
        const p = paths[agent.id];
        if (p && p.length>1) {
          agent.c = p[1].c; agent.r = p[1].r;
          setPaths(pp=>({...pp,[agent.id]:p.slice(1)}));
        } else if (Math.random()<0.12) {
          const slots = ZONE_SLOTS[agent.room];
          if (slots) {
            const target = slots[Math.floor(Math.random()*slots.length)];
            const path = aStar(_walkCache, {c:agent.c,r:agent.r}, target);
            if (path.length>1) setPaths(pp=>({...pp,[agent.id]:path}));
          }
        }
      });
      return next;
    });
  }, [frame, paths]);

  // Camera
  const onMouseDown = useCallback(e=>{if(e.button===0)setDrag({x:e.clientX-cam.x,y:e.clientY-cam.y});},[cam]);
  const onMouseMove = useCallback(e=>{if(drag)setCam({x:e.clientX-drag.x,y:e.clientY-drag.y});},[drag]);
  const onUp = useCallback(()=>setDrag(null),[]);
  const onWheel = useCallback(e=>{e.preventDefault();setScale(s=>Math.min(3,Math.max(0.3,s+(e.deltaY<0?0.15:-0.15))));},[]);

  // Quest completion
  const completeQuest = (qid) => {
    setQuests(prev=>prev.map(q=>{
      if(q.id===qid&&q.st==="en cours"){
        setTotalXp(x=>x+q.xp);
        setNotifs(n=>[...n,{id:Date.now(),msg:`✅ ${q.name} — +${q.xp} XP`,color:DS.quest[q.type]}]);
        setTimeout(()=>setNotifs(n=>n.slice(1)),4000);
        return {...q,st:"complétée"};
      }
      return q;
    }));
  };

  // Keyboard
  useEffect(()=>{
    const handler = (e)=>{
      if(e.key==='1') setViewMode("command");
      if(e.key==='2') setViewMode("map");
      if(e.key==='3') setViewMode("kanban");
      if(e.key==='+'||e.key==='=') setScale(s=>Math.min(3,s+0.2));
      if(e.key==='-') setScale(s=>Math.max(0.3,s-0.2));
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[]);

  const svgW = MAP_W*TW, svgH = MAP_H*TH;
  const originX = MAP_H*(TW/2), originY = 20;
  const level = getLevel(totalXp);
  const activeCount = agents.filter(a=>a.status==="working").length;
  const questsDone = quests.filter(q=>q.st==="complétée").length;
  const questsTotal = quests.length;
  const urgentCount = quests.filter(q=>q.type==="URGENT"&&q.st!=="complétée"&&q.st!=="échouée").length;
  const blockedAgents = agents.filter(a=>a.blockedOn);

  // Filtered quests
  const filteredQuests = quests.filter(q => questFilter === "all" || q.type === questFilter.toUpperCase());
  const questsByStatus = {
    "en cours": filteredQuests.filter(q=>q.st==="en cours"),
    "à faire": filteredQuests.filter(q=>q.st==="à faire"),
    "complétée": filteredQuests.filter(q=>q.st==="complétée"),
    "échouée": filteredQuests.filter(q=>q.st==="échouée"),
  };

  // Pipeline
  const pipeline = [
    {name:"Elle & Vire", status:"Négociation", color:"#f97316"},
    {name:"LCL", status:"RDV à booker", color:"#ef4444"},
    {name:"Dom Pérignon", status:"Prospection", color:"#eab308"},
    {name:"KitchenAid", status:"Brief envoyé", color:"#3b82f6"},
    {name:"Rabanne/PO", status:"Contact", color:"#d946ef"},
  ];

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return <div style={{width:"100vw",height:"100vh",background:DS.bg.base,color:DS.text.primary,fontFamily:DS.font,display:"flex",flexDirection:"column",overflow:"hidden",userSelect:"none"}}>

    {/* ═══ TOP BAR ═══ */}
    <div style={{height:52,background:DS.bg.card,borderBottom:`1px solid ${DS.border.subtle}`,display:"flex",alignItems:"center",padding:"0 20px",gap:16,flexShrink:0,zIndex:50}}>

      {/* Logo */}
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:15,fontWeight:700,color:"#ffaa44",letterSpacing:1.5,fontFamily:DS.font}}>HIVING OFFICE</span>
        <span style={{fontSize:9,color:DS.text.dim,fontFamily:DS.mono,padding:"1px 6px",background:DS.bg.elevated,borderRadius:4,border:`1px solid ${DS.border.subtle}`}}>v3</span>
      </div>

      {/* View tabs */}
      <div style={{display:"flex",gap:2,marginLeft:20,background:DS.bg.elevated,borderRadius:DS.radius.md,padding:2,border:`1px solid ${DS.border.subtle}`}}>
        {[{k:"command",l:"⚔️ Command",n:"1"},{k:"map",l:"🗺️ Office",n:"2"},{k:"kanban",l:"📋 Kanban",n:"3"}].map(v=>(
          <button key={v.k} onClick={()=>setViewMode(v.k)} style={{
            padding:"6px 14px",background:viewMode===v.k?DS.bg.hover:"transparent",
            border:"none",borderRadius:DS.radius.sm,color:viewMode===v.k?DS.text.primary:DS.text.muted,
            fontSize:11,fontWeight:viewMode===v.k?600:400,cursor:"pointer",fontFamily:DS.font,transition:"all .2s",
            letterSpacing:0.2,
          }}>{v.l} <span style={{fontSize:8,color:DS.text.dim,fontFamily:DS.mono}}>{v.n}</span></button>
        ))}
      </div>

      <div style={{flex:1}}/>

      {/* Stats */}
      <div style={{display:"flex",alignItems:"center",gap:14,fontSize:11,fontFamily:DS.mono}}>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:DS.status.working,boxShadow:`0 0 6px ${DS.status.working}`}}/>
          <span style={{color:DS.status.working,fontWeight:600}}>{activeCount}</span>
          <span style={{color:DS.text.dim}}>actifs</span>
        </div>
        {urgentCount > 0 && <div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{color:DS.quest.URGENT,fontWeight:600}}>🔥 {urgentCount}</span>
          <span style={{color:DS.text.dim}}>urgents</span>
        </div>}
        <div style={{color:DS.text.muted}}>{questsDone}/{questsTotal} quêtes</div>
      </div>

      {/* XP Bar */}
      <div style={{width:160,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,fontWeight:700,color:"#ffaa44",fontFamily:DS.mono}}>LV{level.lv}</span>
        <div style={{flex:1,height:6,background:DS.bg.elevated,borderRadius:3,overflow:"hidden",border:`1px solid ${DS.border.subtle}`}}>
          <div style={{width:`${level.pct*100}%`,height:"100%",background:"linear-gradient(90deg,#f59e0b,#ffaa44)",borderRadius:3,transition:"width .6s ease"}}/>
        </div>
        <span style={{fontSize:9,color:DS.text.dim,fontFamily:DS.mono}}>{totalXp}</span>
      </div>

      {/* Sync indicator */}
      <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:DS.radius.sm,
        background:syncError?`${DS.status.error}12`:lastSync?`${DS.status.working}12`:DS.bg.elevated,
        border:`1px solid ${syncError?DS.status.error+"30":lastSync?DS.status.working+"30":DS.border.subtle}`}}>
        <div style={{width:5,height:5,borderRadius:"50%",background:syncError?DS.status.error:lastSync?DS.status.working:DS.text.dim}}/>
        <span style={{fontSize:9,color:syncError?DS.status.error:lastSync?DS.status.working:DS.text.dim,fontFamily:DS.mono}}>
          {syncError?"OFFLINE":lastSync?"LIVE":"SYNC"}
        </span>
      </div>
    </div>

    {/* ═══ MAIN AREA ═══ */}
    <div style={{flex:1,display:"flex",overflow:"hidden"}}>

      {/* ═══ LEFT SIDEBAR — Agent Roster ═══ */}
      <div style={{width:280,background:DS.bg.card,borderRight:`1px solid ${DS.border.subtle}`,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>

        {/* Team header */}
        <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${DS.border.subtle}`}}>
          <div style={{fontSize:11,fontWeight:600,color:DS.text.secondary,letterSpacing:1,textTransform:"uppercase",fontFamily:DS.font}}>Équipe</div>
          <div style={{fontSize:10,color:DS.text.dim,marginTop:2,fontFamily:DS.font}}>{activeCount} agents actifs sur {agents.length}</div>
        </div>

        {/* Agent list */}
        <div style={{flex:1,overflowY:"auto",padding:"6px 8px"}}>
          {agents.map(a => <AgentCard key={a.id} agent={a} selected={selectedAgent}
            onClick={()=>{setSelectedAgent(selectedAgent?.id===a.id?null:a);}}/>)}
        </div>

        {/* Pipeline section */}
        <div style={{borderTop:`1px solid ${DS.border.subtle}`,padding:"12px 16px"}}>
          <div style={{fontSize:10,fontWeight:600,color:DS.text.dim,letterSpacing:1,textTransform:"uppercase",marginBottom:8,fontFamily:DS.font}}>Pipeline</div>
          {pipeline.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:10,color:p.color,fontWeight:500,fontFamily:DS.font}}>{p.name}</span>
              <span style={{fontSize:9,color:DS.text.dim,fontFamily:DS.mono}}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ CENTER CONTENT ═══ */}
      <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>

        {viewMode==="command" && <>
          {/* ═══ COMMAND CENTER ═══ */}
          <div style={{flex:1,overflow:"auto",padding:24,display:"flex",flexDirection:"column",gap:20}}>

            {/* Alert bar — needs attention */}
            {(urgentCount>0||blockedAgents.length>0)&&<div style={{
              background:`${DS.quest.URGENT}08`,border:`1px solid ${DS.quest.URGENT}20`,borderRadius:DS.radius.lg,
              padding:"12px 18px",display:"flex",alignItems:"center",gap:12
            }}>
              <span style={{fontSize:18}}>🔥</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:DS.quest.URGENT,fontFamily:DS.font}}>
                  {urgentCount} quête{urgentCount>1?"s":""} urgente{urgentCount>1?"s":""} {blockedAgents.length>0?`— ${blockedAgents.length} agent${blockedAgents.length>1?"s":""} bloqué${blockedAgents.length>1?"s":""}`:""}</div>
                <div style={{fontSize:10,color:DS.text.muted,marginTop:2,fontFamily:DS.font}}>
                  {blockedAgents.map(a=>a.name.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()).join(", ")} {blockedAgents.length>0?"— ":""}action requise
                </div>
              </div>
            </div>}

            {/* Quest filters */}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,fontWeight:600,color:DS.text.secondary,fontFamily:DS.font,marginRight:4}}>Quêtes</span>
              {[{k:"all",l:"Toutes"},{k:"urgent",l:"🔥 Urgent"},{k:"main",l:"⭐ Main"},{k:"side",l:"📦 Side"},{k:"daily",l:"🔄 Daily"}].map(f=>(
                <button key={f.k} onClick={()=>setQuestFilter(f.k)} style={{
                  padding:"5px 12px",background:questFilter===f.k?DS.bg.hover:"transparent",
                  border:`1px solid ${questFilter===f.k?DS.border.active:DS.border.subtle}`,
                  borderRadius:20,color:questFilter===f.k?DS.text.primary:DS.text.muted,fontSize:10,
                  fontWeight:questFilter===f.k?600:400,cursor:"pointer",fontFamily:DS.font,transition:"all .2s"
                }}>{f.l}</button>
              ))}
              <div style={{flex:1}}/>
              <span style={{fontSize:10,color:DS.text.dim,fontFamily:DS.mono}}>{filteredQuests.length} quête{filteredQuests.length>1?"s":""}</span>
            </div>

            {/* Quest sections */}
            {["en cours","à faire","complétée"].map(status => {
              const qs = questsByStatus[status] || [];
              if (qs.length === 0) return null;
              const labels = {"en cours":"⚡ En cours","à faire":"📋 À faire","complétée":"✅ Complétées"};
              return <div key={status}>
                <div style={{fontSize:11,fontWeight:600,color:DS.text.muted,marginBottom:10,letterSpacing:0.5,fontFamily:DS.font}}>
                  {labels[status]} <span style={{color:DS.text.dim}}>({qs.length})</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
                  {qs.map(q=><QuestCard key={q.id} quest={q} agents={agents} onComplete={completeQuest}
                    onSelect={setSelectedQuest} selected={selectedQuest?.id===q.id}/>)}
                </div>
              </div>;
            })}
          </div>
        </>}

        {viewMode==="map" && <>
          {/* ═══ MAP VIEW ═══ */}
          <div style={{flex:1,cursor:drag?"grabbing":"grab",position:"relative",touchAction:"none",overflow:"hidden"}}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}>

            <svg width={svgW*scale} height={svgH*scale} style={{transform:`translate(${cam.x}px,${cam.y}px) scale(${scale})`,transformOrigin:"0 0",imageRendering:"pixelated"}}>
              <g transform={`translate(${originX},${originY})`}>
                {tiles.map(({c,r,z})=>{
                  const {x,y}=ts(c,r); const zone=ZONES[z]; const isDoor=DOOR_SET.has(`${c},${r}`); const even=(c+r)%2===0;
                  return <g key={`t${c}-${r}`} transform={`translate(${x},${y})`}>
                    <polygon points={`${TW/2},0 ${TW},${TH/2} ${TW/2},${TH} 0,${TH/2}`}
                      fill={isDoor?`${zone.border}46`:even?zone.color:zone.dark} stroke={`${zone.border}${isDoor?"88":"28"}`} strokeWidth={isDoor?1:0.4}/>
                    <polygon points={`0,${TH/2} ${TW/2},${TH} ${TW/2},${TH+7} 0,${TH/2+7}`} fill={`${zone.dark}cc`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                    <polygon points={`${TW/2},${TH} ${TW},${TH/2} ${TW},${TH/2+7} ${TW/2},${TH+7}`} fill={`${zone.dark}88`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                  </g>;
                })}
                {Object.entries(ZONES).map(([k,z])=>{
                  if(k==="couloir"||k==="couloir2") return null;
                  const mc=(z.c1+z.c2)/2, mr=(z.r1+z.r2)/2; const {x,y}=ts(mc,mr);
                  return <text key={k} x={x+TW/2} y={y+TH/2-38} textAnchor="middle" fontSize="8" fill={z.accent} fontFamily="monospace" fontWeight="bold" opacity="0.25">{z.icon} {z.label.toUpperCase()}</text>;
                })}
                {sfurn.map((f,i)=>{
                  const zk=getZone(f.c,f.r)||"bureau"; const {x,y}=ts(f.c,f.r);
                  return <g key={`f${i}`} transform={`translate(${x},${y})`}><FurnSprite t={f.t} l={f.l} zk={zk}/></g>;
                })}
                {sagents.map(agent=>{
                  const meta=AGENT_META[agent.name]||{}; const {x,y}=ts(agent.c,agent.r);
                  const isWalking=(paths[agent.id]?.length||0)>1;
                  const isSel=selectedAgent?.id===agent.id;
                  return <g key={agent.id} transform={`translate(${x},${y})`}
                    onClick={e=>{e.stopPropagation();setSelectedAgent(isSel?null:agent);}} style={{cursor:"pointer"}}>
                    {isSel&&<g>
                      <rect x={TW/2-55} y={TH/2-72} width="110" height="20" rx="6" fill="#08090eee" stroke={meta.accent} strokeWidth="0.7"/>
                      <polygon points={`${TW/2-4},${TH/2-52} ${TW/2+4},${TH/2-52} ${TW/2},${TH/2-46}`} fill={meta.accent}/>
                      <text x={TW/2} y={TH/2-58} textAnchor="middle" fontSize="6" fill="#ccc" fontFamily="sans-serif">{agent.message.slice(0,26)}</text>
                    </g>}
                    <PNJ color={meta.color} accent={meta.accent} status={isWalking?"walking":agent.status}
                      frame={frame+agent.id.charCodeAt(0)*11} selected={isSel} isKhan={meta.isKhan}/>
                    <text x={TW/2} y={TH/2+24} textAnchor="middle" fontSize="5.5" fill={meta.accent} fontFamily="sans-serif"
                      style={{filter:`drop-shadow(0 0 2px ${meta.color})`}}>
                      {agent.name.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()||agent.name}
                    </text>
                  </g>;
                })}
              </g>
            </svg>

            {/* Map controls */}
            <div style={{position:"absolute",bottom:16,left:16,display:"flex",gap:4,zIndex:20}}>
              <button onClick={()=>setScale(s=>Math.min(3,s+0.2))} style={{width:28,height:28,background:DS.bg.card,border:`1px solid ${DS.border.default}`,borderRadius:DS.radius.sm,color:DS.text.muted,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
              <button onClick={()=>setScale(s=>Math.max(0.3,s-0.2))} style={{width:28,height:28,background:DS.bg.card,border:`1px solid ${DS.border.default}`,borderRadius:DS.radius.sm,color:DS.text.muted,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
            </div>

            {/* Minimap */}
            <div style={{position:"absolute",bottom:16,right:16,background:`${DS.bg.card}ee`,border:`1px solid ${DS.border.default}`,padding:8,zIndex:20,borderRadius:DS.radius.md}}>
              <svg width={100} height={66}>
                {Object.entries(ZONES).map(([k,z])=>(
                  <rect key={k} x={z.c1/MAP_W*98} y={z.r1/MAP_H*64} width={(z.c2-z.c1)/MAP_W*98} height={(z.r2-z.r1)/MAP_H*64} fill={z.color} stroke={z.border} strokeWidth="0.6" opacity="0.85" rx="1"/>
                ))}
                {agents.map(a=>{
                  const m=AGENT_META[a.name]||{};
                  return <circle key={a.id} cx={a.c/MAP_W*98} cy={a.r/MAP_H*64} r={m.isKhan?3:2} fill={m.accent||"#fff"} opacity="0.9"/>;
                })}
              </svg>
            </div>
          </div>
        </>}

        {viewMode==="kanban" && <>
          {/* ═══ KANBAN VIEW ═══ */}
          <div style={{flex:1,display:"flex",gap:12,padding:16,overflowX:"auto"}}>
            {[{key:"à faire",label:"📋 À faire",accent:DS.text.muted},{key:"en cours",label:"⚡ En cours",accent:DS.status.working},
              {key:"complétée",label:"✅ Complétées",accent:"#22c55e"},{key:"échouée",label:"❌ Échouées",accent:DS.status.error}].map(col=>{
              const colQuests = quests.filter(q=>q.st===col.key);
              return <div key={col.key} style={{flex:1,minWidth:260,background:DS.bg.card,border:`1px solid ${DS.border.subtle}`,borderRadius:DS.radius.lg,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${DS.border.subtle}`,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,fontWeight:600,color:col.accent,fontFamily:DS.font}}>{col.label}</span>
                  <span style={{fontSize:10,color:DS.text.dim,fontFamily:DS.mono,padding:"1px 6px",background:DS.bg.elevated,borderRadius:10}}>{colQuests.length}</span>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:8}}>
                  {colQuests.map(q=><QuestCard key={q.id} quest={q} agents={agents} onComplete={completeQuest} onSelect={setSelectedQuest}/>)}
                  {colQuests.length===0&&<div style={{fontSize:11,color:DS.text.dim,textAlign:"center",padding:32,fontFamily:DS.font}}>Aucune quête</div>}
                </div>
              </div>;
            })}
          </div>
        </>}
      </div>

      {/* ═══ RIGHT PANEL — Context & Detail ═══ */}
      {(selectedAgent || selectedQuest) && <div style={{width:300,background:DS.bg.card,borderLeft:`1px solid ${DS.border.subtle}`,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>

        {/* Close button */}
        <div style={{display:"flex",justifyContent:"flex-end",padding:"8px 12px 0"}}>
          <button onClick={()=>{setSelectedAgent(null);setSelectedQuest(null);}}
            style={{background:"none",border:"none",color:DS.text.dim,cursor:"pointer",fontSize:16,padding:4}}>✕</button>
        </div>

        {selectedAgent && (() => {
          const meta = AGENT_META[selectedAgent.name] || {};
          const ac = meta.accent || "#666";
          const agQuests = quests.filter(q=>q.ag===selectedAgent.name);
          return <div style={{padding:"0 16px 16px",overflowY:"auto",flex:1}}>
            {/* Agent header */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <AgentAvatar name={selectedAgent.name} size={44} status={selectedAgent.status}/>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:ac,fontFamily:DS.font}}>{selectedAgent.name}</div>
                <div style={{fontSize:10,color:DS.text.muted,fontFamily:DS.font}}>{meta.cls} — {meta.real}</div>
              </div>
            </div>

            <StatusBadge status={selectedAgent.status}/>

            {/* Info blocks */}
            <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
              <InfoBlock label="Mission" value={selectedAgent.mission} color={ac}/>
              <InfoBlock label="Contexte" value={selectedAgent.context}/>
              <InfoBlock label="Dernière action" value={selectedAgent.lastAction} icon="✅"/>
              <InfoBlock label="Prochaine étape" value={selectedAgent.nextStep} icon="→"/>
              {selectedAgent.blockedOn && <InfoBlock label="Bloqué sur" value={selectedAgent.blockedOn} icon="⚠️" color={DS.status.error}/>}
              <InfoBlock label="Planning" value={meta.schedule} icon="⏰"/>
            </div>

            {/* Agent quests */}
            {agQuests.length>0 && <div style={{marginTop:20}}>
              <div style={{fontSize:10,fontWeight:600,color:DS.text.dim,letterSpacing:1,textTransform:"uppercase",marginBottom:8,fontFamily:DS.font}}>Quêtes assignées</div>
              {agQuests.map(q=><div key={q.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",
                background:DS.bg.elevated,borderRadius:DS.radius.sm,marginBottom:4,border:`1px solid ${DS.border.subtle}`,cursor:"pointer"}}
                onClick={()=>setSelectedQuest(q)}>
                <TypeBadge type={q.type}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:DS.text.primary,fontFamily:DS.font}}>{q.name}</div>
                  <div style={{fontSize:9,color:DS.text.dim,fontFamily:DS.font}}>{q.st} — {q.dl}</div>
                </div>
                <XpBadge xp={q.xp}/>
              </div>)}
            </div>}
          </div>;
        })()}

        {selectedQuest && !selectedAgent && (() => {
          const meta = AGENT_META[selectedQuest.ag] || {};
          const ac = meta.accent || "#666";
          return <div style={{padding:"0 16px 16px",overflowY:"auto",flex:1}}>
            <TypeBadge type={selectedQuest.type}/>
            <div style={{fontSize:16,fontWeight:700,color:DS.text.primary,marginTop:10,marginBottom:6,fontFamily:DS.font}}>{selectedQuest.name}</div>
            <div style={{fontSize:12,color:DS.text.secondary,marginBottom:16,lineHeight:1.5,fontFamily:DS.font}}>{selectedQuest.desc}</div>

            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <AgentAvatar name={selectedQuest.ag} size={24} status="working"/>
              <span style={{fontSize:11,color:ac,fontWeight:500,fontFamily:DS.font}}>{selectedQuest.ag}</span>
            </div>

            <div style={{display:"flex",gap:12,marginBottom:16}}>
              <div style={{flex:1,background:DS.bg.elevated,borderRadius:DS.radius.sm,padding:"8px 10px",border:`1px solid ${DS.border.subtle}`}}>
                <div style={{fontSize:8,color:DS.text.dim,textTransform:"uppercase",letterSpacing:0.5}}>XP</div>
                <div style={{fontSize:14,fontWeight:700,color:"#f59e0b",fontFamily:DS.mono}}>+{selectedQuest.xp}</div>
              </div>
              <div style={{flex:1,background:DS.bg.elevated,borderRadius:DS.radius.sm,padding:"8px 10px",border:`1px solid ${DS.border.subtle}`}}>
                <div style={{fontSize:8,color:DS.text.dim,textTransform:"uppercase",letterSpacing:0.5}}>Deadline</div>
                <div style={{fontSize:12,fontWeight:600,color:DS.text.primary,fontFamily:DS.mono}}>{selectedQuest.dl||"—"}</div>
              </div>
            </div>

            {selectedQuest.st==="en cours"&&<button onClick={()=>completeQuest(selectedQuest.id)}
              style={{width:"100%",padding:"10px",background:`${DS.status.working}15`,border:`1px solid ${DS.status.working}40`,
                color:DS.status.working,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:DS.radius.md,fontFamily:DS.font}}>
              ✓ Compléter cette quête
            </button>}
          </div>;
        })()}
      </div>}
    </div>

    {/* ═══ NOTIFICATIONS ═══ */}
    <div style={{position:"fixed",top:60,right:20,display:"flex",flexDirection:"column",gap:6,pointerEvents:"none",zIndex:100}}>
      {notifs.map(n=>(
        <div key={n.id} style={{background:`${DS.bg.card}f8`,border:`1px solid ${n.color}40`,color:n.color,
          padding:"10px 18px",fontSize:12,borderRadius:DS.radius.md,boxShadow:`0 4px 24px ${n.color}20`,
          fontWeight:600,fontFamily:DS.font,animation:"slideIn .3s ease"}}>
          {n.msg}
        </div>
      ))}
    </div>

    {/* ═══ STYLES ═══ */}
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      * { scrollbar-width: thin; scrollbar-color: ${DS.border.default} ${DS.bg.base}; box-sizing:border-box; }
      *::-webkit-scrollbar { width: 5px; }
      *::-webkit-scrollbar-track { background: ${DS.bg.base}; }
      *::-webkit-scrollbar-thumb { background: ${DS.border.default}; border-radius: 3px; }
      *::-webkit-scrollbar-thumb:hover { background: ${DS.border.active}; }
      button:hover { filter: brightness(1.15); }
    `}</style>
  </div>;
}

// Small helper component
function InfoBlock({ label, value, icon, color }) {
  if (!value) return null;
  return <div>
    <div style={{fontSize:9,color:DS.text.dim,textTransform:"uppercase",letterSpacing:0.5,marginBottom:3,fontFamily:DS.font}}>{label}</div>
    <div style={{fontSize:11,color:color||DS.text.secondary,fontFamily:DS.font}}>{icon&&<span style={{marginRight:4}}>{icon}</span>}{value}</div>
  </div>;
}
