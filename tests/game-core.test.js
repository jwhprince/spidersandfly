(() => {
  'use strict';
  const { Game, coverage, cellKey } = window.SilkGame;
  const results = [];
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function test(name, run) {
    try { run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  function seeded(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function fixture() { return new Game('normal', seeded(123)); }

  test('Three difficulties produce valid, distinct starting resources', () => {
    const easy = new Game('easy'), normal = fixture(), hard = new Game('hard');
    assert(easy.state.health === 4 && easy.state.silk === 6, 'Easy resources');
    assert(normal.state.health === 3 && normal.state.silk === 5, 'Normal resources');
    assert(hard.state.health === 2 && hard.state.flies.length === 4, 'Hard resources');
    for (const game of [easy, normal, hard]) {
      assert(new Set(game.state.flies.map(f => cellKey(f.r, f.c))).size === game.state.flies.length, 'Overlapping flies');
      assert(game.noise().reduce((a, b) => a + b, 0) === game.state.flies.length, 'Noise must account for every fly');
    }
  });

  test('Placement enforces price, three traps, locks, and refunds', () => {
    const g = fixture();
    assert(!g.place('cross', 0, 0).ok, 'Cross must be locked');
    assert(!g.place('thread', -1, 0).ok, 'Outside board');
    for (let c = 0; c < 3; c++) assert(g.place('thread', 0, c).ok, 'Place three threads');
    assert(g.state.silk === 2, 'Pay for silk');
    assert(!g.place('thread', 1, 0).ok, 'Fourth trap must be rejected');
    g.clearNew();
    assert(g.state.silk === 5 && g.state.traps.length === 0, 'Refund all new traps');
  });

  test('Radar reveals one turn, costs silk, and cannot be used twice', () => {
    const g = fixture();
    assert(g.scan().ok, 'First scan');
    assert(g.state.silk === 3 && g.state.scanned && g.state.radarLeft === 0, 'Scan resources');
    assert(!g.scan().ok && g.state.silk === 3, 'Duplicate scan must not spend silk');
    g.resolve(); g.advance();
    assert(!g.state.scanned && g.state.silk === 5 && g.state.radarLeft === 0, 'Turn reset must not refill radar');
  });

  test('Capture on the final approach turn saves the spider and awards combo', () => {
    const g = fixture();
    g.state.flies = [{ id: 'a', r: 0, c: 0, ttl: 1 }, { id: 'b', r: 1, c: 1, ttl: 1 }];
    g.place('thread', 0, 0); g.place('thread', 1, 1);
    const report = g.resolve();
    assert(report.caught.length === 2 && report.escaped.length === 0, 'Catch must happen before approach');
    assert(report.score === 250 && g.state.health === 3, 'Combo and health');
    assert(g.resolve() === null && g.state.score === 250, 'Resolve is guarded against double clicks');
    assert(g.advance() === 'waveComplete', 'Wave completes after all captures');
  });

  test('Cross coverage clips at borders and traps cannot overlap', () => {
    const g = fixture(); g.state.wave = 2;
    assert(coverage('cross', 0, 0).length === 3, 'Corner cross covers three');
    assert(coverage('cross', 1, 1).length === 5, 'Interior cross covers five');
    assert(g.place('cross', 1, 1).ok, 'Place cross');
    assert(!g.place('thread', 0, 1).ok, 'Cannot overlap cross arm');
    assert(g.trapAt(1, 2).type === 'cross', 'Arm must resolve to its anchor');
    assert(g.remove(g.trapAt(1, 2).id) && g.state.silk === 5, 'Remove through arm and refund once');
  });

  test('Cocoon persists two checks and an old cocoon never refunds silk', () => {
    const g = fixture(); g.state.wave = 3;
    g.state.flies = [{ id: 'safe', r: 3, c: 5, ttl: 5 }];
    assert(!g.place('cocoon', 3, 5).ok, 'Cocoon must fit entirely');
    assert(g.place('cocoon', 0, 0).ok, 'Place cocoon');
    g.resolve(); g.advance();
    assert(g.state.traps.length === 1 && g.state.traps[0].turns === 1 && !g.state.traps[0].fresh, 'Cocoon survives first check');
    g.clearNew();
    assert(g.state.traps.length === 1, 'Clear new must preserve old cocoon');
    g.resolve(); g.advance();
    assert(g.state.traps.length === 0, 'Cocoon expires after second check');
    const second = fixture(); second.state.wave = 3;
    second.place('cocoon', 0, 0); second.resolve(); second.advance();
    const silk = second.state.silk;
    second.remove(second.state.traps[0].id);
    assert(second.state.silk === silk, 'Old cocoon cannot mint silk');
  });

  test('Uncaught flies approach; zero health loses even when the wave empties', () => {
    const g = fixture(); g.state.health = 1;
    g.state.flies = [{ id: 'a', r: 0, c: 0, ttl: 1 }];
    const report = g.resolve();
    assert(report.escaped.length === 1 && g.state.health === 0, 'An escaped fly costs one life');
    assert(g.advance() === 'lost', 'Loss takes priority over empty wave');
    assert(!g.nextWave('heart'), 'Cannot revive through upgrade after loss');
  });

  test('Upgrades apply once; five completed waves lead to victory', () => {
    const g = fixture();
    for (let wave = 1; wave <= 5; wave++) {
      assert(g.state.wave === wave, 'Wave order');
      g.state.flies = [{ id: 'target', r: 0, c: 0, ttl: 2 }];
      g.place('thread', 0, 0); g.resolve();
      const status = g.advance();
      if (wave < 5) {
        assert(status === 'waveComplete', 'Upgrade phase');
        const oldSilk = g.state.maxSilk;
        assert(g.nextWave('silk'), 'Advance');
        assert(g.state.maxSilk === oldSilk + 1 && g.state.silk === oldSilk + 1, 'Permanent silk');
        assert(!g.nextWave('silk') && g.state.maxSilk === oldSilk + 1, 'No duplicate upgrade');
      } else assert(status === 'won', 'Victory on wave five');
    }
  });

  test('Heart and radar upgrades persist into subsequent waves', () => {
    const g = fixture();
    g.state.status = 'waveComplete';
    g.nextWave('radar');
    assert(g.state.radarCapacity === 2 && g.state.radarLeft === 2, 'Extra scan refills');
    g.state.status = 'waveComplete'; g.nextWave('heart');
    assert(g.state.health === 4 && g.state.maxHealth === 4, 'Heart increases usable health');
    g.state.status = 'waveComplete'; g.nextWave('heart');
    g.state.status = 'waveComplete'; g.nextWave('heart');
    assert(g.state.health === 5, 'Health capped at five');
  });

  test('Movement stays local, on the field, and collision-free across 300 seeded turns', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const g = new Game('hard', seeded(seed));
      g.state.wave = 5; g.beginWave();
      g.state.flies.forEach(f => { f.ttl = 9; });
      for (let turn = 0; turn < 3; turn++) {
        const before = g.state.flies.map(f => ({ ...f }));
        g.resolve(); g.advance();
        for (const fly of g.state.flies) {
          const old = before.find(f => f.id === fly.id);
          assert(Math.abs(fly.r - old.r) + Math.abs(fly.c - old.c) <= 1, 'A fly moved too far');
          assert(fly.r >= 0 && fly.r < 4 && fly.c >= 0 && fly.c < 6, 'A fly left the field');
          assert(fly.ttl === old.ttl - 1, 'Approach counter');
        }
        assert(new Set(g.state.flies.map(f => cellKey(f.r, f.c))).size === g.state.flies.length, 'Flies collided');
      }
    }
  });
  window.__testResults = results;
})();
