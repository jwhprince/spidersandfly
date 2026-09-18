(() => {
  'use strict';
  const { Game, LEVELS, ENEMIES, TRAPS, DIFFICULTIES, WAVES, boardSize, coordinate } = window.SilkGame;
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
  let boardDimensions = '';
  let seenTraps = new Set();
  const key = (r, c) => game.key(r, c);
  const trapCoverage = (type, r, c) => game.coverage(type, r, c);

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

  function animateStage() {
    if (reducedMotion.matches) return;
    [...airCells, ...webCells].forEach(cell => {
      cell.animate([{ opacity: .25 }, { opacity: 1 }], {
        duration: 360, delay: Number.parseFloat(cell.style.getPropertyValue('--tile-delay')), easing: 'ease-out',
      });
    });
  }

  function ripple(grid, color) {
    if (reducedMotion.matches) return;
    grid.animate([
      { outline: `2px solid ${color}`, outlineOffset: '0px' },
      { outline: '2px solid transparent', outlineOffset: '28px' },
    ], { duration: 750, easing: 'ease-out' });
  }

  function celebrate(report) {
    if (reducedMotion.matches) return;
    report.caught.forEach((fly, index) => {
      const rect = airCells[key(fly.r, fly.c)].getBoundingClientRect();
      for (let i = 0; i < 7; i++) {
        const spark = document.createElement('span');
        spark.className = 'catch-spark';
        spark.textContent = i % 3 ? '✦' : '♡';
        spark.style.left = `${rect.left + rect.width / 2}px`;
        spark.style.top = `${rect.top + rect.height / 2}px`;
        spark.style.color = ['#a82e66', '#75429d', '#b36a12'][i % 3];
        $('particle-layer').append(spark);
        const angle = i * Math.PI * 2 / 7;
        const animation = spark.animate([
          { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
          { opacity: 1, offset: .15 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * 56}px), calc(-50% + ${Math.sin(angle) * 40 - 30}px)) rotate(${i * 43}deg) scale(.8)`, opacity: 0 },
        ], { duration: 820, delay: index * 25, easing: 'cubic-bezier(.16,.7,.3,1)', fill: 'both' });
        animation.onfinish = () => spark.remove();
        animation.oncancel = () => spark.remove();
      }
    });
  }

  function buildBoards() {
    const { rows, cols } = game.state;
    airCells.length = 0; webCells.length = 0;
    $('air-grid').replaceChildren(); $('web-grid').replaceChildren();
    boardDimensions = `${rows}x${cols}`;
    $('arena').style.setProperty('--columns', cols);
    $('arena').style.setProperty('--rows', rows);
    $('arena').style.setProperty('--iso-width', `${100 * cols / (rows + cols)}%`);
    $('arena').style.setProperty('--iso-left', `${100 * rows / (rows + cols)}%`);
    $('arena').style.setProperty('--iso-ratio', `${cols} / ${rows}`);
    $('arena').classList.toggle('large-board', cols > 6);
    document.querySelectorAll('.coordinate-row').forEach(row => { row.innerHTML = Array.from({ length: cols }, (_, c) => `<span>${String.fromCharCode(65 + c)}</span>`).join(''); });
    document.querySelectorAll('.coordinate-col').forEach(col => { col.innerHTML = Array.from({ length: rows }, (_, r) => `<span>${r + 1}</span>`).join(''); });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const air = document.createElement('div');
      air.className = 'air-cell';
      $('air-grid').append(air);
      airCells.push(air);
      const cell = document.createElement('button');
      cell.className = 'web-cell';
      cell.type = 'button';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.style.setProperty('--tile-delay', `${(r + c) * 22}ms`);
      air.style.setProperty('--tile-delay', `${(r + c) * 22}ms`);
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
        const row = Math.max(0, Math.min(rows - 1, r + dr));
        const col = Math.max(0, Math.min(cols - 1, c + dc));
        webCells[key(row, col)].focus();
      });
      $('web-grid').append(cell);
      webCells.push(cell);
    }
  }

  function buildTools() {
    $('web-grid').addEventListener('pointerleave', clearPreview);
    $('trap-list').innerHTML = Object.entries(TRAPS).map(([type, trap]) => `<button class="trap-option" data-trap="${type}" aria-pressed="${type === selectedTrap}">${icon(trap.icon)}<span class="trap-copy"><strong>${trap.name}</strong><small>${trap.description}</small></span><span class="trap-price">${trap.cost} <span>⌁</span></span></button>`).join('');
    $('mobile-trap').innerHTML = Object.entries(TRAPS).map(([type, trap]) => `<option value="${type}">${trap.name} · ${trap.cost} ⌁</option>`).join('');
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

  function clearPreview() {
    webCells.forEach(cell => cell.classList.remove('preview', 'invalid-preview'));
    airCells.forEach(cell => cell.classList.remove('linked'));
    $('selection-label').textContent = 'ВЫБЕРИ КЛЕТКУ НИЖНЕГО СЛОЯ';
  }

  function showPreview(r, c) {
    clearPreview();
    if (game.state.status !== 'planning') return;
    $('selection-label').textContent = `${coordinate(r, c)} · ${game.trapAt(r, c) ? 'НАЖМИ, ЧТОБЫ УБРАТЬ' : TRAPS[selectedTrap].name.toUpperCase()}`;
    airCells[key(r, c)].classList.add('linked');
    if (game.trapAt(r, c)) return;
    const cells = trapCoverage(selectedTrap, r, c);
    const invalid = game.canPlace(selectedTrap, r, c);
    (cells.length ? cells : [[r, c]]).forEach(([y, x]) => {
      webCells[key(y, x)].classList.add(invalid ? 'invalid-preview' : 'preview');
      airCells[key(y, x)].classList.add('linked');
    });
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
    airCells.forEach(cell => { cell.className = 'air-cell'; cell.removeAttribute('title'); cell.replaceChildren(); });
    webCells.forEach((cell, i) => {
      const r = Math.floor(i / s.cols), c = i % s.cols;
      cell.className = 'web-cell';
      cell.replaceChildren();
      cell.disabled = s.status !== 'planning';
      cell.setAttribute('aria-label', `${coordinate(r, c)}, пусто. Поставить: ${TRAPS[selectedTrap].name}`);
      cell.setAttribute('aria-pressed', 'false');
    });
    s.blocked.forEach(index => {
      webCells[index].classList.add('blocked');
      webCells[index].innerHTML = icon('leaf');
      webCells[index].setAttribute('aria-label', `${coordinate(Math.floor(index / s.cols), index % s.cols)}, лист. Здесь нельзя плести.`);
    });
    const traps = report ? report.traps : s.traps;
    traps.forEach(trap => trapCoverage(trap.type, trap.r, trap.c).forEach(([r, c]) => {
      const cell = webCells[key(r, c)];
      const anchor = r === trap.r && c === trap.c;
      cell.classList.add('has-trap');
      if (!anchor) cell.classList.add('coverage-cell');
      if (!seenTraps.has(trap.id) && !report) cell.classList.add('new-trap');
      if (!trap.fresh) cell.classList.add('persisted');
      cell.innerHTML = icon(anchor ? TRAPS[trap.type].icon : 'web') + (anchor && trap.type === 'cocoon' ? `<span class="trap-lifetime">${trap.turns}</span>` : '');
      cell.setAttribute('aria-label', `${coordinate(r, c)}, ${TRAPS[trap.type].name}. Осталось проверок: ${trap.turns}. Нажми, чтобы убрать.`);
      cell.setAttribute('aria-pressed', 'true');
    }));
    seenTraps = new Set(s.traps.map(trap => trap.id));
    const visibleFlies = report ? report.flies : s.flies.filter(fly => s.scanned || fly.stunned);
    if (visibleFlies.length) {
      const flies = visibleFlies;
      flies.forEach(fly => {
        const cell = airCells[key(fly.r, fly.c)];
        cell.classList.add('revealed');
        const enemy = ENEMIES[fly.kind || 'ordinary'];
        cell.classList.add(`enemy-${fly.kind || 'ordinary'}`);
        const hp = report?.wounded.find(item => item.id === fly.id)?.hp ?? fly.hp;
        cell.innerHTML = `<span class="fly-sprite">${icon('fly')}${enemy.badge ? `<span class="enemy-badge">${enemy.badge}${enemy.hp > 1 ? hp : ''}</span>` : ''}</span>`;
        cell.title = `${enemy.name} · ${coordinate(fly.r, fly.c)}${enemy.hp > 1 ? ` · осталось ударов: ${hp}` : ''}`;
      });
      $('air-grid').setAttribute('aria-label', `Видимые мухи: ${flies.map(f => `${ENEMIES[f.kind || 'ordinary'].name} ${coordinate(f.r, f.c)}, запас прочности ${f.hp || 1}`).join(', ')}`);
    } else $('air-grid').setAttribute('aria-label', 'Воздушное поле: положение мух скрыто. Слушай шорох по колонкам.');
    if (report) {
      report.caught.forEach(fly => {
        airCells[key(fly.r, fly.c)].classList.add('caught');
        webCells[key(fly.r, fly.c)].classList.add('collision');
      });
      report.wounded.forEach(fly => airCells[key(fly.r, fly.c)].classList.add('wounded'));
      report.escaped.forEach(fly => {
        const cell = airCells[key(fly.r, fly.c)];
        cell.classList.add('escaped');
        cell.replaceChildren();
      });
    }
    const counts = game.noise();
    const fog = Boolean(game.level().fog);
    document.querySelector('.noise-label > span').title = fog ? 'Туман: шорох показывает только наличие мух в колонке.' : 'Шорох показывает 0, 1, 2 или 3 и больше мух в колонке.';
    $('air-grid').classList.toggle('foggy', fog);
    $('arena').classList.toggle('frozen', s.frozen);
    $('noise-meters').innerHTML = counts.map((count, i) => {
      const clue = fog ? (count ? 'есть мухи, количество скрыто туманом' : 'пусто') : flyText(count);
      return `<span class="noise-meter" role="img" aria-label="Колонка ${String.fromCharCode(65 + i)}: ${clue}" title="${String.fromCharCode(65 + i)}: ${clue}"><span class="noise-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span><span class="noise-bars" aria-hidden="true">${[1, 2, 3].map(n => `<span class="noise-bar ${count >= n ? 'lit' : ''}"></span>`).join('')}</span></span>`;
    }).join('');
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
      option.title = locked ? `Откроется на уровне ${trap.unlock}` : `${trap.name}: ${trap.description}. Цена: ${trap.cost} шёлка.`;
      const badge = option.lastElementChild;
      badge.className = locked ? 'locked-label' : 'trap-price';
      badge.innerHTML = locked ? `Ур. ${trap.unlock}` : `${trap.cost} <span>⌁</span>`;
    });
    $('silk-count').textContent = s.silk;
    $('silk-max').textContent = `/ ${s.maxSilk}`;
    $('radar-button').disabled = s.status !== 'planning' || s.scanned || s.radarLeft === 0 || s.silk < 2;
    $('radar-caption').textContent = s.scanned ? 'Координаты раскрыты до конца хода' : s.radarLeft === 0 ? 'Отдохни до следующей волны' : `Увидеть мух · осталось ${s.radarLeft}`;
    $('freeze-button').disabled = s.status !== 'planning' || s.wave < 4 || s.frozen || s.freezeLeft <= 0 || s.silk < 2;
    $('freeze-caption').textContent = s.wave < 4 ? 'Откроется на уровне 4' : s.frozen ? 'Мухи замрут при схлопывании' : `Стоп на 1 проверку · осталось ${s.freezeLeft}`;
    $('clear-button').disabled = s.status !== 'planning' || !s.traps.some(trap => trap.fresh);
    $('merge-button').disabled = s.status !== 'planning';
    $('merge-button').children[1].textContent = s.status === 'resolving' ? 'Слушаем тишину…' : 'Схлопнуть поля';
    $('restart-button').disabled = s.status === 'resolving';
    $('difficulty-button').disabled = s.status === 'resolving';
    $('mobile-trap').value = selectedTrap;
    $('mobile-trap').disabled = s.status !== 'planning';
    [...$('mobile-trap').options].forEach(option => {
      const trap = TRAPS[option.value], locked = s.wave < trap.unlock;
      option.disabled = locked;
      option.textContent = locked ? `${trap.name} · ур. ${trap.unlock}` : `${trap.name} · ${trap.cost} ⌁`;
    });
    $('mobile-silk').textContent = `Шёлк ${s.silk} / ${s.maxSilk}`;
    $('mobile-merge').disabled = $('merge-button').disabled;
    $('mobile-radar').disabled = $('radar-button').disabled;
  }

  function render(report = null) {
    const s = game.state;
    if (boardDimensions !== `${s.rows}x${s.cols}`) buildBoards();
    $('wave-label').textContent = `УРОВЕНЬ ${String(s.wave).padStart(2, '0')} / ${WAVES}`;
    $('turn-label').textContent = `ХОД ${String(s.turn).padStart(2, '0')}`;
    $('difficulty-button').innerHTML = `${DIFFICULTIES[s.difficulty].name} <span>↗</span>`;
    $('air-count').textContent = flyText(s.flies.length);
    $('placement-count').textContent = `${s.traps.length} / ${s.maxTraps} ловушек`;
    $('caught-count').textContent = s.waveCaught;
    $('total-flies').textContent = s.waveTotal;
    $('score').textContent = String(s.score).padStart(4, '0');
    const time = s.flies.length ? Math.min(...s.flies.map(fly => fly.ttl)) : 0;
    $('threat-label').textContent = s.flies.length ? `${time} ${plural(time, ['ход', 'хода', 'ходов'])}` : 'Чистый воздух';
    $('threat-track').classList.toggle('danger', time <= 2 && s.flies.length > 0);
    $('threat-track').innerHTML = Array.from({ length: s.maxTime }, (_, i) => `<span class="threat-segment ${i < time ? 'active' : ''}"></span>`).join('');
    // Project the logical wind vector onto the same diagonal axes as the cells.
    $('wind-icon').textContent = s.wind.dc ? (s.wind.dc > 0 ? '↘' : '↖') : (s.wind.dr > 0 ? '↙' : '↗');
    $('wind-label').textContent = `${game.level().gust ? 'Порывы · ' : ''}${s.wind.name}`;
    $('wind-icon').parentElement.title = game.level().gust ? 'Порывы: обычные мухи делают до 2 шагов, шустрики до 3.' : 'Обычная муха делает до 1 шага, шустрик до 2; по ветру летят чаще.';
    $('hearts').innerHTML = Array.from({ length: s.maxHealth }, (_, i) => icon('heart', i >= s.health ? 'lost-heart' : '')).join('');
    $('hearts').setAttribute('aria-label', `Жизни Тани: ${s.health} из ${s.maxHealth}`);
    const home = document.querySelector('.spider-home');
    home.classList.toggle('happy', Boolean(report?.caught.length));
    home.classList.toggle('worried', Boolean(report?.escaped.length));
    $('spider-caption').textContent = report?.caught.length ? 'Ням! Спасибо за обед!' : report?.escaped.length ? 'Эй! Куда без очереди?' : s.health === 1 ? 'Осторожно, мои лапки!' : s.traps.length ? 'Хе-хе… теперь подождём!' : 'Ну что, сплетём обед?';
    $('progress-count').textContent = `${s.wave} / ${WAVES}`;
    $('wave-progress').innerHTML = Array.from({ length: WAVES }, (_, i) => `<span class="wave-step ${i + 1 < s.wave ? 'complete' : i + 1 === s.wave ? 'current' : ''}"></span>`).join('');
    const level = game.level();
    $('chapter-label').textContent = `Глава ${Math.ceil(s.wave / 4)} · ${level.chapter}`;
    $('level-name').textContent = level.name;
    $('board-size').textContent = `${s.cols} × ${s.rows}`;
    $('level-tip').textContent = level.tip;
    $('mechanic-tags').innerHTML = [...(s.wave === 5 || s.wave === 9 ? [`Поле выросло · запас шёлка ${s.maxSilk}`] : []), ...levelTags(level)].map(tag => `<span>${tag}</span>`).join('');
    $('progress-hint').textContent = s.wave < WAVES ? `Дальше: ${LEVELS[s.wave].name}. ${LEVELS[s.wave].tip}` : 'Финальный пикник! Поймай королеву и сохрани жизни Танюшки.';
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
    celebrate(report);
    const caught = report.caught.length;
    const escaped = report.escaped.length;
    const wounded = report.wounded.length;
    $('result-banner').innerHTML = caught ? `${caught > 1 ? 'КУШАТЬ ПОДАНО!' : 'ПОПАЛАСЬ!'}<small>${flyText(caught)} · +${report.score} очков${caught > 1 ? ' · комбо!' : ''}</small>` : wounded ? `БРОНЯ ТРЕСНУЛА!<small>Оглушено: ${wounded}. Добей на тех же клетках!</small>` : escaped ? 'АЙ-АЙ-АЙ!<small>Мухи добрались до Тани</small>' : 'ВЖУ-У-УХ!<small>Только ветер. Мухи в других клетках!</small>';
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
      setNote(`${caught ? `Поймано: ${caught}. ` : 'Ни одной мухи в этот раз. '}${escaped ? `Потеряно жизней: ${report.damage}. ` : ''}${wounded ? `Оглушено: ${wounded}. Они остались на месте. ` : ''}Снова твой ход.`);
      $('field-note').textContent = escaped ? 'Они уже близко. «Прислушаться» раскрывает координаты, а крест накрывает сразу несколько клеток.' : caught ? 'Шорох изменился. Шустрики летят дальше, а оглушённые мухи остаются видимыми на месте.' : game.level().tip;
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
    $('wave-dialog-eyebrow').textContent = finished ? won ? '12 УРОВНЕЙ. ОДНА СЧАСТЛИВАЯ ТАНЮШКА.' : 'ДАЖЕ У ТАНИ БЫВАЕТ ТАКОЙ ВЕЧЕР' : `УРОВЕНЬ ${s.wave} ПОЗАДИ`;
    $('wave-dialog-title').textContent = finished ? won ? 'Этот вечер — твой.' : 'Крылья оказались быстрее.' : 'Воздух стал тише.';
    $('wave-dialog-description').textContent = finished ? won ? 'Танюшка прошла все 12 уровней! Теперь можно устроить свой маленький пикник.' : 'Мухи добрались до Танюшки. Попробуй другую сложность или новую комбинацию улучшений.' : `${s.waveEscaped ? `Ускользнуло мух: ${s.waveEscaped}. ` : 'Танюшка в безопасности! '}Дальше — «${LEVELS[s.wave].name}». ${LEVELS[s.wave].tip}`;
    $('wave-summary').innerHTML = `<div><strong>${finished ? s.totalCaught : s.waveCaught}</strong><span>поймано мух</span></div><div><strong>${s.score}</strong><span>очков за охоту</span></div><div><strong>${finished ? record : s.health}</strong><span>${finished ? 'твой рекорд' : 'жизней осталось'}</span></div>`;
    $('upgrade-section').hidden = finished;
    if (!finished) {
      const upgrades = game.upgrades();
      selectedUpgrade = upgrades.find(upgrade => !upgrade.disabled).id;
      $('upgrade-options').innerHTML = upgrades.map(u => `<button class="upgrade-option ${u.id === selectedUpgrade ? 'selected' : ''}" data-upgrade="${u.id}" aria-pressed="${u.id === selectedUpgrade}" ${u.disabled ? 'disabled' : ''}><span class="upgrade-symbol">${u.symbol}</span><span><strong>${u.name}</strong><small>${u.disabled ? (['slots', 'freeze'].includes(u.id) && s.wave < 3 ? 'После уровня 3' : 'Уже максимум') : u.detail}</small></span></button>`).join('');
    }
    $('next-wave-button').innerHTML = `${finished ? 'Ещё одна охота' : `На уровень ${s.wave + 1}`} <span>↗</span>`;
    $('wave-dialog').showModal();
  }

  function startNewGame(difficulty) {
    generation++;
    saveRecord();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    game.start(difficulty);
    selectedTrap = 'thread';
    seenTraps = new Set();
    $('particle-layer').replaceChildren();
    $('arena').classList.remove('merging', 'checking');
    $('result-banner').classList.remove('visible');
    $('toast').classList.remove('visible');
    $('field-note').textContent = 'Мух не видно, но слышно. Чем громче шорох в колонке, тем больше в ней крыльев.';
    setNote('Твой ход. Тишина на твоей стороне.');
    render();
    animateStage();
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

  function levelTags(level) {
    return [level.swift && `» Шустрики: ${level.swift}`, level.armored && `◆ Броня: ${level.armored}`, level.queen && '♛ Королева', level.fog && 'Туман', level.leaves && `Листья: ${level.leaves}`, level.gust && 'Порывы ветра'].filter(Boolean);
  }
  function selectMapLevel(index) {
    const level = LEVELS[index];
    document.querySelectorAll('[data-level]').forEach(button => {
      const selected = Number(button.dataset.level) === index;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('campaign-detail').innerHTML = `<span class="chapter-label">${level.chapter} · уровень ${index + 1}</span><h3>${level.name}</h3><p>${level.tip}</p><div class="mechanic-tags"><span>${level.flies + DIFFICULTIES[game.state.difficulty].extraFlies} мух</span><span>Поле ${boardSize(index + 1).cols} × ${boardSize(index + 1).rows}</span>${levelTags(level).map(tag => `<span>${tag}</span>`).join('')}</div><p class="map-state">${index + 1 < game.state.wave ? 'Пройдено в этой охоте.' : index + 1 === game.state.wave ? 'Ты сейчас здесь.' : 'Откроется по ходу приключения.'}</p>`;
  }
  $('map-button').addEventListener('click', () => {
    $('campaign-grid').innerHTML = LEVELS.map((level, i) => `<button data-level="${i}" class="campaign-level ${i + 1 === game.state.wave ? 'current' : i + 1 < game.state.wave ? 'complete' : ''}" aria-pressed="false"><b>${String(i + 1).padStart(2, '0')}</b><span>${level.name}</span><small>${i + 1 < game.state.wave ? '✓ Пройдено' : i + 1 === game.state.wave ? 'Ты здесь' : `Глава ${Math.ceil((i + 1) / 4)}`}</small></button>`).join('');
    selectMapLevel(game.state.wave - 1);
    $('map-dialog').showModal();
  });
  $('campaign-grid').addEventListener('click', event => {
    const card = event.target.closest('[data-level]');
    if (card) selectMapLevel(Number(card.dataset.level));
  });
  $('freeze-button').addEventListener('click', () => {
    const result = game.freeze();
    if (!result.ok) return toast(result.error);
    render(); sound('scan');
    ripple($('air-grid'), '#638cb8');
    setNote('Росинка готова: на этой проверке мухи не двигаются и не приближаются.');
  });
  $('merge-button').addEventListener('click', merge);
  $('clear-button').addEventListener('click', () => { game.clearNew(); render(); setNote('Новые ловушки сняты. Попробуй другую расстановку.'); });
  $('radar-button').addEventListener('click', () => {
    const result = game.scan();
    if (!result.ok) return toast(result.error);
    sound('scan');
    render();
    ripple($('air-grid'), '#b94e88');
    setNote('Вот они! Координаты видны до схлопывания. Плети точно под мухами.');
  });
  $('mobile-trap').addEventListener('change', event => document.querySelector(`[data-trap="${event.target.value}"]`).click());
  $('mobile-merge').addEventListener('click', merge);
  $('mobile-radar').addEventListener('click', () => $('radar-button').click());
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
    animateStage();
    $('field-note').textContent = game.level().tip;
    setNote(`Уровень ${game.state.wave}: ${game.level().tip}`);
    sound('catch');
  });
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    merge();
  });
  window.addEventListener('pagehide', saveRecord);
  buildTools();
  render();
})();
