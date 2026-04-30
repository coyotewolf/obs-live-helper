/* OBS Live Helper – dashboard add-on for shared theme, goal card, and live clock */
(function(){
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'obsHelperTheme';
  const GOAL_KEY = 'obsHelperGoalCards';
  const CLOCK_KEY = 'obsHelperLiveClock';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const themeChannel = new BroadcastChannel('obs-helper-theme');
  const overlayConfigChannel = new BroadcastChannel('obs-helper-overlay-config');

  const defaultGoalConfig = {
    layout: {
      direction:'column',
      gap:30,
      widthMode:'auto',
      minWidthCol:520,
      minWidthRow:220,
      baseAlpha:0.65,
      completedAlpha:0.65,
      completeFlashMs:3000
    },
    cards: [{ uid:'goal-default', text:'今日小目標：完成任務3場', current:0, total:3, visible:true, completed:false }]
  };
  const defaultClockConfig = {
    label:'LIVE',
    timezone:'Asia/Taipei',
    hour12:false,
    scale:1,
    timeSize:'56px',
    dateSize:'18px',
    backgroundAlpha:0.72
  };

  let currentTheme = localStorage.getItem(THEME_KEY) || 'blue-night';
  let saveTimer = null;

  function uid(){ return (crypto.randomUUID && crypto.randomUUID()) || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function showToastSafe(message){
    if (typeof window.showToast === 'function') return window.showToast(message);
    const toast=$('toast');
    if(!toast) return;
    toast.textContent=message;
    toast.classList.add('show');
    clearTimeout(showToastSafe.timer);
    showToastSafe.timer=setTimeout(()=>toast.classList.remove('show'),1800);
  }
  function escapeHtml(text){ return String(text||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
  function readJson(key, fallback){ try { return JSON.parse(localStorage.getItem(key)||'null') || clone(fallback); } catch { return clone(fallback); } }
  function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  function normalizeTheme(theme){ return theme === 'pink-cute' ? 'pink-cute' : 'blue-night'; }
  function clampNumber(value, fallback, min, max){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeGoalConfig(config){
    const next = { ...clone(defaultGoalConfig), ...(config||{}) };
    next.layout = { ...clone(defaultGoalConfig.layout), ...(config?.layout||{}) };
    next.layout.direction = next.layout.direction === 'row' ? 'row' : 'column';
    next.layout.gap = clampNumber(next.layout.gap, 30, 0, 240);
    next.layout.widthMode = next.layout.widthMode === 'manual' ? 'manual' : 'auto';
    next.layout.minWidthCol = clampNumber(next.layout.minWidthCol, 520, 120, 5000);
    next.layout.minWidthRow = clampNumber(next.layout.minWidthRow, 220, 120, 5000);
    next.layout.baseAlpha = clampNumber(next.layout.baseAlpha, 0.65, 0, 1);
    next.layout.completedAlpha = clampNumber(next.layout.completedAlpha ?? next.layout.baseAlpha, next.layout.baseAlpha, 0, 1);
    next.layout.completeFlashMs = clampNumber(next.layout.completeFlashMs, 3000, 0, 30000);
    next.cards = Array.isArray(config?.cards) && config.cards.length ? config.cards : clone(defaultGoalConfig.cards);
    next.cards = next.cards.slice(0,20).map((card,index)=>{
      const total = Math.max(1, Number(card.total)||1);
      const current = Math.max(0, Math.min(total, Number(card.current)||0));
      return {
        uid: card.uid || uid(),
        text: card.text || `今日小目標 ${index+1}`,
        current,
        total,
        visible: card.visible !== false,
        completed: Boolean(card.completed)
      };
    });
    return next;
  }

  function normalizeClockConfig(config){
    const next = { ...clone(defaultClockConfig), ...(config||{}) };
    next.scale = clampNumber(next.scale, 1, 0.3, 3);
    next.backgroundAlpha = clampNumber(next.backgroundAlpha, 0.72, 0, 1);
    next.hour12 = Boolean(next.hour12);
    return next;
  }

  function applyDashboardTheme(theme){
    currentTheme = normalizeTheme(theme);
    localStorage.setItem(THEME_KEY, currentTheme);
    document.body.dataset.theme = currentTheme;
    document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.classList.toggle('isActive', btn.dataset.themeChoice === currentTheme));
  }

  async function postSharedConfig({theme=currentTheme, goal=readJson(GOAL_KEY, defaultGoalConfig), clock=readJson(CLOCK_KEY, defaultClockConfig)} = {}){
    const payload = {
      theme: normalizeTheme(theme),
      goal: normalizeGoalConfig(goal),
      clock: normalizeClockConfig(clock)
    };
    try{
      const res = await fetch('/api/overlay-config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>null);
      if(data?.ok && data.config){
        localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      }
    }catch(err){
      console.warn('Overlay config server sync failed:', err);
      showToastSafe('已儲存在 Dashboard，但 server 同步失敗，請確認已更新 routes 並重啟 npm start');
    }
  }

  function broadcastConfigs(goal, clock){
    overlayConfigChannel.postMessage({ type:'overlay-config-change', goal, clock });
  }

  function scheduleSharedSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      postSharedConfig({
        theme: currentTheme,
        goal: readJson(GOAL_KEY, defaultGoalConfig),
        clock: readJson(CLOCK_KEY, defaultClockConfig)
      });
    }, 180);
  }

  function saveTheme(theme){
    applyDashboardTheme(theme);
    themeChannel.postMessage({ type:'theme-change', theme: currentTheme });
    postSharedConfig({
      theme: currentTheme,
      goal: readJson(GOAL_KEY, defaultGoalConfig),
      clock: readJson(CLOCK_KEY, defaultClockConfig)
    });
  }

  function bootThemeSettings(){
    applyDashboardTheme(currentTheme);
    document.querySelectorAll('[data-theme-choice]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        saveTheme(btn.dataset.themeChoice);
        showToastSafe('已切換主題；OBS Overlay 會在 1 秒內同步');
      });
    });
  }

  function getLocalUrl(path){ return `${location.origin}${path}`; }

  function hydrateAddonUrls(){
    [
      ['goalCardUrl','/html/goal-card.html'],
      ['liveClockUrl','/html/live-clock.html']
    ].forEach(([id,path])=>{
      const el=$(id);
      if(el) el.textContent=getLocalUrl(path);
    });
  }

  function ensureClockAlphaControls(){
    const grid = document.querySelector('.clockSettingsGrid');
    if(!grid || $('clockAlpha')) return;

    const label = document.createElement('label');
    label.className = 'alphaControl clockAlphaControl';
    label.innerHTML = `
      <span>背景透明度</span>
      <div class="alphaInline">
        <input type="range" id="clockAlphaRange" min="0" max="100" step="1" value="72">
        <input type="number" id="clockAlpha" min="0" max="1" step="0.01" value="0.72">
      </div>
    `;
    grid.appendChild(label);
  }

  function renderGoalCardsEditor(config){
    const root=$('goalCardsEditor');
    if(!root) return;
    root.innerHTML = config.cards.map((card,index)=>`
      <article class="goalEditItem" data-goal-index="${index}">
        <label><span>任務名稱</span><input type="text" data-goal-field="text" value="${escapeHtml(card.text)}"></label>
        <label><span>目前</span><input type="number" min="0" data-goal-field="current" value="${card.current}"></label>
        <label><span>總數</span><input type="number" min="1" data-goal-field="total" value="${card.total}"></label>
        <label class="checkLabel"><input type="checkbox" data-goal-field="visible" ${card.visible?'checked':''}><span>顯示</span></label>
      </article>`).join('');
  }

  function syncWidthInputs(goal){
    const widthMode = $('goalWidthMode');
    const widthInput = $('goalCardWidth');
    if(widthMode) widthMode.value = goal.layout.widthMode || 'auto';
    if(widthInput){
      const value = goal.layout.direction === 'row' ? goal.layout.minWidthRow : goal.layout.minWidthCol;
      widthInput.value = Math.round(value || (goal.layout.direction === 'row' ? 220 : 520));
      widthInput.disabled = (goal.layout.widthMode || 'auto') === 'auto';
    }
  }

  function ensureGoalWidthControls(){
    const grid = document.querySelector('.goalSettingsGrid');
    if(!grid || $('goalCardWidth')) return;
    const label = document.createElement('label');
    label.className = 'goalWidthControl';
    label.innerHTML = `
      <span>卡片長度</span>
      <div class="widthInline">
        <select id="goalWidthMode">
          <option value="auto">自動</option>
          <option value="manual">手動</option>
        </select>
        <input type="number" id="goalCardWidth" min="120" max="5000" step="10" value="520">
      </div>
    `;
    grid.appendChild(label);
  }

  function hydrateGoalSettings(goalInput){
    ensureGoalWidthControls();
    const goal = normalizeGoalConfig(goalInput || readJson(GOAL_KEY, defaultGoalConfig));
    writeJson(GOAL_KEY, goal);
    if($('goalCount')) $('goalCount').value = goal.cards.length;
    if($('goalDirection')) $('goalDirection').value = goal.layout.direction || 'column';
    if($('goalGap')) $('goalGap').value = goal.layout.gap ?? 30;
    if($('goalAlpha')) $('goalAlpha').value = Number(goal.layout.baseAlpha ?? 0.65).toFixed(2);
    if($('goalAlphaRange')) $('goalAlphaRange').value = Math.round(Number(goal.layout.baseAlpha ?? 0.65) * 100);
    if($('goalFlashSec')) $('goalFlashSec').value = (goal.layout.completeFlashMs ?? 3000) / 1000;
    syncWidthInputs(goal);
    renderGoalCardsEditor(goal);
  }

  function hydrateClockSettings(clockInput){
    ensureClockAlphaControls();
    const clock = normalizeClockConfig(clockInput || readJson(CLOCK_KEY, defaultClockConfig));
    writeJson(CLOCK_KEY, clock);
    if($('clockLabel')) $('clockLabel').value = clock.label || 'LIVE';
    if($('clockTimezone')) $('clockTimezone').value = clock.timezone || 'Asia/Taipei';
    if($('clockHour12')) $('clockHour12').value = String(Boolean(clock.hour12));
    if($('clockScale')) $('clockScale').value = clock.scale ?? 1;
    if($('clockTimeSize')) $('clockTimeSize').value = clock.timeSize || '56px';
    if($('clockAlpha')) $('clockAlpha').value = Number(clock.backgroundAlpha ?? 0.72).toFixed(2);
    if($('clockAlphaRange')) $('clockAlphaRange').value = Math.round(Number(clock.backgroundAlpha ?? 0.72) * 100);
  }

  function syncGoalAlphaFromRange(){
    const range=$('goalAlphaRange');
    const num=$('goalAlpha');
    if(!range||!num) return;
    const alpha=Math.max(0,Math.min(1,Number(range.value||65)/100));
    num.value=alpha.toFixed(2);
  }

  function syncGoalAlphaFromNumber(){
    const range=$('goalAlphaRange');
    const num=$('goalAlpha');
    if(!range||!num) return;
    const alpha=Math.max(0,Math.min(1,Number(num.value||0.65)));
    num.value=alpha.toFixed(2);
    range.value=Math.round(alpha*100);
  }

  function syncClockAlphaFromRange(){
    const range=$('clockAlphaRange');
    const num=$('clockAlpha');
    if(!range||!num) return;
    const alpha=Math.max(0,Math.min(1,Number(range.value||72)/100));
    num.value=alpha.toFixed(2);
  }

  function syncClockAlphaFromNumber(){
    const range=$('clockAlphaRange');
    const num=$('clockAlpha');
    if(!range||!num) return;
    const alpha=Math.max(0,Math.min(1,Number(num.value||0.72)));
    num.value=alpha.toFixed(2);
    range.value=Math.round(alpha*100);
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
    const direction = $('goalDirection')?.value || 'column';
    const widthMode = $('goalWidthMode')?.value || old.layout.widthMode || 'auto';
    const widthValue = clampNumber($('goalCardWidth')?.value, direction === 'row' ? old.layout.minWidthRow : old.layout.minWidthCol, 120, 5000);
    const layout = {
      ...old.layout,
      direction,
      gap: Math.max(0, Math.min(240, Number($('goalGap')?.value || 30))),
      widthMode,
      baseAlpha: alpha,
      completedAlpha: alpha,
      completeFlashMs: Math.round(Math.max(0, Math.min(30, Number($('goalFlashSec')?.value || 3))) * 1000)
    };
    if(direction === 'row') layout.minWidthRow = widthValue;
    else layout.minWidthCol = widthValue;

    if($('goalAlphaRange')) $('goalAlphaRange').value = Math.round(alpha * 100);
    return normalizeGoalConfig({ layout, cards: nextCards });
  }

  function collectClockConfig(){
    const alpha = Math.max(0, Math.min(1, Number($('clockAlpha')?.value || 0.72)));
    if($('clockAlphaRange')) $('clockAlphaRange').value = Math.round(alpha * 100);
    return normalizeClockConfig({
      label: $('clockLabel')?.value || 'LIVE',
      timezone: $('clockTimezone')?.value || 'Asia/Taipei',
      hour12: $('clockHour12')?.value === 'true',
      scale: Math.max(0.3, Math.min(3, Number($('clockScale')?.value || 1))),
      timeSize: $('clockTimeSize')?.value || '56px',
      dateSize: '18px',
      backgroundAlpha: alpha
    });
  }

  function saveGoalSettings(){
    const goal = collectGoalConfig();
    const clock = normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
    writeJson(GOAL_KEY, goal);
    broadcastConfigs(goal, clock);
    renderGoalCardsEditor(goal);
    syncWidthInputs(goal);
    postSharedConfig({ theme: currentTheme, goal, clock });
    showToastSafe('小目標設定已儲存，OBS 會自動同步');
  }

  function saveClockSettings(){
    const goal = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
    const clock = collectClockConfig();
    writeJson(CLOCK_KEY, clock);
    broadcastConfigs(goal, clock);
    postSharedConfig({ theme: currentTheme, goal, clock });
    showToastSafe('時鐘設定已儲存，OBS 會自動同步');
  }

  function resetGoalSettings(){
    const goal = clone(defaultGoalConfig);
    const clock = normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
    writeJson(GOAL_KEY, goal);
    broadcastConfigs(goal, clock);
    hydrateGoalSettings(goal);
    postSharedConfig({ theme: currentTheme, goal, clock });
    showToastSafe('已恢復小目標預設');
  }

  function resetClockSettings(){
    const goal = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
    const clock = clone(defaultClockConfig);
    writeJson(CLOCK_KEY, clock);
    broadcastConfigs(goal, clock);
    hydrateClockSettings(clock);
    postSharedConfig({ theme: currentTheme, goal, clock });
    showToastSafe('已恢復時鐘預設');
  }

  async function loadSharedConfig(){
    ensureClockAlphaControls();
    ensureGoalWidthControls();
    try{
      const res = await fetch('/api/overlay-config?_t=' + Date.now(), { cache:'no-store' });
      const data = await res.json();
      if(!data?.ok || !data.config) throw new Error('invalid overlay config response');
      const cfg = data.config;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      applyDashboardTheme(cfg.theme || currentTheme);
      hydrateGoalSettings(cfg.goal);
      hydrateClockSettings(cfg.clock);
      writeJson(GOAL_KEY, normalizeGoalConfig(cfg.goal));
      writeJson(CLOCK_KEY, normalizeClockConfig(cfg.clock));
      broadcastConfigs(normalizeGoalConfig(cfg.goal), normalizeClockConfig(cfg.clock));
    }catch(err){
      console.warn('Using local overlay config fallback:', err.message);
      hydrateGoalSettings();
      hydrateClockSettings();
      scheduleSharedSave();
    }
  }

  $('saveGoalBtn')?.addEventListener('click', saveGoalSettings);
  $('resetGoalBtn')?.addEventListener('click', resetGoalSettings);
  $('saveClockBtn')?.addEventListener('click', saveClockSettings);
  $('resetClockBtn')?.addEventListener('click', resetClockSettings);

  $('goalCount')?.addEventListener('input', ()=>{
    const goal=collectGoalConfig();
    writeJson(GOAL_KEY, goal);
    renderGoalCardsEditor(goal);
    syncWidthInputs(goal);
    broadcastConfigs(goal, normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig)));
    scheduleSharedSave();
  });

  $('goalAlphaRange')?.addEventListener('input', ()=>{
    syncGoalAlphaFromRange();
    const goal=collectGoalConfig();
    const clock=normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
    writeJson(GOAL_KEY, goal);
    broadcastConfigs(goal, clock);
    scheduleSharedSave();
  });

  $('goalAlpha')?.addEventListener('input', ()=>{
    syncGoalAlphaFromNumber();
  });

  document.addEventListener('input', event=>{
    if(event.target?.id === 'clockAlphaRange') syncClockAlphaFromRange();
    if(event.target?.id === 'clockAlpha') syncClockAlphaFromNumber();

    if(event.target?.closest?.('.goalSettingsPanel')){
      const goal = collectGoalConfig();
      const clock = normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
      writeJson(GOAL_KEY, goal);
      syncWidthInputs(goal);
      broadcastConfigs(goal, clock);
      scheduleSharedSave();
    }
    if(event.target?.closest?.('.clockSettingsPanel')){
      const goal = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
      const clock = collectClockConfig();
      writeJson(CLOCK_KEY, clock);
      broadcastConfigs(goal, clock);
      scheduleSharedSave();
    }
  });

  document.addEventListener('change', event=>{
    if(event.target?.id === 'goalDirection' || event.target?.id === 'goalWidthMode') {
      const goal = collectGoalConfig();
      syncWidthInputs(goal);
    }

    if(event.target?.closest?.('.goalSettingsPanel')){
      const goal = collectGoalConfig();
      const clock = normalizeClockConfig(readJson(CLOCK_KEY, defaultClockConfig));
      writeJson(GOAL_KEY, goal);
      syncWidthInputs(goal);
      broadcastConfigs(goal, clock);
      scheduleSharedSave();
    }
    if(event.target?.closest?.('.clockSettingsPanel')){
      const goal = normalizeGoalConfig(readJson(GOAL_KEY, defaultGoalConfig));
      const clock = collectClockConfig();
      writeJson(CLOCK_KEY, clock);
      broadcastConfigs(goal, clock);
      scheduleSharedSave();
    }
  });

  bootThemeSettings();
  hydrateAddonUrls();
  loadSharedConfig();
})();
