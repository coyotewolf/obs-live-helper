/**
 * Local Discord StreamKit proxy for dcprofilepic.html.
 *
 * Why this exists:
 * - streamkit.discord.com refuses normal iframe embedding in many contexts.
 * - We proxy the already-working StreamKit URL through localhost and inject CSS.
 * - OBS only needs to load /html/dcprofilepic.html.
 */
const router = require('express').Router();
const axios = require('axios');

const DEFAULT_GUILD_ID = '0000000000000000000';
const DEFAULT_CHANNEL_ID = '0000000000000000000';
const STREAMKIT_ORIGIN = 'https://streamkit.discord.com';

function buildDefaultParams(query = {}) {
  return new URLSearchParams({
    icon: query.icon || 'true',
    online: query.online || 'true',
    logo: query.logo || 'white',
    text_color: query.text_color || '#ffffff',
    text_size: query.text_size || '14',
    text_outline_color: query.text_outline_color || '#000000',
    text_outline_size: query.text_outline_size || '0',
    text_shadow_color: query.text_shadow_color || '#000000',
    text_shadow_size: query.text_shadow_size || '0',
    bg_color: query.bg_color || '#1e2124',
    bg_opacity: query.bg_opacity || '0.28',
    bg_shadow_color: query.bg_shadow_color || '#000000',
    bg_shadow_size: query.bg_shadow_size || '0',
    invite_code: query.invite_code || '',
    limit_speaking: query.limit_speaking || 'true',
    small_avatars: query.small_avatars || 'false',
    hide_names: query.hide_names || 'false',
    fade_chat: query.fade_chat || '0',
    streamer_avatar_first: query.streamer_avatar_first || 'false'
  });
}

function injectedStyle() {
  return `
<style id="obs-live-helper-discord-style">
:root{
  --accent:#7dd3fc;
  --accent-2:#a78bfa;
  --idle:0.30;
  --scale:1.10;
  --glow:18px;
  --overlap-x:60px;
  --gap:0px;
  --avatar:90px;
  --font:'Segoe UI', system-ui, sans-serif;
  --speak-pad:calc((var(--avatar) * (var(--scale) - 1)) * 0.6 + 6px);
}
html,body{
  background:transparent !important;
  overflow:visible !important;
  margin:0 !important;
  padding:0 !important;
  height:100% !important;
}
[class^="Voice_voiceStates"], [class*=" Voice_voiceStates"]{
  display:flex !important;
  justify-content:flex-start !important;
  align-items:flex-start !important;
  align-content:flex-start !important;
  gap:var(--gap) !important;
  column-gap:var(--gap) !important;
  row-gap:0 !important;
  padding:var(--speak-pad) 0 0 0 !important;
  margin:0 !important;
  width:100% !important;
  overflow:visible !important;
}
[class^="Voice_voiceStates"] > *,
[class*=" Voice_voiceStates"] > *{
  margin:0 !important;
  overflow:visible !important;
}
[class^="Voice_voiceState"], [class*=" Voice_voiceState"]{
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
  flex-wrap:wrap !important;
  gap:0 !important;
  padding:var(--speak-pad) 0 var(--speak-pad) 0 !important;
  margin:0 !important;
  border:none !important;
  background:transparent !important;
  box-shadow:none !important;
  backdrop-filter:none !important;
  border-radius:0 !important;
  min-width:auto !important;
  overflow:visible !important;
}
[class^="Voice_voiceState"]:not(:first-child),
[class*=" Voice_voiceState"]:not(:first-child){
  margin-left:calc(-1 * var(--overlap-x)) !important;
}
img[class^="Voice_avatar"], img[class*=" Voice_avatar"]{
  order:1 !important;
  width:var(--avatar) !important;
  height:var(--avatar) !important;
  object-fit:cover !important;
  border-radius:18px !important;
  border:2px solid rgba(125,211,252,.32) !important;
  box-shadow:
    inset 0 0 0 2px rgba(0,0,0,.65),
    0 8px 24px rgba(0,0,0,.22) !important;
  transition:transform .15s ease, box-shadow .2s ease, opacity .2s ease, filter .2s ease, border-color .2s ease !important;
  transform-origin:center center !important;
  opacity:var(--idle) !important;
  filter:saturate(.82) brightness(.92) !important;
}
img[class*="Voice_avatarSpeaking"]{
  opacity:1 !important;
  transform:scale(var(--scale)) !important;
  filter:saturate(1.08) brightness(1.16) !important;
  border-color:var(--accent) !important;
  box-shadow:
    0 0 var(--glow) rgba(125,211,252,.95),
    0 0 calc(var(--glow)*.85) rgba(167,139,250,.75),
    0 0 calc(var(--glow)*.55) rgba(125,211,252,.55) inset,
    0 6px 18px rgba(0,0,0,.36) !important;
  animation:obs-discord-pulse 1.1s ease-in-out infinite alternate !important;
}
[class^="Voice_user"], [class*=" Voice_user"]{
  order:2 !important;
  flex:0 0 100% !important;
  display:flex !important;
  flex-direction:column !important;
  align-items:center !important;
  justify-content:center !important;
  font-family:var(--font) !important;
  line-height:1.05 !important;
  margin-top:0 !important;
  overflow:visible !important;
}
span[class^="Voice_name"], span[class*=" Voice_name"],
div[class^="Voice_name"],  div[class*=" Voice_name"],
span[class*="userName"],    div[class*="userName"]{
  display:block !important;
  visibility:visible !important;
  opacity:1 !important;
  width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  box-sizing:border-box !important;
  text-align:center !important;
  font-weight:800 !important;
  letter-spacing:.2px !important;
  color:#ffffff !important;
  text-shadow:0 0 12px rgba(125,211,252,.45), 0 0 18px rgba(167,139,250,.28) !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
  white-space:nowrap !important;
  margin:0 !important;
}
[class^="Voice_voiceState"][aria-label]::after,
[class*=" Voice_voiceState"][aria-label]::after{
  content:attr(aria-label) !important;
  order:2 !important;
  flex:0 0 100% !important;
  display:block !important;
  margin-top:0 !important;
  width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  box-sizing:border-box !important;
  font-family:var(--font) !important;
  font-weight:800 !important;
  letter-spacing:.2px !important;
  text-align:center !important;
  color:#ffffff !important;
  text-shadow:0 0 12px rgba(125,211,252,.45), 0 0 18px rgba(167,139,250,.28) !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
  white-space:nowrap !important;
}
@keyframes obs-discord-pulse{
  0%{ filter:brightness(1.02) saturate(1.02); }
  100%{ filter:brightness(1.36) saturate(1.14); }
}
</style>`;
}

function injectStyle(html) {
  const style = injectedStyle();
  if (html.includes('</head>')) return html.replace('</head>', `${style}</head>`);
  return `${style}${html}`;
}

router.get('/streamkit', async (req, res) => {
  const guild = String(req.query.guild || DEFAULT_GUILD_ID).trim();
  const channel = String(req.query.channel || DEFAULT_CHANNEL_ID).trim();

  if (!/^\d{10,30}$/.test(guild) || !/^\d{10,30}$/.test(channel)) {
    return res.status(400).send('Invalid Discord guild/channel id');
  }

  const params = buildDefaultParams(req.query);
  const targetUrl = `${STREAMKIT_ORIGIN}/overlay/voice/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}?${params.toString()}`;

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'text',
      maxRedirects: 5,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 OBS-Live-Helper Discord Overlay',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      validateStatus: status => status >= 200 && status < 400
    });

    const html = injectStyle(String(response.data || ''));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(html);
  } catch (err) {
    console.error('Discord StreamKit proxy error:', err.response?.status, err.message);
    return res.status(502).send(`
      <meta charset="utf-8">
      <body style="margin:0;background:transparent;color:#fff;font-family:system-ui;padding:16px;">
        <strong>Discord StreamKit 載入失敗</strong><br>
        <small>${String(err.message || 'unknown error')}</small>
      </body>
    `);
  }
});

module.exports = router;
