/* Quiet Blade: game core. Needs global THREE (r149) and window.QB_LEVELS. */
(() => {
'use strict';
const TEST = /[?&]test/.test(location.search);
const DT = 1 / 60, D2R = Math.PI / 180, TAU = Math.PI * 2;
const C = {
  speed: 3.6, pr: 0.3, tdR: 1.0, tdCD: 0.3,
  walk: 1.5, run: 3.1, flee: 2.9, dash: 4.5, turn: 6,
  susNear: 0.25, susFar: 0.9, susDecay: 0.6,
  react: 0.35, shootEvery: 0.55, dmg: 12, hp: 100,
  radio: 8, lostTime: 3.5, lookTime: 2.5,
  throwRange: 9, throwSpeed: 18, blastR: 2.6, blastDmg: 60, noiseR: 9,
  crackTime: 2.5, ventTime: 0.45, plantDelay: 0.25, laserCD: 2, ammoAim: 0.55,
};
// Vision per kind: range in tiles, half-angle in degrees.
const KIND = {
  guard: { range: 6, half: 38 }, flash: { range: 9.5, half: 13 }, target: { range: 5, half: 40 },
  boss: { range: 6.5, half: 40 }, bodyguard: { range: 5.5, half: 34 },
};
const LEVELS = window.QB_LEVELS;
const HEROES = [
  { id: 'ink', name: 'Ink', price: 0, body: 0x2b2d42, legs: 0x1c1d2b, band: 0xff3b5c, skin: 0xf1c7a1 },
  { id: 'moth', name: 'Moth', price: 150, body: 0x8e8aa8, legs: 0x5f5b78, band: 0xe4ddff, skin: 0xe9bf98 },
  { id: 'ember', name: 'Ember', price: 250, body: 0xb3261e, legs: 0x5a1410, band: 0xffb000, skin: 0xd59b74 },
  { id: 'reed', name: 'Reed', price: 350, body: 0x55703b, legs: 0x334425, band: 0xf0dc84, skin: 0xc58c64 },
  { id: 'frost', name: 'Frost', price: 500, body: 0xeef3f7, legs: 0xb9c7d3, band: 0x3fa9ff, skin: 0xf3d2b5 },
  { id: 'dusk', name: 'Dusk', price: 700, body: 0x3a2c5a, legs: 0x241a3a, band: 0xff7ad9, skin: 0x9c6b4e },
];
const BLADES = [
  { id: 'tanto', name: 'Tanto', price: 0, len: 0.42, color: 0xd8dde3 },
  { id: 'kunai', name: 'Kunai', price: 120, len: 0.32, color: 0x8f99a4 },
  { id: 'katana', name: 'Katana', price: 300, len: 0.78, color: 0xf2f5f8 },
  { id: 'jade', name: 'Jade Edge', price: 450, len: 0.6, color: 0x3ddc97, glow: true },
  { id: 'sun', name: 'Sunsteel', price: 650, len: 0.7, color: 0xffc93c, glow: true },
];

// ---------- math ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;
const turnToward = (cur, want, step) => { const d = wrap(want - cur); return Math.abs(d) <= step ? cur + d : cur + Math.sign(d) * step; };
let seed = 1;
function rnd() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

// ---------- save ----------
const SAVE_KEY = 'quietblade.v1';
const S = Object.assign({ unlocked: 1, done: {}, coins: 0, heroes: ['ink'], blades: ['tanto'], hero: 'ink', blade: 'tanto' }, loadSave());
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: progress lasts this session only */ } }

// ---------- level parsing ----------
function parseLevel(def) {
  const rows = def.map, H = rows.length, Wd = rows[0].length;
  const L = { W: Wd, H, solid: new Uint8Array(Wd * H), block: new Uint8Array(Wd * H), start: { x: 1.5, z: 1.5 }, exit: null,
    barrels: [], safe: null, plant: null, sw: null, vents: [], walls: [], crates: [] };
  const vm = {};
  for (let z = 0; z < H; z++) {
    if (rows[z].length !== Wd) throw new Error(def.name + ': row ' + z + ' length ' + rows[z].length + ' != ' + Wd);
    for (let x = 0; x < Wd; x++) {
      const ch = rows[z][x], p = { x: x + 0.5, z: z + 0.5 }, i = z * Wd + x;
      if (ch === '#') { L.solid[i] = 1; L.walls.push([x, z]); }
      else if (ch === 'x') { L.solid[i] = 2; L.crates.push([x, z]); }
      else if (ch === 'P') L.start = p;
      else if (ch === 'E') L.exit = p;
      else if (ch === 'B') { L.block[i] = 1; L.barrels.push({ x: p.x, z: p.z, i, alive: true }); }
      else if (ch === 'S') { L.block[i] = 1; L.safe = p; }
      else if (ch === 'H') L.plant = { x: p.x, z: p.z, taken: false };
      else if (ch === 'K') L.sw = { x: p.x, z: p.z, used: false };
      else if (ch >= 'a' && ch <= 'h') (vm[ch] = vm[ch] || []).push(p);
      else if (ch !== '.') throw new Error(def.name + ': unknown tile ' + ch);
    }
  }
  for (const k in vm) { if (vm[k].length !== 2) throw new Error(def.name + ': vent ' + k + ' needs 2 ends'); L.vents.push({ a: vm[k][0], b: vm[k][1] }); }
  buildSegs(L);
  return L;
}
// Wall outline as merged axis-aligned segments. These segments are the only thing that blocks sight.
function buildSegs(L) {
  const sol = (x, z) => x < 0 || z < 0 || x >= L.W || z >= L.H || L.solid[z * L.W + x] > 0;
  const hl = new Map(), vl = new Map();
  const add = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(v); };
  for (let z = 0; z < L.H; z++) for (let x = 0; x < L.W; x++) {
    if (!sol(x, z)) continue;
    if (!sol(x, z - 1)) add(hl, z, x);
    if (!sol(x, z + 1)) add(hl, z + 1, x);
    if (!sol(x - 1, z)) add(vl, x, z);
    if (!sol(x + 1, z)) add(vl, x + 1, z);
  }
  const segs = [];
  const merge = (m, horiz) => {
    for (const [line, arr] of m) {
      const u = [...new Set(arr)].sort((a, b) => a - b);
      let s = u[0], p = u[0];
      for (let i = 1; i <= u.length; i++) {
        if (i < u.length && u[i] === p + 1) { p = u[i]; continue; }
        segs.push(horiz ? { ax: s, az: line, bx: p + 1, bz: line } : { ax: line, az: s, bx: line, bz: p + 1 });
        if (i < u.length) s = p = u[i];
      }
    }
  };
  merge(hl, true); merge(vl, false);
  L.segs = segs;
  const cs = new Map();
  for (const s of segs) { cs.set(s.ax + ',' + s.az, [s.ax, s.az]); cs.set(s.bx + ',' + s.bz, [s.bx, s.bz]); }
  L.corners = [...cs.values()];
}

// ---------- geometry ----------
function raySeg(ox, oz, dx, dz, s) {
  const ex = s.bx - s.ax, ez = s.bz - s.az, den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = s.ax - ox, fz = s.az - oz;
  const t = (fx * ez - fz * ex) / den, u = (fx * dz - fz * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}
function segCross(ax, az, bx, bz, s) {
  const rx = bx - ax, rz = bz - az, ex = s.bx - s.ax, ez = s.bz - s.az, den = rx * ez - rz * ex;
  if (Math.abs(den) < 1e-12) return false;
  const fx = s.ax - ax, fz = s.az - az;
  const t = (fx * ez - fz * ex) / den, u = (fx * rz - fz * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1;
}
function losClear(ax, az, bx, bz) { for (const s of W.L.segs) if (segCross(ax, az, bx, bz, s)) return false; return true; }
function inPoly(poly, n, x, z) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], zi = poly[2 * i + 1], xj = poly[2 * j], zj = poly[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, pz, l) {
  const ex = l.bx - l.ax, ez = l.bz - l.az, t = clamp(((px - l.ax) * ex + (pz - l.az) * ez) / (ex * ex + ez * ez), 0, 1);
  return Math.hypot(px - (l.ax + ex * t), pz - (l.az + ez * t));
}

// Vision polygon: a fan from the guard, clipped by wall segments. The same array is drawn on the
// floor and used for every "can this guard see X" check, so what you see is exactly what is tested.
const MAXP = 200, _angs = new Float64Array(MAXP), _near = [];
function computeVis(g) {
  const L = W.L, ox = g.x, oz = g.z, R = g.range, half = g.half, ang = g.ang + (g.sweep || 0);
  _near.length = 0;
  for (const s of L.segs) {
    if (Math.max(s.ax, s.bx) >= ox - R && Math.min(s.ax, s.bx) <= ox + R && Math.max(s.az, s.bz) >= oz - R && Math.min(s.az, s.bz) <= oz + R) _near.push(s);
  }
  let n = 0;
  const N = Math.max(4, Math.ceil((2 * half) / (2.5 * D2R)));
  for (let i = 0; i <= N; i++) _angs[n++] = -half + (2 * half * i) / N;
  const R2 = (R + 0.01) * (R + 0.01);
  for (const c of L.corners) {
    const dx = c[0] - ox, dz = c[1] - oz;
    if (dx * dx + dz * dz > R2 || n > MAXP - 2) continue;
    const rel = wrap(Math.atan2(dz, dx) - ang);
    if (rel > -half && rel < half) { _angs[n++] = Math.max(-half, rel - 1e-4); _angs[n++] = Math.min(half, rel + 1e-4); }
  }
  // Where a wall crosses the range circle the visible edge turns from wall to arc: cast rays there too.
  for (const s of _near) {
    const horiz = s.az === s.bz, c = horiz ? s.az - oz : s.ax - ox;
    if (Math.abs(c) >= R) continue;
    const h = Math.sqrt(R * R - c * c), lo = horiz ? Math.min(s.ax, s.bx) : Math.min(s.az, s.bz), hi = horiz ? Math.max(s.ax, s.bx) : Math.max(s.az, s.bz);
    for (const sg of [-h, h]) {
      const v = (horiz ? ox : oz) + sg;
      if (v < lo || v > hi || n > MAXP - 2) continue;
      const rel = wrap(Math.atan2(horiz ? c : sg, horiz ? sg : c) - ang);
      if (rel > -half && rel < half) { _angs[n++] = Math.max(-half, rel - 1e-4); _angs[n++] = Math.min(half, rel + 1e-4); }
    }
  }
  const arr = _angs.subarray(0, n); arr.sort();
  const P = g.poly; P[0] = ox; P[1] = oz;
  for (let i = 0; i < n; i++) {
    const a = ang + arr[i], dx = Math.cos(a), dz = Math.sin(a);
    let t = R;
    for (const s of _near) { const h = raySeg(ox, oz, dx, dz, s); if (h < t) t = h; }
    P[2 + 2 * i] = ox + dx * t; P[3 + 2 * i] = oz + dz * t;
  }
  g.polyN = n + 1;
}

// ---------- pathfinding (tile A*, then string-pulled) ----------
function cellOK(x, z) { const L = W.L; return x >= 0 && z >= 0 && x < L.W && z < L.H && !L.solid[z * L.W + x] && !L.block[z * L.W + x]; }
function nearestOpen(x, z) {
  const cx = x | 0, cz = z | 0;
  for (let r = 0; r < 4; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (cellOK(cx + dx, cz + dz)) return (cz + dz) * W.L.W + cx + dx;
  return -1;
}
function clearWalk(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.ceil(Math.hypot(dx, dz) / 0.2), r = 0.32;
  for (let i = 1; i <= n; i++) {
    const x = a[0] + (dx * i) / n, z = a[1] + (dz * i) / n;
    if (!cellOK((x - r) | 0, (z - r) | 0) || !cellOK((x + r) | 0, (z - r) | 0) || !cellOK((x - r) | 0, (z + r) | 0) || !cellOK((x + r) | 0, (z + r) | 0)) return false;
  }
  return true;
}
function findPath(sx, sz, tx, tz) {
  const L = W.L, Wd = L.W, N = Wd * L.H;
  let s = cellOK(sx | 0, sz | 0) ? (sz | 0) * Wd + (sx | 0) : nearestOpen(sx, sz);
  const tOpen = cellOK(tx | 0, tz | 0);
  const t = tOpen ? (tz | 0) * Wd + (tx | 0) : nearestOpen(tx, tz);
  if (s < 0 || t < 0) return null;
  const g = new Float32Array(N).fill(1e9), f = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const tcx = t % Wd, tcz = (t / Wd) | 0;
  const h = (i) => { const dx = Math.abs((i % Wd) - tcx), dz = Math.abs(((i / Wd) | 0) - tcz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const open = [s]; g[s] = 0; f[s] = h(s);
  let found = s === t;
  while (open.length && !found) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (closed[cur]) continue;
    if (cur === t) { found = true; break; }
    closed[cur] = 1;
    const cx = cur % Wd, cz = (cur / Wd) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!cellOK(nx, nz) || (dx && dz && (!cellOK(cx + dx, cz) || !cellOK(cx, cz + dz)))) continue;
      const ni = nz * Wd + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + (dx && dz ? 1.4142 : 1);
      if (ng < g[ni]) { g[ni] = ng; f[ni] = ng + h(ni); came[ni] = cur; open.push(ni); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = t; c !== s && c >= 0; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = [[sx, sz]];
  for (const c of cells) pts.push([(c % Wd) + 0.5, ((c / Wd) | 0) + 0.5]);
  if (tOpen) { if (cells.length) pts[pts.length - 1] = [tx, tz]; else pts.push([tx, tz]); }
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearWalk(pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}

// ---------- world ----------
let W = null;
const input = { move: { x: 0, z: 0 }, bot: null, keys: new Set(), ptr: null };

function startLevel(i) {
  const def = LEVELS[i];
  seed = 1000 + i;
  const L = parseLevel(def);
  W = {
    i, def, L, mode: def.mode, t: 0, guards: [], barrels: L.barrels, lasers: [], proj: [], later: [], events: [],
    outcome: null, outcomeT: 0, exitOpen: false, objDone: false, looted: false, crack: 0, everAlert: false, kills: 0,
    ammo: def.ammo || 0, aim: def.aim ? { x: def.aim[0] + 0.5, z: def.aim[1] + 0.5 } : { x: L.W / 2, z: L.H / 2 },
    P: { x: L.start.x, z: L.start.z, ang: 0, hp: C.hp, dead: false, moving: false, hidden: false, plant: false, hasPlant: false,
      stillT: 0, tdCD: 0, laserCD: 0, vent: null, ventLock: null, strikeT: 0, hurtT: 0 },
  };
  for (const d of def.guards || []) W.guards.push(makeGuard(d));
  for (const l of def.lasers || []) W.lasers.push({ ax: l.a[0] + 0.5, az: l.a[1] + 0.5, bx: l.b[0] + 0.5, bz: l.b[1] + 0.5, on: l.on || 0, off: l.off || 0, phase: l.phase || 0, group: l.group || '', disabled: false, flash: 0 });
  for (const g of W.guards) computeVis(g);
  input.bot = null; input.move.x = input.move.z = 0;
  if (R) buildVisuals();
}

function makeGuard(d) {
  const kind = d.kind || 'guard', k = KIND[kind];
  const c = (p) => [p[0] + 0.5, p[1] + 0.5];
  const rooms = d.rooms ? d.rooms.map((r) => r.map(c)) : null;
  const route = rooms ? rooms[0] : d.path ? d.path.map(c) : null;
  const at = d.at ? c(d.at) : route[0];
  const looks = d.looks ? d.looks.map((a) => a * D2R) : null;
  const ang = looks ? looks[0] : route && route.length > 1 ? Math.atan2(route[1][1] - at[1], route[1][0] - at[0]) : (d.ang || 0) * D2R;
  return {
    id: d.id, kind, x: at[0], z: at[1], home: at, route, ri: route ? 1 % route.length : 0, wait: d.wait ?? 0.8, waitT: d.delay || 0,
    looks, li: 0, lookT: d.lookPhase || 0, hold: d.hold ?? 2, ang, wantAng: ang, sweep: 0,
    range: d.range || k.range, half: (d.half || k.half) * D2R, poly: new Float64Array(2 * (MAXP + 1)), polyN: 0, seen: false,
    state: 'patrol', sus: 0, susPeak: 0, alive: true, hp: kind === 'boss' ? 3 : 1, armed: kind !== 'target',
    path: null, pi: 0, lastSeen: null, chaseTo: null, lostT: 0, shootT: 0, reactT: 0, searchT: 0, search0: 0, t: d.phase || 0,
    follow: d.follow, off: d.off, rooms, room: 0, inv: false, deadT: 0, repathT: 0, found: false,
  };
}

function setPath(e, x, z) { e.path = findPath(e.x, e.z, x, z); e.pi = 1; }
function followPath(e, speed, dt) {
  if (!e.path || e.pi >= e.path.length) return true;
  let step = speed * dt;
  while (step > 0 && e.pi < e.path.length) {
    const p = e.path[e.pi], dx = p[0] - e.x, dz = p[1] - e.z, d = Math.hypot(dx, dz);
    if (d > 1e-4) e.wantAng = Math.atan2(dz, dx);
    if (d <= step) { e.x = p[0]; e.z = p[1]; e.pi++; step -= d; } else { e.x += (dx / d) * step; e.z += (dz / d) * step; step = 0; }
  }
  return e.pi >= e.path.length;
}
function collide(e, r) {
  for (let it = 0; it < 2; it++) {
    const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r), z0 = Math.floor(e.z - r), z1 = Math.floor(e.z + r);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (cellOK(x, z)) continue;
      const blk = x >= 0 && z >= 0 && x < W.L.W && z < W.L.H && !W.L.solid[z * W.L.W + x];
      const m = blk ? 0.15 : 0;
      const cx = clamp(e.x, x + m, x + 1 - m), cz = clamp(e.z, z + m, z + 1 - m);
      let dx = e.x - cx, dz = e.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) { dx = 0; dz = -1; d = 1; }
      e.x = cx + (dx / d) * r; e.z = cz + (dz / d) * r;
    }
  }
}
function moveDirect(e, x, z, speed, dt) {
  const dx = x - e.x, dz = z - e.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  const s = Math.min(d, speed * dt);
  e.x += (dx / d) * s; e.z += (dz / d) * s; collide(e, 0.3);
}

function canSee(g) { if (W.mode === 'sniper' || W.P.hidden || W.P.dead) return false; return inPoly(g.poly, g.polyN, W.P.x, W.P.z); }
function laserOn(l) { if (l.disabled) return false; if (!l.on) return true; return (W.t + l.phase) % (l.on + l.off) < l.on; }
function toast(msg) { W.events.push({ type: 'toast', msg }); }

function updateGuard(g, dt) {
  if (!g.alive) { g.deadT += dt; return; }
  g.t += dt;
  const P = W.P;
  const seen = !W.outcome && canSee(g);
  g.seen = seen;
  g.sweep = g.kind === 'flash' && g.state === 'patrol' ? Math.sin(g.t * 1.7) * 0.35 : 0;
  if (g.inv) {
    if (followPath(g, C.dash, dt)) { g.inv = false; g.state = 'patrol'; g.route = g.rooms[g.room]; g.ri = 1 % g.route.length; g.path = null; g.waitT = 0.5; }
    g.ang = turnToward(g.ang, g.wantAng, C.turn * 1.5 * dt);
    return;
  }
  if (g.state === 'flee') {
    if (followPath(g, C.flee, dt) && W.L.exit && near(g, W.L.exit, 0.6)) fail('A target escaped');
  } else if (g.state === 'alert') {
    alertBehave(g, dt, seen);
  } else if (seen) {
    g.lastSeen = [P.x, P.z];
    const d = Math.hypot(P.x - g.x, P.z - g.z);
    g.sus += dt / lerp(C.susNear, C.susFar, clamp(d / g.range, 0, 1));
    g.susPeak = Math.max(g.susPeak, g.sus);
    if (g.sus >= 1) alertGuard(g, true);
    else { g.state = 'suspicious'; g.path = null; g.wantAng = Math.atan2(P.z - g.z, P.x - g.x); }
  } else if (g.state === 'suspicious') {
    g.sus -= C.susDecay * dt;
    g.wantAng = Math.atan2(g.lastSeen[1] - g.z, g.lastSeen[0] - g.x);
    if (g.sus <= 0) { g.sus = 0; if (g.susPeak > 0.45) investigate(g, g.lastSeen[0], g.lastSeen[1]); else backToPatrol(g); }
  } else if (g.state === 'investigate') {
    if (followPath(g, C.walk * 1.3, dt)) { g.state = 'search'; g.searchT = C.lookTime; g.search0 = g.ang; }
  } else if (g.state === 'search') {
    g.searchT -= dt;
    g.wantAng = g.search0 + Math.sin((C.lookTime - g.searchT) * 2.2) * 1.4;
    if (g.searchT <= 0) backToPatrol(g);
  } else patrol(g, dt);
  g.ang = turnToward(g.ang, g.wantAng, C.turn * dt);
}

function alertBehave(g, dt, seen) {
  const P = W.P;
  if (seen) {
    g.lastSeen = [P.x, P.z]; g.lostT = 0; g.path = null;
    g.wantAng = Math.atan2(P.z - g.z, P.x - g.x);
    if (g.armed) {
      g.reactT -= dt;
      if (g.reactT <= 0 && Math.abs(wrap(g.wantAng - g.ang)) < 0.35) { g.shootT -= dt; if (g.shootT <= 0) { g.shootT = C.shootEvery; shoot(g); } }
    }
    if (Math.hypot(P.x - g.x, P.z - g.z) > g.range * 0.6) moveDirect(g, P.x, P.z, C.run, dt);
  } else {
    g.lostT += dt;
    if (!g.lastSeen) g.lastSeen = [g.x, g.z];
    if (!g.path || g.chaseTo !== g.lastSeen) { g.chaseTo = g.lastSeen; setPath(g, g.lastSeen[0], g.lastSeen[1]); }
    const arrived = followPath(g, C.run, dt);
    if (arrived || g.lostT > C.lostTime) { g.state = 'search'; g.searchT = C.lookTime; g.search0 = g.ang; g.sus = 0.5; g.susPeak = 0; g.path = null; }
  }
}

function patrol(g, dt) {
  if (g.kind === 'bodyguard') return followBoss(g, dt);
  if (g.looks) {
    if (Math.hypot(g.x - g.home[0], g.z - g.home[1]) > 0.15) { if (!g.path) setPath(g, g.home[0], g.home[1]); if (followPath(g, C.walk, dt)) g.path = null; return; }
    g.path = null;
    g.lookT += dt;
    if (g.lookT >= g.hold) { g.lookT -= g.hold; g.li = (g.li + 1) % g.looks.length; }
    g.wantAng = g.looks[g.li];
    return;
  }
  if (!g.route || g.route.length < 2) {
    const h = g.route ? g.route[0] : g.home;
    if (Math.hypot(g.x - h[0], g.z - h[1]) > 0.15) { if (!g.path) setPath(g, h[0], h[1]); if (followPath(g, C.walk, dt)) g.path = null; }
    return;
  }
  if (g.waitT > 0) { g.waitT -= dt; return; }
  if (!g.path) setPath(g, g.route[g.ri][0], g.route[g.ri][1]);
  if (followPath(g, C.walk, dt)) { g.path = null; g.ri = (g.ri + 1) % g.route.length; g.waitT = g.wait; }
}

// Bodyguards walk behind the boss and glance back for 1.2 s out of every 7 s.
function followBoss(g, dt) {
  const b = W.guards.find((o) => o.id === g.follow);
  if (!b || !b.alive) { g.kind = 'guard'; g.home = [g.x, g.z]; g.looks = [g.ang, g.ang + Math.PI / 2, g.ang + Math.PI, g.ang - Math.PI / 2]; g.hold = 1.6; return; }
  const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
  const tx = b.x + g.off[0] * ca - g.off[1] * sa, tz = b.z + g.off[0] * sa + g.off[1] * ca;
  const d = Math.hypot(tx - g.x, tz - g.z);
  g.repathT -= dt;
  if (d > 0.3) {
    if (!g.path || g.repathT <= 0) { setPath(g, tx, tz); g.repathT = 0.4; }
    followPath(g, d > 1.5 ? C.run : C.walk * 1.4, dt);
  } else g.path = null;
  if (d <= 0.7) g.wantAng = g.t % 7 > 5.8 ? b.ang + Math.PI : b.ang;
}

function investigate(g, x, z) { g.state = 'investigate'; g.susPeak = 0; setPath(g, x, z); }
function backToPatrol(g) { g.state = 'patrol'; g.sus = 0; g.susPeak = 0; g.path = null; }
function startFlee(g) { g.state = 'flee'; g.sus = 1; if (W.L.exit) setPath(g, W.L.exit.x, W.L.exit.z); }
function alertGuard(g, radio, x, z) {
  if (!g.alive || g.inv) return;
  if (x === undefined) { x = W.P.x; z = W.P.z; }
  g.lastSeen = [x, z]; g.lostT = 0;
  W.everAlert = true;
  if (g.kind === 'target') { if (g.state !== 'flee') startFlee(g); }
  else if (g.state !== 'alert') { g.state = 'alert'; g.sus = 1; g.reactT = C.react; g.shootT = 0; g.path = null; }
  if (radio) for (const o of W.guards) {
    if (o !== g && o.alive && o.state !== 'alert' && o.state !== 'flee' && Math.hypot(o.x - g.x, o.z - g.z) < C.radio) alertGuard(o, false, x, z);
  }
}
function alarm(x, z, msg) { toast(msg); W.events.push({ type: 'alarm' }); for (const g of W.guards) alertGuard(g, false, x, z); }
function shoot(g) { W.events.push({ type: 'shot', ax: g.x, az: g.z, bx: W.P.x, bz: W.P.z }); damage(C.dmg); }
function damage(n) {
  const P = W.P;
  if (W.outcome || P.dead) return;
  P.hp = Math.max(0, P.hp - n); P.hurtT = 0.35; W.events.push({ type: 'hurt' });
  if (P.hp <= 0) { P.dead = true; fail('You were taken down'); }
}
function bossHit(g) {
  g.hp--; g.room = Math.min(g.room + 1, g.rooms.length - 1); g.inv = true; g.state = 'dash'; g.sus = 0; g.path = null;
  setPath(g, g.rooms[g.room][0][0], g.rooms[g.room][0][1]);
  toast('The Broker runs! ' + g.hp + (g.hp === 1 ? ' hit' : ' hits') + ' left');
}
function kill(g, how) {
  if (!g.alive) return;
  g.alive = false; g.state = 'dead'; g.hp = 0; g.deadT = 0; g.path = null; g.seen = false; W.kills++;
  W.events.push({ type: 'kill', x: g.x, z: g.z, how });
  checkObjectives();
}
function takedown(g) {
  const P = W.P;
  P.tdCD = C.tdCD; P.ang = Math.atan2(g.z - P.z, g.x - P.x); P.strikeT = 0.22;
  W.events.push({ type: 'slash', x: P.x, z: P.z, ang: P.ang });
  if (g.kind === 'boss' && g.hp > 1) return bossHit(g);
  kill(g, 'blade');
}
function explode(b) {
  if (!b.alive) return;
  b.alive = false; W.L.block[b.i] = 0;
  W.events.push({ type: 'boom', x: b.x, z: b.z });
  for (const g of W.guards) {
    if (!g.alive || Math.hypot(g.x - b.x, g.z - b.z) >= C.blastR) continue;
    if (g.kind === 'boss' && g.hp > 1) { if (!g.inv) bossHit(g); } else kill(g, 'blast');
  }
  if (W.mode !== 'sniper' && Math.hypot(W.P.x - b.x, W.P.z - b.z) < C.blastR) damage(C.blastDmg);
  for (const o of W.barrels) if (o.alive && Math.hypot(o.x - b.x, o.z - b.z) < C.blastR) W.later.push({ t: 0.15, fn: () => explode(o) });
  noise(b.x, b.z, C.noiseR);
}
function noise(x, z, r) {
  for (const g of W.guards) {
    if (!g.alive || g.inv || g.state === 'alert' || g.state === 'flee' || Math.hypot(g.x - x, g.z - z) >= r) continue;
    if (g.kind === 'target') { W.everAlert = true; startFlee(g); } else investigate(g, x, z);
  }
}
function checkObjectives() {
  if (W.objDone) return;
  const m = W.mode;
  let done = false;
  if (m === 'assassinate' || m === 'sniper') done = W.guards.every((g) => g.kind !== 'target' || !g.alive);
  else if (m === 'heist') done = W.looted;
  else if (m === 'boss') done = W.guards.every((g) => g.kind !== 'boss' || !g.alive);
  if (!done) return;
  W.objDone = true;
  if (m === 'sniper') return win();
  W.exitOpen = true;
  toast('Contract done. Get to the exit!');
}
function win() {
  if (W.outcome) return;
  const first = !S.done[W.i];
  let coins = 40 + 15 * W.i;
  if (!first) coins = Math.round(coins / 2);
  const ghost = !W.everAlert, bonus = ghost ? Math.round(coins / 2) : 0;
  W.outcome = { win: true, coins, bonus, ghost, first };
  S.done[W.i] = true; S.unlocked = Math.max(S.unlocked, Math.min(LEVELS.length, W.i + 2)); S.coins += coins + bonus; save();
}
function fail(reason) { if (!W.outcome) W.outcome = { win: false, reason }; }

function tapWorld(x, z) {
  if (!W || W.outcome || W.mode === 'sniper') return false;
  let best = null, bd = 1.0;
  for (const b of W.barrels) if (b.alive) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
  if (!best) return false;
  const P = W.P, d = Math.hypot(best.x - P.x, best.z - P.z);
  if (d > C.throwRange) { toast('Too far to throw'); return false; }
  if (!losClear(P.x, P.z, best.x, best.z)) { toast('No clear throw'); return false; }
  W.proj.push({ x: P.x, z: P.z, sx: P.x, sz: P.z, b: best, t: 0, T: d / C.throwSpeed });
  P.ang = Math.atan2(best.z - P.z, best.x - P.x);
  return true;
}
function sniperFire() {
  if (!W || W.outcome || W.mode !== 'sniper' || W.ammo <= 0) return;
  W.ammo--;
  const { x, z } = W.aim;
  W.events.push({ type: 'snipe', x, z });
  let hit = null, bd = C.ammoAim;
  for (const g of W.guards) if (g.alive) { const d = Math.hypot(g.x - x, g.z - z); if (d < bd) { bd = d; hit = g; } }
  if (hit) kill(hit, 'shot');
  else {
    let bb = null, b2 = 0.6;
    for (const b of W.barrels) if (b.alive) { const d = Math.hypot(b.x - x, b.z - z); if (d < b2) { b2 = d; bb = b; } }
    if (bb) explode(bb); else noise(x, z, 3);
  }
  if (!W.objDone && W.ammo === 0) W.later.push({ t: 0.6, fn: () => { if (!W.objDone) fail('Out of ammo'); } });
}
// Sniper levels: a guard or target that sees a body raises the alarm and the targets run for the exit.
function bodyCheck() {
  for (const d of W.guards) {
    if (d.alive || d.found) continue;
    for (const g of W.guards) if (g.alive && inPoly(g.poly, g.polyN, d.x, d.z)) { d.found = true; alarm(d.x, d.z, 'A body was found! Targets are running!'); break; }
  }
}

function updatePlayer(dt) {
  const P = W.P, L = W.L;
  if (P.dead || W.outcome) { P.moving = false; return; }
  P.tdCD -= dt; P.laserCD -= dt; P.strikeT -= dt; P.hurtT -= dt;
  if (P.vent) {
    const v = P.vent; v.t += dt;
    const k = Math.min(1, v.t / C.ventTime);
    P.x = lerp(v.a.x, v.b.x, k); P.z = lerp(v.a.z, v.b.z, k);
    if (k >= 1) { P.vent = null; P.hidden = false; P.ventLock = v.b; }
    return;
  }
  const m = input.bot || input.move, len = Math.hypot(m.x, m.z);
  P.moving = len > 0.05;
  if (P.moving) {
    const k = Math.min(1, len) * C.speed * dt;
    P.x += (m.x / len) * k; P.z += (m.z / len) * k; collide(P, C.pr);
    P.ang = Math.atan2(m.z, m.x);
  }
  if (P.hasPlant) { P.stillT = P.moving ? 0 : P.stillT + dt; P.plant = P.stillT >= C.plantDelay; }
  P.hidden = P.plant;
  if (L.plant && !L.plant.taken && near(P, L.plant, 0.6)) { L.plant.taken = true; P.hasPlant = true; toast('Pot-plant disguise! Stand still to hide.'); }
  if (L.sw && !L.sw.used && near(P, L.sw, 0.75)) { L.sw.used = true; for (const l of W.lasers) if (l.group === 'A') l.disabled = true; toast('Lasers switched off'); }
  if (P.ventLock && !near(P, P.ventLock, 0.8)) P.ventLock = null;
  if (!P.ventLock) for (const v of L.vents) {
    for (const [a, b] of [[v.a, v.b], [v.b, v.a]]) if (near(P, a, 0.4)) { P.vent = { a, b, t: 0 }; P.hidden = true; P.plant = false; W.events.push({ type: 'vent' }); return; }
  }
  if (P.laserCD <= 0) for (const l of W.lasers) {
    if (laserOn(l) && segDist(P.x, P.z, l) < C.pr) { P.laserCD = C.laserCD; l.flash = 0.8; alarm(P.x, P.z, 'Laser tripped! Alarm!'); break; }
  }
  if (L.safe && !W.looted) {
    if (near(P, L.safe, 1.15)) { W.crack += dt; if (W.crack >= C.crackTime) { W.looted = true; toast('Loot secured!'); checkObjectives(); } }
    else W.crack = Math.max(0, W.crack - dt * 0.5);
  }
  if (W.exitOpen && L.exit && near(P, L.exit, 0.55)) return win();
  if (P.tdCD <= 0) for (const g of W.guards) {
    if (g.alive && !g.inv && Math.hypot(g.x - P.x, g.z - P.z) < C.tdR && !inPoly(g.poly, g.polyN, P.x, P.z)) { takedown(g); break; }
  }
}
function updateAim(dt) {
  const m = input.bot || input.move;
  if (Math.hypot(m.x, m.z) > 0.05) { W.aim.x += m.x * 6 * dt; W.aim.z += m.z * 6 * dt; }
  W.aim.x = clamp(W.aim.x, 0.5, W.L.W - 0.5); W.aim.z = clamp(W.aim.z, 0.5, W.L.H - 0.5);
}

function simStep() {
  if (!W) return;
  const dt = DT;
  W.t += dt;
  if (W.outcome) W.outcomeT += dt;
  if (W.mode === 'sniper') updateAim(dt); else updatePlayer(dt);
  for (const g of W.guards) updateGuard(g, dt);
  for (let i = W.proj.length - 1; i >= 0; i--) {
    const p = W.proj[i]; p.t += dt;
    const k = Math.min(1, p.t / p.T);
    p.x = lerp(p.sx, p.b.x, k); p.z = lerp(p.sz, p.b.z, k);
    if (k >= 1) { W.proj.splice(i, 1); explode(p.b); }
  }
  for (let i = W.later.length - 1; i >= 0; i--) { const l = W.later[i]; l.t -= dt; if (l.t <= 0) { W.later.splice(i, 1); l.fn(); } }
  for (const l of W.lasers) l.flash = Math.max(0, l.flash - dt);
  for (const g of W.guards) if (g.alive) computeVis(g);
  if (W.mode === 'sniper' && !W.outcome) bodyCheck();
}

// =====================================================================================
// Graphics
// =====================================================================================
let R = null;
const THEME = {
  day: { bg: 0x2d3142, a: '#e9dcc3', b: '#e1d2b6', wall: 0x8a93a8, crate: 0xc98a4b, hemi: 0.62, sun: 0.55 },
  dark: { bg: 0x0f121a, a: '#4a5368', b: '#434b5f', wall: 0x5d6680, crate: 0x7a6449, hemi: 0.46, sun: 0.3 },
};
const LOOK = {
  guard: { body: 0x2f4a7a, legs: 0x23314d, skin: 0xe2b48c, cap: 0x1b2742 },
  flash: { body: 0x3e5f4a, legs: 0x26392d, skin: 0xd8a47c, cap: 0x1f2f25 },
  bodyguard: { body: 0x1f2128, legs: 0x15161b, skin: 0xd8a47c, cap: 0x0e0f12, scale: 1.1 },
  target: { body: 0xf2efe9, legs: 0x8a8f9c, skin: 0xefc39f, tie: 0xff3b5c, outline: 0xff3b5c },
  boss: { body: 0x6b3fa0, legs: 0x3b2259, skin: 0xe7b892, tie: 0xffc93c, outline: 0xffc93c, scale: 1.25, hat: 0x1a1022 },
};
const geoCache = new Map(), matCache = new Map();
function boxG(w, h, d) { const k = w + ',' + h + ',' + d; let g = geoCache.get(k); if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d))); return g; }
function cylG(rt, rb, h, s) { const k = 'c' + rt + ',' + rb + ',' + h + ',' + s; let g = geoCache.get(k); if (!g) geoCache.set(k, (g = new THREE.CylinderGeometry(rt, rb, h, s))); return g; }
function mat(color, basic) { const k = color + (basic ? 'b' : ''); let m = matCache.get(k); if (!m) matCache.set(k, (m = basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }))); return m; }
function mesh(geo, color, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z); m.castShadow = shadow; if (parent) parent.add(m); return m;
}

function initGfx() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa4b8, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.002;
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 70 });
  scene.add(hemi, sun, sun.target);
  const sprite = (txt, bg) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = bg; x.beginPath(); x.arc(32, 32, 28, 0, TAU); x.fill();
    x.fillStyle = '#fff'; x.font = '900 42px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 32, 35);
    const t = new THREE.CanvasTexture(c); return new THREE.SpriteMaterial({ map: t, depthTest: false });
  };
  R = { canvas, renderer, scene, camera, hemi, sun, level: null, disp: [], cam: { x: 0, z: 0 }, shake: 0, hitstop: 0, screen: 'title',
    sprQ: sprite('?', '#f5a623'), sprE: sprite('!', '#ff3b5c'), gv: new Map(), fx: [], toastT: 0, overview: false };
  addEventListener('resize', resize); resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
}

function floorTexture(th) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = th.a; x.fillRect(0, 0, 64, 64); x.fillStyle = th.b; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t;
}

function makeChar(c, isPlayer) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const parts = [];
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.5, s * 0.12); body.add(hip);
    parts.push(mesh(boxG(0.2, 0.5, 0.18), c.legs, 0, -0.25, 0, hip)); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(0, 0.98, s * 0.33); body.add(sh);
    mesh(boxG(0.14, 0.44, 0.14), c.body, 0, -0.2, 0, sh); arms.push(sh);
  }
  parts.push(mesh(boxG(0.32, 0.52, 0.5), c.body, 0, 0.77, 0, body));
  parts.push(mesh(boxG(0.34, 0.34, 0.34), c.skin, 0, 1.21, 0, body));
  if (isPlayer) {
    mesh(boxG(0.36, 0.2, 0.36), c.body, 0, 1.13, 0, body);
    mesh(boxG(0.37, 0.08, 0.37), c.band, 0, 1.3, 0, body);
    mesh(boxG(0.06, 0.06, 0.3), c.band, -0.22, 1.3, 0.12, body).rotation.y = 0.5;
  } else {
    if (c.cap) { mesh(boxG(0.38, 0.09, 0.38), c.cap, 0, 1.42, 0, body); mesh(boxG(0.16, 0.04, 0.3), c.cap, 0.22, 1.39, 0, body); }
    if (c.hat) { mesh(boxG(0.5, 0.05, 0.5), c.hat, 0, 1.4, 0, body); mesh(boxG(0.3, 0.2, 0.3), c.hat, 0, 1.5, 0, body); }
    if (c.tie) mesh(boxG(0.02, 0.3, 0.08), c.tie, 0.17, 0.85, 0, body);
  }
  if (c.outline) {
    const om = new THREE.MeshBasicMaterial({ color: c.outline, side: THREE.BackSide });
    for (const p of parts) { const o = new THREE.Mesh(p.geometry, om); o.scale.setScalar(1.22); p.add(o); }
  }
  return { root, body, legs, arms };
}
function makePlant(parent, s = 1) {
  const g = new THREE.Group();
  mesh(cylG(0.24 * s, 0.17 * s, 0.34 * s, 7), 0xc8693a, 0, 0.17 * s, 0, g);
  const leaf = new THREE.IcosahedronGeometry(0.26 * s, 0);
  for (const [x, y, z] of [[0, 0.55, 0], [0.16, 0.42, 0.12], [-0.14, 0.45, -0.1], [0.05, 0.75, -0.05]]) mesh(leaf, 0x3fa34d, x * s, y * s, z * s, g);
  if (parent) parent.add(g);
  return g;
}

function buildVisuals() {
  if (R.level) { R.scene.remove(R.level); for (const d of R.disp) d.dispose(); }
  R.disp = []; R.gv.clear(); R.fx.length = 0; R.toastT = 0; $('#toast').classList.remove('on');
  const G = new THREE.Group(); R.level = G; R.scene.add(G);
  const L = W.L, th = W.def.dark ? THEME.dark : THEME.day;
  R.scene.background = new THREE.Color(th.bg);
  R.hemi.intensity = th.hemi; R.sun.intensity = th.sun;
  const ft = floorTexture(th); ft.repeat.set(L.W / 2, L.H / 2); R.disp.push(ft);
  const fm = new THREE.MeshLambertMaterial({ map: ft }); R.disp.push(fm);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.W, L.H), fm); R.disp.push(floor.geometry);
  floor.rotation.x = -Math.PI / 2; floor.position.set(L.W / 2, 0, L.H / 2); floor.receiveShadow = true; G.add(floor);
  const inst = (list, geo, color, h) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat(color), list.length); R.disp.push(im);
    const m4 = new THREE.Matrix4();
    list.forEach(([x, z], i) => { m4.makeTranslation(x + 0.5, h / 2, z + 0.5); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; G.add(im);
  };
  inst(L.walls, boxG(1, 1.1, 1), th.wall, 1.1);
  inst(L.crates, boxG(0.92, 0.8, 0.92), th.crate, 0.8);
  // exit
  if (L.exit) {
    const ex = new THREE.Group(); ex.position.set(L.exit.x, 0, L.exit.z); G.add(ex);
    R.exitPad = mesh(cylG(0.45, 0.45, 0.06, 16), new THREE.MeshBasicMaterial({ color: 0x7a8090 }), 0, 0.03, 0, ex, false); R.disp.push(R.exitPad.material);
    R.exitRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 20), R.exitPad.material); R.disp.push(R.exitRing.geometry);
    R.exitRing.rotation.x = Math.PI / 2; R.exitRing.position.y = 0.3; ex.add(R.exitRing);
  } else R.exitPad = null;
  // barrels
  R.barrelMesh = new Map();
  for (const b of W.barrels) {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); G.add(g);
    mesh(cylG(0.33, 0.33, 0.8, 10), 0xe63946, 0, 0.4, 0, g); mesh(cylG(0.34, 0.34, 0.12, 10), 0xffc93c, 0, 0.5, 0, g);
    R.barrelMesh.set(b, g);
  }
  if (L.safe) {
    const g = new THREE.Group(); g.position.set(L.safe.x, 0, L.safe.z); G.add(g);
    mesh(boxG(0.8, 0.85, 0.8), 0x4a5160, 0, 0.43, 0, g); mesh(cylG(0.14, 0.14, 0.06, 10), 0xffc93c, 0, 0.5, 0.42, g).rotation.x = Math.PI / 2;
    R.loot = mesh(boxG(0.4, 0.3, 0.4), 0xffc93c, 0, 1.0, 0, g);
  } else R.loot = null;
  if (L.plant) { R.plantPickup = makePlant(G); R.plantPickup.position.set(L.plant.x, 0, L.plant.z); } else R.plantPickup = null;
  if (L.sw) {
    const g = new THREE.Group(); g.position.set(L.sw.x, 0, L.sw.z); G.add(g);
    mesh(boxG(0.3, 0.9, 0.3), 0x596179, 0, 0.45, 0, g);
    R.swLight = mesh(boxG(0.34, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xff3b5c }), 0, 0.95, 0, g); R.disp.push(R.swLight.material);
  } else R.swLight = null;
  for (const v of L.vents) for (const p of [v.a, v.b]) {
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); G.add(g);
    mesh(boxG(0.86, 0.04, 0.86), 0x2b313d, 0, 0.02, 0, g, false);
    for (const s of [-0.24, 0, 0.24]) mesh(boxG(0.7, 0.06, 0.08), 0x8a93a6, 0, 0.04, s, g, false);
  }
  // lasers
  R.laserMesh = [];
  for (const l of W.lasers) {
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
    const lm = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.9 }); R.disp.push(lm);
    const m = new THREE.Mesh(cylG(0.035, 0.035, len, 6), lm);
    m.position.set((l.ax + l.bx) / 2, 0.5, (l.az + l.bz) / 2); m.rotation.z = Math.PI / 2; m.rotation.y = -Math.atan2(l.bz - l.az, l.bx - l.ax);
    G.add(m); R.laserMesh.push(m);
    for (const [x, z] of [[l.ax, l.az], [l.bx, l.bz]]) mesh(boxG(0.18, 0.8, 0.18), 0x3b3f4a, x, 0.4, z, G);
  }
  // player
  const hero = HEROES.find((h) => h.id === S.hero) || HEROES[0], blade = BLADES.find((b) => b.id === S.blade) || BLADES[0];
  R.player = makeChar(hero, true); G.add(R.player.root);
  const bm = blade.glow ? new THREE.MeshBasicMaterial({ color: blade.color }) : mat(blade.color);
  const bl = mesh(boxG(blade.len, 0.05, 0.07), bm, blade.len / 2 + 0.02, -0.42, 0, R.player.arms[1]);
  if (blade.glow) R.disp.push(bm);
  bl.rotation.z = -0.3;
  R.playerPlant = makePlant(G, 1.25); R.playerPlant.visible = false;
  R.player.root.visible = W.mode !== 'sniper';
  // guards
  for (const g of W.guards) {
    const look = LOOK[g.kind], ch = makeChar(look, false);
    ch.root.scale.setScalar(look.scale || 1); G.add(ch.root);
    const geo = new THREE.BufferGeometry(), pos = new Float32Array((MAXP + 1) * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 1; i < MAXP; i++) idx.push(0, i, i + 1); geo.setIndex(idx);
    const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    if (W.def.dark && g.kind === 'flash') cm.blending = THREE.AdditiveBlending;
    const cone = new THREE.Mesh(geo, cm); cone.frustumCulled = false; cone.renderOrder = 1; G.add(cone);
    R.disp.push(geo, cm);
    const q = new THREE.Sprite(R.sprQ), e = new THREE.Sprite(R.sprE);
    for (const s of [q, e]) { s.scale.setScalar(0.6); s.renderOrder = 10; s.visible = false; G.add(s); }
    let mark = null;
    if (g.kind === 'target' || g.kind === 'boss') { mark = mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: look.outline }), 0, 0, 0, G, false); R.disp.push(mark.geometry, mark.material); }
    R.gv.set(g, { ch, cone, cm, pos, geo, q, e, mark });
  }
  // fx pools
  R.parts = [];
  for (let i = 0; i < 48; i++) { const m = mesh(boxG(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, -5, 0, G, false); R.disp.push(m.material); R.parts.push({ m, life: 0, vx: 0, vy: 0, vz: 0 }); }
  R.tracers = [];
  for (let i = 0; i < 8; i++) { const m = mesh(boxG(1, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true }), 0, -5, 0, G, false); R.disp.push(m.material); R.tracers.push({ m, life: 0 }); }
  R.slash = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.85, 14, 1, -1.2, 2.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  R.slash.rotation.x = -Math.PI / 2; R.slash.visible = false; G.add(R.slash); R.disp.push(R.slash.geometry, R.slash.material); R.slashT = 0;
  R.boom = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true }));
  R.boom.visible = false; G.add(R.boom); R.disp.push(R.boom.geometry, R.boom.material); R.boomT = 0;
  R.shuriken = new THREE.Group();
  mesh(boxG(0.34, 0.03, 0.08), 0xc9d1dc, 0, 0, 0, R.shuriken, false); mesh(boxG(0.08, 0.03, 0.34), 0xc9d1dc, 0, 0, 0, R.shuriken, false);
  R.shuriken.visible = false; G.add(R.shuriken);
  R.cam.x = W.mode === 'sniper' ? W.aim.x : W.P.x; R.cam.z = W.mode === 'sniper' ? W.aim.z : W.P.z;
}

function burst(x, y, z, n, color, speed) {
  for (let k = 0; k < n; k++) {
    const p = R.parts.find((q) => q.life <= 0); if (!p) return;
    const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.8);
    p.life = 0.4 + Math.random() * 0.3; p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 2 + Math.random() * 3;
    p.m.position.set(x, y, z); p.m.material.color.setHex(color); p.m.scale.setScalar(0.6 + Math.random());
  }
}
function handleEvents() {
  for (const ev of W.events) {
    if (ev.type === 'toast') { showToast(ev.msg); }
    else if (ev.type === 'slash') { R.slashT = 0.14; R.slash.position.set(ev.x, 0.8, ev.z); R.slash.rotation.z = ev.ang; R.hitstop = 0.06; R.shake = 0.12; }
    else if (ev.type === 'kill') { burst(ev.x, 0.9, ev.z, 10, ev.how === 'blast' ? 0x3b3f4a : 0xffffff, 3); }
    else if (ev.type === 'boom') { R.boomT = 0.45; R.boom.position.set(ev.x, 0.6, ev.z); R.shake = 0.4; burst(ev.x, 0.6, ev.z, 16, 0xff8c1a, 6); }
    else if (ev.type === 'shot') {
      const t = R.tracers.find((q) => q.life <= 0);
      if (t) { const len = Math.hypot(ev.bx - ev.ax, ev.bz - ev.az); t.life = 0.08; t.m.position.set((ev.ax + ev.bx) / 2, 1, (ev.az + ev.bz) / 2); t.m.scale.x = len; t.m.rotation.y = -Math.atan2(ev.bz - ev.az, ev.bx - ev.ax); }
    }
    else if (ev.type === 'snipe') { R.shake = 0.2; burst(ev.x, 0.5, ev.z, 6, 0xfff1b8, 2); }
    else if (ev.type === 'hurt') { R.shake = Math.max(R.shake, 0.1); }
    else if (ev.type === 'alarm') { R.shake = Math.max(R.shake, 0.15); }
  }
  W.events.length = 0;
}

const COL = { base: 0x29b6f6, flash: 0xfff0a0, sus: 0xffd23f, red: 0xff3b30 };
function syncVisuals(rdt) {
  const P = W.P, pv = R.player, tt = W.t;
  // player
  if (W.mode !== 'sniper') {
    pv.root.position.set(P.x, 0, P.z); pv.root.rotation.y = -P.ang;
    const show = !P.vent && !P.plant;
    pv.root.visible = show; R.playerPlant.visible = P.plant && !P.vent; R.playerPlant.position.set(P.x, 0, P.z);
    const sw = P.moving ? Math.sin(tt * 14) * 0.7 : 0;
    pv.legs[0].rotation.z = sw; pv.legs[1].rotation.z = -sw; pv.arms[0].rotation.z = -sw * 0.6;
    pv.arms[1].rotation.z = P.strikeT > 0 ? 1.6 * (P.strikeT / 0.22) - 0.4 : sw * 0.6;
    pv.body.position.y = P.moving ? Math.abs(Math.sin(tt * 14)) * 0.05 : 0;
    pv.body.rotation.x = P.dead ? 0 : 0; if (P.dead) { pv.root.rotation.z = lerp(pv.root.rotation.z, Math.PI / 2, 0.15); pv.root.position.y = 0.15; } else pv.root.rotation.z = 0;
  }
  // guards & cones
  for (const g of W.guards) {
    const v = R.gv.get(g); if (!v) continue;
    const r = v.ch.root;
    r.position.set(g.x, 0, g.z); r.rotation.y = -g.ang;
    if (!g.alive) {
      const k = Math.min(1, g.deadT / 0.3);
      r.rotation.z = (Math.PI / 2) * k; r.position.y = 0.15 * k; v.cone.visible = false; v.q.visible = v.e.visible = false; if (v.mark) v.mark.visible = false;
      continue;
    }
    const moving = !!g.path || g.inv;
    const sw = moving ? Math.sin(g.t * (g.state === 'alert' || g.inv || g.state === 'flee' ? 15 : 9)) * 0.6 : 0;
    v.ch.legs[0].rotation.z = sw; v.ch.legs[1].rotation.z = -sw; v.ch.arms[0].rotation.z = -sw * 0.5; v.ch.arms[1].rotation.z = g.state === 'alert' && g.armed ? 1.5 : sw * 0.5;
    // cone
    const n = g.polyN, pa = v.pos, pp = g.poly;
    for (let i = 0; i < n; i++) { pa[3 * i] = pp[2 * i]; pa[3 * i + 1] = 0.03; pa[3 * i + 2] = pp[2 * i + 1]; }
    v.geo.attributes.position.needsUpdate = true; v.geo.setDrawRange(0, Math.max(0, n - 2) * 3);
    v.cone.visible = true;
    const red = g.seen || g.state === 'alert' || g.state === 'flee', sus = g.state === 'suspicious' || g.state === 'investigate' || g.state === 'search';
    v.cm.color.setHex(red ? COL.red : sus ? COL.sus : g.kind === 'flash' ? COL.flash : COL.base);
    v.cm.opacity = red ? 0.4 : sus ? 0.36 : g.kind === 'flash' ? (W.def.dark ? 0.5 : 0.4) : 0.3;
    const top = 1.75 * (LOOK[g.kind].scale || 1) + 0.4;
    v.q.visible = sus; v.e.visible = red && g.state !== 'patrol' || g.state === 'alert' || g.state === 'flee';
    if (v.q.visible && v.e.visible) v.q.visible = false;
    v.q.position.set(g.x, top, g.z); v.e.position.set(g.x, top, g.z);
    v.q.material.opacity = 1;
    if (v.mark) { v.mark.visible = true; v.mark.position.set(g.x, top + (v.e.visible || v.q.visible ? 0.55 : 0) + Math.sin(tt * 3) * 0.08, g.z); v.mark.rotation.y = tt * 2; }
  }
  // world objects
  for (const [b, m] of R.barrelMesh) m.visible = b.alive;
  for (let i = 0; i < W.lasers.length; i++) {
    const l = W.lasers[i], m = R.laserMesh[i], on = laserOn(l);
    m.visible = !l.disabled; m.material.opacity = l.flash > 0 ? 1 : on ? 0.9 : 0.12; m.scale.x = m.scale.z = l.flash > 0 ? 2.2 : 1;
  }
  if (R.exitPad) { R.exitPad.material.color.setHex(W.exitOpen ? 0x2ee59d : 0x7a8090); R.exitRing.position.y = W.exitOpen ? 0.3 + Math.sin(tt * 4) * 0.12 : 0.15; R.exitRing.rotation.z = tt; }
  if (R.loot) { R.loot.visible = !W.looted; R.loot.rotation.y = tt * 1.5; }
  if (R.plantPickup) { R.plantPickup.visible = !W.L.plant.taken; R.plantPickup.rotation.y = tt; }
  if (R.swLight) R.swLight.material.color.setHex(W.L.sw.used ? 0x2ee59d : 0xff3b5c);
  const pr = W.proj[0];
  R.shuriken.visible = !!pr; if (pr) { R.shuriken.position.set(pr.x, 0.9, pr.z); R.shuriken.rotation.y = tt * 25; }
  // fx
  for (const p of R.parts) {
    if (p.life <= 0) continue;
    p.life -= rdt; p.vy -= 12 * rdt;
    p.m.position.x += p.vx * rdt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * rdt); p.m.position.z += p.vz * rdt;
    if (p.life <= 0) p.m.position.y = -5;
  }
  for (const t of R.tracers) { if (t.life > 0) { t.life -= rdt; t.m.material.opacity = t.life / 0.08; if (t.life <= 0) t.m.position.y = -5; } }
  R.slashT -= rdt; R.slash.visible = R.slashT > 0; R.slash.material.opacity = Math.max(0, R.slashT / 0.14);
  R.boomT -= rdt; R.boom.visible = R.boomT > 0;
  if (R.boomT > 0) { const k = 1 - R.boomT / 0.45; R.boom.scale.setScalar(0.4 + k * C.blastR); R.boom.material.opacity = 1 - k; }
}

function updateCamera(rdt, snap) {
  const cam = R.camera, a = innerWidth / innerHeight, tanH = Math.tan((cam.fov * D2R) / 2);
  if (R.overview) {
    const L = W.L, half = Math.max(L.W / 2 / Math.min(a, 1e9), L.H / 2) + 1;
    cam.position.set(L.W / 2, half / tanH / Math.min(1, a) * 1.0, L.H / 2 + 0.01); cam.lookAt(L.W / 2, 0, L.H / 2); return;
  }
  const sn = W.mode === 'sniper';
  const t = sn ? W.aim : W.P;
  const k = snap || sn ? 1 : 1 - Math.exp(-7 * rdt);
  R.cam.x += (t.x - R.cam.x) * k; R.cam.z += (t.z - R.cam.z) * k;
  const want = sn ? 4.5 : a < 1 ? 5.2 : 7;
  const Ld = want / (tanH * Math.min(a, 1)), pitch = 58 * D2R;
  R.shake = Math.max(0, R.shake - rdt);
  const sx = R.shake > 0 ? (Math.random() - 0.5) * R.shake : 0, sz = R.shake > 0 ? (Math.random() - 0.5) * R.shake : 0;
  cam.position.set(R.cam.x + sx, Math.sin(pitch) * Ld, R.cam.z + Math.cos(pitch) * Ld + sz);
  cam.lookAt(R.cam.x + sx, 0, R.cam.z + sz);
  R.sun.position.set(R.cam.x - 7, 20, R.cam.z + 6); R.sun.target.position.set(R.cam.x, 0, R.cam.z);
}

// =====================================================================================
// HUD, screens, input
// =====================================================================================
const $ = (s) => document.querySelector(s);
function showToast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); R.toastT = 2.2; }
function objectiveText() {
  const m = W.mode, tg = W.guards.filter((g) => g.kind === 'target'), dead = tg.filter((g) => !g.alive).length;
  if (W.exitOpen) return 'Get to the exit<small>The green pad is open</small>';
  if (m === 'assassinate') return `Targets ${dead}/${tg.length}<small>Take out the marked targets</small>`;
  if (m === 'sniper') return `Targets ${dead}/${tg.length}<small>Drag to aim, let go to fire</small>`;
  if (m === 'heist') return 'Crack the safe<small>Stand by it until it opens</small>';
  if (m === 'boss') { const b = W.guards.find((g) => g.kind === 'boss'); return `Take down the Broker ${'●'.repeat(b ? b.hp : 0)}<small>Three hits. He runs after each one.</small>`; }
  return '';
}
let lastObj = '';
function updateHUD(rdt) {
  const o = objectiveText(); if (o !== lastObj) { $('#obj').innerHTML = (W.def.name ? `<small>${W.i + 1}. ${W.def.name}</small>` : '') + o; lastObj = o; }
  $('#hp i').style.width = (W.P.hp / C.hp) * 100 + '%';
  $('#hp').classList.toggle('hidden', W.mode === 'sniper');
  const cr = $('#crack'), cracking = W.L.safe && !W.looted && W.crack > 0;
  cr.classList.toggle('hidden', !cracking); if (cracking) cr.querySelector('i').style.width = (W.crack / C.crackTime) * 100 + '%';
  $('#scope').classList.toggle('hidden', W.mode !== 'sniper' || R.screen !== 'play');
  if (W.mode === 'sniper') $('#ammo').textContent = 'Ammo ' + '▮'.repeat(W.ammo) + ' ' + W.ammo;
  $('#dmg').style.opacity = W.P.hurtT > 0 ? W.P.hurtT * 2 : W.P.dead ? 0.8 : 0;
  if (R.toastT > 0) { R.toastT -= rdt; if (R.toastT <= 0) $('#toast').classList.remove('on'); }
}

function screen(name, html, style = 'solid') {
  const el = $('#screen'); el.innerHTML = html; el.className = 'show ' + style; el.scrollTop = 0; R.screen = name;
  $('#hud').classList.add('hidden'); $('#joy').classList.add('hidden'); $('#scope').classList.add('hidden');
}
function play() { $('#screen').className = ''; R.screen = 'play'; $('#hud').classList.remove('hidden'); lastObj = ''; }
const coinChip = () => `<span class="chip coin">${S.coins}</span>`;
function titleScreen() {
  screen('title', `<div class="title"><h1>QUIET<br><span>BLADE</span></h1><div class="sub">Chapter 1 · Lantern Harbor</div>
    <button class="btn" data-act="map">Play</button><button class="btn alt" data-act="shop">Hideout</button></div>`, 'dim');
}
function mapScreen() {
  const pos = []; for (let i = 0; i < LEVELS.length; i++) pos.push([i % 2 ? 72 : 28, 70 + i * 104]);
  pos[LEVELS.length - 1][0] = 50;
  const h = 70 + LEVELS.length * 104;
  const path = pos.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
  const nodes = LEVELS.map((l, i) => {
    const st = S.done[i] ? 'done' : i < S.unlocked ? 'open' : 'locked', boss = l.mode === 'boss';
    return `<button class="node ${st}${boss ? ' boss' : ''}" style="left:${pos[i][0]}%;top:${pos[i][1]}px" data-act="intro" data-i="${i}" ${st === 'locked' ? 'disabled' : ''}>${boss ? 'BOSS' : i + 1}<em>${l.name}</em></button>`;
  }).join('');
  screen('map', `<div class="bar"><button class="chip" data-act="title">‹</button><div class="grow">Lantern Harbor</div><button class="chip" data-act="shop">Hideout</button>${coinChip()}</div>
    <div class="map" style="height:${h}px"><svg viewBox="0 0 100 ${h}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/></svg>${nodes}</div>`);
  const el = $('#screen'), cur = el.querySelector('.node.open'); if (cur) el.scrollTop = Math.max(0, cur.offsetTop - innerHeight / 2);
}
function shopScreen(tab = 'heroes') {
  const list = tab === 'heroes' ? HEROES : BLADES, owned = tab === 'heroes' ? S.heroes : S.blades, eq = tab === 'heroes' ? S.hero : S.blade;
  const items = list.map((it) => {
    const own = owned.includes(it.id), on = eq === it.id;
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    const sw = tab === 'heroes' ? `<div class="sw" style="background:${hex(it.body)}"><i style="background:${hex(it.band)}"></i></div>` : `<div class="bl" style="background:${hex(it.color)};height:${30 + it.len * 50}px"></div>`;
    const btn = on ? `<button class="btn alt" disabled>Equipped</button>` : own ? `<button class="btn alt" data-act="equip" data-tab="${tab}" data-id="${it.id}">Equip</button>`
      : `<button class="btn gold" data-act="buy" data-tab="${tab}" data-id="${it.id}" ${S.coins < it.price ? 'disabled style="opacity:.5"' : ''}>● ${it.price}</button>`;
    return `<div class="item">${sw}<b>${it.name}</b>${btn}</div>`;
  }).join('');
  screen('shop', `<div class="bar"><button class="chip" data-act="back">‹</button><div class="grow">Hideout</div>${coinChip()}</div>
    <div class="tabs"><button class="${tab === 'heroes' ? 'on' : ''}" data-act="shop" data-tab="heroes">Heroes</button><button class="${tab === 'blades' ? 'on' : ''}" data-act="shop" data-tab="blades">Blades</button></div>
    <div class="grid">${items}</div>`);
}
const MODE_NAME = { assassinate: 'Contract', heist: 'Heist', sniper: 'Sniper', boss: 'Boss contract' };
function introScreen(i) {
  startLevel(i); updateCamera(0, true);
  const l = LEVELS[i];
  screen('intro', `<div class="card" style="margin-top:auto;margin-bottom:max(20px,env(safe-area-inset-bottom))"><span class="tag">${MODE_NAME[l.mode]} · Level ${i + 1}</span><h2>${l.name}</h2><p>${l.brief}</p><p style="color:#7b7f8c">${l.hint || ''}</p>
    <div class="row"><button class="btn alt" data-act="map">Map</button><button class="btn" data-act="go">Go</button></div></div>`, 'clear');
}
function resultScreen() {
  const o = W.outcome;
  if (o.win) {
    const next = W.i + 1 < LEVELS.length;
    screen('result', `<div class="card"><span class="tag">${W.i + 1}. ${W.def.name}</span><h2>Contract complete</h2>
      <div class="coins-won coin">${o.coins + o.bonus}</div><p>${o.ghost ? 'Ghost bonus +' + o.bonus + ': nobody raised the alarm.' : 'Stay unseen for a ghost bonus.'}</p>
      <div class="row"><button class="btn alt" data-act="map">Map</button>${next ? `<button class="btn" data-act="intro" data-i="${W.i + 1}">Next</button>` : `<button class="btn gold" data-act="map">Chapter done!</button>`}</div></div>`, 'dim');
  } else {
    screen('result', `<div class="card"><span class="tag">${W.i + 1}. ${W.def.name}</span><h2>Mission failed</h2><p>${o.reason}.</p>
      <div class="row"><button class="btn alt" data-act="map">Map</button><button class="btn" data-act="intro" data-i="${W.i}">Retry</button></div></div>`, 'dim');
  }
}
function pauseScreen() {
  screen('pause', `<div class="card"><h2>Paused</h2><p>${W.def.name}</p><button class="btn" data-act="resume">Resume</button>
    <div class="row"><button class="btn alt" data-act="intro" data-i="${W.i}">Restart</button><button class="btn alt" data-act="map">Map</button></div></div>`, 'dim');
}
let shopBack = 'title';
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'map') mapScreen();
  else if (a === 'title') titleScreen();
  else if (a === 'shop') { if (R.screen !== 'shop') shopBack = R.screen; shopScreen(b.dataset.tab); }
  else if (a === 'back') (shopBack === 'map' ? mapScreen : titleScreen)();
  else if (a === 'intro') introScreen(+b.dataset.i);
  else if (a === 'go' || a === 'resume') play();
  else if (a === 'pause') { if (R.screen === 'play' && !W.outcome) pauseScreen(); }
  else if (a === 'buy' || a === 'equip') {
    const tab = b.dataset.tab, list = tab === 'heroes' ? HEROES : BLADES, it = list.find((x) => x.id === b.dataset.id), owned = tab === 'heroes' ? S.heroes : S.blades;
    if (a === 'buy') { if (S.coins < it.price || owned.includes(it.id)) return; S.coins -= it.price; owned.push(it.id); }
    if (tab === 'heroes') S.hero = it.id; else S.blade = it.id;
    save(); shopScreen(tab);
  }
});

function screenToGround(cx, cy) {
  const v = new THREE.Vector3((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1, 0.5).unproject(R.camera);
  const o = R.camera.position, d = v.sub(o); if (Math.abs(d.y) < 1e-6) return null;
  const t = -o.y / d.y; return { x: o.x + d.x * t, z: o.z + d.z * t };
}
function worldPerPixel() { const L = R.camera.position.distanceTo(new THREE.Vector3(R.cam.x, 0, R.cam.z)); return (2 * L * Math.tan((R.camera.fov * D2R) / 2)) / innerHeight; }
function bindInput() {
  const cv = R.canvas, joy = $('#joy'), knob = joy.firstElementChild;
  cv.addEventListener('pointerdown', (e) => {
    if (R.screen !== 'play' || !W || W.outcome || input.ptr) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    input.ptr = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (W.mode !== 'sniper') { joy.style.left = e.clientX + 'px'; joy.style.top = e.clientY + 'px'; knob.style.transform = ''; joy.classList.remove('hidden'); }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = input.ptr; if (!p || p.id !== e.pointerId) return;
    if (W.mode === 'sniper') { const k = worldPerPixel(); W.aim.x = clamp(W.aim.x + (e.clientX - p.x) * k, 0.5, W.L.W - 0.5); W.aim.z = clamp(W.aim.z + (e.clientY - p.y) * k / Math.sin(58 * D2R), 0.5, W.L.H - 0.5); }
    p.x = e.clientX; p.y = e.clientY;
    let dx = p.x - p.sx, dy = p.y - p.sy, len = Math.hypot(dx, dy);
    if (len > 10) p.moved = true;
    if (W.mode === 'sniper') return;
    if (len > 70) { p.sx += (dx * (len - 70)) / len; p.sy += (dy * (len - 70)) / len; joy.style.left = p.sx + 'px'; joy.style.top = p.sy + 'px'; dx = p.x - p.sx; dy = p.y - p.sy; len = 70; }
    knob.style.transform = `translate(${(dx / Math.max(len, 1)) * Math.min(len, 32)}px,${(dy / Math.max(len, 1)) * Math.min(len, 32)}px)`;
    if (len > 8) { input.move.x = dx / len; input.move.z = dy / len; } else input.move.x = input.move.z = 0;
  });
  const up = (e) => {
    const p = input.ptr; if (!p || p.id !== e.pointerId) return;
    input.ptr = null; input.move.x = input.move.z = 0; joy.classList.add('hidden');
    if (!W || R.screen !== 'play') return;
    if (W.mode === 'sniper') { if (e.type === 'pointerup') sniperFire(); return; }
    if (!p.moved && performance.now() - p.t < 350) { const g = screenToGround(e.clientX, e.clientY); if (g) tapWorld(g.x, g.z); }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const keyVec = () => {
    const k = input.keys; let x = 0, z = 0;
    if (k.has('a') || k.has('arrowleft')) x--; if (k.has('d') || k.has('arrowright')) x++; if (k.has('w') || k.has('arrowup')) z--; if (k.has('s') || k.has('arrowdown')) z++;
    const l = Math.hypot(x, z); input.move.x = l ? x / l : 0; input.move.z = l ? z / l : 0;
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' && R.screen === 'play') { sniperFire(); e.preventDefault(); return; }
    if (k === 'escape' && R.screen === 'play' && W && !W.outcome) { pauseScreen(); return; }
    input.keys.add(k); if (!input.ptr) keyVec();
  });
  addEventListener('keyup', (e) => { input.keys.delete(e.key.toLowerCase()); if (!input.ptr) keyVec(); });
  addEventListener('blur', () => { input.keys.clear(); input.move.x = input.move.z = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && R.screen === 'play' && W && !W.outcome) pauseScreen(); });
}

function renderFrame(rdt, snap) {
  if (!W) return;
  handleEvents();
  syncVisuals(rdt);
  updateCamera(rdt, snap);
  if (R.screen === 'play') updateHUD(rdt);
  R.renderer.render(R.scene, R.camera);
}
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let rdt = Math.min(0.1, (now - last) / 1000); last = now;
  if (R.hitstop > 0) { R.hitstop -= rdt; rdt = 0; }
  if (!TEST && R.screen === 'play' && W) {
    acc += rdt; let n = 0;
    while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
    if (n === 6) acc = 0;
  }
  if (W && W.outcome && R.screen === 'play' && W.outcomeT > 1.1) resultScreen();
  renderFrame(Math.min(rdt, 0.05) || 1 / 60);
}

// ---------- boot ----------
initGfx(); bindInput();
startLevel(Math.min(S.unlocked, LEVELS.length) - 1);
titleScreen();
requestAnimationFrame(frame);

// Test/automation hooks (used by the Playwright bot; harmless in normal play).
window.QB = {
  C, DT, LEVELS, HEROES, BLADES, KIND,
  get W() { return W; }, get S() { return S; }, get screen() { return R.screen; },
  start(i) { startLevel(i); play(); renderFrame(0, true); },
  step(n = 1) { for (let k = 0; k < n; k++) simStep(); },
  render() { renderFrame(1 / 60, true); },
  setMove(x, z) { input.bot = x === null ? null : { x, z }; },
  tapWorld, sniperFire, inPoly, losClear, findPath, laserOn,
  aim(x, z) { W.aim.x = x; W.aim.z = z; },
  place(x, z) { W.P.x = x; W.P.z = z; for (const g of W.guards) if (g.alive) computeVis(g); },
  guard(id) { return W.guards.find((g) => g.id === id); },
  poly(id) { const g = this.guard(id); return Array.from(g.poly.subarray(0, 2 * g.polyN)); },
  drawn(id) { const v = R.gv.get(this.guard(id)); const n = v.geo.drawRange.count / 3 + 2, out = []; for (let i = 0; i < n; i++) out.push(v.pos[3 * i], v.pos[3 * i + 2]); return out; },
  coneColor(id) { return R.gv.get(this.guard(id)).cm.color.getHex(); },
  toScreen(x, z) { const v = new THREE.Vector3(x, 0, z).project(R.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; },
  overview(on = true) { R.overview = on; renderFrame(0, true); },
  resetSave() { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, { unlocked: 1, done: {}, coins: 0, heroes: ['ink'], blades: ['tanto'], hero: 'ink', blade: 'tanto' }); save(); },
  ui: { titleScreen, mapScreen, shopScreen, introScreen, resultScreen, pauseScreen, play },
};
})();
