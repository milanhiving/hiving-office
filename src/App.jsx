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
  cuisine:       { c1:20, r1:9,  c2:25, r2:17, label:"Cuisine",        icon:"☕", color:"#060606", dark:"#040804", border:"#1a5a28", accent:"#33aa55", reason:"Attend Milan" },
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