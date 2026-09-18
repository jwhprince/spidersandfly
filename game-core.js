/* Pure game rules: no DOM, network, or external dependencies. */
(() => {
  'use strict';
  const ROWS = 4;
  const COLS = 6;
  const WAVES = 5;
  const DIFFICULTIES = {
    easy: { name: 'Тёплый вечер', health: 4, silk: 6, time: 6, extraFlies: 0 },
    normal: { name: 'Сумерки', health: 3, silk: 5, time: 5, extraFlies: 0 },
    hard: { name: 'Глубокая ночь', health: 2, silk: 5, time: 4, extraFlies: 1 },
  };
  const TRAPS = {
    thread: { name: 'Нить', cost: 1, unlock: 1, duration: 1, icon: 'web', description: '1 клетка · 1 проверка' },
    cross: { name: 'Крест', cost: 2, unlock: 2, duration: 1, icon: 'cross', description: 'До 5 клеток · 1 проверка' },
    cocoon: { name: 'Кокон', cost: 3, unlock: 3, duration: 2, icon: 'cocoon', description: '2 × 2 клетки · 2 проверки' },
  };
  const WINDS = [
    { name: 'Ветер на восток', icon: '→', dr: 0, dc: 1 },
    { name: 'Ветер на запад', icon: '←', dr: 0, dc: -1 },
    { name: 'Ветер к опушке', icon: '↑', dr: -1, dc: 0 },
    { name: 'Ветер к пауку', icon: '↓', dr: 1, dc: 0 },
  ];
  const cellKey = (r, c) => r * COLS + c;
  const coordinate = (r, c) => `${'ABCDEF'[c]}${r + 1}`;

  function coverage(type, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS || c < 0 || c >= COLS) return [];
    if (type === 'cocoon') {
      if (r >= ROWS - 1 || c >= COLS - 1) return [];
      return [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
    }
    if (type === 'cross') return [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && y < ROWS && x >= 0 && x < COLS);
    return type === 'thread' ? [[r, c]] : [];
  }

  class Game {
    constructor(difficulty = 'normal', random = Math.random) {
      this.random = random;
      this.start(difficulty);
    }

    pick(items) { return items[Math.floor(this.random() * items.length)]; }

    start(difficulty = 'normal') {
      const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
      this.state = {
        difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal',
        wave: 1, turn: 1, health: config.health, maxHealth: config.health,
        maxSilk: config.silk, radarCapacity: 1, maxTraps: 3,
        score: 0, totalCaught: 0, totalEscaped: 0,
      };
      this.trapId = 0;
      this.beginWave();
    }

    beginWave() {
      const s = this.state;
      const config = DIFFICULTIES[s.difficulty];
      const count = [3, 4, 5, 6, 8][s.wave - 1] + config.extraFlies;
      const time = Math.max(3, config.time - Math.floor((s.wave - 1) / 2));
      const available = Array.from({ length: ROWS * COLS }, (_, i) => i);
      s.flies = Array.from({ length: count }, (_, i) => {
        const index = Math.floor(this.random() * available.length);
        const cell = available.splice(index, 1)[0];
        return { id: `${s.wave}-${i}`, r: Math.floor(cell / COLS), c: cell % COLS, ttl: time + (i % 3 === 2 ? 1 : 0) };
      });
      Object.assign(s, {
        status: 'planning', turn: 1, waveTotal: count, waveCaught: 0, waveEscaped: 0,
        traps: [], silk: s.maxSilk, radarLeft: s.radarCapacity, scanned: false,
        wind: this.pick(WINDS), maxTime: time + (count >= 3 ? 1 : 0),
      });
    }

    noise() { return Array.from({ length: COLS }, (_, c) => this.state.flies.filter(fly => fly.c === c).length); }
    trapAt(r, c) { return this.state.traps.find(trap => coverage(trap.type, trap.r, trap.c).some(([y, x]) => y === r && x === c)); }

    canPlace(type, r, c) {
      const s = this.state;
      const spec = TRAPS[type];
      if (s.status !== 'planning') return 'Дождись следующего хода.';
      if (!spec) return 'Выбери паутину.';
      if (s.wave < spec.unlock) return `Эта паутина откроется в волне ${spec.unlock}.`;
      const cells = coverage(type, r, c);
      if (!cells.length) return 'Для кокона нужен квадрат 2 × 2 внутри поля.';
      if (s.traps.length >= s.maxTraps) return `На поле помещается ${s.maxTraps} ловушки. Убери одну повторным кликом.`;
      if (s.silk < spec.cost) return 'Не хватает шёлка. Убери новую ловушку или схлопни поля.';
      if (cells.some(([y, x]) => this.trapAt(y, x))) return 'Ловушки не должны пересекаться. Выбери свободное место.';
      return null;
    }

    place(type, r, c) {
      const error = this.canPlace(type, r, c);
      if (error) return { ok: false, error };
      const spec = TRAPS[type];
      this.state.silk -= spec.cost;
      this.state.traps.push({ id: ++this.trapId, type, r, c, turns: spec.duration, fresh: true });
      return { ok: true };
    }

    remove(id) {
      if (this.state.status !== 'planning') return false;
      const trap = this.state.traps.find(item => item.id === id);
      if (!trap) return false;
      if (trap.fresh) this.state.silk += TRAPS[trap.type].cost;
      this.state.traps = this.state.traps.filter(item => item.id !== id);
      return true;
    }

    clearNew() { [...this.state.traps].filter(trap => trap.fresh).forEach(trap => this.remove(trap.id)); }

    scan() {
      const s = this.state;
      if (s.status !== 'planning' || s.scanned) return { ok: false, error: 'Воздух уже раскрыт на этот ход.' };
      if (s.radarLeft <= 0) return { ok: false, error: 'В этой волне больше нельзя прислушаться.' };
      if (s.silk < 2) return { ok: false, error: 'Чтобы прислушаться, нужно 2 шёлка.' };
      s.silk -= 2;
      s.radarLeft--;
      s.scanned = true;
      return { ok: true };
    }

    resolve() {
      const s = this.state;
      if (s.status !== 'planning') return null;
      s.status = 'resolving';
      const report = { flies: s.flies.map(fly => ({ ...fly })), traps: s.traps.map(trap => ({ ...trap })), caught: [], escaped: [], score: 0 };
      const webCells = new Set(s.traps.flatMap(trap => coverage(trap.type, trap.r, trap.c).map(([r, c]) => cellKey(r, c))));
      const survivors = [];
      for (const fly of s.flies) {
        if (webCells.has(cellKey(fly.r, fly.c))) report.caught.push({ ...fly });
        else if (fly.ttl <= 1) report.escaped.push({ ...fly });
        else survivors.push({ ...fly, ttl: fly.ttl - 1 });
      }
      const count = report.caught.length;
      report.score = count * (100 + (s.wave - 1) * 25) + Math.max(0, count - 1) * 50;
      s.score += report.score;
      s.waveCaught += count;
      s.totalCaught += count;
      s.waveEscaped += report.escaped.length;
      s.totalEscaped += report.escaped.length;
      s.health = Math.max(0, s.health - report.escaped.length);
      s.flies = survivors;
      s.traps = s.traps.filter(trap => --trap.turns > 0).map(trap => ({ ...trap, fresh: false }));
      return report;
    }

    advance() {
      const s = this.state;
      if (s.status !== 'resolving') return s.status;
      if (s.health <= 0) return (s.status = 'lost');
      if (!s.flies.length) return (s.status = s.wave === WAVES ? 'won' : 'waveComplete');
      // Each survivor moves at most one cell. Reserve all occupied cells so
      // no two flies can land together, including flies not yet processed.
      const occupied = new Set(s.flies.map(fly => cellKey(fly.r, fly.c)));
      for (const fly of s.flies) {
        occupied.delete(cellKey(fly.r, fly.c));
        const w = s.wind;
        const steps = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [w.dr, w.dc], [w.dr, w.dc]];
        const options = steps.map(([dr, dc]) => [fly.r + dr, fly.c + dc]).filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS && !occupied.has(cellKey(r, c)));
        [fly.r, fly.c] = this.pick(options);
        occupied.add(cellKey(fly.r, fly.c));
      }
      s.turn++;
      s.silk = s.maxSilk;
      s.scanned = false;
      s.wind = this.pick(WINDS);
      s.status = 'planning';
      return s.status;
    }

    nextWave(upgrade) {
      const s = this.state;
      if (s.status !== 'waveComplete' || !['silk', 'radar', 'heart'].includes(upgrade)) return false;
      if (upgrade === 'silk') s.maxSilk++;
      if (upgrade === 'radar') s.radarCapacity++;
      if (upgrade === 'heart') {
        s.health = Math.min(5, s.health + 1);
        s.maxHealth = Math.max(s.maxHealth, s.health);
      }
      s.wave++;
      this.beginWave();
      return true;
    }
  }

  window.SilkGame = { Game, TRAPS, DIFFICULTIES, WINDS, ROWS, COLS, WAVES, coverage, cellKey, coordinate };
})();
