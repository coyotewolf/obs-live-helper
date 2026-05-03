/* OBS Live Helper – keep Dashboard goal editor sorted and synced with Goal overlay */
(function dashboardGoalSyncExtra(){
  const GOAL_KEY = 'obsHelperGoalCards';
  const CLOCK_KEY = 'obsHelperLiveClock';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const channel = new BroadcastChannel('obs-helper-overlay-config');

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

  let latestAutoWidth = null;
  let typingTimer = null;

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || 'null') || clone(fallback); }
    catch { return clone(fallback); }
  }
  function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  function escapeHtml(text){
    return String(text || '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[ch]));
  }
  function toast(message){ if (typeof window.showToast === 'function') window.showToast(message); }
  function requestHandlePatch(){
    requestAnimationFrame(() => {
      if (typeof window.patchDashboardGoalDragHandles === 'function') window.patchDashboardGoalDragHandles();
      document.dispatchEvent(new CustomEvent('dashboard-goal-editor-rendered'));
    });
  }

  function isCompleted(card){
    return Boolean(card.completed) || Number(card.current || 0) >= Number(card.total || 1);
  }

  function sortCards(cards = []){
    const normalized = cards.map((card, index) => ({ card, index }));
    return [
      ...normalized.filter(item => !isCompleted(item.card)),
      ...normalized.filter(item => isCompleted(item.card))
    ].map(item => item.card);
  }

  function normalizeGoal(goalInput){
    const source = goalInput || readJson(GOAL_KEY, fallbackGoal);
    const next = { ...clone(fallbackGoal), ...source };
    next.layout = { ...clone(fallbackGoal.layout), ...(source.layout || {}) };
    next.layout.direction = next.layout.direction === 'row' ? 'row' : 'column';
    next.layout.widthMode = next.layout.widthMode === 'manual' ? 'manual' : 'auto';
    next.layout.gap = Math.max(0, Math.min(240, Number(next.layout.gap ?? 30)));
    next.layout.minWidthCol = Math.max(120, Math.min(5000, Number(next.layout.minWidthCol ?? 520)));
    next.layout.minWidthRow = Math.max(120, Math.min(5000, Number(next.layout.minWidthRow ?? 220)));
    next.layout.baseAlpha = Math.max(0, Math.min(1, Number(next.layout.baseAlpha ?? 0.65)));
    next.layout.completedAlpha = Math.max(0, Math.min(1, Number(next.layout.completedAlpha ?? next.layout.baseAlpha)));
    next.layout.completeFlashMs = Math.max(0, Math.min(30000, Number(next.layout.completeFlashMs ?? 3000)));

    const cards = Array.isArray(source.cards) && source.cards.length ? source.cards : clone(fallbackGoal.cards);
    next.cards = sortCards(cards.slice(0, 20).map((card, index) => {
      const total = Math.max(1, Number(card.total) || 1);
      const current = Math.max(0, Math.min(total, Number(card.current) || 0));
      return {
        uid: card.uid || uid(),
        text: card.text || `今日小目標 ${index + 1}`,
        current,
        total,
        visible: card.visible !== false,
        completed: Boolean(card.completed)
      };
    }));
    return next;
  }

  function syncAutoWidthToInput(goal){
    if (!latestAutoWidth) return;
    if ((goal?.layout?.widthMode || 'auto') !== 'auto') return;
    const widthInput = document.getElementById('goalCardWidth');
    if (!widthInput) return;
    const displayWidth = Math.round(goal.layout.direction === 'row' ? latestAutoWidth.rowWidth : latestAutoWidth.colWidth);
    if (Number(widthInput.value) !== displayWidth) widthInput.value = displayWidth;
    widthInput.disabled = true;
    widthInput.title = '自動模式：此數值由最長小目標文字自動計算。';
  }

  function renderGoalEditor(goalInput){
    const root = document.getElementById('goalCardsEditor');
    if (!root) return;
    const goal = normalizeGoal(goalInput);
    root.innerHTML = goal.cards.map((card, index) => `
      <article class="goalEditItem hasDragHandle" data-goal-index="${index}" data-goal-uid="${escapeHtml(card.uid)}">
        <button class="goalDragHandle" type="button" aria-label="拖曳調整小目標順序" title="拖曳調整順序：第 ${index + 1} 個小目標"></button>
        <label><span>任務名稱</span><input type="text" data-goal-field="text" value="${escapeHtml(card.text)}"></label>
        <label><span>目前</span><input type="number" min="0" data-goal-field="current" value="${card.current}"></label>
        <label><span>總數</span><input type="number" min="1" data-goal-field="total" value="${card.total}"></label>
        <label class="checkLabel"><input type="checkbox" data-goal-field="visible" ${card.visible ? 'checked' : ''}><span>顯示</span></label>
      </article>`).join('');

    if (document.getElementById('goalCount')) document.getElementById('goalCount').value = goal.cards.length;
    if (document.getElementById('goalDirection')) document.getElementById('goalDirection').value = goal.layout.direction || 'column';
    if (document.getElementById('goalWidthMode')) document.getElementById('goalWidthMode').value = goal.layout.widthMode || 'auto';
    if (document.getElementById('goalCardWidth')) {
      const widthInput = document.getElementById('goalCardWidth');
      widthInput.value = Math.round(goal.layout.direction === 'row' ? goal.layout.minWidthRow : goal.layout.minWidthCol);
      widthInput.disabled = (goal.layout.widthMode || 'auto') === 'auto';
      widthInput.title = (goal.layout.widthMode || 'auto') === 'auto' ? '自動模式：此數值由最長小目標文字自動計算。' : '手動模式：可自行輸入固定卡片長度。';
      syncAutoWidthToInput(goal);
    }
    if (document.getElementById('goalGap')) document.getElementById('goalGap').value = goal.layout.gap ?? 30;
    if (document.getElementById('goalAlpha')) document.getElementById('goalAlpha').value = Number(goal.layout.baseAlpha ?? 0.65).toFixed(2);
    if (document.getElementById('goalAlphaRange')) document.getElementById('goalAlphaRange').value = Math.round(Number(goal.layout.baseAlpha ?? 0.65) * 100);
    if (document.getElementById('goalFlashSec')) document.getElementById('goalFlashSec').value = (goal.layout.completeFlashMs ?? 3000) / 1000;
    requestHandlePatch();
  }

  async function persistGoalToServer(goal){
    try {
      const shared = readJson(CONFIG_KEY, {});
      const clock = readJson(CLOCK_KEY, fallbackClock);
      const payload = {
        theme: shared.theme || document.body.dataset.theme || localStorage.getItem('obsHelperTheme') || 'blue-night',
        goal: normalizeGoal(goal),
        clock: shared.clock || clock
      };
      const res = await fetch('/api/overlay-config', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (data?.ok && data.config) localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
    } catch (err) {
      console.warn('goal sync save failed', err);
      toast('小目標已更新，但同步到 server 失敗');
    }
  }

  function broadcastGoal(goal){
    const clock = readJson(CLOCK_KEY, fallbackClock);
    channel.postMessage({ type:'overlay-config-change', goal: normalizeGoal(goal), clock });
  }

  async function saveGoal(goalInput, { broadcast = true, server = true, render = true } = {}){
    const goal = normalizeGoal(goalInput);
    writeJson(GOAL_KEY, goal);
    if (render) renderGoalEditor(goal);
    else syncAutoWidthToInput(goal);
    if (broadcast) broadcastGoal(goal);
    if (server) persistGoalToServer(goal);
    return goal;
  }

  function collectEditorGoal(){
    const old = normalizeGoal(readJson(GOAL_KEY, fallbackGoal));
    const count = Math.max(1, Math.min(20, Number(document.getElementById('goalCount')?.value || old.cards.length || 1)));
    const items = Array.from(document.querySelectorAll('#goalCardsEditor .goalEditItem'));
    const cards = items.slice(0, count).map((item, index) => {
      const oldCard = old.cards.find(card => card.uid === item.dataset.goalUid) || old.cards[index] || {};
      const total = Math.max(1, Number(item.querySelector('[data-goal-field="total"]')?.value ?? oldCard.total ?? 1));
      const current = Math.max(0, Math.min(total, Number(item.querySelector('[data-goal-field="current"]')?.value ?? oldCard.current ?? 0)));
      return {
        ...oldCard,
        uid: oldCard.uid || item.dataset.goalUid || uid(),
        text: item.querySelector('[data-goal-field="text"]')?.value || oldCard.text || `今日小目標 ${index + 1}`,
        current,
        total,
        visible: item.querySelector('[data-goal-field="visible"]')?.checked ?? oldCard.visible ?? true,
        completed: current >= total ? Boolean(oldCard.completed) : false
      };
    });

    while (cards.length < count) {
      cards.push({ uid: uid(), text:`今日小目標 ${cards.length + 1}`, current:0, total:3, visible:true, completed:false });
    }

    const direction = document.getElementById('goalDirection')?.value || old.layout.direction || 'column';
    const widthMode = document.getElementById('goalWidthMode')?.value || old.layout.widthMode || 'auto';
    const fallbackWidth = direction === 'row' ? old.layout.minWidthRow : old.layout.minWidthCol;
    const manualWidth = Math.max(120, Math.min(5000, Number(document.getElementById('goalCardWidth')?.value || fallbackWidth)));
    const alpha = Math.max(0, Math.min(1, Number(document.getElementById('goalAlpha')?.value || old.layout.baseAlpha || 0.65)));
    const layout = {
      ...old.layout,
      direction,
      widthMode,
      gap: Math.max(0, Math.min(240, Number(document.getElementById('goalGap')?.value || old.layout.gap || 30))),
      baseAlpha: alpha,
      completedAlpha: alpha,
      completeFlashMs: Math.round(Math.max(0, Math.min(30, Number(document.getElementById('goalFlashSec')?.value || 3))) * 1000)
    };
    if (widthMode === 'manual') {
      if (direction === 'row') layout.minWidthRow = manualWidth;
      else layout.minWidthCol = manualWidth;
    }

    return normalizeGoal({ layout, cards });
  }

  async function fetchLatestGoal(){
    const active = document.activeElement;
    if (active?.closest?.('#goalCardsEditor')) return;
    try {
      const res = await fetch('/api/overlay-config?_t=' + Date.now(), { cache:'no-store' });
      const data = await res.json().catch(() => null);
      if (!data?.ok || !data.config?.goal) return;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      const currentText = JSON.stringify(readJson(GOAL_KEY, fallbackGoal));
      const nextGoal = normalizeGoal(data.config.goal);
      if (JSON.stringify(nextGoal) !== currentText) {
        writeJson(GOAL_KEY, nextGoal);
        renderGoalEditor(nextGoal);
      } else {
        syncAutoWidthToInput(nextGoal);
      }
    } catch {}
  }

  window.applyDashboardGoalSortedConfig = (goal, options = {}) => saveGoal(goal, options);
  window.collectDashboardGoalConfigSorted = collectEditorGoal;
  window.sortDashboardGoalCards = sortCards;

  channel.addEventListener('message', event => {
    if (event.data?.type === 'goal-auto-width-change') {
      latestAutoWidth = event.data;
      syncAutoWidthToInput(normalizeGoal(readJson(GOAL_KEY, fallbackGoal)));
      return;
    }
    if (event.data?.type !== 'overlay-config-change' || !event.data.goal) return;
    if (document.activeElement?.closest?.('#goalCardsEditor')) return;
    saveGoal(event.data.goal, { broadcast:false, server:false, render:true });
  });

  document.addEventListener('input', event => {
    if (!event.target?.closest?.('.goalSettingsPanel')) return;
    const field = event.target?.dataset?.goalField || '';

    // 任務名稱不即時同步 overlay / server，避免每次刪字都重算自動卡片長度。
    // 使用者按「儲存小目標設定」後才會更新實際卡片長度。
    if (field === 'text') return;

    const shouldRender = Boolean(field);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const goal = collectEditorGoal();
      saveGoal(goal, { broadcast:true, server:true, render:shouldRender });
    }, 120);
  });
  document.addEventListener('change', event => {
    if (!event.target?.closest?.('.goalSettingsPanel')) return;
    const field = event.target?.dataset?.goalField || '';

    // 任務名稱只在按下儲存時套用，blur/change 不更新 overlay，避免自動寬度縮放干擾編輯。
    if (field === 'text') return;

    clearTimeout(typingTimer);
    const goal = collectEditorGoal();
    saveGoal(goal, { broadcast:true, server:true, render:true });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchLatestGoal();
  });
  // Do not poll every 2 seconds. Progress updates already use BroadcastChannel,
  // and polling can read an old server value before the latest edit is persisted,
  // causing 0 -> 1 / 1 -> 0 to appear to require a second click.
})();
