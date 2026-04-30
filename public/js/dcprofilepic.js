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

  // Blue-night theme keeps the old text styling. Avatar speaking glow is handled
  // by an injected iframe CSS override below, because StreamKit's injected CSS
  // controls Voice_avatarSpeaking more strongly than URL query params.
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
    bg_shadow_size: '18'
  };
}

function getAvatarGlowCss(theme) {
  if (theme === 'pink-cute') {
    return `
      img[class*="Voice_avatarSpeaking"]{
        border-color:#ff7fa9 !important;
        box-shadow:
          0 0 18px rgba(255,127,169,.95),
          0 0 15px rgba(168,216,255,.72),
          0 0 10px rgba(255,127,169,.58) inset,
          0 6px 18px rgba(0,0,0,.36) !important;
      }
    `;
  }

  return `
    img[class*="Voice_avatarSpeaking"]{
      border-color:#c084fc !important;
      box-shadow:
        0 0 20px rgba(192,132,252,.98),
        0 0 18px rgba(124,58,237,.82),
        0 0 11px rgba(192,132,252,.62) inset,
        0 6px 18px rgba(0,0,0,.36) !important;
    }
  `;
}

function injectAvatarGlowOverride() {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !doc.documentElement) return;

    let style = doc.getElementById('obs-helper-avatar-glow-override');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'obs-helper-avatar-glow-override';
      (doc.head || doc.documentElement).appendChild(style);
    }
    style.textContent = getAvatarGlowCss(currentTheme);
  } catch (err) {
    // Same-origin local proxy should allow this. If it ever does not, the normal
    // StreamKit params still remain as a fallback.
  }
}

function scheduleAvatarGlowOverride() {
  injectAvatarGlowOverride();
  setTimeout(injectAvatarGlowOverride, 80);
  setTimeout(injectAvatarGlowOverride, 350);
  setTimeout(injectAvatarGlowOverride, 900);
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
  } else {
    scheduleAvatarGlowOverride();
  }
}

function applyTheme(theme) {
  const next = normalizeTheme(theme);
  if (next === currentTheme && iframe.src) {
    scheduleAvatarGlowOverride();
    return;
  }
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
  scheduleAvatarGlowOverride();
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
setInterval(scheduleAvatarGlowOverride, 1500);
