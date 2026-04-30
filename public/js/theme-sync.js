(function(){
  const THEME_KEY = 'obsHelperTheme';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const channel = new BroadcastChannel('obs-helper-theme');
  let currentTheme = localStorage.getItem(THEME_KEY) || 'blue-night';
  let lastUpdatedAt = 0;
  let applying = false;

  function normalizeTheme(theme){
    return theme === 'pink-cute' ? 'pink-cute' : 'blue-night';
  }

  function applyOverlayVars(config){
    const music = config?.music || {};
    const goal = config?.goal || {};
    const root = document.documentElement;

    root.style.setProperty('--now-playing-alpha', Number(music.nowPlayingAlpha ?? 0.65));
    root.style.setProperty('--queue-alpha', Number(music.queueAlpha ?? 0.65));
    root.style.setProperty('--shared-card-alpha', Number(goal.layout?.baseAlpha ?? 0.65));
  }

  function applyTheme(theme, source = 'local', config = null){
    const next = normalizeTheme(theme);
    currentTheme = next;
    localStorage.setItem(THEME_KEY, next);
    document.body.dataset.theme = next;
    if (config) applyOverlayVars(config);
    window.dispatchEvent(new CustomEvent('obs-helper-theme-applied', { detail: { theme: next, source, config } }));
  }

  async function fetchSharedConfig(){
    try{
      const res = await fetch('/api/overlay-config?_t=' + Date.now(), { cache:'no-store' });
      const data = await res.json();
      if(!data?.ok || !data.config) return;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      applyOverlayVars(data.config);

      const updatedAt = Number(data.config.updatedAt || 0);
      if(updatedAt >= lastUpdatedAt){
        lastUpdatedAt = updatedAt;
        applyTheme(data.config.theme || currentTheme, 'server', data.config);
      }
    }catch(err){
      // OBS Browser Source may load before the helper server is fully ready.
    }
  }

  async function saveSharedTheme(theme){
    if(applying) return;
    try{
      applying = true;
      const cached = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      const payload = {
        theme: normalizeTheme(theme),
        goal: cached.goal,
        clock: cached.clock,
        music: cached.music
      };
      const res = await fetch('/api/overlay-config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>null);
      if(data?.ok && data.config){
        localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
        applyOverlayVars(data.config);
        lastUpdatedAt = Number(data.config.updatedAt || Date.now());
      }
    }catch(err){
      // Keep local theme as fallback.
    }finally{
      applying = false;
    }
  }

  applyTheme(currentTheme, 'boot');
  fetchSharedConfig();
  setInterval(fetchSharedConfig, 1000);

  channel.addEventListener('message', event => {
    if(event.data?.type !== 'theme-change') return;
    applyTheme(event.data.theme, 'broadcast');
  });

  window.obsHelperTheme = {
    get: () => currentTheme,
    set: theme => {
      const next = normalizeTheme(theme);
      applyTheme(next, 'manual');
      channel.postMessage({ type:'theme-change', theme: next });
      saveSharedTheme(next);
    },
    refresh: fetchSharedConfig
  };
})();
