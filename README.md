# Quiet Blade

A top-down stealth assassination game for phone and desktop browsers. Sneak past vision cones, take guards out
from behind, finish the contract and get to the exit.

**Play:** open `stealthninja.html` in any modern browser. It's one self-contained file (Three.js r149 is inlined),
so it works offline and needs no server.

## Controls
- **Phone:** touch and drag anywhere to move (a joystick appears under your finger), and let go to stop. Tap a red
  barrel to throw a shuriken at it.
- **Desktop:** drag with the mouse or use WASD/arrow keys. Click a barrel to throw, and press Esc to pause.
- **Sniper levels:** drag to aim and let go to fire (Space also fires).

## Rules
- Guards see only inside their cone, and cones stop at walls. The cone turns yellow when a guard is suspicious
  ("?") and red when it sees you or is alerted ("!").
- Alerted guards chase you and shoot, so you lose health. At zero health you fail the level.
- Reach a guard from outside its cone and you take it down automatically.
- If a target spots you, it runs for the exit, and you fail if it gets there.

## Chapter 1: Lantern Harbor
| # | Level | Type | Introduces |
|---|-------|------|------------|
| 1 | Pier Lanterns | Contract | Moving, takedowns, patrol guards, targets |
| 2 | Net Lofts | Contract | Sentries (stand and look around), hidden passages |
| 3 | Cannery | Contract | Explosive barrels |
| 4 | Blackout Docks | Contract | Flashlight guards (long, narrow beam) in the dark |
| 5 | Customs House | Contract | Laser tripwires, some blinking |
| 6 | Glasshouse | Contract | Pot-plant disguise (invisible while standing still) |
| 7 | Harbor Bank | Heist | Laser switch, safe cracking, escape with the loot |
| 8 | Crane Sight | Sniper | Limited ammo. A body seen by anyone makes the targets run |
| 9 | Night Market | Contract | Everything together |
| 10 | The Broker | Boss | Three hits, runs to another room after each, two bodyguards who glance back |

Coins from contracts (plus a ghost bonus if nobody raised the alarm) buy heroes and blade looks in the Hideout.
Progress is saved in the browser.

## Development
- `src/game.js` is the engine, `src/levels.js` holds the level data (with an ASCII map legend at the top), and
  `src/template.html` is the page shell.
- `npm install` and then `npm run build` write `stealthninja.html`.
- `npm test` builds and runs the Playwright tests in `tests/`. They need Playwright with Chromium
  (`npm i -D playwright && npx playwright install chromium`). A bot (`tests/bot.js`, plans in `tests/plans.js`)
  plays every level through to the end. The tests also check that the drawn cone is the exact polygon used for
  detection, and they compare it against brute-force line of sight. Screenshots go to `screenshots/`.
- `RESEARCH.md` lists the reference game's mechanics. The gameplay is in the same genre, but the names, characters,
  art and levels are all original.
