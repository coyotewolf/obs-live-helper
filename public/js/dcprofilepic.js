const DEFAULT_GUILD_ID = '';
const DEFAULT_CHANNEL_ID = '';

const params = new URLSearchParams(location.search);
const iframe = document.getElementById('discordStreamkitFrame');
const loadingText = document.getElementById('loadingText');

function fallbackProxyUrl() {
  const guild = params.get('guild') || DEFAULT_GUILD_ID;
  const channel = params.get('channel') || DEFAULT_CHANNEL_ID;
  const proxyParams = new URLSearchParams({
    icon: 'true',
    online: 'true',
    logo: 'white',
    text_color: '#ffffff',
    text_size: '14',
    text_outline_color: '#000000',
    text_outline_size: '0',
    text_shadow_color: '#000000',
    text_shadow_size: '0',
    bg_color: '#1e2124',
    bg_opacity: '0',
    bg_shadow_color: '#000000',
    bg_shadow_size: '0',
    invite_code: params.get('invite_code') || '',
    limit_speaking: 'false',
    small_avatars: 'false',
    hide_names: params.get('hide_names') || 'false',
    fade_chat: '0',
    streamer_avatar_first: 'true'
  });
  return `/overlay/voice/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}?${proxyParams.toString()}`;
}

function setFrame(src) {
  iframe.src = src || fallbackProxyUrl();
}

iframe.addEventListener('load', () => {
  if (loadingText) loadingText.style.display = 'none';
  iframe.classList.add('is-loaded');
});

(async () => {
  try {
    const data = await fetch('/api/config/discord-streamkit', { cache: 'no-store' }).then(r => r.json());
    if (data?.ok && data.streamKitProxyUrl) {
      setFrame(data.streamKitProxyUrl);
      return;
    }
  } catch (err) {
    console.warn('Failed to load Discord StreamKit config:', err);
  }
  setFrame(fallbackProxyUrl());
})();
