/* OBS Live Helper – dashboard add-on for theme, goal card, and live clock */
(function(){
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'obsHelperTheme';
  const GOAL_KEY = 'obsHelperGoalCards';
  const CLOCK_KEY = 'obsHelperLiveClock';
  const themeChannel = new BroadcastChannel('obs-helper-theme');
  const overlayConfigChannel = new BroadcastChannel('obs-helper-overlay-config');

  const defaultGoalConfig = {
    layout: { direction:'column', gap:30, baseAlpha:0.65, completedAlpha:0.65, completeFlashMs:3000 },
    cards: [{ uid:'goal-default', text:'今日小目標：完成任務3場', current:0, total:3, visible:true, completed:false }]
  };
  const defaultClockConfig = { label:'LIVE', timezone:'Asia/Taipei', hour12:false, scale:1, timeSize:'56px', dateSize:'18px' };

  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function showToastSafe(message){ if (typeof window.showToast === 'function') return window.showToast(message); const toast=$('toast'); if(!toast) return; toast.textContent=message; toast.classList.add('show'); clearTimeout(showToastSafe.timer); showToastSafe.timer=setTimeout(()=>toast.classList.remove('show'),1800); }
  function escapeHtml(text){ return String(text||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
  function readJson(key, fallback){ try { return JSON.parse(localStorage.getItem(key)||'null') || clone(fallback); } catch { return clone(fallback); } }
  function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

  function normalizeGoalConfig(config){
    const next = { ...clone(defaultGoalConfig), ...(config||{}) };
    next.layout = { ...clone(defaultGoalConfig.layout), ...(config?.layout||{}) };
    next.cards = Array.isArray(config?.cards) && config.cards.length ? config.cards : clone(defaultGoalConfig.cards);
    next.cards = next.cards.map((card,index)=>({
      uid: card.uid || uid(),
      text: card.text || `今日小目標 ${index+1}`,
      current: Number.isFinite(Number(card.current)) ? Number(card.current) : 0,
      total: Math.max(1, Number(card.total)||1),
      visible: card.visible !== false,
      completed: Boolean(card.completed)
    }));
    return next;
  }

  function normalizeClockConfig(config){ return { ...clone(defaultClockConfig), ...(config||{}) }; }

  function applyDashboardTheme(theme){
    document.body.dataset.theme = theme || 'blue-night';
    document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.classList.toggle('isActive', btn.dataset.themeChoice === (theme||'blue-night')));
  }
  function saveTheme(theme){
    localStorage.setItem(THEME_KEY, theme);
    applyDashboardTheme(theme);
    themeChannel.postMessage({ type:'theme-change', theme });
  }
  function bootThemeSettings(){
    const theme = localStorage.getItem(THEME_KEY) || 'blue-night';
    applyDashboardTheme(theme);
    document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',()=>{ saveTheme(btn.dataset.themeChoice); showToastSafe('已切換主題'); }));
  }

  function getLocalUrl(path){ return `${location.origin}${path}`; }
  function hydrateAddonUrls(){
    [['goalCardUrl','/html/goal-card.html'],['liveClockUrl','/html/live-clock.html']].forEach(([id,path])=>{ const el=$(id); if(el) el.textContent=getLocalUrl(path); });
  }

  function renderGoalCardsEditor(config){
    const root=$('goalCardsEditor'); if(!root) return;
    root.innerHTML = config.cards.map((card,index)=>`
      <article class="goalEditItem" data-goal-index="${index}">
        <label><span>任務名稱</span><input type="text" data-goal-field="text" value="${escapeHtml(card.text)}"></label>
        <label><span>目前</span><input type="number" min="0" data-goal-field="current" value="${card.current}"></label>
        <label><span>總數</span><input type="number" min="1" data-goal-field="total" value="${card.total}"></label>
        <label class="checkLabel"><input type="checkbox" data-goal-field="visible" ${card.visible?'checked':''}><span>顯示</span></label>
      </article>`).join('');
  }

  function hydrateGoalClockSettings(){
    const goal = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
    const clock = normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
    writeJson(GOAL_KEY, goal);
    writeJson(CLOCK_KEY, clock);

    if($('goalCount')) $('goalCount').value = goal.cards.length;
    if($('goalDirection')) $('goalDirection').value = goal.layout.direction || 'column';
    if($('goalGap')) $('goalGap').value = goal.layout.gap ?? 30;
    if($('goalAlpha')) $('goalAlpha').value = goal.layout.baseAlpha ?? 0.65;
    if($('goalFlashSec')) $('goalFlashSec').value = (goal.layout.completeFlashMs ?? 3000) / 1000;

    if($('clockLabel')) $('clockLabel').value = clock.label || 'LIVE';
    if($('clockTimezone')) $('clockTimezone').value = clock.timezone || 'Asia/Taipei';
    if($('clockHour12')) $('clockHour12').value = String(Boolean(clock.hour12));
    if($('clockScale')) $('clockScale').value = clock.scale ?? 1;
    if($('clockTimeSize')) $('clockTimeSize').value = clock.timeSize || '56px';
    renderGoalCardsEditor(goal);
  }

  function collectGoalConfig(){
    const old = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
    const count = Math.max(1, Math.min(20, Number($('goalCount')?.value || old.cards.length || 1)));
    const nextCards = Array.from({ length:count }, (_,index)=>{
      const existing = old.cards[index] || { uid:uid(), text:`今日小目標 ${index+1}`, current:0, total:3, visible:true, completed:false };
      const item = document.querySelector(`[data-goal-index="${index}"]`);
      const text = item?.querySelector('[data-goal-field="text"]')?.value || existing.text;
      const total = Math.max(1, Number(item?.querySelector('[data-goal-field="total"]')?.value ?? existing.total));
      const current = Math.max(0, Math.min(total, Number(item?.querySelector('[data-goal-field="current"]')?.value ?? existing.current)));
      const visible = item?.querySelector('[data-goal-field="visible"]')?.checked ?? existing.visible;
      return { ...existing, text, current, total, visible, completed: current >= total ? existing.completed : false };
    });
    const alpha = Math.max(0, Math.min(1, Number($('goalAlpha')?.value || 0.65)));
    return normalizeGoalConfig({
      layout: {
        direction: $('goalDirection')?.value || 'column',
        gap: Math.max(0, Math.min(200, Number($('goalGap')?.value || 30))),
        baseAlpha: alpha,
        completedAlpha: alpha,
        completeFlashMs: Math.round(Math.max(0, Math.min(30, Number($('goalFlashSec')?.value || 3))) * 1000)
      },
      cards: nextCards
    });
  }

  function collectClockConfig(){
    return normalizeClockConfig({
      label: $('clockLabel')?.value || 'LIVE',
      timezone: $('clockTimezone')?.value || 'Asia/Taipei',
      hour12: $('clockHour12')?.value === 'true',
      scale: Math.max(0.3, Math.min(3, Number($('clockScale')?.value || 1))),
      timeSize: $('clockTimeSize')?.value || '56px',
      dateSize: '18px'
    });
  }

  function broadcastConfigs(goal, clock){
    overlayConfigChannel.postMessage({ type:'overlay-config-change', goal, clock });
  }
  function saveGoalClockSettings(){
    const goal = collectGoalConfig();
    const clock = collectClockConfig();
    writeJson(GOAL_KEY, goal); writeJson(CLOCK_KEY, clock);
    broadcastConfigs(goal, clock);
    renderGoalCardsEditor(goal);
    showToastSafe('小目標與時鐘設定已儲存');
  }
  function resetGoalClockSettings(){
    const goal = clone(defaultGoalConfig);
    const clock = clone(defaultClockConfig);
    writeJson(GOAL_KEY, goal); writeJson(CLOCK_KEY, clock);
    broadcastConfigs(goal, clock);
    hydrateGoalClockSettings();
    showToastSafe('已恢復預設設定');
  }

  $('saveGoalClockBtn')?.addEventListener('click', saveGoalClockSettings);
  $('resetGoalClockBtn')?.addEventListener('click', resetGoalClockSettings);
  $('goalCount')?.addEventListener('input', ()=>{ renderGoalCardsEditor(collectGoalConfig()); });

  document.addEventListener('input', event=>{
    if(event.target?.closest?.('.goalClockPanel')){
      const goal = collectGoalConfig();
      const clock = collectClockConfig();
      writeJson(GOAL_KEY, goal); writeJson(CLOCK_KEY, clock);
      broadcastConfigs(goal, clock);
    }
  });
  document.addEventListener('change', event=>{
    if(event.target?.closest?.('.goalClockPanel')){
      const goal = collectGoalConfig();
      const clock = collectClockConfig();
      writeJson(GOAL_KEY, goal); writeJson(CLOCK_KEY, clock);
      broadcastConfigs(goal, clock);
    }
  });

  bootThemeSettings();
  hydrateAddonUrls();
  hydrateGoalClockSettings();
})();
