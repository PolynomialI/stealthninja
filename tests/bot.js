/* Bot player, injected into the page by the tests. It drives the game through QB.setMove (the same
   move vector the on-screen joystick writes), QB.tapWorld (a tap) and the sniper aim/fire calls, and
   advances the fixed-step simulation itself, so a run is deterministic and much faster than real time.
   Plans are lists of steps; tile coordinates are [column, row]. */
window.Bot = (() => {
  const T = (v) => v + 0.5;
  const W = () => QB.W;
  const inCone = (x, z) => W().guards.some((g) => g.alive && QB.inPoly(g.poly, g.polyN, x, z));
  // A laser is "unsafe" near a point if it is on now or switches on within `soon` seconds.
  function laserNear(x, z, soon) {
    for (const l of W().lasers) {
      if (l.disabled) continue;
      const ex = l.bx - l.ax, ez = l.bz - l.az, k = Math.max(0, Math.min(1, ((x - l.ax) * ex + (z - l.az) * ez) / (ex * ex + ez * ez)));
      if (Math.hypot(x - (l.ax + ex * k), z - (l.az + ez * k)) > QB.C.pr + 0.05) continue;
      if (!l.on) return true;
      const c = l.on + l.off, ph = (W().t + l.phase) % c;
      if (ph < l.on || c - ph < soon) return true;
    }
    return false;
  }
  let trail = [];
  // If a guard can see us right now, step back toward the most recent spot nobody could see.
  function retreat() {
    const P = W().P;
    // With the pot-plant disguise, the right move under a cone is to freeze.
    if (P.hasPlant && inCone(P.x, P.z)) { QB.setMove(0, 0); return true; }
    if (!inCone(P.x, P.z)) {
      const l = trail[trail.length - 1];
      if (!l || Math.hypot(l[0] - P.x, l[1] - P.z) > 0.25) { trail.push([P.x, P.z]); if (trail.length > 80) trail.shift(); }
      return false;
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      const q = trail[i];
      if (Math.hypot(q[0] - P.x, q[1] - P.z) > 0.9 && !inCone(q[0], q[1])) { const bx = q[0] - P.x, bz = q[1] - P.z, bl = Math.hypot(bx, bz); QB.setMove(bx / bl, bz / bl); return true; }
    }
    return false;
  }
  function steer(tx, tz, safe, st) {
    const P = W().P;
    if (!st.path || st.rep-- <= 0 || Math.hypot(st.tx - tx, st.tz - tz) > 0.3) {
      st.path = QB.findPath(P.x, P.z, tx, tz) || [[P.x, P.z], [tx, tz]]; st.pi = 1; st.rep = 15; st.tx = tx; st.tz = tz;
    }
    while (st.pi < st.path.length - 1 && Math.hypot(st.path[st.pi][0] - P.x, st.path[st.pi][1] - P.z) < 0.2) st.pi++;
    const p = st.path[Math.min(st.pi, st.path.length - 1)];
    let dx = p[0] - P.x, dz = p[1] - P.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.03) { QB.setMove(0, 0); return; }
    dx /= d; dz /= d;
    // Never stop inside a laser beam's path: finish crossing first.
    if (laserNear(P.x, P.z, 99)) { QB.setMove(dx, dz); return; }
    if (safe) {
      if (retreat()) { st.rep = 0; return; }
      for (const k of [0.35, 0.8]) if (inCone(P.x + dx * k, P.z + dz * k)) { QB.setMove(0, 0); st.waits = (st.waits || 0) + 1; return; }
      for (const k of [0.2, 0.5, 0.8]) if (laserNear(P.x + dx * k, P.z + dz * k, 0.45)) { QB.setMove(0, 0); return; }
    }
    QB.setMove(dx, dz);
  }
  function cond(expr) {
    // Helpers available to `until` expressions.
    const g = (id) => QB.guard(id);
    const P = W().P;
    const away = (id, deg = 110) => { const o = g(id); const a = Math.atan2(P.z - o.z, P.x - o.x) - o.ang; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > deg * Math.PI / 180; };
    const dist = (id) => Math.hypot(g(id).x - P.x, g(id).z - P.z);
    const at = (id, x, z, r = 0.6) => Math.hypot(g(id).x - T(x), g(id).z - T(z)) < r;
    return new Function('g', 'P', 'W', 'away', 'dist', 'at', 'inCone', 'return (' + expr + ');').bind(null, g, P, W(), away, dist, at, inCone);
  }
  function run(plan, opts = {}) {
    const stepsLog = [];
    trail = [];
    for (let si = 0; si < plan.length; si++) {
      const s = plan[si], st = {}, lim = (s.timeout || 60) * 60;
      let ticks = 0;
      const t0 = W().t;
      for (;;) {
        if (W().outcome) return result(si, stepsLog);
        if (ticks++ > lim) { QB.setMove(0, 0); return result(si, stepsLog, 'timeout on step ' + si + ' ' + JSON.stringify(s)); }
        const P = W().P;
        let done = false;
        if (s.go) {
          const tx = T(s.go[0]), tz = T(s.go[1]);
          if (s.vent) { if (P.vent) st.entered = true; if (st.entered && !P.vent) done = true; }
          else if (Math.hypot(P.x - tx, P.z - tz) < 0.2) done = true;
          if (done) QB.setMove(0, 0); else if (!P.vent) steer(tx, tz, !s.unsafe, st);
        } else if (s.kill) {
          const g = QB.guard(s.kill);
          if (!g.alive) { done = true; QB.setMove(0, 0); } else steer(g.x, g.z, !s.unsafe, st);
        } else if (s.wait !== undefined) { if (!retreat()) QB.setMove(0, 0); done = ticks > s.wait * 60; }
        else if (s.until) { if (!retreat()) QB.setMove(0, 0); st.fn = st.fn || cond(s.until); done = st.fn(); }
        else if (s.throw) { QB.setMove(0, 0); done = QB.tapWorld(T(s.throw[0]), T(s.throw[1])) || ticks > 1; }
        else if (s.snipe) {
          const g = QB.guard(s.snipe);
          if (!g.alive) done = true;
          else if (!s.when || (st.fn = st.fn || cond(s.when))()) { QB.aim(g.x, g.z); QB.sniperFire(); done = true; }
        } else if (s.fire) { QB.aim(T(s.fire[0]), T(s.fire[1])); QB.sniperFire(); done = true; }
        else if (s.exit) { const e = W().L.exit; steer(e.x, e.z, !s.unsafe, st); }
        if (done) { stepsLog.push({ step: si, t: +(W().t - t0).toFixed(2) }); break; }
        QB.step(1);
        if (opts.trace) for (const g of W().guards) {
          if (g._st !== g.state) { if (g._st !== undefined && g.state !== 'dead') stepsLog.push(`${W().t.toFixed(2)} ${g.id} ${g._st}->${g.state} g=${g.x.toFixed(1)},${g.z.toFixed(1)} a=${Math.round(g.ang * 57.3)} p=${W().P.x.toFixed(1)},${W().P.z.toFixed(1)} step${si}`); g._st = g.state; }
        }
      }
    }
    for (let k = 0; k < 240 && !W().outcome; k++) QB.step(1);
    return result(plan.length, stepsLog);
  }
  function result(step, log, why) {
    const w = W();
    return {
      win: !!(w.outcome && w.outcome.win), outcome: w.outcome, step, why: why || (w.outcome && w.outcome.reason) || null,
      t: +w.t.toFixed(2), hp: w.P.hp, everAlert: w.everAlert, log,
      guards: w.guards.map((g) => `${g.id}:${g.alive ? g.state : 'dead'}@${g.x.toFixed(1)},${g.z.toFixed(1)}`).join(' '),
      player: `${w.P.x.toFixed(1)},${w.P.z.toFixed(1)}`,
    };
  }
  return { run, inCone, laserNear, trail: () => trail, retreat };
})();
