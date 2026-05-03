(function(){
  const GOAL_KEY = 'obsHelperGoalCards';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const channel = new BroadcastChannel('obs-helper-overlay-config');

  const defaults = {
    layout: {
      direction: 'column',
      gap: 30,
      widthMode: 'auto',
      minWidthCol: 520,
      minWidthRow: 220,
      baseAlpha: .65,
      completedAlpha: .65,
      completeFlashMs: 3000
    },
    cards: [{ uid: 'goal-default', text: '今日小目標：完成任務3場', current: 0, total: 3, visible: true, completed: false }]
  };

  const cardsContainer = document.getElementById('cardsContainer');
  if (!cardsContainer) return;

  let config = normalize(readLocalGoal());
  let previousCards = new Map(config.cards.map(card => [card.uid, { ...card }]));
  let lastCompleted = new Set(config.cards.filter(isCompleted).map(card => card.uid));
  let isUserDragging = false;
  let lastAutoWidthMessage = '';
  let lastAppliedSignature = '';
  let lastServerUpdatedAt = 0;

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function clamp(value, fallback, min, max){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }
  function readLocalGoal(){
    try { return JSON.parse(localStorage.getItem(GOAL_KEY) || 'null') || clone(defaults); }
    catch { return clone(defaults); }
  }
  function escapeHtml(text){
    return String(text || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch]));
  }
  function normalize(raw){
    const source = raw || {};
    const next = { ...clone(defaults), ...source };
    next.layout = { ...clone(defaults.layout), ...(source.layout || {}) };
    next.layout.direction = next.layout.direction === 'row' ? 'row' : 'column';
    next.layout.gap = clamp(next.layout.gap, 30, 0, 240);
    next.layout.widthMode = next.layout.widthMode === 'manual' ? 'manual' : 'auto';
    next.layout.minWidthCol = clamp(next.layout.minWidthCol, 520, 120, 5000);
    next.layout.minWidthRow = clamp(next.layout.minWidthRow, 220, 120, 5000);
    next.layout.baseAlpha = clamp(next.layout.baseAlpha, .65, 0, 1);
    next.layout.completedAlpha = clamp(next.layout.completedAlpha ?? next.layout.baseAlpha, next.layout.baseAlpha, 0, 1);
    next.layout.completeFlashMs = clamp(next.layout.completeFlashMs, 3000, 0, 30000);

    const cards = Array.isArray(source.cards) && source.cards.length ? source.cards : clone(defaults.cards);
    next.cards = cards.slice(0, 20).map((card, index) => {
      const total = Math.max(1, Number(card.total) || 1);
      const current = Math.max(0, Math.min(total, Number(card.current) || 0));
      return {
        uid: String(card.uid || uid()),
        text: String(card.text || `今日小目標 ${index + 1}`),
        current,
        total,
        visible: card.visible !== false,
        completed: Boolean(card.completed)
      };
    });
    return next;
  }
  function isCompleted(card){ return Boolean(card.completed) || Number(card.current) >= Number(card.total); }
  function sortCards(cards){ return [...cards.filter(card => !isCompleted(card)), ...cards.filter(isCompleted)]; }
  function visibleCards(){ return sortCards(config.cards).filter(card => card.visible !== false); }
  function percent(card){
    const total = Math.max(1, Number(card.total) || 1);
    const current = Math.max(0, Math.min(total, Number(card.current) || 0));
    return Math.max(0, Math.min(100, current / total * 100));
  }
  function signature(goal = config){ return JSON.stringify(goal); }

  function measureText(text, font){
    const canvas = measureText.canvas || (measureText.canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    return Math.ceil(ctx.measureText(String(text || '')).width);
  }
  function computeAutoWidths(colMin, rowMin){
    const textFont = '850 26px Plus Jakarta Sans, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif';
    const progressFont = '850 16px Plus Jakarta Sans, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif';
    let longest = 0;
    for (const card of visibleCards()) {
      longest = Math.max(
        longest,
        measureText(card.text, textFont),
        measureText(`${card.current} / ${card.total}`, progressFont)
      );
    }
    const required = Math.ceil(longest + 118);
    return { col: Math.max(colMin, required), row: Math.max(rowMin, required), required };
  }
  function notifyAutoWidth(widths){
    if (config.layout.widthMode !== 'auto') return;
    const payload = {
      type: 'goal-auto-width-change',
      direction: config.layout.direction,
      colWidth: widths.col,
      rowWidth: widths.row,
      width: config.layout.direction === 'row' ? widths.row : widths.col
    };
    const key = JSON.stringify(payload);
    if (key === lastAutoWidthMessage) return;
    lastAutoWidthMessage = key;
    channel.postMessage(payload);
  }
  function applyCssVars(){
    const root = document.documentElement;
    const colMin = clamp(config.layout.minWidthCol, 520, 120, 5000);
    const rowMin = clamp(config.layout.minWidthRow, 220, 120, 5000);
    const autoWidths = computeAutoWidths(colMin, rowMin);
    const colWidth = config.layout.widthMode === 'auto' ? autoWidths.col : colMin;
    const rowWidth = config.layout.widthMode === 'auto' ? autoWidths.row : rowMin;

    root.style.setProperty('--cards-gap', `${config.layout.gap}px`);
    root.style.setProperty('--base-alpha', config.layout.baseAlpha);
    root.style.setProperty('--completed-alpha', config.layout.completedAlpha);
    root.style.setProperty('--card-min-col', `${colMin}px`);
    root.style.setProperty('--card-min-row', `${rowMin}px`);
    root.style.setProperty('--card-width-col', `${colWidth}px`);
    root.style.setProperty('--card-width-row', `${rowWidth}px`);
    notifyAutoWidth(autoWidths);
  }

  function getPositions(){
    const map = new Map();
    cardsContainer.querySelectorAll('.goal-card:not(.leaving)').forEach(el => map.set(el.dataset.uid, el.getBoundingClientRect()));
    return map;
  }
  function animateMoves(before, duration = 420){
    if (!before || !before.size) return;
    cardsContainer.querySelectorAll('.goal-card:not(.leaving)').forEach(el => {
      const prev = before.get(el.dataset.uid);
      if (!prev) return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([
        { transform: `translate(${dx}px, ${dy}px)`, opacity: .92 },
        { transform: 'translate(0, 0)', opacity: 1 }
      ], { duration, easing: 'cubic-bezier(.16,1,.3,1)' });
    });
  }

  function createCardElement(card){
    const pct = percent(card);
    const completed = isCompleted(card);
    const el = document.createElement('div');
    el.className = `goal-card ${completed ? 'completed' : ''}`;
    el.dataset.uid = card.uid;
    el.dataset.progressPct = String(pct);
    el.dataset.progressCurrent = String(card.current);
    el.dataset.progressTotal = String(card.total);
    el.innerHTML = `<div class="fill-bg" style="width:${pct}%"></div><div class="shine"></div><div class="badge ${completed ? 'is-heart is-heart-small' : ''}">${completed ? '❤' : '💖'}</div><div class="stack"><div class="text ${completed ? 'is-done' : ''}">${escapeHtml(card.text)}</div><div class="progressText">${card.current} / ${card.total}</div></div>`;
    return el;
  }

  function animateProgress(el, fromPct, toPct, direction){
    const fill = el.querySelector('.fill-bg');
    const progressText = el.querySelector('.progressText');
    if (!fill || !progressText) return;

    fill.getAnimations?.().forEach(animation => animation.cancel());
    progressText.getAnimations?.().forEach(animation => animation.cancel());

    fill.style.transition = 'none';
    fill.style.width = `${fromPct}%`;
    void fill.offsetWidth;

    const goingUp = direction === 'up';
    requestAnimationFrame(() => {
      fill.style.transition = '';
      const animation = fill.animate([
        { width: `${fromPct}%`, opacity: .86, filter: 'brightness(1)' },
        { width: `${toPct}%`, opacity: goingUp ? .9 : .8, filter: goingUp ? 'brightness(1.12)' : 'brightness(.96)', offset: .68 },
        { width: `${toPct}%`, opacity: .86, filter: 'brightness(1)' }
      ], { duration: 760, easing: 'cubic-bezier(.18,.82,.18,1)', fill: 'both' });
      fill.style.width = `${toPct}%`;
      animation.onfinish = () => {
        fill.style.width = `${toPct}%`;
        try { animation.cancel(); } catch {}
      };
    });

    el.classList.remove('progress-rise', 'progress-fall');
    void el.offsetWidth;
    el.classList.add(goingUp ? 'progress-rise' : 'progress-fall');
    setTimeout(() => el.classList.remove('progress-rise', 'progress-fall'), 900);

    progressText.animate([
      { transform: 'translateY(0)', opacity: .86, filter: 'brightness(1)' },
      { transform: goingUp ? 'translateY(-1px)' : 'translateY(1px)', opacity: 1, filter: goingUp ? 'brightness(1.14)' : 'brightness(.96)' },
      { transform: 'translateY(0)', opacity: 1, filter: 'brightness(1)' }
    ], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  function updateCardElement(el, card){
    const previous = previousCards.get(card.uid);
    const previousPct = previous ? percent(previous) : Number(el.dataset.progressPct);
    const nextPct = percent(card);
    const previousCurrent = previous ? Number(previous.current) : Number(el.dataset.progressCurrent);
    const progressChanged = Number.isFinite(previousPct) && (Math.abs(previousPct - nextPct) > .01 || previousCurrent !== Number(card.current));
    const direction = nextPct > previousPct || Number(card.current) > previousCurrent ? 'up' : 'down';
    const completed = isCompleted(card);

    el.classList.toggle('completed', completed);
    el.dataset.uid = card.uid;
    el.dataset.progressPct = String(nextPct);
    el.dataset.progressCurrent = String(card.current);
    el.dataset.progressTotal = String(card.total);

    const badge = el.querySelector('.badge');
    badge.textContent = completed ? '❤' : '💖';
    badge.classList.toggle('is-heart', completed);
    badge.classList.toggle('is-heart-small', completed);

    const text = el.querySelector('.text');
    text.textContent = card.text;
    text.classList.toggle('is-done', completed);
    el.querySelector('.progressText').textContent = `${card.current} / ${card.total}`;

    if (progressChanged) {
      animateProgress(el, Math.max(0, Math.min(100, previousPct)), nextPct, direction);
    } else {
      const fill = el.querySelector('.fill-bg');
      if (fill) {
        fill.getAnimations?.().forEach(animation => animation.cancel());
        fill.style.width = `${nextPct}%`;
      }
    }

    if (completed && !lastCompleted.has(card.uid)) {
      spawnGoldFX(el, config.layout.completeFlashMs);
      lastCompleted.add(card.uid);
    }
    if (!completed) lastCompleted.delete(card.uid);
  }

  function render(options = {}){
    if (isUserDragging && !options.force) return;
    const before = options.beforePositions || getPositions();
    applyCssVars();

    const oldMode = cardsContainer.dataset.mode;
    const oldWidthMode = cardsContainer.dataset.widthMode;
    const nextMode = config.layout.direction;
    const nextWidthMode = config.layout.widthMode;
    cardsContainer.dataset.mode = nextMode;
    cardsContainer.dataset.widthMode = nextWidthMode;

    if ((oldMode && oldMode !== nextMode) || (oldWidthMode && oldWidthMode !== nextWidthMode)) {
      cardsContainer.classList.remove('mode-switching');
      void cardsContainer.offsetWidth;
      cardsContainer.classList.add('mode-switching');
      setTimeout(() => cardsContainer.classList.remove('mode-switching'), 620);
    }

    const currentEls = new Map(Array.from(cardsContainer.querySelectorAll('.goal-card:not(.leaving)')).map(el => [el.dataset.uid, el]));
    const target = visibleCards();
    const targetUids = new Set(target.map(card => card.uid));

    currentEls.forEach((el, uidValue) => {
      if (!targetUids.has(uidValue)) {
        el.classList.add('leaving');
        el.style.height = `${el.offsetHeight}px`;
        setTimeout(() => el.remove(), 360);
      }
    });

    target.forEach(card => {
      let el = currentEls.get(card.uid);
      if (!el) {
        el = createCardElement(card);
        el.classList.add('entering');
        cardsContainer.appendChild(el);
        requestAnimationFrame(() => el.classList.remove('entering'));
      } else {
        updateCardElement(el, card);
      }
      cardsContainer.appendChild(el);
    });

    animateMoves(before, oldMode !== nextMode ? 620 : 420);
    enableHUDDragSort();
    previousCards = new Map(config.cards.map(card => [card.uid, { ...card }]));
  }

  function postOverlayConfig(goal, debounce = false){
    localStorage.setItem(GOAL_KEY, JSON.stringify(goal));
    channel.postMessage({ type: 'overlay-config-change', goal });
    clearTimeout(postOverlayConfig.timer);
    const run = async () => {
      try {
        let shared = {};
        try { shared = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch {}
        const payload = { theme: shared.theme || document.body.dataset.theme || 'blue-night', goal, clock: shared.clock };
        const res = await fetch('/api/overlay-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => null);
        if (data?.ok && data.config) {
          lastServerUpdatedAt = Number(data.config.updatedAt || Date.now());
          localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
        }
      } catch (err) {
        console.warn('goal save failed', err);
      }
    };
    if (debounce) postOverlayConfig.timer = setTimeout(run, 160);
    else run();
  }

  function enableHUDDragSort(){
    cardsContainer.onpointerdown = event => {
      const card = event.target.closest('.goal-card');
      if (!card || event.target.closest('input') || event.target.closest('button')) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let placeholder = null;
      let rect = null;
      card.setPointerCapture?.(event.pointerId);

      const move = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > 6) {
          dragging = true;
          isUserDragging = true;
          rect = card.getBoundingClientRect();
          placeholder = document.createElement('div');
          placeholder.className = 'goal-card placeholder';
          placeholder.style.width = `${rect.width}px`;
          placeholder.style.height = `${rect.height}px`;
          card.parentNode.insertBefore(placeholder, card.nextSibling);
          card.classList.add('dragging');
          card.style.width = `${rect.width}px`;
          card.style.height = `${rect.height}px`;
          card.style.left = `${rect.left}px`;
          card.style.top = `${rect.top}px`;
          document.body.classList.add('hud-dragging');
        }
        if (!dragging) return;
        moveEvent.preventDefault();
        card.style.left = `${rect.left + dx}px`;
        card.style.top = `${rect.top + dy}px`;
        updatePlaceholder(moveEvent.clientX, moveEvent.clientY, placeholder);
      };

      const up = () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', up);
        card.removeEventListener('pointercancel', up);
        if (!dragging) return;
        const before = getPositions();
        card.classList.remove('dragging');
        card.style.cssText = '';
        if (placeholder) {
          cardsContainer.insertBefore(card, placeholder);
          placeholder.remove();
        }
        const order = Array.from(cardsContainer.querySelectorAll('.goal-card:not(.leaving)')).map(el => el.dataset.uid);
        const byUid = new Map(config.cards.map(cardData => [cardData.uid, cardData]));
        const hidden = config.cards.filter(cardData => !order.includes(cardData.uid));
        config.cards = [...order.map(uidValue => byUid.get(uidValue)).filter(Boolean), ...hidden];
        isUserDragging = false;
        document.body.classList.remove('hud-dragging');
        postOverlayConfig(config, false);
        render({ force: true, beforePositions: before });
      };

      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', up);
      card.addEventListener('pointercancel', up);
    };
  }

  function updatePlaceholder(x, y, placeholder){
    if (!placeholder) return;
    const items = Array.from(cardsContainer.querySelectorAll('.goal-card:not(.dragging):not(.leaving)')).filter(el => el !== placeholder);
    if (!items.length) return;
    if (config.layout.direction === 'column') {
      let target = null;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) { target = item; break; }
      }
      target ? cardsContainer.insertBefore(placeholder, target) : cardsContainer.appendChild(placeholder);
      return;
    }
    const sorted = items.map(el => ({ el, rect: el.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    let target = null;
    for (const item of sorted) {
      if (y < item.rect.top + item.rect.height && x < item.rect.left + item.rect.width / 2) { target = item.el; break; }
    }
    target ? cardsContainer.insertBefore(placeholder, target) : cardsContainer.appendChild(placeholder);
  }

  function spawnGoldFX(cardEl, durationMs){
    const layer = document.createElement('div');
    layer.className = 'particle-layer';
    cardEl.appendChild(layer);
    const burst = document.createElement('div');
    burst.className = 'burst';
    burst.style.animation = 'burstFlash 600ms ease-out forwards';
    layer.appendChild(burst);
    const sprays = Math.max(2, Math.floor(Number(durationMs || 3000) / 300));
    let count = 0;
    const timer = setInterval(() => {
      createSpray(layer);
      count += 1;
      if (count >= sprays) clearInterval(timer);
    }, 300);
    setTimeout(() => layer.remove(), Math.max(800, Number(durationMs || 3000) + 500));
  }
  function createSpray(layer){
    const rect = layer.getBoundingClientRect();
    for (let i = 0; i < 44; i += 1) {
      const p = document.createElement('span');
      p.className = 'particle';
      const size = 2.5 + Math.random() * 8.5;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * rect.width}px`;
      p.style.top = `${Math.random() * rect.height}px`;
      p.style.setProperty('--dx', `${(Math.random() * 2 - 1) * (rect.width * .25)}px`);
      p.style.setProperty('--dy', `${(Math.random() * 2 - 1) * (rect.height * .2) - 30}px`);
      p.style.animation = `particleDrift ${700 + Math.random() * 900}ms cubic-bezier(.2,.7,.2,1) forwards`;
      layer.appendChild(p);
    }
  }

  function applyConfig(goal, updatedAt = 0){
    if (isUserDragging) return;
    const next = normalize(goal);
    const nextSignature = signature(next);
    if (nextSignature === lastAppliedSignature) return;
    const before = getPositions();
    config = next;
    lastAppliedSignature = nextSignature;
    if (updatedAt) lastServerUpdatedAt = updatedAt;
    localStorage.setItem(GOAL_KEY, JSON.stringify(config));
    render({ force: true, beforePositions: before });
  }

  async function fetchSharedConfig(){
    if (isUserDragging) return;
    try {
      const res = await fetch('/api/overlay-config?_t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      if (!data?.ok || !data.config?.goal) return;
      const updatedAt = Number(data.config.updatedAt || 0);
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      if (!updatedAt || updatedAt > lastServerUpdatedAt) applyConfig(data.config.goal, updatedAt);
    } catch {}
  }

  channel.addEventListener('message', event => {
    if (event.data?.type !== 'overlay-config-change' || !event.data.goal) return;
    applyConfig(event.data.goal);
  });
  addEventListener('resize', () => render({ force: true }));
  lastAppliedSignature = signature(config);
  render({ force: true });
  fetchSharedConfig();
  setInterval(fetchSharedConfig, 1000);
})();
