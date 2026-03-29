import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
// TILE ENGINE
// ═══════════════════════════════════════════════════════════
const TW = 56, TH = 28;
const MAP_W = 26, MAP_H = 18;
function ts(c, r) { return { x: (c - r) * (TW / 2), y: (c + r) * (TH / 2) }; }

const ZONES = {
  milan:         { c1:0,  r1:0,  c2:6,  r2:7,  label:"Bureau Milan",   icon:"👑", color:"#1a1208", dark:"#0e0a04", border:"#c8762e", accent:"#ffaa44", reason:"CEO Overview" },
  bureau:        { c1:7,  r1:0,  c2:17, r2:9,  label:"Open Space",     icon:"💼", color:"#0c1420", dark:"#070d16", border:"#1a4a8a", accent:"#3a80d4", reason:"Travail API" },
  couloir:       { c1:18, r1:0,  c2:19, r2:17, label:"Couloir",        icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565", reason:"Transit" },
  salle_reunion: { c1:20, r1:0,  c2:25, r2:8,  label:"Salle Réunion",  icon:"🌐", color:"#120818", dark:"#0a0410", border:"#5a1aaa", accent:"#9944ee", reason:"Browser / Web" },
  cuisine:       { c1:20, r1:9,  c2:25, r2:17, label:"Cuisine",        icon:"☕", color:"#060e06", dark:"#040804", border:"#1a5a28", accent:"#33aa55", reason:"Attend Milan" },
  couloir2:      { c1:7,  r1:10, c2:17, r2:17, label:"Couloir Sud",    icon:"🚶", color:"#0a0a10", dark:"#060608", border:"#252535", accent:"#454565", reason:"Transit" },
};

function getZone(c, r) {
  for (const [k, z] of Object.entries(ZONES)) {
    if (c >= z.c1 && c <= z.c2 && r >= z.r1 && r <= z.r2) return k;
  }
  return null;
}

const DOORS = [
  {c:6,r:4},{c:7,r:4},   // milan ↔ bureau
  {c:17,r:4},{c:18,r:4}, // bureau ↔ couloir
  {c:19,r:3},{c:20,r:3}, // couloir ↔ reunion
  {c:19,r:13},{c:20,r:13}, // couloir ↔ cuisine
  {c:17,r:13},{c:18,r:13}, // bureau ↔ couloir2
];
const DOOR_SET = new Set(DOORS.map(d=>`${d.c},${d.r}`));

// ═══════════════════════════════════════════════════════════
// PATHFINDING
// ═══════════════════════════════════════════════════════════
const BLOCKED_TYPES = new Set(["desk","shelf","ctable","cscreen","wboard","coffee","counter","fridge","sofa_back","golf_hole","armchair","window_wall","divider"]);

// Pre-build walkability (computed once)
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
  while (open.length && iter++ < 400) {
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

// ═══════════════════════════════════════════════════════════
// FURNITURE DEFINITIONS
// ═══════════════════════════════════════════════════════════
const FURN = [
  // ── MILAN'S OFFICE ──
  // Bay window wall (decorative back wall)
  {c:0,r:0,t:"window_wall"},{c:1,r:0,t:"window_wall"},{c:2,r:0,t:"window_wall"},
  {c:3,r:0,t:"window_wall"},{c:4,r:0,t:"window_wall"},{c:5,r:0,t:"window_wall"},
  // Milan's executive desk (center)
  {c:2,r:3,t:"exec_desk",l:"MILAN"},
  // Armchair
  {c:1,r:5,t:"armchair"},
  // Mini golf hole
  {c:4,r:6,t:"golf_hole",l:"⛳"},
  {c:5,r:5,t:"golf_ball"},
  // Plants
  {c:0,r:6,t:"plant"},{c:6,r:0,t:"plant"},
  // Overview screens (showing other rooms)
  {c:5,r:2,t:"overview_screen",l:"LIVE"},

  // ── OPEN SPACE BUREAU ──
  // 5 agent desks in L shape
  {c:8,r:1,t:"desk",l:"🧠"},{c:11,r:1,t:"desk",l:"🎯"},
  {c:8,r:5,t:"desk",l:"⭐"},{c:11,r:5,t:"desk",l:"🎬"},
  {c:14,r:3,t:"desk",l:"📋"},
  // Plants + printer
  {c:7,r:8,t:"plant"},{c:16,r:0,t:"plant"},
  {c:16,r:7,t:"printer"},
  {c:7,r:0,t:"shelf"},
  // Small sofa area in corner
  {c:14,r:7,t:"sofa_back"},{c:15,r:7,t:"sofa_back"},
  {c:10,r:8,t:"coffee_table"},

  // ── SALLE DE RÉUNION ──
  // Round conference table (multi-tile)
  {c:22,r:2,t:"ctable"},{c:23,r:2,t:"ctable"},
  {c:21,r:3,t:"ctable"},{c:22,r:3,t:"ctable"},{c:23,r:3,t:"ctable"},
  {c:22,r:4,t:"ctable"},
  // Whiteboard
  {c:20,r:1,t:"wboard"},
  // Projector screen
  {c:24,r:0,t:"cscreen"},
  // Plants
  {c:25,r:1,t:"plant"},

  // ── CUISINE ──
  // Kitchen counter L-shape
  {c:20,r:10,t:"coffee"},{c:21,r:10,t:"counter"},{c:22,r:10,t:"counter"},
  {c:23,r:10,t:"microwave"},{c:24,r:10,t:"counter"},
  // Fridge
  {c:25,r:10,t:"fridge"},
  // Central island
  {c:21,r:12,t:"island"},{c:22,r:12,t:"island"},{c:23,r:12,t:"island"},
  // Sofa lounge
  {c:20,r:14,t:"sofa_back"},{c:21,r:14,t:"sofa_back"},
  {c:22,r:15,t:"low_table"},
  // Plants
  {c:25,r:15,t:"plant"},{c:20,r:16,t:"plant"},
];

// ═══════════════════════════════════════════════════════════
// FURNITURE SPRITES — rich pixel art
// ═══════════════════════════════════════════════════════════
function FurnSprite({ t, l, zk }) {
  const z = ZONES[zk] || ZONES.bureau;
  const B = z.accent, brd = z.border;
  const cx = TW/2, cy = TH/2;

  if (t === "window_wall") return <g>
    {/* Glass panel */}
    <polygon points={`${cx},-22 ${TW+4},-6 ${TW+4},8 ${cx},22`} fill="#0a1a2a" opacity="0.9"/>
    <polygon points={`${cx},-22 ${TW+4},-6 ${TW+4},8 ${cx},22`} fill="none" stroke="#1a4a7a" strokeWidth="0.8"/>
    {/* Window frame verticals */}
    {[0.3,0.6].map((p,i)=>{
      const px = cx + (TW/2+4)*p, py1 = -22 + 30*p, py2 = 22-p*14;
      return <line key={i} x1={px} y1={py1} x2={px} y2={py2} stroke="#1a4a7a" strokeWidth="0.6" opacity="0.7"/>;
    })}
    {/* City skyline silhouette */}
    <polygon points={`${cx+2},-2 ${cx+8},-8 ${cx+12},-4 ${cx+16},-12 ${cx+20},-6 ${cx+24},-10 ${cx+28},-4 ${TW+2},-6 ${TW+2},6 ${cx},6`} fill="#061018" opacity="0.8"/>
    {/* Stars / lights */}
    {[[cx+10,-6],[cx+18,-4],[cx+6,-10]].map(([px,py],i)=>(
      <circle key={i} cx={px} cy={py} r={0.8} fill="#ffee88" opacity="0.6"/>
    ))}
  </g>;

  if (t === "exec_desk") return <g>
    {/* Large L-shaped exec desk */}
    <polygon points={`${cx-18},-4 ${cx+22},-4 ${cx+22},16 ${cx-18},16`} fill="#1a0e06" stroke="#3a2010" strokeWidth="0.8"/>
    <polygon points={`${cx-18},-4 ${cx+22},-4 ${cx+18},-16 ${cx-14},-16`} fill="#2a1808" stroke="#4a3018" strokeWidth="0.6"/>
    {/* Dual monitors */}
    <rect x={cx-12} y={-34} width="16" height="12" rx="1" fill="#04040c" stroke="#1a1a2a" strokeWidth="0.6"/>
    <rect x={cx-11} y={-33} width="14" height="10" fill="#08102a"/>
    <rect x={cx-10} y={-32} width="5" height="1.5" fill="#00aaff" opacity="0.8"/>
    <rect x={cx-10} y={-30} width="9" height="1" fill="#00ff88" opacity="0.6"/>
    <rect x={cx-10} y={-28} width="6" height="1" fill="#ffaa44" opacity="0.5"/>
    <rect x={cx+4}  y={-32} width="16" height="12" rx="1" fill="#04040c" stroke="#1a1a2a" strokeWidth="0.6"/>
    <rect x={cx+5}  y={-31} width="14" height="10" fill="#080820"/>
    <rect x={cx+6}  y={-30} width="5" height="1.5" fill="#ffaa44" opacity="0.8"/>
    <rect x={cx+6}  y={-28} width="8" height="1" fill="#c8762e" opacity="0.6"/>
    {/* Keyboard */}
    <polygon points={`${cx-8},-2 ${cx+14},-2 ${cx+12},5 ${cx-6},5`} fill="#0e0e1e" stroke="#1a1a2a" strokeWidth="0.4"/>
    {/* Phone */}
    <rect x={cx-16} y={-2} width="8" height="6" rx="1" fill="#1a1a2a"/>
    {/* Name + priority */}
    {l && <text x={cx} y={-38} textAnchor="middle" fontSize="5.5" fill={B} fontFamily="monospace" fontWeight="bold">{l}</text>}
    <text x={cx} y={-42} textAnchor="middle" fontSize="4.5" fill="#c8762e" fontFamily="monospace">👑 CEO</text>
  </g>;

  if (t === "armchair") return <g>
    <polygon points={`${cx-12},2 ${cx+12},2 ${cx+14},14 ${cx-14},14`} fill="#2a1808" stroke="#3a2810" strokeWidth="0.6"/>
    <polygon points={`${cx-12},-10 ${cx+12},-10 ${cx+12},2 ${cx-12},2`} fill="#3a2010" stroke="#4a3020" strokeWidth="0.5"/>
    <polygon points={`${cx-14},-10 ${cx-12},-10 ${cx-12},14 ${cx-14},14`} fill="#221006"/>
    <polygon points={`${cx+12},-10 ${cx+14},-10 ${cx+14},14 ${cx+12},14`} fill="#221006"/>
    {/* Cushion */}
    <ellipse cx={cx} cy={-4} rx="10" ry="5" fill="#4a3020" stroke="#5a4030" strokeWidth="0.4"/>
    {/* Headrest */}
    <rect x={cx-8} y={-18} width="16" height="8" rx="3" fill="#3a2010" stroke="#4a3020" strokeWidth="0.5"/>
  </g>;

  if (t === "golf_hole") return <g>
    {/* Green patch */}
    <polygon points={`${cx},-4 ${cx+16},4 ${cx},12 ${cx-16},4`} fill="#0e3010" stroke="#1a4818" strokeWidth="0.5"/>
    <polygon points={`${cx},-4 ${cx+16},4 ${cx},12 ${cx-16},4`} fill="#124014" opacity="0.6"/>
    {/* Hole */}
    <ellipse cx={cx} cy={4} rx="4" ry="2" fill="#000"/>
    {/* Flag */}
    <line x1={cx} y1={4} x2={cx} y2={-14} stroke="#888" strokeWidth="0.8"/>
    <polygon points={`${cx},${-14} ${cx+8},${-10} ${cx},${-6}`} fill="#ff2200"/>
    {/* Number */}
    <text x={cx+4} y={-8} fontSize="4" fill="#fff" fontFamily="monospace">1</text>
  </g>;

  if (t === "golf_ball") return <g>
    <circle cx={cx+4} cy={TH/2} r="3.5" fill="#fff" stroke="#ddd" strokeWidth="0.4"/>
    <circle cx={cx+3} cy={TH/2-1} r="1" fill="#eee" opacity="0.5"/>
  </g>;

  if (t === "overview_screen") return <g>
    {/* Large monitor showing overview */}
    <rect x={cx-14} y={-38} width="28" height="22} " rx="1.5" fill="#04040c" stroke={brd} strokeWidth="0.8"/>
    <rect x={cx-13} y={-37} width="26" height="19" fill="#060818"/>
    {/* 4 mini room views */}
    {[[0,0,"#1a4a8a"],[1,0,"#5a1aaa"],[0,1,"#1a5a28"],[1,1,"#c8762e"]].map(([ci,ri,c],i)=>(
      <g key={i}>
        <rect x={cx-12+ci*13} y={-36+ri*9} width="11" height="7" fill={c} opacity="0.3" stroke={c} strokeWidth="0.3"/>
        {/* Mini agent dots */}
        <circle cx={cx-8+ci*13+Math.random()*6} cy={-33+ri*9+Math.random()*3} r="1" fill="#fff" opacity="0.6"/>
      </g>
    ))}
    <text x={cx} y={-18} textAnchor="middle" fontSize="4" fill={B} fontFamily="monospace">{l}</text>
    <rect x={cx-14} y={-38} width="28" height="2" rx="0.5" fill={brd} opacity="0.5"/>
  </g>;

  if (t === "desk") return <g>
    <polygon points={`${cx-14},-4 ${cx+14},-4 ${cx+14},12 ${cx-14},12`} fill="#1a0e08" stroke="#2e1c10" strokeWidth="0.6"/>
    <polygon points={`${cx-14},-4 ${cx+14},-4 ${cx+12},-14 ${cx-12},-14`} fill="#221208" stroke="#3a1e10" strokeWidth="0.5"/>
    <rect x={cx-8} y={-28} width="16" height="12} " rx="1" fill="#04040e" stroke="#0e0e1e" strokeWidth="0.5"/>
    <rect x={cx-7} y={-27} width="14" height="10" fill="#080c1e"/>
    <rect x={cx-6} y={-25} width="5" height="1.5" fill="#00ccff" opacity="0.8"/>
    <rect x={cx-6} y={-23} width="9" height="1" fill="#00ff88" opacity="0.6"/>
    <rect x={cx-6} y={-21} width="6" height="1" fill="#ff6644" opacity="0.4"/>
    <rect x={cx-1} y={-18} width="2" height="3} " fill="#111"/>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+6},5 ${cx-6},5`} fill="#0e0e1a" stroke="#1a1a28" strokeWidth="0.3"/>
    {l && <text x={cx} y={-32} textAnchor="middle" fontSize="7" fill="#888" fontFamily="monospace">{l}</text>}
  </g>;

  if (t === "shelf") return <g>
    <polygon points={`${cx-14},-2 ${cx+14},-2 ${cx+14},18 ${cx-14},18`} fill="#160e06"/>
    {[0,1,2].map(i=><g key={i}>
      {["#aa2200","#2244aa","#006622","#884400","#220044"].map((c,j)=>(
        <rect key={j} x={cx-12+(j*5)} y={i*7-1} width="4" height="6" fill={c} opacity="0.9"/>
      ))}
    </g>)}
    {[6,13].map(y=><line key={y} x1={cx-14} y1={y} x2={cx+14} y2={y} stroke="#2e1a0a" strokeWidth="0.7"/>)}
  </g>;

  if (t === "printer") return <g>
    <polygon points={`${cx-10},0 ${cx+10},0 ${cx+12},12 ${cx-12},12`} fill="#121220"/>
    <rect x={cx-9} y={-12} width="18" height="12} " rx="1.5" fill="#1a1a28"/>
    <circle cx={cx+6} cy={-6} r="2" fill="#00ff88" opacity="0.9"/>
    <rect x={cx-6} y={4} width="12" height="2} " fill="#0a0a16"/>
  </g>;

  if (t === "sofa_back") return <g>
    <polygon points={`${cx-12},2 ${cx+12},2 ${cx+14},14 ${cx-14},14`} fill="#141018"/>
    <polygon points={`${cx-12},-10 ${cx+12},-10 ${cx+12},2 ${cx-12},2`} fill="#1e1428" stroke="#2a1e34" strokeWidth="0.5"/>
    <polygon points={`${cx-14},-10 ${cx-12},-10 ${cx-12},14 ${cx-14},14`} fill="#100c14"/>
    <polygon points={`${cx+12},-10 ${cx+14},-10 ${cx+14},14 ${cx+12},14`} fill="#100c14"/>
    <ellipse cx={cx} cy={-4} rx="10" ry="4.5" fill="#221a2e" stroke="#2e2438" strokeWidth="0.4"/>
  </g>;

  if (t === "coffee_table") return <g>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+10},8 ${cx-10},8`} fill="#1a1208" stroke="#2a1e10" strokeWidth="0.5"/>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+6},-10 ${cx-6},-10`} fill="#221808"/>
    {/* Coffee cup */}
    <polygon points={`${cx-3},-6 ${cx+3},-6 ${cx+2},-2 ${cx-2},-2`} fill="#1a1010"/>
    <ellipse cx={cx} cy={-6} rx="3" ry="1.5" fill="#0e0808"/>
    <path d={`M${cx+3},-5 Q${cx+6},-5 ${cx+6},-3 Q${cx+6},-1 ${cx+3},-1`} fill="none" stroke="#2a1a10" strokeWidth="0.6"/>
  </g>;

  if (t === "ctable") return <g>
    {/* Round section of conference table */}
    <ellipse cx={cx} cy={4} rx={16} ry={10} fill="#1e1006" stroke="#3a2010" strokeWidth="0.7"/>
    <ellipse cx={cx} cy={0} rx={14} ry={8} fill="#2a1808" stroke="#3e2418" strokeWidth="0.5"/>
    {/* Chair */}
    <ellipse cx={cx} cy={18} rx="7" ry="3.5" fill="#0e0812" stroke="#1a1020" strokeWidth="0.5"/>
  </g>;

  if (t === "wboard") return <g>
    <rect x={cx-14} y={-34} width="28" height="22} " rx="1" fill="#f0f0e8" stroke="#888" strokeWidth="0.5"/>
    {/* Drawing */}
    <line x1={cx-10} y1={-28} x2={cx+4} y2={-20} stroke="#2244cc" strokeWidth="1.2"/>
    <circle cx={cx-2} cy={-26} r="4" fill="none" stroke="#cc2244" strokeWidth="1"/>
    <rect x={cx+2} y={-30} width="6" height="6" fill="none" stroke="#22aa44" strokeWidth="1"/>
    {/* Text lines */}
    <line x1={cx-10} y1={-16} x2={cx+10} y2={-16} stroke="#333" strokeWidth="0.5" opacity="0.4"/>
    <line x1={cx-10} y1={-14} x2={cx+6} y2={-14} stroke="#333" strokeWidth="0.5" opacity="0.4"/>
    <rect x={cx-14} y={-12} width="28" height="3" fill="#ddd"/>
    {/* Markers */}
    {["#ff2200","#0022ff","#00aa00"].map((c,i)=>(
      <rect key={i} x={cx-12+i*5} y={-11} width="4" height="2} " fill={c} rx="0.5"/>
    ))}
  </g>;

  if (t === "cscreen") return <g>
    <rect x={cx-16} y={-44} width="32" height="24} " rx="1.5" fill="#04040e" stroke={brd} strokeWidth="0.8"/>
    <rect x={cx-15} y={-43} width="30" height="22" fill="#06081e"/>
    <rect x={cx-13} y={-41} width="9" height="2" fill="#0088ff" opacity="0.8"/>
    <rect x={cx-13} y={-37} width="20" height="2" fill="#00ff88" opacity="0.6"/>
    <rect x={cx-13} y={-33} width="13" height="2" fill="#ff8844" opacity="0.5"/>
    <text x={cx} y={-23} textAnchor="middle" fontSize="4.5" fill={B} fontFamily="monospace">BROWSER</text>
  </g>;

  if (t === "coffee") return <g>
    <rect x={cx-8} y={-28} width="16" height="26} " rx="2" fill="#0c0c1c" stroke="#1a1a2a" strokeWidth="0.6"/>
    <rect x={cx-6} y={-26} width="12" height="10} " rx="1" fill="#080810"/>
    <rect x={cx-5} y={-25} width="10" height="4} " fill="#001200"/>
    <text x={cx} y={-22} textAnchor="middle" fontSize="3.5" fill="#00ff44" fontFamily="monospace">READY</text>
    <circle cx={cx-3} cy={-12} r="2" fill="#bb1100"/>
    <circle cx={cx+3} cy={-12} r="2" fill="#00aa33"/>
    <polygon points={`${cx-3},0 ${cx+3},0 ${cx+2},8 ${cx-2},8`} fill="#181818"/>
    <path d={`M${cx-2},-2 Q${cx-4},-6 ${cx-2},-10`} fill="none" stroke="#666" strokeWidth="0.7" opacity="0.7"/>
    <path d={`M${cx+2},-2 Q${cx+4},-6 ${cx+2},-10`} fill="none" stroke="#666" strokeWidth="0.7" opacity="0.7"/>
    <ellipse cx={cx} cy={0} rx="4" ry="1.5" fill="#0e0808"/>
  </g>;

  if (t === "counter") return <g>
    <polygon points={`${cx-10},-2 ${cx+10},-2 ${cx+12},10 ${cx-12},10`} fill="#141e14" stroke="#1e2e1e" strokeWidth="0.5"/>
    <polygon points={`${cx-10},-2 ${cx+10},-2 ${cx+10},-12 ${cx-10},-12`} fill="#1e2e1e" stroke="#283e28" strokeWidth="0.4"/>
    {/* Counter items */}
    <circle cx={cx-4} cy={-8} r="2" fill="#3a1a00" stroke="#5a2a00" strokeWidth="0.4"/>
    <circle cx={cx+4} cy={-8} r="1.5" fill="#1a3a1a"/>
  </g>;

  if (t === "microwave") return <g>
    <rect x={cx-10} y={-22} width="20" height="14} " rx="1" fill="#141414" stroke="#222" strokeWidth="0.5"/>
    <rect x={cx-8} y={-20} width="12" height="10} " rx="0.5" fill="#0a0a0a" stroke="#181818" strokeWidth="0.3"/>
    <circle cx={cx+7} cy={-15} r="3} " fill="#0e0e0e" stroke="#333" strokeWidth="0.4"/>
    <rect x={cx-8} y={-20} width="2" height="10} " fill="#0d0d0d"/>
  </g>;

  if (t === "island") return <g>
    <polygon points={`${cx-12},-2 ${cx+12},-2 ${cx+14},10 ${cx-14},10`} fill="#0e1a0e" stroke="#1a2a1a" strokeWidth="0.5"/>
    <polygon points={`${cx-12},-2 ${cx+12},-2 ${cx+12},-12 ${cx-12},-12`} fill="#162216" stroke="#223322" strokeWidth="0.4"/>
    {/* Cutting board + bowl */}
    <rect x={cx-8} y={-10} width="10" height="7} " rx="0.5" fill="#2a1a08" opacity="0.8"/>
    <ellipse cx={cx+6} cy={-8} rx="4" ry="2} " fill="#1a3a2a"/>
  </g>;

  if (t === "low_table") return <g>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+10},8 ${cx-10},8`} fill="#0e100e"/>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+6},-8 ${cx-6},-8`} fill="#121412"/>
  </g>;

  if (t === "fridge") return <g>
    <polygon points={`${cx-8},-2 ${cx+8},-2 ${cx+9},10 ${cx-9},10`} fill="#141e1e"/>
    <rect x={cx-7} y={-28} width="14" height="26} " rx="1" fill="#1a2424" stroke="#243434" strokeWidth="0.5"/>
    <line x1={cx-6} y1={-16} x2={cx+6} y2={-16} stroke="#243434" strokeWidth="0.5"/>
    <circle cx={cx+4} cy={-22} r="1" fill="#555"/>
    <circle cx={cx+4} cy={-10} r="1" fill="#555"/>
  </g>;

  if (t === "plant") return <g>
    <rect x={cx-4} y={0} width="8" height="9} " fill="#3a1e06"/>
    <ellipse cx={cx} cy={-6} rx="11" ry="8" fill="#104010"/>
    <ellipse cx={cx-4} cy={-10} rx="6" ry="5} " fill="#186018"/>
    <ellipse cx={cx+4} cy={-12} rx="5" ry="4} " fill="#20aa20" opacity="0.7"/>
  </g>;

  if (t === "divider") return <g>
    <rect x={cx-1} y={-30} width="2" height="40} " fill="#1a1a2a"/>
  </g>;

  return null;
}

// ═══════════════════════════════════════════════════════════
// PNJ SPRITE
// ═══════════════════════════════════════════════════════════
const SC = { working:"#44ff88", waiting:"#ffbb44", browsing:"#4488ff", idle:"#445566", walking:"#aaccff" };

function PNJ({ color, accent, status, frame, selected, isMilan }) {
  const isWalk = status === "walking";
  const bob = ["working","browsing"].includes(status) ? Math.sin(frame/7)*1.2 : 0;
  const lL = isWalk ? Math.sin(frame/4)*3 : 0;
  const lR = isWalk ? -Math.sin(frame/4)*3 : 0;
  const dot = SC[status] || "#555";
  const scale = isMilan ? 1.2 : 1;
  const cx = TW/2, cy = TH/2;

  return <g>
    {selected && <ellipse cx={cx} cy={cy+5} rx={20*scale} ry={10*scale} fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.9">
      <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy+5}`} to={`360 ${cx} ${cy+5}`} dur="3s" repeatCount="indefinite"/>
    </ellipse>}
    <g transform={`translate(${cx},${cy-14}) scale(${scale}) translate(0,${bob})`}>
      <ellipse cx={0} cy={26} rx={7} ry={2.5} fill="#000" opacity="0.3"/>
      <rect x={-4} y={13+lL} width={4} height={7} fill="#1a1a3a" rx="0.5"/>
      <rect x={1}  y={13+lR} width={4} height={7} fill="#1a1a3a" rx="0.5"/>
      <rect x={-5} y={20+lL} width={5} height={2.5} fill="#0a0a14" rx="0.5"/>
      <rect x={1}  y={20+lR} width={5} height={2.5} fill="#0a0a14" rx="0.5"/>
      <rect x={-6} y={5} width={12} height={10} fill={color} rx="1"/>
      <rect x={-2} y={5} width={4} height={3} fill={accent} opacity="0.4"/>
      <rect x={-9} y={6}  width={3} height={8} fill={color} rx="0.5"/>
      <rect x={6}  y={6}  width={3} height={8} fill={color} rx="0.5"/>
      <circle cx={-7} cy={14} r={2} fill="#ffcc99"/>
      <circle cx={7}  cy={14} r={2} fill="#ffcc99"/>
      <rect x={-5} y={-9} width={10} height={11} fill="#ffcc99" rx="1"/>
      <rect x={-5} y={-9} width={10} height={isMilan?5:4} fill={accent} rx="1"/>
      <rect x={-3} y={-5} width={2} height={2} fill="#111"/>
      <rect x={2}  y={-5} width={2} height={2} fill="#111"/>
      <rect x={-2} y={-1} width={4} height={1} fill="#cc8866" opacity="0.6"/>
      {isMilan && <text x={0} y={-14} textAnchor="middle" fontSize="5" fill="#ffaa44" fontFamily="monospace">👑</text>}
    </g>
    <circle cx={cx+11} cy={cy-26*scale} r={3} fill={dot} style={{filter:`drop-shadow(0 0 3px ${dot})`}}/>
  </g>;
}

// ═══════════════════════════════════════════════════════════
// AGENTS + QUESTS
// ═══════════════════════════════════════════════════════════
const AGENT_META = {
  "👑 MILAN":     { color:"#8a5000", accent:"#ffaa44", xpMax:9999, startC:2, startR:4, isMilan:true },
  "🧠 STRATÈGE":  { color:"#b06018", accent:"#ffaa44", xpMax:2000, startC:9, startR:2 },
  "🎯 CHASSEUR":  { color:"#aa2020", accent:"#ff6655", xpMax:1800, startC:12,startR:2 },
  "⭐ TALENT":    { color:"#1a44aa", accent:"#5588ff", xpMax:1600, startC:21,startR:13 },
  "🎬 CRÉATIF":   { color:"#6611aa", accent:"#aa55ff", xpMax:1700, startC:12,startR:6 },
  "📋 ADMIN":     { color:"#0f6e28", accent:"#33cc66", xpMax:1500, startC:15,startR:4 },
};

const ZONE_SLOTS = {
  milan:         [{c:2,r:4},{c:3,r:5},{c:1,r:3}],
  bureau:        [{c:9,r:2},{c:12,r:2},{c:9,r:6},{c:12,r:6},{c:15,r:4}],
  salle_reunion: [{c:21,r:4},{c:23,r:4},{c:21,r:6},{c:23,r:6}],
  cuisine:       [{c:21,r:12},{c:23,r:12},{c:21,r:15},{c:23,r:15}],
  couloir:       [{c:18,r:4},{c:18,r:8},{c:18,r:12}],
  couloir2:      [{c:12,r:12},{c:14,r:12}],
};

const INIT_AGENTS = [
  { id:"m0", name:"👑 MILAN", room:"milan", status:"idle", c:2, r:4, xp:5000,
    mission:"Superviser tous les agents", context:"Vue d'ensemble du bureau", lastAction:"Check morning", nextStep:"Valider brief La Table Hiving", blockedOn:"", priority:"👑 CEO", message:"Watching the game 🏌️" },
  { id:"s1", name:"🧠 STRATÈGE", room:"bureau", status:"idle", c:9, r:2, xp:680,
    mission:"Roadmap Q2 Hiving Food", context:"Définir les deals Q2, talents, offres produit", lastAction:"Analyse pipeline marques", nextStep:"Rédiger roadmap Q2 chiffrée", blockedOn:"Rien — peut démarrer", priority:"🟠 High", message:"Roadmap Q2 en cours 🗺️" },
  { id:"c1", name:"🎯 CHASSEUR", room:"bureau", status:"working", c:12, r:2, xp:920,
    mission:"Closer Elle & Vire + RDV LCL", context:"Elle & Vire 2 semaines. LCL chaud semaine 14.", lastAction:"Relance email Elle & Vire", nextStep:"Appel LCL + follow-up E&V 48h", blockedOn:"Attente retour Elle & Vire", priority:"🔴 Urgent", message:"LCL chaud → RDV sem. 14 🔥" },
  { id:"t1", name:"⭐ TALENT", room:"cuisine", status:"waiting", c:21, r:12, xp:430,
    mission:"Jules → Samsung + Vincent avril", context:"Jules pitch Samsung, Vincent 2 slots avril, Peppe Reel 60s", lastAction:"Confirmation dispos Vincent", nextStep:"Dossier Jules pitch Samsung", blockedOn:"Confirmation Jules dispo", priority:"🟠 High", message:"En attente Milan ☕" },
  { id:"r1", name:"🎬 CRÉATIF", room:"bureau", status:"working", c:12, r:6, xp:760,
    mission:"Brief La Table Hiving 80%", context:"Brief à 80%. One-pager Hiving Food demandé.", lastAction:"Draft brief La Table Hiving", nextStep:"Finaliser brief + one-pager", blockedOn:"Validation angle créatif", priority:"🔴 Urgent", message:"Draft 80% terminé ✍️" },
  { id:"a1", name:"📋 ADMIN", room:"bureau", status:"idle", c:15, r:4, xp:380,
    mission:"Devis Elle & Vire dès validation", context:"Stand-by CRÉATIF. Templates OK.", lastAction:"Vérif templates contrats", nextStep:"Devis E&V dès signal CRÉATIF", blockedOn:"Brief pas encore validé", priority:"🟡 Normal", message:"Prêt à générer devis 📄" },
];

const INIT_QUESTS = [
  { id:"q1", name:"🔥 Closer Elle & Vire",   ag:"🎯 CHASSEUR", type:"URGENT", xp:500, st:"en cours", dl:"05/04", desc:"Obtenir accord ou RDV", notionId:"332df40d942981178badcf71b4433362" },
  { id:"q2", name:"📞 RDV LCL confirmé",      ag:"🎯 CHASSEUR", type:"URGENT", xp:300, st:"en cours", dl:"07/04", desc:"Booker RDV semaine 14",  notionId:"332df40d942981178badcf71b4433362" },
  { id:"q3", name:"✍️ Brief La Table Hiving", ag:"🎬 CRÉATIF",  type:"MAIN",   xp:400, st:"en cours", dl:"03/04", desc:"Finaliser brief event",  notionId:"332df40d942981ad8970ddb157f8273c" },
  { id:"q4", name:"⭐ Jules → Samsung",        ag:"⭐ TALENT",   type:"MAIN",   xp:450, st:"à faire",  dl:"10/04", desc:"Dossier talent Jules",   notionId:"332df40d94298192b53dc3b7e52b2b2a" },
  { id:"q5", name:"💰 Devis Elle & Vire",      ag:"📋 ADMIN",   type:"SIDE",   xp:200, st:"à faire",  dl:"06/04", desc:"Devis post-validation",  notionId:"332df40d94298178aba5d580a3ed75f7" },
  { id:"q6", name:"🎬 Reel 60s Peppe",         ag:"🎬 CRÉATIF",  type:"SIDE",   xp:250, st:"à faire",  dl:"12/04", desc:"Brief format Reel 60s",  notionId:"332df40d942981ad8970ddb157f8273c" },
  { id:"q7", name:"🗺️ Roadmap Q2",             ag:"🧠 STRATÈGE", type:"MAIN",   xp:600, st:"à faire",  dl:"15/04", desc:"Roadmap Q2 complète",    notionId:"332df40d9429818bb22fc06fa7008757" },
  { id:"q8", name:"📧 Outreach x20",           ag:"🎯 CHASSEUR", type:"DAILY",  xp:100, st:"à faire",  dl:"30/03", desc:"20 emails Instantly",    notionId:"332df40d942981178badcf71b4433362" },
];

const QC = { URGENT:"#ff4444", MAIN:"#ffcc00", SIDE:"#4488ff", DAILY:"#44ff88" };
const PRIO_C = { "🔴 Urgent":"#ff4444","🟠 High":"#ff8844","🟡 Normal":"#ffcc44","🟢 Low":"#44ff88","👑 CEO":"#c8762e" };

// ═══════════════════════════════════════════════════════════
// NOTION UPDATE — called on quest complete
// ═══════════════════════════════════════════════════════════
async function notifyAgentQuestComplete(quest, agents) {
  try {
    const agent = agents.find(a => a.name === quest.ag);
    await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: "Réponds uniquement {\"ok\":true}",
        messages: [{
          role: "user",
          content: `Quête complétée par ${quest.ag}: "${quest.name}". Agent next step: "${agent?.nextStep}". Confirme.`
        }],
        mcp_servers: [{ type:"url", url:"https://mcp.notion.com/mcp", name:"notion-mcp" }]
      })
    });
  } catch(e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [agents, setAgents] = useState(INIT_AGENTS);
  const [quests, setQuests] = useState(INIT_QUESTS);
  const [paths, setPaths] = useState({});
  const [frame, setFrame] = useState(0);
  const [totalXp, setTotalXp] = useState(3170);
  const [prevLevel, setPrevLevel] = useState(4);
  const [showLU, setShowLU] = useState(false);
  const [xpPops, setXpPops] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [missionAgent, setMissionAgent] = useState(null);
  const [hudOpen, setHudOpen] = useState(false); // closed by default on mobile
  const [hudTab, setHudTab] = useState("agents");
  const [cam, setCam] = useState({ x: 20, y: 20 });
  const [drag, setDrag] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [scale, setScale] = useState(1);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [updatingNotion, setUpdatingNotion] = useState(false);
  const isWalkRef = useRef(null);

  // Build walkability once
  useEffect(() => { isWalkRef.current = buildWalkCache(FURN); }, []);

  // Detect mobile
  const isMobile = window.innerWidth < 700;
  useEffect(() => {
    const s = isMobile ? 0.65 : 1;
    setScale(s);
    setCam({ x: isMobile ? -100 : 20, y: isMobile ? -20 : 20 });
  }, []);

  const addNotif = useCallback((msg, color="#c8762e") => {
    const id = Date.now()+Math.random();
    setNotifs(n=>[...n,{id,msg,color}]);
    setTimeout(()=>setNotifs(n=>n.filter(x=>x.id!==id)),3000);
  },[]);

  // Anim loop
  useEffect(()=>{
    const iv=setInterval(()=>{
      setFrame(f=>f+1);
      setAgents(prev=>prev.map(agent=>{
        const p=paths[agent.id];
        if(!p||p.length<2) return agent;
        const next=p[1], np=p.slice(1);
        setPaths(pp=>({...pp,[agent.id]:np}));
        const zone=getZone(next.c,next.r)||agent.room;
        const status=np.length>1?"walking":zone==="cuisine"?"waiting":zone==="salle_reunion"?"browsing":zone==="milan"?"idle":(agent._prevStatus||"idle");
        return {...agent,c:next.c,r:next.r,room:zone,status};
      }));
    },170);
    return ()=>clearInterval(iv);
  },[paths]);

  // Idle movement
  useEffect(()=>{
    const iv=setInterval(()=>{
      if(!isWalkRef.current) return;
      setAgents(prev=>prev.map(agent=>{
        if(agent.name==="👑 MILAN") return agent; // Milan stays put
        if((paths[agent.id]?.length||0)>1) return agent;
        if(Math.random()>0.28) return agent;
        const z=ZONES[agent.room]; if(!z) return agent;
        for(let i=0;i<15;i++){
          const tc=z.c1+Math.floor(Math.random()*(z.c2-z.c1+1));
          const tr=z.r1+Math.floor(Math.random()*(z.r2-z.r1+1));
          if(isWalkRef.current(tc,tr)&&!(tc===agent.c&&tr===agent.r)){
            const p=aStar(isWalkRef.current,{c:agent.c,r:agent.r},{c:tc,r:tr});
            if(p.length>1){setPaths(pp=>({...pp,[agent.id]:p}));return{...agent,_prevStatus:agent.status};}
          }
        }
        return agent;
      }));
    },2600);
    return ()=>clearInterval(iv);
  },[paths]);

  // Complete quest → XP + update agents + notify Notion
  const completeQuest = useCallback(async (q, e) => {
    setQuests(prev=>prev.map(x=>x.id===q.id?{...x,st:"complétée"}:x));
    const newXp=totalXp+q.xp;
    setTotalXp(newXp);
    setCompletedTasks(t=>t+1);

    // Update agent xp + nextStep
    setAgents(prev=>prev.map(a=>{
      if(a.name!==q.ag) return a;
      const updatedNextStep = `[✓ ${q.name}] → ${a.nextStep}`;
      return {...a, xp:a.xp+q.xp, lastAction:`Complété: ${q.name}`, nextStep:updatedNextStep};
    }));

    const lv=Math.floor(newXp/1000)+1;
    if(lv>prevLevel){setPrevLevel(lv);setShowLU(true);setTimeout(()=>setShowLU(false),3000);}

    const rect=e?.target?.getBoundingClientRect();
    const px=rect?rect.x+rect.width/2:window.innerWidth/2;
    const py=rect?rect.y:window.innerHeight/2;
    const pid=Date.now();
    setXpPops(pp=>[...pp,{id:pid,x:px-24,y:py-20,xp:q.xp}]);
    setTimeout(()=>setXpPops(pp=>pp.filter(p=>p.id!==pid)),1600);

    addNotif(`⚔️ ${q.name} +${q.xp} XP → Notion notifié`,"#44ff88");

    // Notify Notion silently
    setUpdatingNotion(true);
    const currentAgents = INIT_AGENTS; // use ref for latest
    await notifyAgentQuestComplete(q, agents);
    setUpdatingNotion(false);
  },[totalXp,prevLevel,addNotif,agents]);

  const moveToZone = useCallback((agent, zone) => {
    if(!isWalkRef.current) return;
    const slots=ZONE_SLOTS[zone]||[];
    for(const slot of slots){
      if(isWalkRef.current(slot.c,slot.r)){
        const p=aStar(isWalkRef.current,{c:agent.c,r:agent.r},{c:slot.c,r:slot.r});
        if(p.length>1){
          setPaths(pp=>({...pp,[agent.id]:p}));
          const ps=zone==="cuisine"?"waiting":zone==="salle_reunion"?"browsing":"working";
          setAgents(prev=>prev.map(a=>a.id===agent.id?{...a,_prevStatus:ps}:a));
          addNotif(`${agent.name.split(" ")[0]} → ${ZONES[zone]?.icon} ${ZONES[zone]?.label}`);
          return;
        }
      }
    }
  },[addNotif]);

  const onTouchStart = e => { const t=e.touches[0]; setDrag({sx:t.clientX-cam.x,sy:t.clientY-cam.y}); };
  const onTouchMove  = e => { if(!drag) return; const t=e.touches[0]; setCam({x:t.clientX-drag.sx,y:t.clientY-drag.sy}); };
  const onMouseDown  = e => { if(!e.target.dataset.nopan) setDrag({sx:e.clientX-cam.x,sy:e.clientY-cam.y}); };
  const onMouseMove  = e => { if(drag) setCam({x:e.clientX-drag.sx,y:e.clientY-drag.sy}); };
  const onUp = () => setDrag(null);

  // Render
  const tiles=[], sfurn=[], sagents=[];
  for(let r=0;r<MAP_H;r++) for(let c=0;c<MAP_W;c++){
    const z=getZone(c,r); if(z) tiles.push({c,r,z});
  }
  tiles.sort((a,b)=>(a.c+a.r)-(b.c+b.r));
  FURN.slice().sort((a,b)=>(a.c+a.r)-(b.c+b.r)).forEach(f=>sfurn.push(f));
  agents.slice().sort((a,b)=>(a.c+a.r)-(b.c+b.r)).forEach(a=>sagents.push(a));

  const originX=MAP_H*(TW/2)+60, originY=60;
  const svgW=(MAP_W+MAP_H)*(TW/2)+160, svgH=(MAP_W+MAP_H)*(TH/2)+160;
  const level=Math.floor(totalXp/1000)+1;
  const xpInLevel=totalXp%(1000);
  const activeQ=quests.filter(q=>q.st!=="complétée");
  const urgentQ=activeQ.filter(q=>q.type==="URGENT");

  return (
    <div style={{width:"100vw",height:"100vh",background:"#020208",fontFamily:"monospace",display:"flex",flexDirection:"column",overflow:"hidden",userSelect:"none"}}>

      {/* TOP BAR */}
      <div style={{padding:"5px 12px",background:"#03030a",borderBottom:"1px solid #0c0c18",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#44ff88",boxShadow:"0 0 6px #44ff88"}}/>
          <span style={{fontSize:7,letterSpacing:3,color:"#c8762e"}}>HIVING</span>
          <span style={{fontSize:10,fontWeight:"bold",letterSpacing:2,color:"#eee"}}>OFFICE</span>
        </div>
        {/* XP bar */}
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,maxWidth:280,margin:"0 10px"}}>
          <div style={{fontSize:8,color:"#ffcc44",whiteSpace:"nowrap"}}>LVL {level}</div>
          <div style={{flex:1,height:5,background:"#0a0a14",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${xpInLevel/10}%`,background:"linear-gradient(90deg,#c8a840,#ffe880)",transition:"width .4s ease"}}/>
          </div>
          <div style={{fontSize:7,color:"#444",whiteSpace:"nowrap"}}>{totalXp.toLocaleString()}</div>
          {urgentQ.length>0 && <div style={{fontSize:7,color:"#ff4444",animation:"blink .7s infinite alternate"}}>⚠{urgentQ.length}</div>}
          {updatingNotion && <div style={{fontSize:6,color:"#44ff88",animation:"blink .4s infinite alternate"}}>N↑</div>}
        </div>
        <div style={{display:"flex",gap:5}}>
          {/* Zoom controls for mobile */}
          <button onClick={()=>setScale(s=>Math.max(0.4,s-0.1))} data-nopan="true" style={{padding:"3px 7px",background:"transparent",border:"1px solid #1a1a28",color:"#444",fontSize:10,cursor:"pointer",fontFamily:"monospace"}}>−</button>
          <button onClick={()=>setScale(s=>Math.min(1.4,s+0.1))} data-nopan="true" style={{padding:"3px 7px",background:"transparent",border:"1px solid #1a1a28",color:"#444",fontSize:10,cursor:"pointer",fontFamily:"monospace"}}>+</button>
          <button onClick={()=>setHudOpen(o=>!o)} data-nopan="true" style={{padding:"3px 10px",background:hudOpen?"#0e0e1e":"transparent",border:`1px solid ${hudOpen?"#2a2a44":"#111118"}`,color:hudOpen?"#8888cc":"#444",fontSize:7,cursor:"pointer",fontFamily:"monospace",transition:"all .2s"}}>
            {hudOpen?"✕ HUD":"☰ HUD"}
          </button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>

        {/* MAP */}
        <div style={{flex:1,overflow:"hidden",cursor:drag?"grabbing":"grab",position:"relative",touchAction:"none"}}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onUp}>

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
                    fill={isDoor?`${zone.border}44`:even?zone.color:zone.dark}
                    stroke={`${zone.border}${isDoor?"88":"28"}`} strokeWidth={isDoor?1:0.4}/>
                  <polygon points={`0,${TH/2} ${TW/2},${TH} ${TW/2},${TH+7} 0,${TH/2+7}`} fill={`${zone.dark}cc`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                  <polygon points={`${TW/2},${TH} ${TW},${TH/2} ${TW},${TH/2+7} ${TW/2},${TH+7}`} fill={`${zone.dark}88`} stroke={`${zone.border}12`} strokeWidth="0.3"/>
                  {isDoor&&<polygon points={`${TW/2},2 ${TW-2},${TH/2} ${TW/2},${TH-2} 2,${TH/2}`} fill={zone.accent} opacity="0.1"/>}
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
                    <rect x={TW/2-50} y={TH/2-72} width="100" height="18" rx="3" fill="#08080e" stroke={meta.accent} strokeWidth="0.7" opacity="0.95"/>
                    <polygon points={`${TW/2-4},${TH/2-54} ${TW/2+4},${TH/2-54} ${TW/2},${TH/2-48}`} fill={meta.accent}/>
                    <text x={TW/2} y={TH/2-60} textAnchor="middle" fontSize="6" fill="#ccc" fontFamily="monospace">{agent.message.slice(0,22)}</text>
                  </g>}
                  <PNJ color={meta.color} accent={meta.accent}
                    status={isWalking?"walking":agent.status}
                    frame={frame+agent.id.charCodeAt(0)*11}
                    selected={isSel} isMilan={meta.isMilan}/>
                  <text x={TW/2} y={TH/2+22} textAnchor="middle" fontSize="5.5" fill={meta.accent} fontFamily="monospace"
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
              <div key={n.id} style={{background:"#06060e",border:`1px solid ${n.color}`,color:n.color,padding:"5px 14px",fontSize:8,borderRadius:2,boxShadow:`0 4px 16px ${n.color}33`,whiteSpace:"nowrap",animation:"slideIn .3s ease"}}>{n.msg}</div>
            ))}
          </div>

          {/* Mini-map */}
          <div style={{position:"absolute",bottom:10,left:10,background:"#03030a",border:"1px solid #0e0e1e",padding:6,zIndex:20,borderRadius:2}}>
            <svg width={80} height={60}>
              {Object.entries(ZONES).map(([k,z])=>(
                <rect key={k} x={z.c1/MAP_W*78} y={z.r1/MAP_H*58} width={(z.c2-z.c1)/MAP_W*78} height={(z.r2-z.r1)/MAP_H*58} fill={z.color} stroke={z.border} strokeWidth="0.6" opacity="0.85"/>
              ))}
              {agents.map(a=>{
                const m=AGENT_META[a.name]||{};
                return <circle key={a.id} cx={a.c/MAP_W*78} cy={a.r/MAP_H*58} r={m.isMilan?3:2} fill={m.accent||"#fff"} opacity="0.9"/>;
              })}
            </svg>
          </div>

          {/* Selected agent quick panel */}
          {selectedAgent&&(()=>{
            const meta=AGENT_META[selectedAgent.name]||{};
            return <div data-nopan="true" style={{position:"absolute",left:10,top:10,width:200,background:"#05050e",border:`1px solid ${meta.accent}44`,boxShadow:`0 0 16px ${meta.color}22`,zIndex:30,borderRadius:3}}>
              <div style={{padding:"7px 10px 5px",borderBottom:`1px solid ${meta.color}22`,display:"flex",justifyContent:"space-between"}}>
                <div style={{fontSize:8,color:meta.accent}}>{selectedAgent.name}</div>
                <button onClick={()=>setSelectedAgent(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:13}}>✕</button>
              </div>
              <div style={{padding:"7px 10px"}}>
                <div style={{fontSize:7,color:"#3a4a5a",marginBottom:4}}>{selectedAgent.mission}</div>
                <div style={{fontSize:7,color:"#2a3a2a",marginBottom:8}}>→ {selectedAgent.nextStep?.slice(0,36)}...</div>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>{setMissionAgent(selectedAgent);setSelectedAgent(null);}} data-nopan="true" style={{flex:1,padding:"4px",background:"transparent",border:`1px solid ${meta.color}44`,color:meta.accent,fontSize:7,cursor:"pointer",fontFamily:"monospace"}}>📋 MISSION</button>
                  <button onClick={()=>{setSelectedAgent(null);if(!hudOpen)setHudOpen(true);setHudTab("move");}} data-nopan="true" style={{flex:1,padding:"4px",background:"transparent",border:"1px solid #1a1a2e",color:"#444",fontSize:7,cursor:"pointer",fontFamily:"monospace"}}>🚶 MOVE</button>
                </div>
              </div>
            </div>;
          })()}
        </div>

        {/* HUD PANEL */}
        <div style={{
          position:"absolute",right:0,top:0,bottom:0,
          width:hudOpen?260:0,
          overflow:"hidden",
          transition:"width .3s cubic-bezier(.4,0,.2,1)",
          background:"#03030a",borderLeft:"1px solid #0c0c18",
          display:"flex",flexDirection:"column",
          flexShrink:0,zIndex:50
        }}>
          <div style={{display:"flex",borderBottom:"1px solid #0c0c18",flexShrink:0}}>
            {[["agents","👥"],["quetes","⚔️"],["move","🚶"]].map(([t,ico])=>(
              <button key={t} onClick={()=>setHudTab(t)} data-nopan="true" style={{
                flex:1,padding:"8px 2px",background:hudTab===t?"#0a0a14":"transparent",
                border:"none",borderBottom:hudTab===t?"2px solid #c8762e":"2px solid transparent",
                color:hudTab===t?"#c8762e":"#2a2a3a",fontSize:8,cursor:"pointer",fontFamily:"monospace"
              }}>{ico}</button>
            ))}
          </div>

          <div style={{flex:1,overflowY:"auto"}}>
            {/* AGENTS */}
            {hudTab==="agents"&&(
              <div style={{padding:"8px 10px"}}>
                <div style={{display:"flex",gap:6,marginBottom:10,padding:"7px",background:"#07070e",border:"1px solid #0c0c18",borderRadius:2}}>
                  {[["LVL",level,"#ffcc44"],["✓",completedTasks,"#44ff88"],["⚔️",activeQ.length,"#4488ff"]].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center",flex:1}}>
                      <div style={{fontSize:13,color:c,fontWeight:"bold"}}>{v}</div>
                      <div style={{fontSize:6,color:"#333"}}>{l}</div>
                    </div>
                  ))}
                </div>
                {agents.map(agent=>{
                  const meta=AGENT_META[agent.name]||{};
                  const isWalk=(paths[agent.id]?.length||0)>1;
                  const st=isWalk?"walking":agent.status;
                  return <div key={agent.id} onClick={()=>setMissionAgent(agent)} data-nopan="true" style={{
                    marginBottom:7,padding:"7px 9px",background:"#05050e",
                    border:`1px solid ${meta.color}22`,borderLeft:`3px solid ${meta.color}`,
                    borderRadius:2,cursor:"pointer"
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${meta.color}11`}
                    onMouseLeave={e=>e.currentTarget.style.background="#05050e"}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:SC[st]||"#555",boxShadow:`0 0 4px ${SC[st]}`}}/>
                      <div style={{fontSize:8,color:meta.accent,fontWeight:"bold",flex:1}}>{agent.name}</div>
                      <div style={{fontSize:7,color:"#ffcc44"}}>{agent.xp}</div>
                    </div>
                    <div style={{fontSize:6,color:"#3a4a5a",marginBottom:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{agent.mission}</div>
                    <div style={{height:2,background:"#08080e",borderRadius:1,overflow:"hidden",marginTop:4}}>
                      <div style={{height:"100%",width:`${(agent.xp/(meta.xpMax||2000))*100}%`,background:meta.color}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                      <div style={{fontSize:5,color:ZONES[agent.room]?.accent||"#333"}}>{ZONES[agent.room]?.icon} {ZONES[agent.room]?.label}</div>
                      <div style={{fontSize:5,color:PRIO_C[agent.priority]||"#555"}}>{agent.priority}</div>
                    </div>
                  </div>;
                })}
              </div>
            )}

            {/* QUÊTES */}
            {hudTab==="quetes"&&(
              <div style={{padding:"8px 10px"}}>
                {["URGENT","MAIN","SIDE","DAILY"].map(type=>{
                  const list=quests.filter(q=>q.type===type&&q.st!=="complétée");
                  if(!list.length) return null;
                  return <div key={type} style={{marginBottom:10}}>
                    <div style={{fontSize:7,letterSpacing:2,color:QC[type],marginBottom:5,display:"flex",alignItems:"center",gap:4}}>
                      <div style={{flex:1,height:1,background:`${QC[type]}33`}}/>{type}({list.length})<div style={{flex:1,height:1,background:`${QC[type]}33`}}/>
                    </div>
                    {list.map(q=>(
                      <div key={q.id} style={{marginBottom:5,padding:"7px 8px",background:"#05050e",border:`1px solid ${q.type==="URGENT"?"#ff444422":"#0c0c18"}`,borderLeft:`3px solid ${QC[q.type]}`,borderRadius:2}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <div style={{fontSize:8,color:"#ccc",flex:1,paddingRight:4}}>{q.name}</div>
                          <div style={{fontSize:8,color:"#ffcc44",flexShrink:0}}>+{q.xp}</div>
                        </div>
                        <div style={{fontSize:6,color:"#3a3a4a",marginBottom:4}}>{q.desc} · ⏱{q.dl}</div>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <span style={{fontSize:6,color:QC[q.type],border:`1px solid ${QC[q.type]}44`,padding:"0 3px"}}>{q.type}</span>
                          <span style={{fontSize:6,color:"#333",flex:1}}>{q.ag.split(" ")[0]}</span>
                          {q.st==="en cours"&&(
                            <button onClick={e=>completeQuest(q,e)} data-nopan="true" style={{
                              padding:"2px 7px",background:"#03100a",border:"1px solid #44ff88",
                              color:"#44ff88",fontSize:6,cursor:"pointer",fontFamily:"monospace"
                            }}>✓ DONE</button>
                          )}
                          {q.st==="à faire"&&(
                            <button onClick={e=>{setQuests(prev=>prev.map(x=>x.id===q.id?{...x,st:"en cours"}:x));addNotif(`${q.name} démarrée`,"#4488ff");}} data-nopan="true" style={{
                              padding:"2px 7px",background:"transparent",border:"1px solid #4488ff55",
                              color:"#4488ff",fontSize:6,cursor:"pointer",fontFamily:"monospace"
                            }}>▶ START</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>;
                })}
                {activeQ.length===0&&<div style={{textAlign:"center",padding:20}}><div style={{fontSize:18,color:"#ffcc44"}}>★★★</div><div style={{fontSize:7,color:"#333",marginTop:4}}>ALL CLEAR</div></div>}
              </div>
            )}

            {/* MOVE */}
            {hudTab==="move"&&(
              <div style={{padding:"8px 10px"}}>
                <div style={{fontSize:7,color:"#222233",letterSpacing:2,marginBottom:8}}>DÉPLACER</div>
                {agents.filter(a=>a.name!=="👑 MILAN").map(a=>{
                  const m=AGENT_META[a.name]||{};
                  return <div key={a.id} style={{marginBottom:8,padding:"7px 9px",background:"#05050e",border:`1px solid ${m.color}22`,borderLeft:`3px solid ${m.color}`,borderRadius:2}}>
                    <div style={{fontSize:8,color:m.accent,marginBottom:5}}>{a.name}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                      {Object.entries(ZONES).filter(([k])=>!k.startsWith("couloir")).map(([k,z])=>(
                        <button key={k} onClick={()=>moveToZone(a,k)} data-nopan="true" style={{
                          padding:"5px 3px",background:a.room===k?`${z.border}22`:"transparent",
                          border:`1px solid ${a.room===k?z.border:"#0c0c18"}`,
                          color:a.room===k?z.accent:"#333",
                          fontSize:6,cursor:"pointer",fontFamily:"monospace",
                          display:"flex",alignItems:"center",gap:3,justifyContent:"center"
                        }}>
                          {z.icon}<span style={{fontSize:5}}>{z.label.slice(0,8)}</span>
                          {a.room===k&&<span style={{fontSize:5,opacity:.6}}>●</span>}
                        </button>
                      ))}
                    </div>
                  </div>;
                })}
              </div>
            )}
          </div>

          {/* Notion links */}
          <div style={{padding:"7px 10px",borderTop:"1px solid #0a0a14",flexShrink:0}}>
            <div style={{display:"flex",gap:6,justifyContent:"center"}}>
              {[["📋","https://www.notion.so/c843853b732e443b9c3c6c712b95d7d5"],
                ["⚔️","https://www.notion.so/174b14e559dc49a0ae63f2f9f626a126"],
                ["🤖","https://www.notion.so/332df40d942981e893b6fc9febe96a36"]].map(([ico,url])=>(
                <a key={ico} href={url} target="_blank" rel="noreferrer" data-nopan="true"
                  style={{fontSize:14,opacity:0.4,textDecoration:"none",transition:"opacity .2s"}}
                  onMouseEnter={e=>e.currentTarget.style.opacity=1}
                  onMouseLeave={e=>e.currentTarget.style.opacity=0.4}>{ico}</a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MISSION CARD */}
      {missionAgent&&(()=>{
        const meta=AGENT_META[missionAgent.name]||{};
        const pc=PRIO_C[missionAgent.priority]||"#888";
        return <div data-nopan="true" style={{
          position:"fixed",left:"50%",top:"50%",transform:"translate(-50%,-50%)",
          width:Math.min(340,window.innerWidth-20),background:"#05050e",
          border:`2px solid ${meta.accent}`,
          boxShadow:`0 0 40px ${meta.color}44`,
          zIndex:400,fontFamily:"monospace",borderRadius:4,
          animation:"cardIn .25s ease"
        }}>
          <div style={{padding:"11px 14px 9px",background:`linear-gradient(135deg,${meta.color}22,transparent)`,borderBottom:`1px solid ${meta.color}33`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:7,letterSpacing:3,color:meta.accent,marginBottom:2}}>{missionAgent.name}</div>
              <div style={{fontSize:11,fontWeight:"bold",color:"#eee",lineHeight:1.3}}>{missionAgent.mission}</div>
            </div>
            <div style={{display:"flex",gap:5,alignItems:"flex-start"}}>
              <div style={{fontSize:6,color:pc,border:`1px solid ${pc}44`,padding:"1px 5px",whiteSpace:"nowrap"}}>{missionAgent.priority}</div>
              <button onClick={()=>setMissionAgent(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:16,lineHeight:1,padding:0}}>✕</button>
            </div>
          </div>
          <div style={{padding:"11px 14px"}}>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:6,letterSpacing:2,color:"#333",marginBottom:4}}>CONTEXTE</div>
              <div style={{fontSize:8,color:"#778",lineHeight:1.7,background:"#08080e",padding:"7px 9px",borderLeft:`2px solid ${meta.color}44`}}>{missionAgent.context}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
              <div>
                <div style={{fontSize:6,letterSpacing:2,color:"#333",marginBottom:3}}>DERNIÈRE ACTION</div>
                <div style={{fontSize:7,color:"#446",background:"#07070e",padding:"5px 7px",borderRadius:2}}>✓ {missionAgent.lastAction}</div>
              </div>
              <div>
                <div style={{fontSize:6,letterSpacing:2,color:"#333",marginBottom:3}}>PROCHAINE ÉTAPE</div>
                <div style={{fontSize:7,color:"#484",background:"#030d06",padding:"5px 7px",borderRadius:2}}>→ {missionAgent.nextStep?.slice(0,50)}</div>
              </div>
            </div>
            {missionAgent.blockedOn&&missionAgent.blockedOn!=="Rien — peut démarrer"&&missionAgent.blockedOn!==""&&(
              <div style={{marginBottom:10}}>
                <div style={{fontSize:6,letterSpacing:2,color:"#ff4444",marginBottom:3}}>⚠ BLOQUÉ</div>
                <div style={{fontSize:7,color:"#ff6644",background:"#150303",padding:"5px 7px",border:"1px solid #ff444420",borderRadius:2}}>{missionAgent.blockedOn}</div>
              </div>
            )}
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontSize:6,letterSpacing:2,color:"#333"}}>XP</div>
                <div style={{fontSize:6,color:"#ffcc44"}}>{missionAgent.xp}/{AGENT_META[missionAgent.name]?.xpMax}</div>
              </div>
              <div style={{height:3,background:"#09090e",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${(missionAgent.xp/(AGENT_META[missionAgent.name]?.xpMax||2000))*100}%`,background:`linear-gradient(90deg,${meta.color},${meta.accent})`,borderRadius:2}}/>
              </div>
            </div>
          </div>
          <div style={{padding:"7px 14px",borderTop:`1px solid ${meta.color}22`,display:"flex",gap:8}}>
            <a href="https://www.notion.so/c843853b732e443b9c3c6c712b95d7d5" target="_blank" rel="noreferrer" style={{fontSize:7,color:"#1a1a3a",textDecoration:"none"}}>📋 Missions</a>
            <a href="https://www.notion.so/174b14e559dc49a0ae63f2f9f626a126" target="_blank" rel="noreferrer" style={{fontSize:7,color:"#1a1a3a",textDecoration:"none"}}>⚔️ Quêtes</a>
            <button onClick={()=>{setMissionAgent(null);setHudTab("quetes");if(!hudOpen)setHudOpen(true);}} data-nopan="true" style={{marginLeft:"auto",fontSize:7,color:"#c8762e",background:"transparent",border:"none",cursor:"pointer",fontFamily:"monospace"}}>voir quêtes →</button>
          </div>
        </div>;
      })()}

      {/* LEVEL UP */}
      {showLU&&<div style={{position:"fixed",top:"18%",left:"50%",transform:"translate(-50%,-50%)",background:"#050410",border:"2px solid #ffcc00",boxShadow:"0 0 40px #ffcc0044",padding:"16px 36px",zIndex:600,fontFamily:"monospace",textAlign:"center",animation:"levelPop .5s ease"}}>
        <div style={{fontSize:8,letterSpacing:4,color:"#ffcc00",marginBottom:3}}>NIVEAU SUPÉRIEUR</div>
        <div style={{fontSize:26,fontWeight:"bold",color:"#ffe880"}}>LVL {level}</div>
        <div style={{fontSize:7,color:"#888",marginTop:3}}>Milan Marinkovic · Directeur</div>
      </div>}

      {/* XP pops */}
      <div style={{position:"fixed",left:0,top:0,pointerEvents:"none",zIndex:500}}>
        {xpPops.map(p=>(
          <div key={p.id} style={{position:"absolute",left:p.x,top:p.y,color:"#ffcc00",fontSize:13,fontWeight:"bold",fontFamily:"monospace",animation:"xpFloat 1.4s ease-out forwards",textShadow:"0 0 8px #ffaa00"}}>+{p.xp} XP</div>
        ))}
      </div>

      <style>{`
        @keyframes blink{from{opacity:.4}to{opacity:1}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes xpFloat{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-44px)}}
        @keyframes levelPop{from{opacity:0;transform:translate(-50%,-50%) scale(.7)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        @keyframes cardIn{from{opacity:0;transform:translate(-50%,-52%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#0c0c18}::-webkit-scrollbar-track{background:#03030a}
      `}</style>
    </div>
  );
}
