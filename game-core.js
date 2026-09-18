/* Game rules are independent of rendering; inject a seeded RNG for tests. */
(() => {
  'use strict';
  const ROWS = 4, COLS = 6;
  const LEVELS = [
    { name: 'Первая ниточка', chapter: 'Знакомство', flies: 3, tip: 'Слушай колонки и ставь нити. Радар покажет точные клетки.' },
    { name: 'Крест-накрест', chapter: 'Знакомство', flies: 4, tip: 'Открыт крест: центр и четыре соседние клетки за 2 шёлка.' },
    { name: 'Пушистый кокон', chapter: 'Знакомство', flies: 5, tip: 'Кокон держится две проверки и ловит в квадрате 2 × 2.' },
    { name: 'Шустрые гости', chapter: 'Знакомство', flies: 5, swift: 2, time: 1, tip: 'Шустрики летят до двух клеток. Росинка заморозит движение и подлёт на одну проверку.' },
    { name: 'Шёлковая дорожка', chapter: 'Сад секретов', flies: 6, swift: 2, tip: 'Поле выросло до 7 × 5! Новая лента накрывает всю строку. Бонус главы: +1 к запасу шёлка, максимум — 10.' },
    { name: 'Жужжи в броне', chapter: 'Сад секретов', flies: 5, armored: 2, time: 1, tip: 'Броня требует двух попаданий. Первый удар оглушает муху: она остаётся видимой и не приближается.' },
    { name: 'Туманная полянка', chapter: 'Сад секретов', flies: 6, swift: 2, armored: 1, fog: true, tip: 'В тумане шорох говорит только «есть мухи» или «пусто». Радар по-прежнему видит всё.' },
    { name: 'Цветочный капкан', chapter: 'Сад секретов', flies: 7, armored: 2, leaves: 2, tip: 'Цветок накрывает до девяти клеток и пробивает броню. На клетках с листьями плести нельзя.' },
    { name: 'Липкие листочки', chapter: 'Большая охота', flies: 7, swift: 2, armored: 2, leaves: 3, tip: 'Теперь поле 8 × 6! Бонус главы: +1 к запасу шёлка, максимум — 10. Листья мешают любой части паутины: лови мух на свободных клетках.' },
    { name: 'Ветер-озорник', chapter: 'Большая охота', flies: 8, swift: 3, armored: 2, gust: true, tip: 'Порывы дают всем мухам ещё один шаг: обычным — до двух, шустрикам — до трёх.' },
    { name: 'Розовые сумерки', chapter: 'Большая охота', flies: 8, swift: 3, armored: 3, fog: true, leaves: 2, tip: 'Туман, броня и листья вместе. Береги радар, цветок и росинку для решающего хода.' },
    { name: 'Большой жужж-пикник', chapter: 'Большая охота', flies: 10, swift: 3, armored: 3, queen: 1, leaves: 2, gust: true, time: 1, tip: 'Королева выдерживает три удара и отнимает две жизни. Цветок наносит два удара сразу!' },
  ];
  const WAVES = LEVELS.length;
  const DIFFICULTIES = {
    easy: { name: 'Тёплый вечер', health: 4, silk: 6, time: 6, extraFlies: 0 },
    normal: { name: 'Сумерки', health: 3, silk: 5, time: 5, extraFlies: 0 },
    hard: { name: 'Глубокая ночь', health: 2, silk: 5, time: 4, extraFlies: 1 },
    expert: { name: 'Гроза в саду', health: 2, silk: 4, time: 4, extraFlies: 2 },
    nightmare: { name: 'Жужж-кошмар', health: 1, silk: 4, time: 3, extraFlies: 2 },
  };
  const ENEMIES = {
    ordinary: { name: 'Муха', hp: 1, speed: 1, bonus: 0, damage: 1, badge: '' },
    swift: { name: 'Шустрик', hp: 1, speed: 2, bonus: 25, damage: 1, badge: '»' },
    armored: { name: 'Бронежужжа', hp: 2, speed: 1, bonus: 75, damage: 1, badge: '◆' },
    queen: { name: 'Королева', hp: 3, speed: 1, bonus: 250, damage: 2, badge: '♛' },
  };
  const TRAPS = {
    thread: { name: 'Нить', cost: 1, unlock: 1, duration: 1, power: 1, icon: 'web', description: '1 клетка · 1 проверка' },
    cross: { name: 'Крест', cost: 2, unlock: 2, duration: 1, power: 1, icon: 'cross', description: 'До 5 клеток · 1 проверка' },
    cocoon: { name: 'Кокон', cost: 3, unlock: 3, duration: 2, power: 1, icon: 'cocoon', description: '2 × 2 · 2 проверки' },
    ribbon: { name: 'Лента', cost: 3, unlock: 5, duration: 1, power: 1, icon: 'ribbon', description: 'Вся строка · 1 проверка' },
    blossom: { name: 'Цветок', cost: 4, unlock: 8, duration: 1, power: 2, icon: 'blossom', description: 'До 3 × 3 · сила 2' },
  };
  const WINDS = [
    { name: 'Ветер на восток', dr: 0, dc: 1 }, { name: 'Ветер на запад', dr: 0, dc: -1 },
    { name: 'Ветер к опушке', dr: -1, dc: 0 }, { name: 'Ветер к Танюшке', dr: 1, dc: 0 },
  ];
  const boardSize = wave => ({ rows: wave >= 9 ? 6 : wave >= 5 ? 5 : 4, cols: wave >= 9 ? 8 : wave >= 5 ? 7 : 6 });
  const cellKey = (r, c, cols = COLS) => r * cols + c;
  const coordinate = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`;
  const inside = (r, c, rows = ROWS, cols = COLS) => r >= 0 && r < rows && c >= 0 && c < cols;
  function coverage(type, r, c, rows = ROWS, cols = COLS) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || !inside(r, c, rows, cols)) return [];
    if (type === 'cocoon') return r < rows - 1 && c < cols - 1 ? [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]] : [];
    if (type === 'cross') return [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => inside(y, x, rows, cols));
    if (type === 'ribbon') return Array.from({ length: cols }, (_, x) => [r, x]);
    if (type === 'blossom') return [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => [r + dy, c + dx])).filter(([y, x]) => inside(y, x, rows, cols));
    return type === 'thread' ? [[r, c]] : [];
  }
  class Game {
    constructor(difficulty = 'normal', random = Math.random) { this.random = random; this.start(difficulty); }
    pick(items) { return items[Math.floor(this.random() * items.length)]; }
    level() { return LEVELS[this.state.wave - 1]; }
    coverage(type, r, c) { return coverage(type, r, c, this.state.rows, this.state.cols); }
    key(r, c) { return cellKey(r, c, this.state.cols); }
    start(difficulty = 'normal') {
      const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
      this.state = {
        difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal', wave: 1, turn: 1,
        health: config.health, maxHealth: config.health, maxSilk: config.silk,
        radarCapacity: 1, freezeCapacity: 1, maxTraps: 3, score: 0, totalCaught: 0, totalEscaped: 0,
      };
      this.trapId = 0; this.beginWave();
    }
    beginWave() {
      const s = this.state, level = this.level(), config = DIFFICULTIES[s.difficulty];
      Object.assign(s, boardSize(s.wave));
      const count = level.flies + config.extraFlies;
      const time = Math.max(3, config.time - Math.floor((s.wave - 1) / 5)) + (level.time || 0) + (s.wave >= 5 ? 1 : 0);
      const available = Array.from({ length: s.rows * s.cols }, (_, i) => i);
      const takeCell = () => available.splice(Math.floor(this.random() * available.length), 1)[0];
      const kinds = [...Array(level.queen || 0).fill('queen'), ...Array(level.armored || 0).fill('armored'), ...Array(level.swift || 0).fill('swift')];
      s.flies = Array.from({ length: count }, (_, i) => {
        const cell = takeCell(), kind = kinds[i] || 'ordinary';
        return { id: `${s.wave}-${i}`, r: Math.floor(cell / s.cols), c: cell % s.cols, ttl: time + (i % 3 === 2 ? 1 : 0), kind, hp: ENEMIES[kind].hp, stunned: false };
      });
      // Leaves are ground obstacles. Initial flies start over free cells, but
      // can subsequently fly above leaves; only placing traps is restricted.
      s.blocked = Array.from({ length: level.leaves || 0 }, takeCell);
      Object.assign(s, { status: 'planning', turn: 1, waveTotal: count, waveCaught: 0, waveEscaped: 0,
        traps: [], silk: s.maxSilk, radarLeft: s.radarCapacity, freezeLeft: s.freezeCapacity,
        frozen: false, scanned: false, wind: this.pick(WINDS), maxTime: time + 1 });
    }
    noise() {
      return Array.from({ length: this.state.cols }, (_, c) => {
        const count = this.state.flies.filter(f => f.c === c).length;
        return this.level().fog ? Number(count > 0) : count;
      });
    }
    trapAt(r, c) { return this.state.traps.find(t => this.coverage(t.type, t.r, t.c).some(([y, x]) => y === r && x === c)); }
    canPlace(type, r, c) {
      const s = this.state, spec = TRAPS[type];
      if (s.status !== 'planning') return 'Дождись следующего хода.';
      if (!spec) return 'Выбери паутину.';
      if (s.wave < spec.unlock) return `Эта паутина откроется на уровне ${spec.unlock}.`;
      const cells = this.coverage(type, r, c);
      if (!cells.length) return 'Паутина должна целиком помещаться на поле.';
      if (cells.some(([y, x]) => s.blocked.includes(this.key(y, x)))) return 'Листья мешают плести. Вся паутина должна лежать на свободных клетках.';
      if (s.traps.length >= s.maxTraps) return `Лимит ловушек: ${s.maxTraps}. Убери одну повторным кликом.`;
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
      const trap = this.state.traps.find(t => t.id === id);
      if (!trap) return false;
      if (trap.fresh) this.state.silk += TRAPS[trap.type].cost;
      this.state.traps = this.state.traps.filter(t => t.id !== id);
      return true;
    }
    clearNew() { [...this.state.traps].filter(t => t.fresh).forEach(t => this.remove(t.id)); }
    scan() {
      const s = this.state;
      if (s.status !== 'planning' || s.scanned) return { ok: false, error: 'Воздух уже раскрыт на этот ход.' };
      if (s.radarLeft <= 0) return { ok: false, error: 'В этом уровне больше нельзя прислушаться.' };
      if (s.silk < 2) return { ok: false, error: 'Чтобы прислушаться, нужно 2 шёлка.' };
      s.silk -= 2; s.radarLeft--; s.scanned = true;
      return { ok: true };
    }
    freeze() {
      const s = this.state;
      if (s.status !== 'planning' || s.wave < 4 || s.frozen || s.freezeLeft <= 0 || s.silk < 2) return { ok: false, error: 'Росинка доступна с уровня 4: нужны 2 шёлка и неиспользованный заряд.' };
      s.silk -= 2; s.freezeLeft--; s.frozen = true;
      return { ok: true };
    }
    resolve() {
      const s = this.state;
      if (s.status !== 'planning') return null;
      s.status = 'resolving';
      const report = { flies: s.flies.map(f => ({ ...f })), traps: s.traps.map(t => ({ ...t })), caught: [], escaped: [], wounded: [], score: 0, damage: 0 };
      const power = new Map(s.traps.flatMap(t => this.coverage(t.type, t.r, t.c).map(([r, c]) => [this.key(r, c), TRAPS[t.type].power])));
      const survivors = [];
      for (const original of s.flies) {
        const fly = { ...original, stunned: false };
        const hit = power.get(this.key(fly.r, fly.c)) || 0;
        if (hit) {
          fly.hp = (fly.hp || 1) - hit;
          if (fly.hp <= 0) { report.caught.push(fly); continue; }
          fly.stunned = true;
          report.wounded.push({ ...fly });
        }
        if (!s.frozen && !fly.stunned) fly.ttl--;
        if (fly.ttl <= 0) report.escaped.push(fly);
        else survivors.push(fly);
      }
      const count = report.caught.length;
      report.score = report.caught.reduce((sum, f) => sum + 100 + (s.wave - 1) * 25 + ENEMIES[f.kind || 'ordinary'].bonus, 0) + Math.max(0, count - 1) * 50;
      report.damage = report.escaped.reduce((sum, f) => sum + ENEMIES[f.kind || 'ordinary'].damage, 0);
      s.score += report.score; s.waveCaught += count; s.totalCaught += count;
      s.waveEscaped += report.escaped.length; s.totalEscaped += report.escaped.length;
      s.health = Math.max(0, s.health - report.damage);
      s.flies = survivors;
      s.traps = s.traps.filter(t => --t.turns > 0).map(t => ({ ...t, fresh: false }));
      return report;
    }
    advance() {
      const s = this.state;
      if (s.status !== 'resolving') return s.status;
      if (s.health <= 0) return (s.status = 'lost');
      if (!s.flies.length) return (s.status = s.wave === WAVES ? 'won' : 'waveComplete');
      const occupied = new Set(s.flies.map(f => this.key(f.r, f.c)));
      for (const fly of s.flies) {
        if (s.frozen || fly.stunned) continue;
        const speed = ENEMIES[fly.kind || 'ordinary'].speed + (this.level().gust ? 1 : 0);
        for (let step = 0; step < speed; step++) {
          occupied.delete(this.key(fly.r, fly.c));
          const w = s.wind;
          const steps = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [w.dr, w.dc], [w.dr, w.dc]];
          const options = steps.map(([dr, dc]) => [fly.r + dr, fly.c + dc]).filter(([r, c]) => inside(r, c, s.rows, s.cols) && !occupied.has(this.key(r, c)));
          [fly.r, fly.c] = this.pick(options);
          occupied.add(this.key(fly.r, fly.c));
        }
      }
      s.turn++; s.silk = s.maxSilk; s.scanned = false; s.frozen = false;
      s.wind = this.pick(WINDS); s.status = 'planning';
      return s.status;
    }
    upgrades() {
      const s = this.state;
      const choices = [
        { id: 'silk', symbol: '⌁', name: 'Больше шёлка', detail: `+1 каждый ход · будет ${s.maxSilk + 1}`, disabled: s.maxSilk >= 10 },
        { id: 'radar', symbol: '◎', name: 'Чуткие лапки', detail: `+1 радар за уровень · будет ${s.radarCapacity + 1}`, disabled: s.radarCapacity >= 3 },
        { id: 'heart', symbol: '♡', name: 'Второе дыхание', detail: `+1 жизнь · будет ${Math.min(5, s.health + 1)}`, disabled: s.health >= 5 },
        { id: 'slots', symbol: '✣', name: 'Ловкие лапки', detail: `+1 ловушка на поле · будет ${s.maxTraps + 1}`, disabled: s.wave < 3 || s.maxTraps >= 5 },
        { id: 'freeze', symbol: '❄', name: 'Запас росинок', detail: '+1 заморозка за уровень · будет 2', disabled: s.wave < 3 || s.freezeCapacity >= 2 },
      ];
      if (choices.every(choice => choice.disabled)) choices.push({ id: 'rest', symbol: '♡', name: 'Всё готово!', detail: 'Все улучшения собраны. Продолжить охоту.', disabled: false });
      return choices;
    }
    nextWave(upgrade) {
      const s = this.state;
      const choice = this.upgrades().find(u => u.id === upgrade);
      if (s.status !== 'waveComplete' || !choice || choice.disabled) return false;
      if (upgrade === 'silk') s.maxSilk++;
      if (upgrade === 'radar') s.radarCapacity++;
      if (upgrade === 'slots') s.maxTraps++;
      if (upgrade === 'freeze') s.freezeCapacity++;
      if (upgrade === 'heart') { s.health++; s.maxHealth = Math.max(s.maxHealth, s.health); }
      s.wave++;
      if (s.wave === 5 || s.wave === 9) s.maxSilk = Math.min(10, s.maxSilk + 1);
      this.beginWave(); return true;
    }
  }
  window.SilkGame = { Game, LEVELS, ENEMIES, TRAPS, DIFFICULTIES, WINDS, ROWS, COLS, WAVES, boardSize, coverage, cellKey, coordinate };
})();
