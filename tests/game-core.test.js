(() => {
  'use strict';
  const { Game, coverage, cellKey, WAVES, LEVELS, ENEMIES, DIFFICULTIES } = window.SilkGame;
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

  test('Upgrades apply once; all twelve completed levels lead to victory', () => {
    const g = fixture();
    for (let wave = 1; wave <= WAVES; wave++) {
      assert(g.state.wave === wave, 'Wave order');
      g.state.blocked = [];
      g.state.flies = [{ id: 'target', r: 0, c: 0, ttl: 2 }];
      g.place('thread', 0, 0); g.resolve();
      const status = g.advance();
      if (wave < WAVES) {
        assert(status === 'waveComplete', 'Upgrade phase');
        const oldSilk = g.state.maxSilk;
        const choice = g.upgrades().find(u => !u.disabled).id;
        assert(g.nextWave(choice), 'Advance');
        const expectedSilk = Math.min(10, oldSilk + (choice === 'silk' ? 1 : 0) + ([5, 9].includes(wave + 1) ? 1 : 0));
        assert(g.state.maxSilk === expectedSilk && g.state.silk === expectedSilk, 'Permanent silk');
        assert(!g.nextWave(choice) && g.state.maxSilk === expectedSilk, 'No duplicate upgrade');
      } else assert(status === 'won', 'Victory on level twelve');
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
          assert(Math.abs(fly.r - old.r) + Math.abs(fly.c - old.c) <= ENEMIES[fly.kind || 'ordinary'].speed, 'A fly moved too far');
          assert(fly.r >= 0 && fly.r < g.state.rows && fly.c >= 0 && fly.c < g.state.cols, 'A fly left the field');
          assert(fly.ttl === old.ttl - 1, 'Approach counter');
        }
        assert(new Set(g.state.flies.map(f => g.key(f.r, f.c))).size === g.state.flies.length, 'Flies collided');
      }
    }
  });

  test('All 60 difficulty/level combinations generate a valid roster and free starting cells', () => {
    for (const difficulty of Object.keys(DIFFICULTIES)) for (let level = 1; level <= WAVES; level++) {
      const g = new Game(difficulty, seeded(level)); g.state.wave = level; g.beginWave();
      const s = g.state;
      assert(s.flies.length === LEVELS[level - 1].flies + DIFFICULTIES[difficulty].extraFlies, 'Roster size');
      assert(s.flies.every(f => f.hp === ENEMIES[f.kind].hp && !s.blocked.includes(g.key(f.r, f.c))), 'Free starting cell and correct armor');
      assert(new Set(s.flies.map(f => g.key(f.r, f.c))).size === s.flies.length, 'Unique flies');
      assert(new Set(s.blocked).size === (LEVELS[level - 1].leaves || 0), 'Unique leaves');
    }
  });
  test('Armor hit on the last approach turn stuns and exposes without costing a life', () => {
    const g = fixture(); g.state.wave = 6;
    g.state.flies = [{ id: 'armor', kind: 'armored', hp: 2, r: 1, c: 1, ttl: 1 }];
    g.place('thread', 1, 1);
    const first = g.resolve();
    assert(first.wounded.length === 1 && !first.caught.length && g.state.health === 3, 'Armor absorbs first hit');
    g.advance();
    const f = g.state.flies[0];
    assert(f.r === 1 && f.c === 1 && f.ttl === 1 && f.hp === 1 && f.stunned, 'Stun must preserve position and approach');
    g.place('thread', 1, 1); const second = g.resolve();
    assert(second.caught.length === 1 && g.advance() === 'waveComplete', 'Second hit catches armor');
  });
  test('Rosinka stops approach and movement once, then normal movement resumes', () => {
    const g = fixture(); assert(!g.freeze().ok, 'Locked before level four');
    g.state.wave = 4; g.beginWave();
    g.state.flies.forEach(f => { f.ttl = 1; });
    const before = g.state.flies.map(f => ({ ...f }));
    assert(g.freeze().ok && !g.freeze().ok, 'One charge per cast');
    assert(g.state.silk === 3, 'Freeze cost');
    g.resolve(); g.advance();
    assert(g.state.flies.every((f,i) => f.r === before[i].r && f.c === before[i].c && f.ttl === 1), 'Entire flock frozen');
    assert(!g.state.frozen && g.state.freezeLeft === 0, 'Freeze ends and charge stays spent');
    assert(g.resolve().escaped.length === before.length, 'Approach resumes next check');
  });
  test('Fog never leaks counts through noise but radar still works', () => {
    const g = fixture(); g.state.wave = 7; g.beginWave();
    g.state.flies = [{r:0,c:0,ttl:3}, {r:1,c:0,ttl:3}, {r:2,c:0,ttl:3}];
    assert(g.noise()[0] === 1 && g.noise()[1] === 0, 'Binary clues in fog');
    assert(g.scan().ok && g.state.scanned, 'Radar bypasses fog');
  });
  test('Leaves block every covered cell and rejection does not spend silk', () => {
    const g = fixture(); g.state.wave = 8; g.state.blocked = [cellKey(1, 2)];
    for (const type of ['thread','cross','cocoon','ribbon','blossom']) {
      assert(!g.place(type,1,2).ok && g.state.silk === 5, 'No placement through leaf');
    }
    assert(!g.place('cross',1,1).ok && !g.place('ribbon',1,0).ok, 'Leaf on any arm blocks full trap');
    assert(g.place('thread',0,0).ok, 'Free cells remain usable');
  });
  test('Ribbon covers exactly one row; blossom clips and deals two damage', () => {
    assert(coverage('ribbon',2,4).length === 6 && coverage('ribbon',2,4).every(([r]) => r === 2), 'Whole row');
    assert(coverage('blossom',0,0).length === 4 && coverage('blossom',1,1).length === 9, 'Flower bounds');
    const g = fixture(); g.state.wave = 12;
    g.state.flies = [{ id:'queen', kind:'queen', hp:3, r:1,c:1,ttl:1 }, { id:'armor', kind:'armored', hp:2, r:0,c:0,ttl:1 }];
    g.place('blossom',1,1); const report = g.resolve();
    assert(report.caught.length === 1 && report.wounded[0].hp === 1, 'Flower defeats armor, wounds queen');
    g.advance(); g.place('thread',1,1); g.resolve();
    assert(g.advance() === 'won', 'Queen can be finished on last approach turn');
  });
  test('Queen escape deals two lives and upgrades never soft-lock capped builds', () => {
    const g = fixture(); g.state.wave = 12;
    g.state.flies = [{kind:'queen',hp:3,r:0,c:0,ttl:1}];
    assert(g.resolve().damage === 2 && g.state.health === 1, 'Queen deals two');
    Object.assign(g.state, {wave:11,status:'waveComplete',maxSilk:10,radarCapacity:3,health:5,maxTraps:5,freezeCapacity:2});
    assert(g.upgrades().some(u => u.id === 'rest' && !u.disabled), 'Fallback upgrade');
    assert(g.nextWave('rest') && g.state.wave === 12, 'Capped player can continue');
  });
  test('Gusts add one bounded step and never merge flies', () => {
    for (let seed=1; seed<=40; seed++) {
      const g=new Game('normal',seeded(seed)); g.state.wave=10; g.beginWave();
      const before=g.state.flies.map(f=>({...f})); g.resolve(); g.advance();
      g.state.flies.forEach((f,i)=>assert(Math.abs(f.r-before[i].r)+Math.abs(f.c-before[i].c)<=ENEMIES[f.kind].speed+1,'Gust distance'));
      assert(new Set(g.state.flies.map(f=>g.key(f.r,f.c))).size===g.state.flies.length,'No collisions');
    }
  });
  test('Boards grow at chapter boundaries and reset to the small garden on restart', () => {
    const g = fixture();
    for (let level = 1; level <= WAVES; level++) {
      g.state.wave = level; g.beginWave();
      const { rows, cols } = g.state;
      assert(cols === (level < 5 ? 6 : level < 9 ? 7 : 8), 'Column count');
      assert(rows === (level < 5 ? 4 : level < 9 ? 5 : 6), 'Row count');
      assert(g.noise().length === cols, 'One clue per column');
      assert(g.state.flies.every(f => f.r < rows && f.c < cols), 'Spawns within resized field');
      assert(new Set(Array.from({ length: rows * cols }, (_, i) => g.key(Math.floor(i / cols), i % cols))).size === rows * cols, 'Every tile has a unique key');
    }
    g.start('easy');
    assert(g.state.rows === 4 && g.state.cols === 6 && g.state.wave === 1, 'Restart shrinks both fields');
  });
  test('Traps reach the far edge of enlarged fields and preserve border rules', () => {
    const g = fixture(); g.state.wave = 9; g.beginWave(); g.state.blocked = [];
    assert(g.coverage('ribbon', 5, 7).length === 8, 'Ribbon spans all eight columns');
    assert(g.coverage('cross', 5, 7).length === 3, 'Corner cross clips to three');
    assert(g.coverage('blossom', 5, 7).length === 4, 'Corner flower clips to four');
    assert(!g.place('cocoon', 5, 7).ok && !g.place('thread', 6, 7).ok, 'Out-of-bounds traps rejected');
    g.state.flies = [{ id: 'edge', kind: 'ordinary', hp: 1, r: 5, c: 7, ttl: 1 }];
    assert(g.place('ribbon', 5, 2).ok && g.trapAt(5, 7).type === 'ribbon', 'Far edge covered');
    assert(g.resolve().caught.length === 1 && g.advance() === 'waveComplete', 'Capture at H6');
  });
  test('Growing the garden grants a capped permanent bonus exactly once', () => {
    for (const boundary of [4, 8]) {
      const g = fixture();
      Object.assign(g.state, { wave: boundary, status: 'waveComplete', maxSilk: 6 });
      assert(g.nextWave('radar') && g.state.maxSilk === 7 && g.state.silk === 7, 'Growth bonus');
      assert(!g.nextWave('radar') && g.state.maxSilk === 7, 'Cannot apply bonus twice');
      g.state.status = 'waveComplete'; g.nextWave('heart');
      assert(g.state.maxSilk === 7, 'No bonus between chapter boundaries');
    }
    const capped = fixture(); Object.assign(capped.state, {wave: 8, status: 'waveComplete', maxSilk: 10});
    capped.nextWave('radar');
    assert(capped.state.maxSilk === 10, 'Silk cap survives growth');
  });
  test('Late-game leaf collision uses the enlarged coordinate system', () => {
    const g = fixture(); g.state.wave = 9; g.beginWave(); g.state.blocked = [g.key(5, 7)];
    assert(!g.place('ribbon', 5, 0).ok && !g.place('blossom', 4, 6).ok, 'Any part touching H6 is blocked');
    assert(g.place('thread', 5, 6).ok, 'Adjacent G6 remains free');
    g.clearNew();
    assert(g.state.silk === g.state.maxSilk, 'Rejected traps do not consume silk');
  });
  window.__testResults = results;
})();
