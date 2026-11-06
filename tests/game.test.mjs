// Playwright tests for Quiet Blade. Run with `npm test` (builds stealthninja.html first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { PLANS } from './plans.js';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAME = 'file://' + path.join(root, 'stealthninja.html');
const BOT = path.join(root, 'tests', 'bot.js');
const SHOTS = path.join(root, 'screenshots');

let browser;
before(async () => { browser = await chromium.launch(); fs.mkdirSync(SHOTS, { recursive: true }); });
after(async () => { await browser.close(); });

async function open(opts = {}, query = '?test') {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME + query);
  await page.waitForFunction(() => window.QB);
  if (query) await page.addScriptTag({ path: BOT });
  page.errors = errors;
  return page;
}
const run = (page, i, plan = PLANS[i]) => page.evaluate(([i, plan]) => { QB.start(i); return Bot.run(plan); }, [i, plan]);

test('vision cones: drawn cone == checked cone, and guards never see through walls', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    let checked = 0, visible = 0, blocked = 0, mismatches = [], drawnDiff = 0;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let li = 0; li < QB.LEVELS.length; li++) {
      QB.start(li);
      for (const ticks of [0, 200, 400]) {
        QB.step(ticks ? 200 : 0);
        QB.render();
        for (const g of QB.W.guards) {
          if (!g.alive) continue;
          // 1) The polygon drawn on the floor is exactly the polygon the game tests against.
          const pa = QB.poly(g.id), da = QB.drawn(g.id);
          if (pa.length !== da.length) drawnDiff++;
          else for (let i = 0; i < pa.length; i++) if (Math.abs(pa[i] - da[i]) > 1e-4) { drawnDiff++; break; }
          // 2) Brute-force ground truth: in range, in angle, and a clear line past every wall.
          const ox = g.x, oz = g.z, R = g.range, half = g.half, ang = g.ang + (g.sweep || 0);
          for (let k = 0; k < 500; k++) {
            const x = ox + (rnd() * 2 - 1) * (R + 1), z = oz + (rnd() * 2 - 1) * (R + 1);
            const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz), rel = Math.abs(wrap(Math.atan2(dz, dx) - ang));
            if (Math.abs(d - R) < 0.03 || Math.abs(rel - half) < 0.004 || d < 0.05) continue; // skip points on the cone's own edge
            const los = QB.losClear(ox, oz, x, z);
            const ux = dx / d, uz = dz / d, e = 0.03;
            // Skip points within 3 cm of a wall's shadow edge or surface, where "seen" is a matter of rounding.
            if ([[-uz * e, ux * e], [uz * e, -ux * e], [ux * e, uz * e], [-ux * e, -uz * e]].some(([px, pz]) => QB.losClear(ox, oz, x + px, z + pz) !== los)) continue;
            const expected = d < R && rel < half && los, actual = QB.inPoly(g.poly, g.polyN, x, z);
            checked++; if (expected) visible++; if (d < R && rel < half && !los) blocked++;
            if (expected !== actual && mismatches.length < 5) mismatches.push({ level: li + 1, guard: g.id, x, z, expected, actual });
          }
        }
      }
    }
    return { checked, visible, blocked, mismatches, drawnDiff };
  });
  assert.equal(r.drawnDiff, 0, 'drawn cone differs from the checked polygon');
  assert.deepEqual(r.mismatches, [], 'cone polygon disagrees with brute-force line of sight');
  assert.ok(r.checked > 20000 && r.visible > 2000 && r.blocked > 500, JSON.stringify(r));
  await page.close();
});

test('takedown from behind works, from the front it does not', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    QB.start(0); const g = QB.guard('g1');
    // Directly behind the guard, 0.8 tiles away.
    QB.place(g.x - Math.cos(g.ang) * 0.8, g.z - Math.sin(g.ang) * 0.8); QB.step(2);
    const behind = !g.alive;
    QB.start(0); const h = QB.guard('g1');
    QB.place(h.x + Math.cos(h.ang) * 0.8, h.z + Math.sin(h.ang) * 0.8); QB.step(2);
    return { behind, frontAlive: h.alive, frontState: h.state };
  });
  assert.equal(r.behind, true);
  assert.equal(r.frontAlive, true);
  assert.notEqual(r.frontState, 'patrol', 'guard should notice a player right in front of it');
  await page.close();
});

test('getting spotted: suspicious "?", then alerted "!", red cone, shots cost health, death fails', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    QB.start(0); const g = QB.guard('g1'); g.route = null; g.home = [g.x, g.z]; g.ang = g.wantAng = 0; // hold still, facing right
    QB.place(g.x + 4.5, g.z); QB.step(1);
    const states = [g.state]; QB.render(); const color1 = QB.coneColor('g1');
    QB.step(20); states.push(g.state);
    QB.step(60); states.push(g.state); QB.render();
    const color2 = QB.coneColor('g1'), hp1 = QB.W.P.hp;
    QB.step(60 * 8);
    return { states, color1, color2, hp1, hp2: QB.W.P.hp, outcome: QB.W.outcome };
  });
  assert.deepEqual(r.states, ['suspicious', 'suspicious', 'alert']);
  assert.equal(r.color1, 0xff3b30, 'cone turns red while it sees you');
  assert.equal(r.color2, 0xff3b30);
  assert.ok(r.hp1 < 100, 'alerted guard shoots');
  assert.equal(r.hp2, 0);
  assert.deepEqual(r.outcome, { win: false, reason: 'You were taken down' });
  await page.close();
});

test('a brief glimpse only makes a guard suspicious, then it calms down', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    QB.start(0); const g = QB.guard('g1'); g.route = null; g.home = [g.x, g.z]; g.ang = g.wantAng = 0;
    QB.place(g.x + 5.5, g.z); QB.step(10); const s1 = g.state;
    QB.place(g.x - 3, g.z - 0.5); QB.step(120);
    return { s1, s2: g.state, sus: g.sus };
  });
  assert.equal(r.s1, 'suspicious');
  assert.equal(r.s2, 'patrol');
  await page.close();
});

test('objective: assassinate (Pier Lanterns) and a target escaping fails', async () => {
  const page = await open();
  const r = await run(page, 0);
  assert.ok(r.win, JSON.stringify(r));
  const esc = await page.evaluate(() => {
    QB.start(0); const t = QB.guard('t1');
    QB.place(t.x + Math.cos(t.ang) * 3, t.z + Math.sin(t.ang) * 3); QB.step(60);
    const state = t.state; QB.place(1.5, 1.5); QB.step(60 * 30);
    return { state, outcome: QB.W.outcome };
  });
  assert.equal(esc.state, 'flee');
  assert.deepEqual(esc.outcome, { win: false, reason: 'A target escaped' });
  await page.close();
});

test('objective: heist (Harbor Bank): switch kills the lasers, safe cracks, exit opens only after the loot', async () => {
  const page = await open();
  const pre = await page.evaluate(() => {
    QB.start(6); const e = QB.W.L.exit; QB.place(e.x, e.z); QB.step(5);
    return { outcome: QB.W.outcome, exitOpen: QB.W.exitOpen };
  });
  assert.deepEqual(pre, { outcome: null, exitOpen: false });
  const r = await run(page, 6);
  assert.ok(r.win, JSON.stringify(r));
  const s = await page.evaluate(() => ({ looted: QB.W.looted, sw: QB.W.L.sw.used, lasersA: QB.W.lasers.filter((l) => l.group === 'A').every((l) => l.disabled) }));
  assert.deepEqual(s, { looted: true, sw: true, lasersA: true });
  await page.close();
});

test('objective: sniper (Crane Sight): win, body seen raises alarm, out of ammo fails', async () => {
  const page = await open();
  const r = await run(page, 7);
  assert.ok(r.win, JSON.stringify(r));
  const alarm = await page.evaluate(() => {
    QB.start(7); QB.step(30);
    const s2 = QB.guard('s2'); s2.looks = [Math.PI]; s2.li = 0; s2.ang = s2.wantAng = Math.PI; QB.step(10); // s2 faces s1
    const s1 = QB.guard('s1'); QB.aim(s1.x, s1.z); QB.sniperFire(); QB.step(3);
    return { s1: s1.alive, t1: QB.guard('t1').state, t2: QB.guard('t2').state };
  });
  assert.deepEqual(alarm, { s1: false, t1: 'flee', t2: 'flee' });
  const ammo = await page.evaluate(() => { QB.start(7); for (let i = 0; i < 4; i++) { QB.aim(1.5, 1.5); QB.sniperFire(); } QB.step(60); return QB.W.outcome; });
  assert.deepEqual(ammo, { win: false, reason: 'Out of ammo' });
  await page.close();
});

test('objective: boss (The Broker) needs three hits and runs after each', async () => {
  const page = await open();
  const hits = await page.evaluate(() => {
    QB.start(9); const b = QB.guard('b'), out = [];
    for (let k = 0; k < 3; k++) {
      while (b.inv) QB.step(1);
      QB.place(b.x - Math.cos(b.ang) * 0.8, b.z - Math.sin(b.ang) * 0.8); QB.step(2);
      out.push({ hp: b.hp, alive: b.alive, dashing: b.inv, room: b.room });
      QB.step(25);
    }
    return out;
  });
  assert.deepEqual(hits, [
    { hp: 2, alive: true, dashing: true, room: 1 },
    { hp: 1, alive: true, dashing: true, room: 2 },
    { hp: 0, alive: false, dashing: false, room: 2 },
  ]);
  const r = await run(page, 9);
  assert.ok(r.win, JSON.stringify(r));
  await page.close();
});

test('hazards and tools: lasers, barrels, flashlights, hidden passages, plant disguise, sentries', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    const out = {};
    // Laser: stepping into a beam alerts everyone and sends the target running.
    QB.start(4); const l = QB.W.lasers[0]; while (!QB.laserOn(l)) QB.step(1);
    QB.place((l.ax + l.bx) / 2, 7.5); QB.step(2);
    out.laser = { g1: QB.guard('g1').state, t1: QB.guard('t1').state };
    // Barrel: a thrown shuriken blows it up and takes out everyone in the blast.
    QB.start(2); QB.place(8.5, 5.5); out.thrown = QB.tapWorld(12.5, 3.5); QB.step(30);
    out.barrel = ['s1', 's2', 't1'].map((id) => QB.guard(id).alive);
    // Too far / no line of sight: no throw.
    QB.start(2); out.farThrow = QB.tapWorld(12.5, 3.5);
    // Flashlight: sees much farther than a normal guard, but only in a narrow beam.
    QB.start(3); const f = QB.guard('f1');
    out.flash = { range: f.range, far: QB.inPoly(f.poly, f.polyN, f.x + Math.cos(f.ang) * 9, f.z + Math.sin(f.ang) * 9),
      side: QB.inPoly(f.poly, f.polyN, f.x + Math.cos(f.ang + 0.6) * 3, f.z + Math.sin(f.ang + 0.6) * 3) };
    // Hidden passage: step on one grate, come out of the other.
    QB.start(1); const v = QB.W.L.vents[0]; QB.place(v.a.x, v.a.z); QB.step(40);
    out.vent = [+QB.W.P.x.toFixed(2), +QB.W.P.z.toFixed(2), v.b.x, v.b.z];
    // Pot plant: standing still inside a cone you are not seen; moving, you are.
    QB.start(5); const pl = QB.W.L.plant; QB.place(pl.x, pl.z); QB.step(2);
    const s1 = QB.guard('s1'); s1.looks = [Math.PI]; s1.li = 0; s1.ang = s1.wantAng = Math.PI;
    QB.place(s1.x - 4, s1.z); QB.step(60);
    out.plantStill = { hasPlant: QB.W.P.hasPlant, hidden: QB.W.P.hidden, state: s1.state, sus: s1.sus };
    QB.setMove(0, 1); QB.step(8); QB.setMove(null);
    out.plantMoving = { hidden: QB.W.P.hidden, state: s1.state };
    // Sentry: cycles through its look directions.
    QB.start(1); const s = QB.guard('s1'), seen = new Set();
    for (let i = 0; i < 6 * 60; i++) { QB.step(1); seen.add(Math.round(Math.atan2(Math.sin(s.ang), Math.cos(s.ang)) * 57.3 / 10) * 10); }
    out.sentry = { moved: Math.hypot(s.x - s.home[0], s.z - s.home[1]), looks: seen.has(180) || seen.has(-180), up: seen.has(-90) };
    return out;
  });
  assert.deepEqual(r.laser, { g1: 'alert', t1: 'flee' });
  assert.equal(r.thrown, true); assert.deepEqual(r.barrel, [false, false, false]);
  assert.equal(r.farThrow, false);
  assert.deepEqual(r.flash, { range: 9.5, far: true, side: false });
  assert.deepEqual(r.vent.slice(0, 2), r.vent.slice(2));
  assert.deepEqual(r.plantStill, { hasPlant: true, hidden: true, state: 'patrol', sus: 0 });
  assert.equal(r.plantMoving.hidden, false); assert.equal(r.plantMoving.state, 'suspicious');
  assert.deepEqual(r.sentry, { moved: 0, looks: true, up: true });
  await page.close();
});

test('the bot plays the whole chapter: every level completes and progress is saved', async () => {
  const page = await open();
  await page.evaluate(() => QB.resetSave());
  const results = [];
  for (let i = 0; i < PLANS.length; i++) {
    const r = await run(page, i);
    results.push(`${i + 1}:${r.win ? 'win' : 'FAIL ' + r.why}`);
    assert.ok(r.win, `level ${i + 1} ${QB_name(i)}: ${JSON.stringify(r)}`);
  }
  const s = await page.evaluate(() => QB.S);
  assert.equal(s.unlocked, 10); assert.equal(Object.keys(s.done).length, 10); assert.ok(s.coins > 1000, 'coins ' + s.coins);
  await page.reload(); await page.waitForFunction(() => window.QB);
  const saved = await page.evaluate(() => ({ unlocked: QB.S.unlocked, coins: QB.S.coins }));
  assert.deepEqual(saved, { unlocked: 10, coins: s.coins });
  await page.close();
});
const QB_name = (i) => ['Pier Lanterns', 'Net Lofts', 'Cannery', 'Blackout Docks', 'Customs House', 'Glasshouse', 'Harbor Bank', 'Crane Sight', 'Night Market', 'The Broker'][i];

test('real input: menus, drag-to-move joystick, keyboard, tap a barrel, shop', async () => {
  const page = await open({ viewport: { width: 1000, height: 700 } }, '');
  await page.click('text=Play');
  await page.click('.node.open');
  await page.click('text=Go');
  assert.equal(await page.evaluate(() => QB.screen), 'play');
  const x0 = await page.evaluate(() => QB.W.P.x);
  await page.mouse.move(500, 400); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(500 + i * 15, 400);
  await page.waitForTimeout(500);
  await page.mouse.up();
  const x1 = await page.evaluate(() => QB.W.P.x);
  assert.ok(x1 > x0 + 0.5, `mouse drag should move right: ${x0} -> ${x1}`);
  await page.keyboard.down('s'); await page.waitForTimeout(300); await page.keyboard.up('s');
  const z1 = await page.evaluate(() => QB.W.P.z);
  assert.ok(z1 > 1.6, 'S key moves down');
  // Tap a barrel on screen (level 3), from in range.
  await page.evaluate(() => { QB.start(2); QB.place(8.5, 5.5); QB.render(); });
  const pt = await page.evaluate(() => QB.toScreen(12.5, 3.5));
  await page.mouse.click(pt.x, pt.y);
  assert.equal(await page.evaluate(() => QB.W.proj.length + (QB.W.barrels[0].alive ? 0 : 1)), 1, 'tap throws a shuriken');
  // Shop: buy and equip with coins.
  await page.evaluate(() => { QB.S.coins = 500; QB.ui.shopScreen('heroes'); });
  await page.click('[data-act=buy][data-id=moth]');
  const s = await page.evaluate(() => ({ hero: QB.S.hero, coins: QB.S.coins, owned: QB.S.heroes }));
  assert.deepEqual(s, { hero: 'moth', coins: 350, owned: ['ink', 'moth'] });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('screenshots at phone and desktop sizes', async () => {
  const shots = [
    ['phone', devices['Pixel 7']],
    ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
  ];
  for (const [name, opts] of shots) {
    const page = await open(opts);
    const snap = async (file, fn, arg) => { await page.evaluate(fn, arg); await page.evaluate(() => QB.render()); await page.screenshot({ path: path.join(SHOTS, `${name}-${file}.png`) }); };
    await page.evaluate(() => { QB.resetSave(); QB.S.unlocked = 4; QB.S.done = { 0: 1, 1: 1, 2: 1 }; QB.S.coins = 420; });
    await snap('1-title', () => QB.ui.titleScreen());
    await snap('2-map', () => QB.ui.mapScreen());
    await snap('3-hideout', () => QB.ui.shopScreen('heroes'));
    await snap('4-pier', () => { QB.start(0); Bot.run([{ go: [6, 4] }]); QB.step(30); });
    await snap('5-spotted', () => { QB.start(0); const g = QB.guard('g1'); QB.step(90); QB.place(g.x + Math.cos(g.ang) * 3.5, g.z + Math.sin(g.ang) * 3.5); QB.step(70); });
    await snap('6-blackout', () => { QB.start(3); QB.step(120); });
    await snap('7-heist', () => { QB.start(6); Bot.run([{ go: [1, 9] }, { kill: 'g3' }, { go: [8, 9] }, { wait: 1.2 }]); });
    await snap('8-sniper', () => { QB.start(7); QB.step(60); const t = QB.guard('t1'); QB.aim(t.x + 0.3, t.z); });
    await snap('9-boss', () => { QB.start(9); QB.step(200); QB.place(8.5, 4.5); });
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});
