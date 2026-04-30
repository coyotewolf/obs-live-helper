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

  function applyTheme(theme, source = 'local'){
    const next = normalizeTheme(theme);
    if (currentTheme === next && document.body.dataset.theme === next) return;
    currentTheme = next;
    localStorage.setItem(THEME_KEY, next);
    document.body.dataset.theme = next;
    window.dispatchEvent(new CustomEvent('obs-helper-theme-applied', { detail: { theme: next, source } }));
  }

  async function fetchSharedConfig(){
    try{
      const res = await fetch('/api/overlay-config?_t=' + Date.now(), { cache:'no-store' });
      const data = await res.json();
      if(!data?.ok || !data.config) return;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
      if(Number(data.config.updatedAt || 0) > lastUpdatedAt){
        lastUpdatedAt = Number(data.config.updatedAt || 0);
        applyTheme(data.config.theme || currentTheme, 'server');
      }else if(data.config.theme){
        applyTheme(data.config.theme, 'server');
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
        clock: cached.clock
      };
      const res = await fetch('/api/overlay-config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>null);
      if(data?.ok && data.config){
        localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
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
