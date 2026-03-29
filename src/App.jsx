import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// LIVE DATA — fetches data.json pushed by sync task every 15min
// ═══════════════════════════════════════════════════════════════
const DATA_URL = import.meta.env.BASE_URL + "data.json";
const SYNC_INTERVAL = 30000; // poll every 30s

function mapAgentId(name) {
  const map = {"KHAN":"khan","ORACLE":"oracle","VIPER":"viper","HUNTER":"hunter","ARCHITECT":"architect","HERALD":"herald","WARDEN":"warden","SAGE":"sage","ALCHEMIST":"alchemist","SCOUT":"scout"};
  for (const [k,v] of Object.entries(map)) if (name.toUpperCase().includes(k)) return v;
  return name.toLowerCase().replace(/[^a-z]/g,"");
}

function mergeAgents(liveAgents, fallback) {
  if (!liveAgents || !liveAgents.length) return fallback;
  return liveAgents.map((la, i) => {
    const fb = fallback.find(f => f.name === la.name) || fallback[i] || {};
    const meta = AGENT_META[la.name] || {};
    return {
      id: mapAgentId(la.name),
      name: la.name,
      room: la.room || fb.room || "bureau",
      status: la.status || fb.status || "idle",
      c: meta.startC ?? fb.c ?? 10,
      r: meta.startR ?? fb.r ?? 5,
      xp: fb.xp || 0,
      mission: la.task || fb.mission || "",
      context: la.action || fb.context || "",
      lastAction: la.action || fb.lastAction || "",
      nextStep: fb.nextStep || "",
      blockedOn: fb.blockedOn || "",
      priority: fb.priority || "🟡 Normal",
      message: la.message || fb.message || "",
    };
  });
}

function mergeQuests(liveQuests, fallback) {
  if (!liveQuests || !liveQuests.length) return fallback;
  return liveQuests.map((lq, i) => ({
    id: `lq${i}`,
    name: lq.title || "Untitled",
    ag: lq.agent || "",
    type: lq.type || "SIDE",
    xp: lq.xp || 0,
    st: lq.status || "à faire",
    dl: lq.deadline || "",
    desc: lq.description || "",
  }));
}

// ═══════════════════════════════════════════════════════════════
// TILE ENGINE
// ═══════════════════════════════════════════════════════════════
const TW = 56, TH = 28;
const MAP_W = 30, MAP_H = 20;
function ts(c, r) { return { x: (c - r) * (TW / 2), y: (c + r) * (TH / 2) }; }

const ZONES = {
  khan:          { c1:0,  r1:0,  c2:6,  r2:7,  label:"Bureau Khan",     icon:"👑", color:"#1a1208", dark:"#0e0a04", border:"#c8762e", accent:"#ffaa44", reason:"CEO Command" },
  bureau:        { c1:7,  r1:0,  c2:18, r2:9,  label:"Open Space",      icon:"💻", color:"#0c1420", dark:"#070d16", border:"#1a4a8a", accent:"#3a80d4", reason:"Agent Hub" },
  couloir:       { c1:19, r1:0,  c2:20, r2:19, label:"Couloir",         icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565", reason:"Transit" },
  salle_reunion: { c1:21, r1:0,  c2:29, r2:9,  label:"War Room",        icon:"⚔️", color:"#120818", dark:"#0a0410", border:"#5a1aaa", accent:"#9944ee", reason:"Strategy" },
  cuisine:       { c1:21, r1:10, c2:29, r2:19, label:"Taverne",         icon:"🍺", color:"#060e06", dark:"#040804", border:"#1a5a28", accent:"#33aa55", reason:"Rest & Scout" },
  couloir2:      { c1:7,  r1:10, c2:18, r2:19, label:"Couloir Sud",     icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565", reason:"Transit" },
};

function getZone(c, r) {
  for (const [k, z] of Object.entries(ZONES)) {
    if (c >= z.c1 && c <= z.c2 && r >= z.r1 && r <= z.r2) return k;
  }
  return null;
}

const DOORS = [
  {c:6,r:4},{c:7,r:4},
  {c:18,r:4},{c:19,r:4},
  {c:20,r:3},{c:21,r:3},
  {c:20,r:14},{c:21,r:14},
  {c:18,r:14},{c:19,r:14},
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
  // — KHAN'S OFFICE —
  {c:0,r:0,t:"window_wall"},{c:1,r:0,t:"window_wall"},{c:2,r:0,t:"window_wall"},
  {c:3,r:0,t:"window_wall"},{c:4,r:0,t:"window_wall"},{c:5,r:0,t:"window_wall"},
  {c:2,r:3,t:"throne",l:"KHAN"},
  {c:1,r:5,t:"armchair"},
  {c:4,r:6,t:"golf_hole",l:"⛳"},{c:5,r:5,t:"golf_ball"},
  {c:0,r:6,t:"plant"},{c:6,r:0,t:"plant"},
  {c:5,r:2,t:"overview_screen",l:"LIVE"},
  // — OPEN SPACE —
  {c:8,r:1,t:"desk",l:"🔮"},{c:11,r:1,t:"desk",l:"🐍"},
  {c:14,r:1,t:"desk",l:"🏹"},{c:17,r:1,t:"desk",l:"🏗️"},
  {c:8,r:5,t:"desk",l:"📯"},{c:11,r:5,t:"desk",l:"🛡️"},
  {c:7,r:8,t:"plant"},{c:18,r:0,t:"plant"},
  {c:17,r:8,t:"printer"},
  {c:7,r:0,t:"shelf"},
  {c:15,r:7,t:"sofa_back"},{c:16,r:7,t:"sofa_back"},
  {c:12,r:8,t:"coffee_table"},
  // — WAR ROOM —
  {c:23,r:2,t:"ctable"},{c:24,r:2,t:"ctable"},{c:25,r:2,t:"ctable"},
  {c:22,r:3,t:"ctable"},{c:23,r:3,t:"ctable"},{c:24,r:3,t:"ctable"},{c:25,r:3,t:"ctable"},{c:26,r:3,t:"ctable"},
  {c:23,r:4,t:"ctable"},{c:24,r:4,t:"ctable"},{c:25,r:4,t:"ctable"},
  {c:21,r:1,t:"wboard"},{c:28,r:0,t:"cscreen"},
  {c:29,r:1,t:"plant"},
  // — TAVERNE —
  {c:21,r:11,t:"coffee"},{c:22,r:11,t:"counter"},{c:23,r:11,t:"counter"},
  {c:24,r:11,t:"counter"},{c:25,r:11,t:"barrel"},
  {c:26,r:11,t:"fridge"},
  {c:23,r:14,t:"ctable"},{c:24,r:14,t:"ctable"},
  {c:21,r:16,t:"sofa_back"},{c:22,r:16,t:"sofa_back"},
  {c:24,r:17,t:"low_table"},
  {c:29,r:17,t:"plant"},{c:21,r:19,t:"plant"},
];

// ═══════════════════════════════════════════════════════════════
// FURNITURE SPRITES
// ═══════════════════════════════════════════════════════════════
function FurnSprite({ t, l, zk }) {
  const z = ZONES[zk] || ZONES.bureau;
  const B = z.accent, br = z.border;
  const s = { desk:<g><rect x="10" y="2" width="36" height="18" rx="2" fill="#0e1a2a" stroke={br} strokeWidth="0.7"/><rect x="12" y="4" width="14" height="10" rx="1" fill="#112244" stroke={B} strokeWidth="0.4"/><circle cx="19" cy="9" r="2" fill={B} opacity="0.3"/>{l&&<text x="28" y="19" fontSize="7" fill={B} fontFamily="monospace" textAnchor="middle" opacity="0.7">{l}</text>}</g>,
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
    window_wall:<g><rect x="2" y="-4" width="52" height="22" rx="1" fill="#0a0a14" stroke="#2a2a44" strokeWidth="0.5"/><rect x="6" y="-2" width="20" height="14" rx="1" fill="#0c0c1e" stroke="#1a1a3a" strokeWidth="0.3"/><rect x="30" y="-2" width="20" height="14" rx="1" fill="#0c0c1e" stroke="#1a1a3a" strokeWidth="0.3"/><line x1="16" y1="-2" x2="16" y2="12" stroke="#1a1a3a" strokeWidth="0.2"/><line x1="40" y1="-2" x2="40" y2="12" stroke="#1a1a3a" strokeWidth="0.2"/></g>,
    barrel:<g><ellipse cx="28" cy="6" rx="10" ry="6" fill="#2a1a08" stroke="#8a6020" strokeWidth="0.6"/><rect x="18" y="6" width="20" height="12" fill="#2a1a08" stroke="#8a6020" strokeWidth="0.4"/><ellipse cx="28" cy="18" rx="10" ry="4" fill="#221608"/><line x1="20" y1="6" x2="20" y2="18" stroke="#8a6020" strokeWidth="0.3"/><line x1="36" y1="6" x2="36" y2="18" stroke="#8a6020" strokeWidth="0.3"/></g>,
    microwave:<g><rect x="14" y="4" width="28" height="16" rx="2" fill="#1a1a22" stroke={br} strokeWidth="0.5"/><rect x="16" y="6" width="18" height="10" rx="1" fill="#0a0a14"/><circle cx="38" cy="10" r="1.5" fill={B} opacity="0.4"/></g>,
    island:<g><polygon points={`${TW/2},4 ${TW-6},${TH/2} ${TW/2},${TH-4} 6,${TH/2}`} fill="#1a1208" stroke={br} strokeWidth="0.5"/></g>,
    divider:<g><rect x="24" y="-2" width="8" height="22" rx="1" fill="#0e0e1a" stroke={br} strokeWidth="0.4"/></g>,
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
    {status==="working"&&<>
      <rect x={TW/2-3} y={bodyY+12} width={6} height={3} rx={1} fill={accent} opacity="0.3"/>
    </>}
    <circle cx={TW/2} cy={bodyY+4} r={headR} fill={color} stroke={accent} strokeWidth="0.8"/>
    <circle cx={TW/2-2} cy={bodyY+2} r={1} fill={accent}/>
    <circle cx={TW/2+2} cy={bodyY+2} r={1} fill={accent}/>
    {isKhan&&<polygon points={`${TW/2-6},${bodyY-2} ${TW/2-4},${bodyY-7} ${TW/2},${bodyY-4} ${TW/2+4},${bodyY-7} ${TW/2+6},${bodyY-2}`} fill="#ffaa44" stroke="#cc8800" strokeWidth="0.4"/>}
    {status==="working"&&<circle cx={TW/2+10} cy={bodyY} r={2} fill={accent} opacity={0.4+Math.sin(frame*0.2)*0.3}/>}
    {status==="idle"&&frame%60<30&&<text x={TW/2+10} y={bodyY+4} fontSize="4" fill="#666" fontFamily="monospace">z</text>}
  </g>;
}

// ═══════════════════════════════════════════════════════════════
// AGENTS + QUESTS (Notion-ready data)
// ═══════════════════════════════════════════════════════════════
const AGENT_META = {
  "👑 KHAN":      { color:"#8a5000", accent:"#ffaa44", startC:2, startR:4, isKhan:true, cls:"Boss Final",  schedule:"Always",       real:"Milan — CEO oversight" },
  "🔮 ORACLE":    { color:"#6611aa", accent:"#aa55ff", startC:8, startR:2, isKhan:false, cls:"Devin",       schedule:"Weekly ~10h",  real:"Agent CR Automatique" },
  "🐍 VIPER":     { color:"#aa2020", accent:"#ff4444", startC:11,startR:2, isKhan:false, cls:"Assassin",    schedule:"Weekly ~9h",   real:"Agent Relances" },
  "🏹 HUNTER":    { color:"#b06018", accent:"#ff8844", startC:14,startR:2, isKhan:false, cls:"Ranger",      schedule:"Mondays ~9h",  real:"Agent Prospection B2B" },
  "🏗️ ARCHITECT": { color:"#0f6e28", accent:"#33cc66", startC:17,startR:2, isKhan:false, cls:"Ingénieur",   schedule:"Thursdays ~10h",real:"Agent Marketing Site" },
  "📯 HERALD":    { color:"#cc8800", accent:"#ffcc44", startC:8, startR:6, isKhan:false, cls:"Barde",       schedule:"Daily ~8h",    real:"LinkedIn Daily" },
  "🛡️ WARDEN":   { color:"#444466", accent:"#8888cc", startC:11,startR:6, isKhan:false, cls:"Gardien",     schedule:"Mondays ~11h", real:"Agent Meta Système" },
  "📜 SAGE":      { color:"#1a44aa", accent:"#5588ff", startC:24,startR:5, isKhan:false, cls:"Archiviste",  schedule:"Fridays ~18h", real:"Agent Recap Hebdo" },
  "⚗️ ALCHEMIST": { color:"#8800aa", accent:"#cc44ff", startC:26,startR:5, isKhan:false, cls:"Créateur",    schedule:"Wednesdays ~10h",real:"Agent Dispositifs" },
  "🔭 SCOUT":     { color:"#1a6a6a", accent:"#44ccbb", startC:24,startR:15,isKhan:false, cls:"Éclaireur",   schedule:"Tuesdays ~10h",real:"Agent Audit Créateurs" },
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
  { id:"k0", name:"👑 KHAN",      room:"khan",     status:"idle",    c:2, r:4, xp:5000, mission:"Superviser tous les agents", context:"Vue d'ensemble", lastAction:"Morning check", nextStep:"Valider brief La Table", blockedOn:"", priority:"👑 CEO", message:"Watching the game 🏌️" },
  { id:"o1", name:"🔮 ORACLE",    room:"bureau",   status:"working", c:8, r:2, xp:680,  mission:"Scanner les CR de calls", context:"Cross-ref Notion & calendrier", lastAction:"Scan CR calls semaine", nextStep:"Rapport anomalies détectées", blockedOn:"", priority:"🟡 Normal", message:"Scanning call data..." },
  { id:"v1", name:"🐍 VIPER",     room:"bureau",   status:"working", c:11,r:2, xp:920,  mission:"Relancer les actions en retard", context:"12 actions overdue détectées", lastAction:"Scan pipeline relances", nextStep:"Générer emails de relance", blockedOn:"Attente retour Elle & Vire", priority:"🔴 Urgent", message:"12 relances en queue 🎯" },
  { id:"h1", name:"🏹 HUNTER",    room:"bureau",   status:"working", c:14,r:2, xp:1100, mission:"Closer Elle & Vire + RDV LCL", context:"Elle & Vire 2 sem. LCL chaud sem 14", lastAction:"Relance email E&V", nextStep:"Appel LCL + follow-up E&V 48h", blockedOn:"Retour Elle & Vire", priority:"🔴 Urgent", message:"LCL chaud → RDV sem. 14 🔥" },
  { id:"a1", name:"🏗️ ARCHITECT", room:"bureau",   status:"idle",    c:17,r:2, xp:460,  mission:"Améliorer site hivingfood.com", context:"SEO + backlog Maxime", lastAction:"Audit SEO pages", nextStep:"Meta tags + rapport hebdo", blockedOn:"", priority:"🟡 Normal", message:"SEO audit en cours 📊" },
  { id:"he1",name:"📯 HERALD",    room:"bureau",   status:"working", c:8, r:6, xp:350,  mission:"Post LinkedIn quotidien", context:"Contenu food + influence", lastAction:"Post LinkedIn lundi", nextStep:"Rédiger post du jour", blockedOn:"", priority:"🟢 Low", message:"Drafting today's post ✍️" },
  { id:"w1", name:"🛡️ WARDEN",   room:"bureau",   status:"idle",    c:11,r:6, xp:380,  mission:"Maintenance système Notion", context:"Templates OK, agent sync", lastAction:"Vérif templates contrats", nextStep:"Devis E&V dès signal ALCHEMIST", blockedOn:"Brief pas encore validé", priority:"🟡 Normal", message:"Prêt à générer devis 📄" },
  { id:"s1", name:"📜 SAGE",      room:"salle_reunion", status:"idle", c:24,r:5, xp:760, mission:"Roadmap Q2 Hiving Food", context:"Définir deals Q2, talents, offres", lastAction:"Analyse pipeline marques", nextStep:"Rédiger roadmap Q2 chiffrée", blockedOn:"", priority:"🟠 High", message:"Roadmap Q2 en cours 🗺️" },
  { id:"al1",name:"⚗️ ALCHEMIST", room:"salle_reunion", status:"working", c:26,r:5, xp:890, mission:"Brief La Table Hiving 80%", context:"Brief à 80%. One-pager demandé.", lastAction:"Draft brief La Table", nextStep:"Finaliser brief + one-pager", blockedOn:"Validation angle créatif", priority:"🔴 Urgent", message:"Draft 80% terminé ✍️" },
  { id:"sc1",name:"🔭 SCOUT",     room:"cuisine",  status:"working", c:24,r:15,xp:430,  mission:"Audit créateurs semaine", context:"Jules, Peppe, Vincent à scorer", lastAction:"Audit vidéos Jules", nextStep:"Dossier Jules pitch Samsung", blockedOn:"Confirmation Jules dispo", priority:"🟠 High", message:"Auditing creators 🔭" },
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

const QC = { URGENT:"#ff4444", MAIN:"#ffcc00", SIDE:"#4488ff", DAILY:"#44ff88" };
const PRIO_C = {"🔴 Urgent":"#ff4444","🟠 High":"#ff8844","🟡 Normal":"#ffcc44","🟢 Low":"#44ff88","👑 CEO":"#c8762e"};

// ═══════════════════════════════════════════════════════════════
// LEVEL SYSTEM
// ═══════════════════════════════════════════════════════════════
function getLevel(xp) {
  const thresholds = [0,500,1200,2500,5000,8000,12000,18000,25000,35000];
  let lv = 1;
  for (let i = 1; i < thresholds.length; i++) { if (xp >= thresholds[i]) lv = i+1; }
  const cur = thresholds[lv-1]||0, next = thresholds[lv]||thresholds[lv-1]+10000;
  return { lv, cur, next, pct: (xp-cur)/(next-cur) };
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
  const [hudOpen, setHudOpen] = useState(true);
  const [viewMode, setViewMode] = useState("map"); // map | kanban
  const [cam, setCam] = useState({x:0,y:0});
  const [scale, setScale] = useState(1.2);
  const [drag, setDrag] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(false);

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
        // Merge live agents — preserve current positions (c/r) if agent is walking
        setAgents(prev => {
          const merged = mergeAgents(data.agents, INIT_AGENTS);
          return merged.map(ma => {
            const existing = prev.find(p => p.name === ma.name);
            if (existing) {
              return { ...ma, c: existing.c, r: existing.r, xp: existing.xp };
            }
            return ma;
          });
        });
        // Merge live quests
        if (data.quests && data.quests.length) {
          setQuests(mergeQuests(data.quests, INIT_QUESTS));
        }
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

  // Sorted furniture & agents
  const sfurn = [...FURN].sort((a,b)=>(a.c+a.r)-(b.c+b.r));
  const sagents = [...agents].sort((a,b)=>(a.c+a.r)-(b.c+b.r));

  // Walk cache
  if (!_walkCache) _walkCache = buildWalkCache(FURN);

  // Animation loop
  useEffect(() => {
    const id = setInterval(()=>setFrame(f=>f+1), 120);
    return ()=>clearInterval(id);
  }, []);

  // Agent patrol AI
  useEffect(() => {
    if (frame%30!==0) return;
    setAgents(prev => {
      const next = [...prev];
      next.forEach(agent => {
        const p = paths[agent.id];
        if (p && p.length>1) {
          const step = p[1];
          agent.c = step.c; agent.r = step.r;
          setPaths(pp=>({...pp,[agent.id]:p.slice(1)}));
        } else if (Math.random()<0.12) {
          const zone = agent.room;
          const slots = ZONE_SLOTS[zone];
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
        setNotifs(n=>[...n,{id:Date.now(),msg:`✅ ${q.name} +${q.xp}XP`,color:QC[q.type]}]);
        setTimeout(()=>setNotifs(n=>n.slice(1)),4000);
        return {...q,st:"complétée"};
      }
      return q;
    }));
  };

  // Keyboard
  useEffect(()=>{
    const handler = (e)=>{
      if(e.key==='m'||e.key==='M') setViewMode("map");
      if(e.key==='k'||e.key==='K') setViewMode("kanban");
      if(e.key==='d'||e.key==='D') setHudOpen(h=>!h);
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

  // Pipeline data
  const pipeline = [
    {name:"Elle & Vire", status:"Négociation", color:"#ff8844"},
    {name:"LCL", status:"RDV à booker", color:"#ff4444"},
    {name:"Dom Pérignon", status:"Prospection", color:"#ffcc44"},
    {name:"KitchenAid", status:"Brief envoyé", color:"#4488ff"},
    {name:"Rabanne/PO Agency", status:"Contact", color:"#cc44ff"},
  ];

  return <div style={{width:"100vw",height:"100vh",background:"#020208",color:"#aaa",fontFamily:"'Courier New',monospace",display:"flex",flexDirection:"column",overflow:"hidden",userSelect:"none"}}>

    {/* TOP BAR */}
    <div style={{height:44,background:"#06060e",borderBottom:"1px solid #1a1a28",display:"flex",alignItems:"center",padding:"0 16px",gap:12,flexShrink:0,zIndex:50}}>
      <div style={{fontSize:14,fontWeight:"bold",color:"#ffaa44",letterSpacing:2}}>HIVING OFFICE</div>
      <div style={{fontSize:9,color:"#666",borderLeft:"1px solid #1a1a28",paddingLeft:10}}>v2.0</div>
      <div style={{flex:1}}/>
      <div style={{display:"flex",gap:6,fontSize:8}}>
        <span style={{color:"#44ff88"}}>● {activeCount} active</span>
        <span style={{color:"#666"}}>|</span>
        <span style={{color:"#ffcc44"}}>⚔️ {questsDone}/{questsTotal}</span>
        <span style={{color:"#666"}}>|</span>
        <span style={{color:"#ffaa44"}}>LV{level.lv}</span>
        <span style={{color:"#555"}}>{totalXp}XP</span>
        <span style={{color:"#666"}}>|</span>
        <span style={{color:syncError?"#ff4444":lastSync?"#44ff88":"#666"}}>{syncError?"⚠ OFFLINE":lastSync?"🔗 LIVE":"⏳ SYNC"}</span>
      </div>
      <div style={{display:"flex",gap:4,marginLeft:12}}>
        <button onClick={()=>setScale(s=>Math.min(3,s+0.2))} style={{padding:"2px 6px",background:"transparent",border:"1px solid #1a1a28",color:"#555",fontSize:10,cursor:"pointer",fontFamily:"monospace"}}>+</button>
        <button onClick={()=>setScale(s=>Math.max(0.3,s-0.2))} style={{padding:"2px 6px",background:"transparent",border:"1px solid #1a1a28",color:"#555",fontSize:10,cursor:"pointer",fontFamily:"monospace"}}>−</button>
      </div>
      <div style={{display:"flex",gap:4,marginLeft:8}}>
        {["map","kanban"].map(v=>(
          <button key={v} onClick={()=>setViewMode(v)} style={{padding:"3px 10px",background:viewMode===v?"#0e0e1e":"transparent",border:`1px solid ${viewMode===v?"#2a2a44":"#111118"}`,color:viewMode===v?"#8888cc":"#444",fontSize:8,cursor:"pointer",fontFamily:"monospace",transition:"all .2s"}}>
            {v==="map"?"🗺️ MAP":"📋 KANBAN"}
          </button>
        ))}
        <button onClick={()=>setHudOpen(o=>!o)} style={{padding:"3px 10px",background:hudOpen?"#0e0e1e":"transparent",border:`1px solid ${hudOpen?"#2a2a44":"#111118"}`,color:hudOpen?"#8888cc":"#444",fontSize:8,cursor:"pointer",fontFamily:"monospace"}}>
          {hudOpen?"◀ HUD":"▶ HUD"}
        </button>
      </div>
    </div>

    <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>

      {/* LEFT DASHBOARD */}
      {hudOpen && <div style={{width:260,background:"#04040c",borderRight:"1px solid #0e0e1e",overflowY:"auto",flexShrink:0,padding:10,display:"flex",flexDirection:"column",gap:10}}>

        {/* XP Bar */}
        <div style={{background:"#08080e",border:"1px solid #1a1a28",borderRadius:3,padding:8}}>
          <div style={{fontSize:8,color:"#ffaa44",marginBottom:4}}>👑 KHAN — Level {level.lv}</div>
          <div style={{height:6,background:"#0a0a14",borderRadius:3,overflow:"hidden"}}>
            <div style={{width:`${level.pct*100}%`,height:"100%",background:"linear-gradient(90deg,#ffaa44,#ff8844)",borderRadius:3,transition:"width .5s"}}/>
          </div>
          <div style={{fontSize:7,color:"#555",marginTop:3}}>{totalXp} / {level.next} XP</div>
        </div>

        {/* Agent Status */}
        <div style={{background:"#08080e",border:"1px solid #1a1a28",borderRadius:3,padding:8}}>
          <div style={{fontSize:8,color:"#666",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Agents</div>
          {agents.map(a=>{
            const m = AGENT_META[a.name]||{};
            return <div key={a.id} onClick={()=>{setSelectedAgent(a);setViewMode("map");}} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",marginBottom:3,background:selectedAgent?.id===a.id?"#0e0e1e":"transparent",borderRadius:2,cursor:"pointer",border:`1px solid ${selectedAgent?.id===a.id?m.accent+"44":"transparent"}`}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:a.status==="working"?"#44ff88":a.status==="idle"?"#666":"#ffcc44",boxShadow:a.status==="working"?`0 0 4px #44ff88`:""}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:7,color:m.accent}}>{a.name.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()}</div>
                <div style={{fontSize:6,color:"#3a3a4a"}}>{m.cls} — {m.schedule}</div>
              </div>
              <div style={{fontSize:6,color:PRIO_C[a.priority]||"#444"}}>{a.priority?.split(" ")[0]}</div>
            </div>;
          })}
        </div>

        {/* Pipeline */}
        <div style={{background:"#08080e",border:"1px solid #1a1a28",borderRadius:3,padding:8}}>
          <div style={{fontSize:8,color:"#666",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Pipeline</div>
          {pipeline.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #0a0a14"}}>
              <span style={{fontSize:7,color:p.color}}>{p.name}</span>
              <span style={{fontSize:6,color:"#3a3a4a"}}>{p.status}</span>
            </div>
          ))}
        </div>

        {/* Quest Progress */}
        <div style={{background:"#08080e",border:"1px solid #1a1a28",borderRadius:3,padding:8}}>
          <div style={{fontSize:8,color:"#666",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Quêtes</div>
          {["URGENT","MAIN","SIDE","DAILY"].map(type=>{
            const qs = quests.filter(q=>q.type===type);
            const done = qs.filter(q=>q.st==="complétée").length;
            return <div key={type} style={{marginBottom:4}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:7}}>
                <span style={{color:QC[type]}}>{type}</span>
                <span style={{color:"#444"}}>{done}/{qs.length}</span>
              </div>
              <div style={{height:3,background:"#0a0a14",borderRadius:2,overflow:"hidden",marginTop:2}}>
                <div style={{width:`${qs.length?done/qs.length*100:0}%`,height:"100%",background:QC[type],borderRadius:2}}/>
              </div>
            </div>;
          })}
        </div>

        {/* Activity Feed */}
        <div style={{background:"#08080e",border:"1px solid #1a1a28",borderRadius:3,padding:8}}>
          <div style={{fontSize:8,color:"#666",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Activité récente</div>
          {agents.slice(0,5).map(a=>{
            const m=AGENT_META[a.name]||{};
            return <div key={a.id} style={{fontSize:6,color:"#3a4a5a",marginBottom:4,paddingBottom:3,borderBottom:"1px solid #080810"}}>
              <span style={{color:m.accent}}>{a.name.split(" ")[1]}</span>: {a.lastAction}
            </div>;
          })}
        </div>
      </div>}

      {/* CENTER CONTENT */}
      <div style={{flex:1,overflow:"hidden",position:"relative"}}>

        {viewMode==="map" ? <>
          {/* MAP VIEW */}
          <div style={{width:"100%",height:"100%",cursor:drag?"grabbing":"grab",position:"relative",touchAction:"none"}}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onUp} onMouseLeave={onUp}
            onWheel={onWheel}>

            <svg width={svgW*scale} height={svgH*scale} style={{transform:`translate(${cam.x}px,${cam.y}px) scale(${scale})`,transformOrigin:"0 0",imageRendering:"pixelated"}}>
              <g transform={`translate(${originX},${originY})`}>

                {/* Floor tiles */}
                {tiles.map(({c,r,z})=>{
                  const {x,y}=ts(c,r);
                  const zone=ZONES[z];
                  const isDoor=DOOR_SET.has(`${c},${r}`);
                  const even=(c+r)%2===0;
                  return <g key={`t${c}-${r}`} transform={`translate(${x},${y})`}>
                    <polygon points={`${TW/2},0 ${TW},${TH/2} ${TW/2},${TH} 0,${TH/2}`}
                      fill={isDoor?`${zone.border}46`:even?zone.color:zone.dark}
                      stroke={`${zone.border}${isDoor?"88":"28"}`} strokeWidth={isDoor?1:0.4}/>
                    <polygon points={`0,${TH/2} ${TW/2},${TH} ${TW/2},${TH+7} 0,${TH/2+7}`} fill={`${zone.dark}cc`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                    <polygon points={`${TW/2},${TH} ${TW},${TH/2} ${TW},${TH/2+7} ${TW/2},${TH+7}`} fill={`${zone.dark}88`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                  </g>;
                })}

                {/* Zone labels */}
                {Object.entries(ZONES).map(([k,z])=>{
                  if(k==="couloir"||k==="couloir2") return null;
                  const mc=(z.c1+z.c2)/2, mr=(z.r1+z.r2)/2;
                  const {x,y}=ts(mc,mr);
                  return <g key={k}>
                    <text x={x+TW/2} y={y+TH/2-38} textAnchor="middle" fontSize="8" fill={z.accent} fontFamily="monospace" fontWeight="bold" opacity="0.3">{z.icon} {z.label.toUpperCase()}</text>
                  </g>;
                })}

                {/* Furniture */}
                {sfurn.map((f,i)=>{
                  const zk=getZone(f.c,f.r)||"bureau";
                  const {x,y}=ts(f.c,f.r);
                  return <g key={`f${i}`} transform={`translate(${x},${y})`}><FurnSprite t={f.t} l={f.l} zk={zk}/></g>;
                })}

                {/* Agents */}
                {sagents.map(agent=>{
                  const meta=AGENT_META[agent.name]||{};
                  const {x,y}=ts(agent.c,agent.r);
                  const isWalking=(paths[agent.id]?.length||0)>1;
                  const isSel=selectedAgent?.id===agent.id;
                  return <g key={agent.id} transform={`translate(${x},${y})`}
                    onClick={e=>{e.stopPropagation();setSelectedAgent(isSel?null:agent);}}
                    style={{cursor:"pointer"}}>
                    {isSel&&<g>
                      <rect x={TW/2-55} y={TH/2-72} width="110" height="20" rx="3" fill="#08080e" stroke={meta.accent} strokeWidth="0.7" opacity="0.95"/>
                      <polygon points={`${TW/2-4},${TH/2-52} ${TW/2+4},${TH/2-52} ${TW/2},${TH/2-46}`} fill={meta.accent}/>
                      <text x={TW/2} y={TH/2-58} textAnchor="middle" fontSize="6" fill="#ccc" fontFamily="monospace">{agent.message.slice(0,26)}</text>
                    </g>}
                    <PNJ color={meta.color} accent={meta.accent}
                      status={isWalking?"walking":agent.status}
                      frame={frame+agent.id.charCodeAt(0)*11}
                      selected={isSel} isKhan={meta.isKhan}/>
                    <text x={TW/2} y={TH/2+24} textAnchor="middle" fontSize="5.5" fill={meta.accent} fontFamily="monospace"
                      style={{filter:`drop-shadow(0 0 2px ${meta.color})`}}>
                      {agent.name.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()||agent.name}
                    </text>
                  </g>;
                })}
              </g>
            </svg>

            {/* Notifications */}
            <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",gap:4,pointerEvents:"none",zIndex:30,alignItems:"center"}}>
              {notifs.map(n=>(
                <div key={n.id} style={{background:"#06060e",border:`1px solid ${n.color}`,color:n.color,padding:"5px 14px",fontSize:9,borderRadius:3,boxShadow:`0 4px 16px ${n.color}33`,whiteSpace:"nowrap"}}>{n.msg}</div>
              ))}
            </div>

            {/* Mini-map */}
            <div style={{position:"absolute",bottom:10,left:10,background:"#03030a",border:"1px solid #0e0e1e",padding:6,zIndex:20,borderRadius:3}}>
              <svg width={90} height={60}>
                {Object.entries(ZONES).map(([k,z])=>(
                  <rect key={k} x={z.c1/MAP_W*88} y={z.r1/MAP_H*58} width={(z.c2-z.c1)/MAP_W*88} height={(z.r2-z.r1)/MAP_H*58} fill={z.color} stroke={z.border} strokeWidth="0.6" opacity="0.85"/>
                ))}
                {agents.map(a=>{
                  const m=AGENT_META[a.name]||{};
                  return <circle key={a.id} cx={a.c/MAP_W*88} cy={a.r/MAP_H*58} r={m.isKhan?3:2} fill={m.accent||"#fff"} opacity="0.9"/>;
                })}
              </svg>
            </div>

            {/* Selected agent panel */}
            {selectedAgent&&(()=>{
              const meta=AGENT_META[selectedAgent.name]||{};
              const agQuests=quests.filter(q=>q.ag===selectedAgent.name);
              return <div data-nopan="true" style={{position:"absolute",right:10,top:10,width:260,background:"#05050e",border:`1px solid ${meta.accent}44`,boxShadow:`0 0 16px ${meta.color}22`,zIndex:30,borderRadius:4,maxHeight:"80vh",overflowY:"auto"}}>
                <div style={{padding:"10px 12px 8px",borderBottom:`1px solid ${meta.color}22`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:10,color:meta.accent,fontWeight:"bold"}}>{selectedAgent.name}</div>
                    <div style={{fontSize:7,color:"#3a4a5a"}}>{meta.cls} — {meta.real}</div>
                  </div>
                  <button onClick={()=>setSelectedAgent(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:14}}>✕</button>
                </div>
                <div style={{padding:"10px 12px"}}>
                  <div style={{fontSize:7,color:PRIO_C[selectedAgent.priority]||"#444",marginBottom:4}}>{selectedAgent.priority}</div>
                  <div style={{fontSize:8,color:"#7a8a9a",marginBottom:6}}>{selectedAgent.mission}</div>
                  <div style={{fontSize:7,color:"#3a4a5a",marginBottom:4}}>📍 {selectedAgent.context}</div>
                  <div style={{fontSize:7,color:"#3a4a5a",marginBottom:4}}>✅ {selectedAgent.lastAction}</div>
                  <div style={{fontSize:7,color:"#5a6a7a",marginBottom:4}}>→ {selectedAgent.nextStep}</div>
                  {selectedAgent.blockedOn&&<div style={{fontSize:7,color:"#ff6644",marginBottom:4}}>⚠️ {selectedAgent.blockedOn}</div>}
                  <div style={{fontSize:7,color:"#555",marginBottom:8}}>⏰ {meta.schedule}</div>

                  {agQuests.length>0&&<>
                    <div style={{fontSize:8,color:"#666",marginTop:8,marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Quêtes assignées</div>
                    {agQuests.map(q=>(
                      <div key={q.id} onClick={()=>setSelectedQuest(q)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 6px",marginBottom:3,background:"#08080e",borderRadius:2,border:`1px solid ${QC[q.type]}22`,cursor:"pointer"}}>
                        <div>
                          <div style={{fontSize:7,color:QC[q.type]}}>{q.name}</div>
                          <div style={{fontSize:6,color:"#3a3a4a"}}>{q.st} — {q.dl}</div>
                        </div>
                        <div style={{fontSize:7,color:"#ffcc44"}}>+{q.xp}</div>
                        {q.st==="en cours"&&<button onClick={(e)=>{e.stopPropagation();completeQuest(q.id);}} style={{marginLeft:4,padding:"2px 6px",background:"transparent",border:"1px solid #44ff8844",color:"#44ff88",fontSize:6,cursor:"pointer",borderRadius:2,fontFamily:"monospace"}}>✓</button>}
                      </div>
                    ))}
                  </>}
                </div>
              </div>;
            })()}
          </div>
        </> : <>
          {/* KANBAN VIEW */}
          <div style={{height:"100%",display:"flex",gap:8,padding:12,overflowX:"auto"}}>
            {[{key:"à faire",label:"📋 À FAIRE"},{key:"en cours",label:"⚡ EN COURS"},{key:"complétée",label:"✅ COMPLÉTÉE"},{key:"échouée",label:"❌ ÉCHOUÉE"}].map(col=>{
              const colQuests = quests.filter(q=>q.st===col.key);
              return <div key={col.key} style={{flex:1,minWidth:200,background:"#06060e",border:"1px solid #0e0e1e",borderRadius:4,display:"flex",flexDirection:"column"}}>
                <div style={{padding:"10px 12px",borderBottom:"1px solid #0e0e1e",fontSize:9,color:"#666",fontWeight:"bold",letterSpacing:1}}>
                  {col.label} <span style={{color:"#444"}}>({colQuests.length})</span>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:8,display:"flex",flexDirection:"column",gap:6}}>
                  {colQuests.map(q=>{
                    const agMeta = AGENT_META[q.ag]||{};
                    return <div key={q.id} onClick={()=>{
                      const ag = agents.find(a=>a.name===q.ag);
                      if(ag){setSelectedAgent(ag);setViewMode("map");}
                    }} style={{background:"#08080e",border:`1px solid ${QC[q.type]}33`,borderRadius:3,padding:10,cursor:"pointer",transition:"border-color .2s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontSize:6,color:QC[q.type],padding:"1px 6px",background:`${QC[q.type]}15`,borderRadius:2,fontWeight:"bold"}}>{q.type}</span>
                        <span style={{fontSize:7,color:"#ffcc44",fontWeight:"bold"}}>+{q.xp}XP</span>
                      </div>
                      <div style={{fontSize:9,color:"#ccc",marginBottom:4}}>{q.name}</div>
                      <div style={{fontSize:7,color:"#3a4a5a",marginBottom:6}}>{q.desc}</div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:agMeta.accent||"#666"}}/>
                          <span style={{fontSize:6,color:agMeta.accent||"#666"}}>{q.ag.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim()}</span>
                        </div>
                        <span style={{fontSize:6,color:"#444"}}>📅 {q.dl}</span>
                      </div>
                      {q.st==="en cours"&&<button onClick={(e)=>{e.stopPropagation();completeQuest(q.id);}} style={{marginTop:6,width:"100%",padding:"4px",background:"transparent",border:"1px solid #44ff8844",color:"#44ff88",fontSize:7,cursor:"pointer",borderRadius:2,fontFamily:"monospace"}}>✓ Compléter</button>}
                    </div>;
                  })}
                  {colQuests.length===0&&<div style={{fontSize:7,color:"#2a2a3a",textAlign:"center",padding:20}}>Aucune quête</div>}
                </div>
              </div>;
            })}
          </div>
        </>}
      </div>
    </div>

    {/* Keyframes */}
    <style>{`
      @keyframes slideIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
      * { scrollbar-width: thin; scrollbar-color: #1a1a28 #04040c; }
      *::-webkit-scrollbar { width: 4px; }
      *::-webkit-scrollbar-track { background: #04040c; }
      *::-webkit-scrollbar-thumb { background: #1a1a28; border-radius: 2px; }
    `}</style>
  </div>;
}
