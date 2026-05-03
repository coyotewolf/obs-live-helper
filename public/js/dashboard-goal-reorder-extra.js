/* OBS Live Helper – drag reorder for goal cards in Dashboard */
(function dashboardGoalReorderExtra(){
  const GOAL_KEY = 'obsHelperGoalCards';
  const CLOCK_KEY = 'obsHelperLiveClock';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const overlayConfigChannel = new BroadcastChannel('obs-helper-overlay-config');

  let patchTimer = null;
  let saveTimer = null;
  let activeDrag = null;

  const fallbackGoal = {
    layout: {
      direction:'column', gap:30, widthMode:'auto', minWidthCol:520, minWidthRow:220,
      baseAlpha:0.65, completedAlpha:0.65, completeFlashMs:3000
    },
    cards: [{ uid:'goal-default', text:'今日小目標：完成任務3場', current:0, total:3, visible:true, completed:false }]
  };
  const fallbackClock = {
    label:'LIVE', timezone:'Asia/Taipei', hour12:false, scale:1,
    timeSize:'56px', dateSize:'18px', backgroundAlpha:0.72
  };

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function toast(message){ if (typeof window.showToast === 'function') window.showToast(message); }
  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || 'null') || clone(fallback); }
    catch { return clone(fallback); }
  }
  function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

  function getGoal(){
    const goal = readJson(GOAL_KEY, fallbackGoal);
    if (!Array.isArray(goal.cards)) goal.cards = clone(fallbackGoal.cards);
    goal.cards = goal.cards.map((card, index) => ({
      uid: card.uid || uid(),
      text: card.text || `今日小目標 ${index + 1}`,
      current: Math.max(0, Number(card.current) || 0),
      total: Math.max(1, Number(card.total) || 1),
      visible: card.visible !== false,
      completed: Boolean(card.completed)
    }));
    return goal;
  }

  function readItemCard(item){
    const goal = getGoal();
    const uidValue = item.dataset.goalUid;
    const fallbackIndex = Math.max(0, Number(item.dataset.goalIndex || 0));
    const old = goal.cards.find(card => card.uid === uidValue) || goal.cards[fallbackIndex] || {};
    const total = Math.max(1, Number(item.querySelector('[data-goal-field="total"]')?.value ?? old.total ?? 1));
    const current = Math.max(0, Math.min(total, Number(item.querySelector('[data-goal-field="current"]')?.value ?? old.current ?? 0)));
    return {
      ...old,
      uid: old.uid || uidValue || uid(),
      text: item.querySelector('[data-goal-field="text"]')?.value || old.text || '今日小目標',
      current,
      total,
      visible: item.querySelector('[data-goal-field="visible"]')?.checked ?? old.visible ?? true,
      completed: current >= total ? Boolean(old.completed) : false
    };
  }

  function collectGoalFromEditor(){
    const goal = getGoal();
    const items = Array.from(document.querySelectorAll('#goalCardsEditor .goalEditItem'));
    if (!items.length) return goal;
    goal.cards = items.map(readItemCard);
    return goal;
  }

  async function saveGoal(goal){
    writeJson(GOAL_KEY, goal);
    overlayConfigChannel.postMessage({ type:'overlay-config-change', goal, clock: readJson(CLOCK_KEY, fallbackClock) });

    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const shared = readJson(CONFIG_KEY, {});
        const payload = {
          theme: shared.theme || document.body.dataset.theme || localStorage.getItem('obsHelperTheme') || 'blue-night',
          goal,
          clock: shared.clock || readJson(CLOCK_KEY, fallbackClock)
        };
        const res = await fetch('/api/overlay-config', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (data?.ok && data.config) localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      } catch (err) {
        console.warn('goal reorder save failed', err);
        toast('小目標順序已暫存，但同步到 server 失敗');
      }
    }, 80);
  }

  function getItems(){
    return Array.from(document.querySelectorAll('#goalCardsEditor .goalEditItem'));
  }

  function getRects(){
    return new Map(getItems().map(el => [el, el.getBoundingClientRect()]));
  }

  function animateLayoutChange(before){
    for (const item of getItems()) {
      if (activeDrag && item === activeDrag.item) continue;
      const prev = before.get(item);
      if (!prev) continue;
      const now = item.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      item.animate([
        { transform:`translate(${dx}px, ${dy}px)` },
        { transform:'translate(0, 0)' }
      ], { duration:260, easing:'cubic-bezier(.16,1,.3,1)' });
    }
  }

  function reindexEditorItems(){
    const goal = getGoal();
    getItems().forEach((item, index) => {
      item.dataset.goalIndex = String(index);
      if (!item.dataset.goalUid && goal.cards[index]) item.dataset.goalUid = goal.cards[index].uid || uid();
      const handle = item.querySelector('.goalDragHandle');
      if (handle) handle.title = `拖曳調整順序：第 ${index + 1} 個小目標`;
    });
  }

  function ensureStyles(){
    if (document.getElementById('goalReorderStyle')) return;
    const style = document.createElement('style');
    style.id = 'goalReorderStyle';
    style.textContent = `
      #goalCardsEditor .goalEditItem{position:relative;transition:box-shadow .2s ease,opacity .2s ease,background .2s ease;will-change:transform}
      #goalCardsEditor .goalEditItem.hasDragHandle{padding-left:58px}
      .goalDragHandle{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:36px;height:42px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.055));color:var(--muted);display:grid;place-items:center;cursor:grab;user-select:none;touch-action:none;z-index:5;box-shadow:0 8px 18px rgba(0,0,0,.12)}
      .goalDragHandle::before{content:'☰';font-size:22px;line-height:1;font-weight:900;letter-spacing:-1px;transform:scaleX(1.08)}
      .goalDragHandle:hover{color:var(--accent);border-color:rgba(125,211,252,.42);box-shadow:0 0 0 3px rgba(125,211,252,.10),0 10px 24px rgba(0,0,0,.18)}
      .goalDragHandle:active{cursor:grabbing;transform:translateY(-50%) scale(.96)}
      body.isGoalSorting{cursor:grabbing!important;user-select:none}
      body.isGoalSorting #goalCardsEditor .goalEditItem:not(.isDraggingGoal):not(.goalDragPlaceholder){outline:1px dashed rgba(125,211,252,.26)}
      #goalCardsEditor .goalEditItem.isDraggingGoal{position:fixed!important;z-index:99999!important;pointer-events:none;opacity:.96;transform:scale(1.025) rotate(-1deg);box-shadow:0 24px 70px rgba(0,0,0,.42),0 0 0 2px rgba(125,211,252,.76)!important;background:rgba(15,23,42,.98)}
      #goalCardsEditor .goalDragPlaceholder{border:2px dashed rgba(125,211,252,.58)!important;background:rgba(125,211,252,.08)!important;box-shadow:inset 0 0 28px rgba(125,211,252,.08)!important;animation:goalPlaceholderPulse 1.1s ease-in-out infinite;box-sizing:border-box}
      #goalCardsEditor .goalDragPlaceholder>*{visibility:hidden!important}
      @keyframes goalPlaceholderPulse{0%,100%{opacity:.72}50%{opacity:1}}
      body[data-theme="pink-cute"] .goalDragHandle{background:rgba(255,255,255,.82);border-color:rgba(210,72,122,.22);color:#d9467f;box-shadow:0 8px 18px rgba(217,70,127,.10)}
      body[data-theme="pink-cute"] .goalDragHandle:hover{border-color:rgba(217,70,127,.48);box-shadow:0 0 0 3px rgba(217,70,127,.10),0 10px 24px rgba(217,70,127,.12)}
      body[data-theme="pink-cute"] #goalCardsEditor .goalEditItem.isDraggingGoal{background:rgba(255,247,252,.98);box-shadow:0 24px 70px rgba(217,70,127,.22),0 0 0 2px rgba(217,70,127,.50)!important}
      body[data-theme="pink-cute"] #goalCardsEditor .goalDragPlaceholder{border-color:rgba(217,70,127,.45)!important;background:rgba(217,70,127,.08)!important}
    `;
    document.head.appendChild(style);
  }

  function patchEditor(){
    if (activeDrag) return;
    ensureStyles();
    const root = document.getElementById('goalCardsEditor');
    if (!root) return;
    const goal = getGoal();
    getItems().forEach((item, index) => {
      item.classList.add('hasDragHandle');
      item.dataset.goalIndex = String(index);
      item.dataset.goalUid = goal.cards[index]?.uid || item.dataset.goalUid || uid();
      item.draggable = false;

      let handle = item.querySelector('.goalDragHandle');
      if (!handle) {
        handle = document.createElement('button');
        handle.className = 'goalDragHandle';
        handle.type = 'button';
        handle.setAttribute('aria-label', '拖曳調整小目標順序');
        item.prepend(handle);
      }
      handle.textContent = '';
      handle.title = `拖曳調整順序：第 ${index + 1} 個小目標`;
    });
  }

  function schedulePatch(){
    clearTimeout(patchTimer);
    patchTimer = setTimeout(patchEditor, 80);
  }

  function findInsertTarget(pointerY, placeholder){
    const items = getItems().filter(item => item !== activeDrag.item && item !== placeholder);
    let target = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        target = item;
        break;
      }
    }
    return target;
  }

  function movePlaceholder(pointerY){
    if (!activeDrag) return;
    const { placeholder } = activeDrag;
    const parent = placeholder.parentNode;
    const target = findInsertTarget(pointerY, placeholder);
    const before = getRects();
    if (target && target !== placeholder.nextSibling) parent.insertBefore(placeholder, target);
    if (!target && placeholder !== parent.lastElementChild) parent.appendChild(placeholder);
    animateLayoutChange(before);
  }

  function setDraggedPosition(clientX, clientY){
    if (!activeDrag) return;
    const { item, offsetX, offsetY } = activeDrag;
    item.style.left = `${clientX - offsetX}px`;
    item.style.top = `${clientY - offsetY}px`;
  }

  function startDrag(event){
    const handle = event.target?.closest?.('.goalDragHandle');
    const item = handle?.closest?.('#goalCardsEditor .goalEditItem');
    const root = document.getElementById('goalCardsEditor');
    if (!handle || !item || !root) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = item.getBoundingClientRect();
    const placeholder = item.cloneNode(true);
    placeholder.classList.remove('isDraggingGoal');
    placeholder.classList.add('goalDragPlaceholder');
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.width = `${rect.width}px`;

    activeDrag = {
      item,
      handle,
      placeholder,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startIndex: getItems().indexOf(item)
    };

    item.parentNode.insertBefore(placeholder, item.nextSibling);
    item.classList.add('isDraggingGoal');
    item.style.width = `${rect.width}px`;
    item.style.height = `${rect.height}px`;
    item.style.left = `${rect.left}px`;
    item.style.top = `${rect.top}px`;
    document.body.classList.add('isGoalSorting');
    handle.setPointerCapture?.(event.pointerId);
    setDraggedPosition(event.clientX, event.clientY);
  }

  function moveDrag(event){
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.preventDefault();
    setDraggedPosition(event.clientX, event.clientY);
    movePlaceholder(event.clientY);
  }

  function finishDrag(event){
    if (!activeDrag) return;
    if (event && event.pointerId !== activeDrag.pointerId) return;

    const { item, placeholder, handle } = activeDrag;
    const parent = placeholder.parentNode;
    const before = getRects();

    parent.insertBefore(item, placeholder);
    placeholder.remove();
    item.classList.remove('isDraggingGoal');
    item.style.width = '';
    item.style.height = '';
    item.style.left = '';
    item.style.top = '';
    document.body.classList.remove('isGoalSorting');
    handle.releasePointerCapture?.(activeDrag.pointerId);
    activeDrag = null;

    reindexEditorItems();
    animateLayoutChange(before);
    const goal = collectGoalFromEditor();
    saveGoal(goal);
    toast('小目標順序已更新');
    schedulePatch();
  }

  document.addEventListener('pointerdown', startDrag, true);
  document.addEventListener('pointermove', moveDrag, true);
  document.addEventListener('pointerup', finishDrag, true);
  document.addEventListener('pointercancel', finishDrag, true);
  document.addEventListener('dragstart', event => {
    if (event.target?.closest?.('#goalCardsEditor')) event.preventDefault();
  }, true);

  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  schedulePatch();
})();
