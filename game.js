(() => {
  'use strict';
  const { Game, TRAPS, DIFFICULTIES, ROWS, COLS, WAVES, coverage, cellKey, coordinate } = window.SilkGame;
  const $ = id => document.getElementById(id);
  const icon = (name, className = '') => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const game = new Game();
  let selectedTrap = 'thread';
  let selectedDifficulty = 'normal';
  let selectedUpgrade = 'silk';
  let soundEnabled = false;
  let audioContext;
  let toastTimer;
  let generation = 0;
  let record = 0;
  try { record = Number(localStorage.getItem('silk-wings-record')) || 0; } catch (_) { /* Storage is optional. */ }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? Math.min(ms, 100) : ms));
  const plural = (number, forms) => forms[number % 100 >= 11 && number % 100 <= 14 ? 2 : number % 10 === 1 ? 0 : number % 10 >= 2 && number % 10 <= 4 ? 1 : 2];
  const flyText = n => `${n} ${plural(n, ['муха', 'мухи', 'мух'])}`;
  const airCells = [];
  const webCells = [];

  function sound(kind) {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const notes = kind === 'catch' ? [440, 554, 659] : kind === 'scan' ? [330, 660] : kind === 'lost' ? [220, 165] : kind === 'merge' ? [110, 147] : [540];
      notes.forEach((frequency, i) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + i * .09;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.055, start + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + .22);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + .23);
      });
    } catch (_) { soundEnabled = false; updateSoundButton(); }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3400);
  }

  function setNote(message) { $('turn-note').lastElementChild.textContent = message; }

  function buildBoards() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const air = document.createElement('div');
      air.className = 'air-cell';
      $('air-grid').append(air);
      airCells.push(air);
      const cell = document.createElement('button');
      cell.className = 'web-cell';
      cell.type = 'button';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.tabIndex = r === 0 && c === 0 ? 0 : -1;
      cell.addEventListener('click', () => onCellClick(r, c));
      cell.addEventListener('pointerenter', () => showPreview(r, c));
      cell.addEventListener('focus', () => {
        webCells.forEach(item => { item.tabIndex = item === cell ? 0 : -1; });
        showPreview(r, c);
      });
      cell.addEventListener('blur', clearPreview);
      cell.addEventListener('keydown', event => {
        const steps = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (!steps[event.key]) return;
        event.preventDefault();
        const [dr, dc] = steps[event.key];
        const row = Math.max(0, Math.min(ROWS - 1, r + dr));
        const col = Math.max(0, Math.min(COLS - 1, c + dc));
        webCells[cellKey(row, col)].focus();
      });
      $('web-grid').append(cell);
      webCells.push(cell);
    }
    $('web-grid').addEventListener('pointerleave', clearPreview);
    $('trap-list').innerHTML = Object.entries(TRAPS).map(([type, trap]) => `<button class="trap-option" data-trap="${type}" aria-pressed="${type === selectedTrap}">${icon(trap.icon)}<span class="trap-copy"><strong>${trap.name}</strong><small>${trap.description}</small></span><span class="trap-price">${trap.cost} <span>⌁</span></span></button>`).join('');
    $('trap-list').addEventListener('click', event => {
      const option = event.target.closest('[data-trap]');
      if (!option || option.disabled) return;
      selectedTrap = option.dataset.trap;
      sound('place');
      renderTools();
      renderBoards();
      const spec = TRAPS[selectedTrap];
      setNote(`${spec.name}: ${spec.description.toLowerCase()}. Выбери место на нижнем поле.`);
    });
  }

  function clearPreview() { webCells.forEach(cell => cell.classList.remove('preview', 'invalid-preview')); }

  function showPreview(r, c) {
    clearPreview();
    if (game.state.status !== 'planning' || game.trapAt(r, c)) return;
    const cells = coverage(selectedTrap, r, c);
    const invalid = game.canPlace(selectedTrap, r, c);
    (cells.length ? cells : [[r, c]]).forEach(([y, x]) => webCells[cellKey(y, x)].classList.add(invalid ? 'invalid-preview' : 'preview'));
  }

  function onCellClick(r, c) {
    if (game.state.status !== 'planning') return;
    const existing = game.trapAt(r, c);
    if (existing) {
      const fresh = existing.fresh;
      game.remove(existing.id);
      setNote(fresh ? 'Ловушка снята. Шёлк вернулся в запас.' : 'Старый кокон снят. Место снова свободно.');
    } else {
      const result = game.place(selectedTrap, r, c);
      if (!result.ok) { toast(result.error); return; }
      sound('place');
      setNote(`${TRAPS[selectedTrap].name} на ${coordinate(r, c)}. ${game.state.traps.length === game.state.maxTraps ? 'Ловушки готовы — схлопни поля.' : 'Можно сплести ещё или проверить ловушки.'}`);
    }
    render();
  }

  function renderBoards(report = null) {
    const s = game.state;
    airCells.forEach(cell => { cell.className = 'air-cell'; cell.replaceChildren(); });
    webCells.forEach((cell, i) => {
      const r = Math.floor(i / COLS), c = i % COLS;
      cell.className = 'web-cell';
      cell.replaceChildren();
      cell.disabled = s.status !== 'planning';
      cell.setAttribute('aria-label', `${coordinate(r, c)}, пусто. Поставить: ${TRAPS[selectedTrap].name}`);
      cell.setAttribute('aria-pressed', 'false');
    });
    const traps = report ? report.traps : s.traps;
    traps.forEach(trap => coverage(trap.type, trap.r, trap.c).forEach(([r, c]) => {
      const cell = webCells[cellKey(r, c)];
      const anchor = r === trap.r && c === trap.c;
      cell.classList.add('has-trap');
      if (!anchor) cell.classList.add('coverage-cell');
      if (!trap.fresh) cell.classList.add('persisted');
      cell.innerHTML = icon(anchor ? TRAPS[trap.type].icon : 'web') + (anchor && trap.type === 'cocoon' ? `<span class="trap-lifetime">${trap.turns}</span>` : '');
      cell.setAttribute('aria-label', `${coordinate(r, c)}, ${TRAPS[trap.type].name}. Осталось проверок: ${trap.turns}. Нажми, чтобы убрать.`);
      cell.setAttribute('aria-pressed', 'true');
    }));
    if (s.scanned || report) {
      const flies = report ? report.flies : s.flies;
      flies.forEach(fly => {
        const cell = airCells[cellKey(fly.r, fly.c)];
        cell.classList.add('revealed');
        cell.innerHTML = icon('fly');
      });
      $('air-grid').setAttribute('aria-label', `Мухи в клетках: ${flies.map(f => coordinate(f.r, f.c)).join(', ') || 'нет'}`);
    } else $('air-grid').setAttribute('aria-label', 'Воздушное поле: положение мух скрыто. Слушай шорох по колонкам.');
    if (report) {
      report.caught.forEach(fly => {
        airCells[cellKey(fly.r, fly.c)].classList.add('caught');
        webCells[cellKey(fly.r, fly.c)].classList.add('collision');
      });
      report.escaped.forEach(fly => {
        const cell = airCells[cellKey(fly.r, fly.c)];
        cell.classList.add('escaped');
        cell.replaceChildren();
      });
    }
    const counts = game.noise();
    $('noise-meters').innerHTML = counts.map((count, i) => `<span class="noise-meter" role="img" aria-label="Колонка ${'ABCDEF'[i]}: ${flyText(count)}" title="${'ABCDEF'[i]}: ${flyText(count)}">${[1, 2, 3].map(n => `<span class="noise-bar ${count >= n ? 'lit' : ''}"></span>`).join('')}</span>`).join('');
  }

  function renderTools() {
    const s = game.state;
    document.querySelectorAll('[data-trap]').forEach(option => {
      const type = option.dataset.trap;
      const trap = TRAPS[type];
      const locked = s.wave < trap.unlock;
      option.disabled = locked || s.status !== 'planning';
      option.classList.toggle('selected', type === selectedTrap);
      option.setAttribute('aria-pressed', String(type === selectedTrap));
      option.title = locked ? `Откроется в волне ${trap.unlock}` : `${trap.name}: ${trap.description}. Цена: ${trap.cost} шёлка.`;
      const badge = option.lastElementChild;
      badge.className = locked ? 'locked-label' : 'trap-price';
      badge.innerHTML = locked ? `Волна ${trap.unlock}` : `${trap.cost} <span>⌁</span>`;
    });
    $('silk-count').textContent = s.silk;
    $('silk-max').textContent = `/ ${s.maxSilk}`;
    $('radar-button').disabled = s.status !== 'planning' || s.scanned || s.radarLeft === 0 || s.silk < 2;
    $('radar-caption').textContent = s.scanned ? 'Координаты раскрыты до конца хода' : s.radarLeft === 0 ? 'Отдохни до следующей волны' : `Увидеть мух · осталось ${s.radarLeft}`;
    $('clear-button').disabled = s.status !== 'planning' || !s.traps.some(trap => trap.fresh);
    $('merge-button').disabled = s.status !== 'planning';
    $('merge-button').children[1].textContent = s.status === 'resolving' ? 'Слушаем тишину…' : 'Схлопнуть поля';
    $('restart-button').disabled = s.status === 'resolving';
    $('difficulty-button').disabled = s.status === 'resolving';
  }

  function render(report = null) {
    const s = game.state;
    $('wave-label').textContent = `ВОЛНА ${String(s.wave).padStart(2, '0')} / 05`;
    $('turn-label').textContent = `ХОД ${String(s.turn).padStart(2, '0')}`;
    $('difficulty-button').innerHTML = `${DIFFICULTIES[s.difficulty].name} <span>↗</span>`;
    $('air-count').textContent = flyText(s.flies.length);
    $('placement-count').textContent = `${s.traps.length} / ${s.maxTraps} ловушки`;
    $('caught-count').textContent = s.waveCaught;
    $('total-flies').textContent = s.waveTotal;
    $('score').textContent = String(s.score).padStart(4, '0');
    const time = s.flies.length ? Math.min(...s.flies.map(fly => fly.ttl)) : 0;
    $('threat-label').textContent = s.flies.length ? `${time} ${plural(time, ['ход', 'хода', 'ходов'])}` : 'Чистый воздух';
    $('threat-track').classList.toggle('danger', time <= 2 && s.flies.length > 0);
    $('threat-track').innerHTML = Array.from({ length: s.maxTime }, (_, i) => `<span class="threat-segment ${i < time ? 'active' : ''}"></span>`).join('');
    $('wind-icon').textContent = s.wind.icon;
    $('wind-label').textContent = s.wind.name;
    $('hearts').innerHTML = Array.from({ length: s.maxHealth }, (_, i) => icon('heart', i >= s.health ? 'lost-heart' : '')).join('');
    $('hearts').setAttribute('aria-label', `Жизни: ${s.health} из ${s.maxHealth}`);
    const home = document.querySelector('.spider-home');
    home.classList.toggle('happy', Boolean(report?.caught.length));
    home.classList.toggle('worried', Boolean(report?.escaped.length));
    $('spider-caption').textContent = report?.caught.length ? 'Ням! Спасибо за обед!' : report?.escaped.length ? 'Эй! Куда без очереди?' : s.health === 1 ? 'Осторожно, мои лапки!' : s.traps.length ? 'Хе-хе… теперь подождём!' : 'Ну что, сплетём обед?';
    $('progress-count').textContent = `${s.wave} / ${WAVES}`;
    $('wave-progress').innerHTML = Array.from({ length: WAVES }, (_, i) => `<span class="wave-step ${i + 1 < s.wave ? 'complete' : i + 1 === s.wave ? 'current' : ''}"></span>`).join('');
    $('progress-hint').textContent = s.wave === 1 ? 'Во второй волне откроется паутина «Крест».' : s.wave === 2 ? 'В третьей волне откроется прочный «Кокон».' : s.wave === 5 ? 'Последний рой. Пусть этот вечер станет твоим.' : 'Мух всё больше. Сохрани жизни до пятой волны.';
    renderTools();
    renderBoards(report);
  }

  async function merge() {
    if (game.state.status !== 'planning' || document.querySelector('dialog[open]')) return;
    const token = generation;
    const report = game.resolve();
    if (!report) return;
    clearPreview();
    renderTools();
    webCells.forEach(cell => { cell.disabled = true; });
    const distance = $('web-grid').getBoundingClientRect().top - $('air-grid').getBoundingClientRect().top;
    $('arena').style.setProperty('--merge-offset', `${distance / 2}px`);
    $('arena').classList.add('merging');
    setNote('Слои сближаются. Сейчас всё станет видно…');
    sound('merge');
    await wait(650);
    if (token !== generation) return;
    render(report);
    $('arena').classList.add('checking');
    const caught = report.caught.length;
    const escaped = report.escaped.length;
    $('result-banner').innerHTML = caught ? `${caught > 1 ? 'КУШАТЬ ПОДАНО!' : 'ПОПАЛАСЬ!'}<small>${flyText(caught)} · +${report.score} очков${caught > 1 ? ' · комбо!' : ''}</small>` : escaped ? 'АЙ-АЙ-АЙ!<small>Мухи добрались до паука</small>' : 'ВЖУ-У-УХ!<small>Только ветер. Мухи в других клетках!</small>';
    $('result-banner').classList.add('visible');
    sound(caught ? 'catch' : escaped ? 'lost' : 'merge');
    await wait(1150);
    if (token !== generation) return;
    $('arena').classList.remove('merging');
    await wait(600);
    if (token !== generation) return;
    $('result-banner').classList.remove('visible');
    $('arena').classList.remove('checking');
    const status = game.advance();
    render();
    if (status !== 'planning') {
      saveRecord();
      showWaveDialog();
    } else {
      setNote(`${caught ? `Поймано: ${caught}. ` : 'Ни одной мухи в этот раз. '}${escaped ? `Потеряно жизней: ${escaped}. ` : ''}Мухи переместились. Снова твой ход.`);
      $('field-note').textContent = escaped ? 'Они уже близко. «Прислушаться» раскрывает координаты, а крест накрывает сразу несколько клеток.' : caught ? 'Шорох изменился: выжившие перелетели на соседние клетки. Ветер подскажет вероятное направление.' : 'После каждого схлопывания мухи смещаются не дальше одной клетки. По ветру они летят чаще.';
    }
  }

  function saveRecord() {
    record = Math.max(record, game.state.score);
    try { localStorage.setItem('silk-wings-record', String(record)); } catch (_) { /* Private mode still allows a full game. */ }
  }

  function showWaveDialog() {
    const s = game.state;
    const finished = s.status === 'won' || s.status === 'lost';
    const won = s.status === 'won';
    $('wave-dialog').classList.toggle('lost', s.status === 'lost');
    $('wave-dialog').querySelector('.celebration-icon').innerHTML = icon(finished && !won ? 'fly' : 'spider');
    $('wave-dialog-eyebrow').textContent = finished ? won ? 'ПЯТЬ ВОЛН. ОДИН ОЧЕНЬ ДОВОЛЬНЫЙ ПАУК.' : 'У КАЖДОГО ПАУКА БЫВАЕТ ТАКОЙ ВЕЧЕР' : `ВОЛНА ${s.wave} ПОЗАДИ`;
    $('wave-dialog-title').textContent = finished ? won ? 'Этот вечер — твой.' : 'Крылья оказались быстрее.' : 'Воздух стал тише.';
    $('wave-dialog-description').textContent = finished ? won ? 'Ты выдержал все пять волн. Можно наконец отдохнуть в своей паутине.' : 'Мухи добрались до паука. Попробуй снова: слушай колонки и береги радар для решающего хода.' : `${s.waveEscaped ? `Ускользнуло мух: ${s.waveEscaped}. ` : 'Ни одна муха не добралась до тебя. '}${s.wave === 1 ? 'Теперь тебе доступна паутина «Крест».' : s.wave === 2 ? 'Теперь тебе доступен прочный «Кокон».' : 'Следующий рой уже на подходе.'}`;
    $('wave-summary').innerHTML = `<div><strong>${finished ? s.totalCaught : s.waveCaught}</strong><span>поймано мух</span></div><div><strong>${s.score}</strong><span>очков за охоту</span></div><div><strong>${finished ? record : s.health}</strong><span>${finished ? 'твой рекорд' : 'жизней осталось'}</span></div>`;
    $('upgrade-section').hidden = finished;
    if (!finished) {
      selectedUpgrade = 'silk';
      const upgrades = [
        ['silk', '⌁', 'Больше шёлка', `+1 шёлк каждый ход · будет ${s.maxSilk + 1}`],
        ['radar', '◎', 'Чуткие лапки', `+1 радар в каждой волне · будет ${s.radarCapacity + 1}`],
        ['heart', '♡', 'Второе дыхание', s.health >= 5 ? 'У тебя уже максимум: 5 жизней' : `+1 жизнь прямо сейчас · будет ${s.health + 1}`],
      ];
      $('upgrade-options').innerHTML = upgrades.map(([id, symbol, name, description]) => `<button class="upgrade-option ${id === selectedUpgrade ? 'selected' : ''}" data-upgrade="${id}" aria-pressed="${id === selectedUpgrade}" ${id === 'heart' && s.health >= 5 ? 'disabled' : ''}><span class="upgrade-symbol">${symbol}</span><span><strong>${name}</strong><small>${description}</small></span></button>`).join('');
    }
    $('next-wave-button').innerHTML = `${finished ? 'Ещё одна охота' : `Навстречу волне ${s.wave + 1}`} <span>↗</span>`;
    $('wave-dialog').showModal();
  }

  function startNewGame(difficulty) {
    generation++;
    saveRecord();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    game.start(difficulty);
    selectedTrap = 'thread';
    $('arena').classList.remove('merging', 'checking');
    $('result-banner').classList.remove('visible');
    $('toast').classList.remove('visible');
    $('field-note').textContent = 'Мух не видно, но слышно. Чем громче шорох в колонке, тем больше в ней крыльев.';
    setNote('Твой ход. Тишина на твоей стороне.');
    render();
  }

  function openNewGame() {
    selectedDifficulty = game.state.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach(button => {
      button.classList.toggle('selected', button.dataset.difficulty === selectedDifficulty);
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === selectedDifficulty));
    });
    $('record-line').textContent = `Твой рекорд: ${Math.max(record, game.state.score)}`;
    $('new-game-dialog').showModal();
  }

  function updateSoundButton() {
    $('sound-button').classList.toggle('muted', !soundEnabled);
    $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
    $('sound-button').setAttribute('aria-label', soundEnabled ? 'Выключить звук' : 'Включить звук');
    $('sound-button').title = soundEnabled ? 'Выключить звук' : 'Включить звук';
  }

  $('merge-button').addEventListener('click', merge);
  $('clear-button').addEventListener('click', () => { game.clearNew(); render(); setNote('Новые ловушки сняты. Попробуй другую расстановку.'); });
  $('radar-button').addEventListener('click', () => {
    const result = game.scan();
    if (!result.ok) return toast(result.error);
    sound('scan');
    render();
    setNote('Вот они! Координаты видны до схлопывания. Плети точно под мухами.');
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('restart-button').addEventListener('click', openNewGame);
  $('difficulty-button').addEventListener('click', openNewGame);
  $('start-game-button').addEventListener('click', () => startNewGame(selectedDifficulty));
  $('sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled; updateSoundButton(); if (soundEnabled) sound('place'); });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('[data-difficulty]').forEach(button => button.addEventListener('click', () => {
    selectedDifficulty = button.dataset.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach(item => {
      item.classList.toggle('selected', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
  }));
  $('upgrade-options').addEventListener('click', event => {
    const button = event.target.closest('[data-upgrade]');
    if (!button || button.disabled) return;
    selectedUpgrade = button.dataset.upgrade;
    document.querySelectorAll('[data-upgrade]').forEach(item => {
      item.classList.toggle('selected', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
  $('wave-dialog').addEventListener('cancel', event => event.preventDefault());
  $('next-wave-button').addEventListener('click', () => {
    if (['won', 'lost'].includes(game.state.status)) return startNewGame(game.state.difficulty);
    if (!game.nextWave(selectedUpgrade)) return;
    $('wave-dialog').close();
    render();
    setNote(`Волна ${game.state.wave}. ${game.state.wave === 2 ? 'Попробуй крест: он накрывает до пяти клеток.' : game.state.wave === 3 ? 'Кокон останется на поле на две проверки.' : 'Слушай внимательно — крыльев стало больше.'}`);
    sound('catch');
  });
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    merge();
  });
  window.addEventListener('pagehide', saveRecord);
  buildBoards();
  render();
})();
