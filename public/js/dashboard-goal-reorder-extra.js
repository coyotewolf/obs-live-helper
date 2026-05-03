/* OBS Live Helper – drag reorder for goal cards in Dashboard */
(function dashboardGoalReorderExtra(){
  const GOAL_KEY = 'obsHelperGoalCards';
  const CLOCK_KEY = 'obsHelperLiveClock';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const overlayConfigChannel = new BroadcastChannel('obs-helper-overlay-config');

  let draggingItem = null;
  let saveTimer = null;
  let patchTimer = null;

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || 'null') || clone(fallback); }
    catch { return clone(fallback); }
  }
  function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function toast(message){ if (typeof window.showToast === 'function') window.showToast(message); }

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
    const currentGoal = getGoal();
    const uidValue = item.dataset.goalUid;
    const fallbackIndex = Math.max(0, Number(item.dataset.goalIndex || 0));
    const old = currentGoal.cards.find(card => card.uid === uidValue) || currentGoal.cards[fallbackIndex] || {};
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

  async function saveGoal(goal, { debounce = true } = {}){
    writeJson(GOAL_KEY, goal);
    overlayConfigChannel.postMessage({ type:'overlay-config-change', goal, clock: readJson(CLOCK_KEY, fallbackClock) });

    clearTimeout(saveTimer);
    const run = async () => {
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
    };

    if (debounce) saveTimer = setTimeout(run, 160);
    else run();
  }

  function reindexEditorItems(){
    const goal = getGoal();
    const items = Array.from(document.querySelectorAll('#goalCardsEditor .goalEditItem'));
    items.forEach((item, index) => {
      item.dataset.goalIndex = String(index);
      if (!item.dataset.goalUid && goal.cards[index]) item.dataset.goalUid = goal.cards[index].uid || uid();
      const handle = item.querySelector('.goalDragHandle');
      if (handle) handle.title = `拖曳調整順序：第 ${index + 1} 個小目標`;
    });
  }

  function moveDraggingBefore(targetItem, pointerY){
    if (!draggingItem || !targetItem || draggingItem === targetItem) return;
    const rect = targetItem.getBoundingClientRect();
    const insertAfter = pointerY > rect.top + rect.height / 2;
    const parent = targetItem.parentNode;
    if (insertAfter) parent.insertBefore(draggingItem, targetItem.nextSibling);
    else parent.insertBefore(draggingItem, targetItem);
  }

  function finishDrag(){
    if (!draggingItem) return;
    draggingItem.classList.remove('isDraggingGoal');
    draggingItem = null;
    document.body.classList.remove('isGoalSorting');
    reindexEditorItems();
    const goal = collectGoalFromEditor();
    saveGoal(goal, { debounce:false });
    toast('小目標順序已更新');
  }

  function ensureStyles(){
    if (document.getElementById('goalReorderStyle')) return;
    const style = document.createElement('style');
    style.id = 'goalReorderStyle';
    style.textContent = `
      #goalCardsEditor .goalEditItem{position:relative;transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease}
      #goalCardsEditor .goalEditItem.isDraggingGoal{opacity:.62;transform:scale(.992);box-shadow:0 0 0 2px rgba(125,211,252,.72),0 18px 46px rgba(0,0,0,.28)}
      .goalDragHandle{position:absolute;left:10px;top:10px;width:34px;height:34px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.08);color:var(--muted);display:grid;place-items:center;cursor:grab;font-size:18px;font-weight:900;line-height:1;user-select:none;touch-action:none;z-index:2}
      .goalDragHandle:active{cursor:grabbing}
      #goalCardsEditor .goalEditItem.hasDragHandle{padding-left:54px}
      body.isGoalSorting #goalCardsEditor .goalEditItem:not(.isDraggingGoal){outline:1px dashed rgba(125,211,252,.28)}
      body[data-theme="pink-cute"] .goalDragHandle{background:rgba(255,255,255,.8);border-color:rgba(210,72,122,.2);color:#d9467f}
      body[data-theme="pink-cute"] #goalCardsEditor .goalEditItem.isDraggingGoal{box-shadow:0 0 0 2px rgba(217,70,127,.45),0 18px 46px rgba(217,70,127,.18)}
    `;
    document.head.appendChild(style);
  }

  function patchEditor(){
    ensureStyles();
    const root = document.getElementById('goalCardsEditor');
    if (!root) return;
    const goal = getGoal();
    const items = Array.from(root.querySelectorAll('.goalEditItem'));
    items.forEach((item, index) => {
      item.classList.add('hasDragHandle');
      item.dataset.goalIndex = String(index);
      item.dataset.goalUid = goal.cards[index]?.uid || item.dataset.goalUid || uid();
      item.draggable = true;

      if (!item.querySelector('.goalDragHandle')) {
        const handle = document.createElement('button');
        handle.className = 'goalDragHandle';
        handle.type = 'button';
        handle.textContent = '↕';
        handle.setAttribute('aria-label', '拖曳調整小目標順序');
        item.prepend(handle);
      }
    });
  }

  function schedulePatch(){
    clearTimeout(patchTimer);
    patchTimer = setTimeout(patchEditor, 40);
  }

  document.addEventListener('dragstart', event => {
    const item = event.target?.closest?.('#goalCardsEditor .goalEditItem');
    if (!item) return;
    const handle = event.target.closest('.goalDragHandle');
    if (!handle) {
      event.preventDefault();
      return;
    }
    draggingItem = item;
    item.classList.add('isDraggingGoal');
    document.body.classList.add('isGoalSorting');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.goalUid || 'goal');
  });

  document.addEventListener('dragover', event => {
    if (!draggingItem) return;
    const targetItem = event.target?.closest?.('#goalCardsEditor .goalEditItem');
    if (!targetItem) return;
    event.preventDefault();
    moveDraggingBefore(targetItem, event.clientY);
  });

  document.addEventListener('drop', event => {
    if (!draggingItem) return;
    event.preventDefault();
    finishDrag();
  });

  document.addEventListener('dragend', finishDrag);

  document.addEventListener('pointerdown', event => {
    const handle = event.target?.closest?.('.goalDragHandle');
    if (!handle) return;
    handle.closest('.goalEditItem')?.setAttribute('draggable', 'true');
  });

  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  schedulePatch();
})();
