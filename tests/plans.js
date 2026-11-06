// Bot solutions for each level (index = level). Steps are run by tests/bot.js.
export const PLANS = [
  // 1 Pier Lanterns: guard takedown, target takedown, exit.
  [{ kill: 'g1' }, { kill: 't1' }, { exit: 1 }],
  // 2 Net Lofts: hidden passage in and out.
  [{ go: [4, 3], vent: 1 }, { kill: 't1' }, { go: [2, 9], vent: 1 }, { go: [7, 6] },
    { until: 'g("s1").li === 0 && g("s1").lookT < 0.3 && g("g1").ri === 1' }, { kill: 'g1' }, { exit: 1 }],
  // 3 Cannery: barrel blast from the doorway.
  [{ go: [7, 5] }, { go: [8, 5], unsafe: 1 }, { throw: [12, 3] }, { wait: 1 }, { exit: 1 }],
  // 4 Blackout Docks: flashlight patrols.
  [{ kill: 't1' }, { exit: 1 }],
  // 5 Customs House: blinking lasers.
  [{ kill: 't1' }, { exit: 1 }],
  // 6 Glasshouse: pot-plant disguise.
  [{ go: [3, 3] }, { kill: 's1' }, { kill: 't1' }, { exit: 1 }],
  // 7 Harbor Bank: switch, safe, escape.
  [{ go: [1, 9] }, { kill: 'g3' }, { go: [8, 9] }, { until: 'W.looted' }, { exit: 1 }],
  // 8 Crane Sight: barrel, then both targets.
  [{ wait: 1 }, { fire: [9, 3] }, { wait: 0.5 }, { snipe: 't1' }, { wait: 0.5 }, { snipe: 't2' }],
  // 9 Night Market.
  [{ go: [3, 3], vent: 1 }, { kill: 'g1' }, { kill: 't2' }, { go: [15, 10] }, { kill: 'f1' }, { go: [19, 9] }, { go: [9, 9] }, { go: [8, 8] }, { go: [8, 4] }, { throw: [12, 2] }, { wait: 1 }, { exit: 1 }],
  // 10 The Broker: one bodyguard per pass while he walks away, then the Broker himself (he runs after each hit).
  [
    { go: [7, 2] }, { until: 'g("b").ri === 1 && g("b").x < 14 && g("bg1").t % 7 < 0.6' }, { kill: 'bg1' },
    { go: [7, 2] }, { until: 'g("b").ri === 1 && g("b").x < 14 && g("bg2").t % 7 < 0.6' }, { kill: 'bg2' }, { kill: 'g1' },
    { go: [7, 2] }, { until: 'g("b").ri === 1 && g("b").x < 14' }, { kill: 'b', timeout: 120 }, { exit: 1 },
  ],
];
