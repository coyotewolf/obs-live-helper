const DEFAULT_GUILD_ID = '';
const DEFAULT_CHANNEL_ID = '';

const params = new URLSearchParams(location.search);
const iframe = document.getElementById('discordStreamkitFrame');
const loadingText = document.getElementById('loadingText');
const themeChannel = new BroadcastChannel('obs-helper-theme');

let configuredProxyUrl = '';
let currentTheme = (window.obsHelperTheme && window.obsHelperTheme.get && window.obsHelperTheme.get()) || localStorage.getItem('obsHelperTheme') || 'blue-night';
let lastServerUpdatedAt = 0;

function normalizeTheme(theme) {
  return theme === 'pink-cute' ? 'pink-cute' : 'blue-night';
}

function getThemeParams(theme) {
  if (theme === 'pink-cute') {
    return {
      logo: 'white',
      text_color: '#ffffff',
      text_outline_color: '#7a234f',
      text_outline_size: '1',
      text_shadow_color: '#ff7fa9',
      text_shadow_size: '6',
      bg_color: '#ff7fa9',
      bg_opacity: '0',
      bg_shadow_color: '#ff7fa9',
      bg_shadow_size: '8'
    };
  }

  // Blue-night theme:
  // Keep the old text style unchanged, but use a purple shadow for the speaking avatar/card glow.
  return {
    logo: 'white',
    text_color: '#ffffff',
    text_outline_color: '#000000',
    text_outline_size: '0',
    text_shadow_color: '#000000',
    text_shadow_size: '0',
    bg_color: '#1e2124',
    bg_opacity: '0',
    bg_shadow_color: '#c084fc',
    bg_shadow_size: '10'
  };
}

function applyThemeToStreamKitUrl(rawUrl, theme = currentTheme) {
  if (!rawUrl) return rawUrl;
  const themeParams = getThemeParams(theme);
  try {
    const url = new URL(rawUrl, location.origin);
    Object.entries(themeParams).forEach(([key, value]) => url.searchParams.set(key, value));
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return rawUrl;
  }
}

function fallbackProxyUrl() {
  const guild = params.get('guild') || DEFAULT_GUILD_ID;
  const channel = params.get('channel') || DEFAULT_CHANNEL_ID;
  const proxyParams = new URLSearchParams({
    icon: 'true',
    online: 'true',
    text_size: '14',
    invite_code: params.get('invite_code') || '',
    limit_speaking: 'false',
    small_avatars: 'false',
    hide_names: params.get('hide_names') || 'false',
    fade_chat: '0',
    streamer_avatar_first: 'true',
    ...getThemeParams(currentTheme)
  });
  return `/overlay/voice/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}?${proxyParams.toString()}`;
}

function setFrame(src) {
  const nextSrc = applyThemeToStreamKitUrl(src || configuredProxyUrl || fallbackProxyUrl(), currentTheme);
  if (iframe.src !== new URL(nextSrc, location.origin).href) {
    iframe.classList.remove('is-loaded');
    if (loadingText) loadingText.style.display = '';
    iframe.src = nextSrc;
  }
}

function applyTheme(theme) {
  const next = normalizeTheme(theme);
  if (next === currentTheme && iframe.src) return;
  currentTheme = next;
  localStorage.setItem('obsHelperTheme', currentTheme);
  setFrame(configuredProxyUrl || fallbackProxyUrl());
}

async function fetchSharedTheme() {
  try {
    const data = await fetch('/api/overlay-config?_t=' + Date.now(), { cache:'no-store' }).then(r => r.json());
    if (!data?.ok || !data.config) return;
    const updatedAt = Number(data.config.updatedAt || 0);
    if (updatedAt >= lastServerUpdatedAt) {
      lastServerUpdatedAt = updatedAt;
      applyTheme(data.config.theme || currentTheme);
    }
  } catch {}
}

iframe.addEventListener('load', () => {
  if (loadingText) loadingText.style.display = 'none';
  iframe.classList.add('is-loaded');
});

themeChannel.addEventListener('message', event => {
  if (event.data?.type !== 'theme-change') return;
  applyTheme(event.data.theme || 'blue-night');
});

window.addEventListener('obs-helper-theme-applied', event => {
  applyTheme(event.detail?.theme || 'blue-night');
});

(async () => {
  await fetchSharedTheme();
  try {
    const data = await fetch('/api/config/discord-streamkit', { cache: 'no-store' }).then(r => r.json());
    if (data?.ok && data.streamKitProxyUrl) {
      configuredProxyUrl = data.streamKitProxyUrl;
      setFrame(configuredProxyUrl);
      return;
    }
  } catch (err) {
    console.warn('Failed to load Discord StreamKit config:', err);
  }
  configuredProxyUrl = '';
  setFrame(fallbackProxyUrl());
})();

setInterval(fetchSharedTheme, 1000);
