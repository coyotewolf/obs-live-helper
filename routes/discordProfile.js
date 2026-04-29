/**
 * Local Discord StreamKit proxy for dcprofilepic.html.
 *
 * The StreamKit overlay expects to be hosted under /overlay/voice/... and calls
 * relative assets/endpoints such as /static/... and /overlay/token. This proxy
 * keeps those paths working on localhost, then injects OBS Live Helper styling.
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

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
    bg_opacity: query.bg_opacity || '0',
    bg_shadow_color: query.bg_shadow_color || '#000000',
    bg_shadow_size: query.bg_shadow_size || '0',
    invite_code: query.invite_code || '',
    limit_speaking: query.limit_speaking || 'false',
    small_avatars: query.small_avatars || 'false',
    hide_names: query.hide_names || 'false',
    fade_chat: query.fade_chat || '0',
    streamer_avatar_first: query.streamer_avatar_first || 'true'
  });
}

function injectedBridgeScript() {
  return `
<script id="obs-live-helper-discord-rpc-bridge">
(function(){
  var NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__obsLiveHelperPatched) return;

  function rewriteUrl(url){
    var text = String(url || '');
    if (text.indexOf('ws://127.0.0.1:6463') === 0 || text.indexOf('ws://localhost:6463') === 0) {
      var queryIndex = text.indexOf('?');
      var query = queryIndex >= 0 ? text.slice(queryIndex) : '';
      var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return protocol + '//' + location.host + '/discord-rpc' + query;
    }
    return url;
  }

  function PatchedWebSocket(url, protocols){
    var finalUrl = rewriteUrl(url);
    return protocols ? new NativeWebSocket(finalUrl, protocols) : new NativeWebSocket(finalUrl);
  }

  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  Object.keys(NativeWebSocket).forEach(function(key){
    try { PatchedWebSocket[key] = NativeWebSocket[key]; } catch (_) {}
  });
  PatchedWebSocket.__obsLiveHelperPatched = true;
  window.WebSocket = PatchedWebSocket;
})();
</script>`;
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
  --gap:14px;
  --avatar:90px;
  --font:'Segoe UI', system-ui, sans-serif;
  --speak-pad:calc((var(--avatar) * (var(--scale) - 1)) * 0.6 + 6px);
}

html,body{
  background:transparent !important;
  overflow:visible !important;
  margin:0 !important;
  padding:0 !important;
  width:100% !important;
  height:100% !important;
  text-align:left !important;
}

/* 只把 StreamKit 的最外層固定成左上角，不動內部結構 
body > div,
#root,
[class^="App"],
[class*=" App"]{
  position:static !important;
  transform:none !important;
  margin:0 !important;
  padding:0 !important;
  width:100% !important;
  height:auto !important;
  min-width:0 !important;
  text-align:left !important;
  overflow:visible !important;
}*/

/* 這裡才是整排頭像的排列方向：由左往右 */
[class^="Voice_voiceStates"],
[class*=" Voice_voiceStates"]{
  position:static !important;
  transform:none !important;
  display:flex !important;
  flex-direction:row !important;
  flex-wrap:nowrap !important;
  justify-content:flex-start !important;
  align-items:flex-start !important;
  align-content:flex-start !important;
  gap:var(--gap) !important;
  padding:var(--speak-pad) 0 0 var(--speak-pad) !important;
  margin:0 !important;
  width:max-content !important;
  min-width:0 !important;
  max-width:none !important;
  height:auto !important;
  overflow:visible !important;
  text-align:left !important;
}

/* 不要讓任何子層用負 margin 疊在一起 */
[class^="Voice_voiceStates"] > *,
[class*=" Voice_voiceStates"] > *,
[class^="Voice_voiceState"],
[class*=" Voice_voiceState"]{
  margin:0 !important;
  margin-left:0 !important;
  margin-right:0 !important;
  position:relative !important;
  transform:none !important;
  overflow:visible !important;
}

/* 每個使用者卡片：保留內部上下結構，但不要壓成窄欄造成換行重疊 */
[class^="Voice_voiceState"],
[class*=" Voice_voiceState"]{
  display:flex !important;
  flex-direction:column !important;
  flex-wrap:nowrap !important;
  align-items:center !important;
  justify-content:flex-start !important;
  width:var(--avatar) !important;
  min-width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  padding:0 !important;
  border:none !important;
  background:transparent !important;
  box-shadow:none !important;
  backdrop-filter:none !important;
  border-radius:0 !important;
}

/* 頭像本體 */
img[class^="Voice_avatar"],
img[class*=" Voice_avatar"]{
  display:block !important;
  position:relative !important;
  order:1 !important;
  width:var(--avatar) !important;
  height:var(--avatar) !important;
  min-width:var(--avatar) !important;
  min-height:var(--avatar) !important;
  max-width:var(--avatar) !important;
  max-height:var(--avatar) !important;
  object-fit:cover !important;
  border-radius:18px !important;
  border:2px solid rgba(125,211,252,.32) !important;
  box-sizing:border-box !important;
  box-shadow:inset 0 0 0 2px rgba(0,0,0,.65),0 8px 24px rgba(0,0,0,.22) !important;
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

/* 名字放在頭像下方，不參與頭像水平排列 */
[class^="Voice_user"],
[class*=" Voice_user"]{
  order:2 !important;
  display:block !important;
  width:var(--avatar) !important;
  min-width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  margin:0 !important;
  padding:0 !important;
  overflow:hidden !important;
  text-align:center !important;
  font-family:var(--font) !important;
  line-height:1.05 !important;
}

span[class^="Voice_name"],
span[class*=" Voice_name"],
div[class^="Voice_name"],
div[class*=" Voice_name"],
span[class*="userName"],
div[class*="userName"]{
  display:block !important;
  width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  box-sizing:border-box !important;
  text-align:center !important;
  font-weight:800 !important;
  letter-spacing:.2px !important;
  color:#ffffff !important;
  text-shadow:0 0 12px rgba(125,211,252,.45),0 0 18px rgba(167,139,250,.28) !important;
  overflow:hidden !important;
  text-overflow:clip !important;
  white-space:nowrap !important;
  margin:0 !important;
  padding:0 !important;
}

.obs-name-marquee-viewport{
  display:block !important;
  width:var(--avatar) !important;
  max-width:var(--avatar) !important;
  overflow:hidden !important;
  white-space:nowrap !important;
  text-align:center !important;
}

.obs-name-marquee-inner{
  display:inline-block !important;
  white-space:nowrap !important;
  will-change:transform !important;
  transform:translateX(0);
}

/* 只有真的啟用跑馬燈時，才改成左對齊，讓文字從左邊開始滑 */
.obs-marquee-active .obs-name-marquee-viewport{
  text-align:left !important;
}

.obs-marquee-active .obs-name-marquee-inner{
  animation:obs-discord-name-marquee var(--marquee-duration, 7s) linear infinite alternate !important;
}

@keyframes obs-discord-name-marquee{
  0%,18%{
    transform:translateX(0);
  }
  82%,100%{
    transform:translateX(calc(var(--marquee-distance, 0px) * -1));
  }
}

/* 避免 aria-label 備援文字擠出第二層名字造成重疊 */
[class^="Voice_voiceState"][aria-label]::after,
[class*=" Voice_voiceState"][aria-label]::after{
  display:none !important;
  content:none !important;
}

@keyframes obs-discord-pulse{
  0%{filter:brightness(1.02) saturate(1.02);}
  100%{filter:brightness(1.36) saturate(1.14);}
}
</style>`;
}

function injectedSafeHorizontalScript() {
  return `
<script id="obs-live-helper-safe-horizontal-layout">
(function(){
  function classText(el){
    return String(el && el.className || '');
  }

  function isVoiceStatesContainer(el){
    return classText(el).indexOf('Voice_voiceStates') >= 0;
  }

  function isVoiceStateCard(el){
    var cls = classText(el);
    return cls.indexOf('Voice_voiceState') >= 0 && cls.indexOf('Voice_voiceStates') < 0;
  }

  function applyStyle(el, styles){
    if (!el || !el.style) return;
    Object.keys(styles).forEach(function(key){
      el.style.setProperty(key, styles[key], 'important');
    });
  }

    function isNameNode(el){
    var cls = classText(el);
    return cls.indexOf('Voice_name') >= 0 || cls.indexOf('userName') >= 0;
  }

  function getTextWidth(el){
    if (!el) return 0;

    var text = el.textContent || '';
    var canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement('canvas'));
    var ctx = canvas.getContext('2d');

    var style = window.getComputedStyle(el);
    ctx.font = [
      style.fontStyle,
      style.fontVariant,
      style.fontWeight,
      style.fontSize,
      style.fontFamily
    ].join(' ');

    return ctx.measureText(text).width;
  }

  function applyNameMarquee(){
    var names = Array.prototype.slice
      .call(document.querySelectorAll('[class*="Voice_name"], [class*="userName"]'))
      .filter(isNameNode);

    names.forEach(function(name){
      if (name.dataset.obsMarqueeReady !== '1') {
        var originalText = name.textContent || '';

        name.textContent = '';

        var viewport = document.createElement('span');
        viewport.className = 'obs-name-marquee-viewport';

        var inner = document.createElement('span');
        inner.className = 'obs-name-marquee-inner';
        inner.textContent = originalText;

        viewport.appendChild(inner);
        name.appendChild(viewport);

        name.dataset.obsMarqueeReady = '1';
      }

      var viewport = name.querySelector('.obs-name-marquee-viewport');
      var inner = name.querySelector('.obs-name-marquee-inner');
      if (!viewport || !inner) return;

      applyStyle(name, {
        'overflow':'hidden',
        'text-overflow':'clip',
        'white-space':'nowrap'
      });

      var viewportWidth = viewport.clientWidth || 90;
      var textWidth = getTextWidth(inner);
      var overflow = Math.ceil(textWidth - viewportWidth);

      if (overflow > 4) {
        var duration = Math.max(5, Math.min(14, textWidth / 18));

        name.classList.add('obs-marquee-active');
        viewport.style.setProperty('text-align', 'left', 'important');
        name.style.setProperty('--marquee-distance', overflow + 'px');
        name.style.setProperty('--marquee-duration', duration + 's');
      } else {
        name.classList.remove('obs-marquee-active');
        name.style.setProperty('--marquee-distance', '0px');
        name.style.setProperty('--marquee-duration', '7s');
        viewport.style.setProperty('text-align', 'center', 'important');
        inner.style.setProperty('transform', 'translateX(0)', 'important');
        inner.style.removeProperty('animation');
      }
    });
  }
  
  function applyHorizontalLayout(){
    var containers = Array.prototype.slice
      .call(document.querySelectorAll('[class*="Voice_voiceStates"]'))
      .filter(isVoiceStatesContainer);

    containers.forEach(function(container){
      applyStyle(container, {
        'display':'flex',
        'flex-direction':'row',
        'flex-wrap':'nowrap',
        'justify-content':'flex-start',
        'align-items':'flex-start',
        'align-content':'flex-start',
        'gap':'14px',
        'column-gap':'14px',
        'row-gap':'0px',
        'width':'max-content',
        'min-width':'0',
        'max-width':'none',
        'height':'auto',
        'margin':'0',
        'padding':'8px 0 0 8px',
        'overflow':'visible',
        'text-align':'left',
        'transform':'none',
        'position':'relative'
      });
    });

    var cards = Array.prototype.slice
      .call(document.querySelectorAll('[class*="Voice_voiceState"]'))
      .filter(isVoiceStateCard);

    cards.forEach(function(card){
      applyStyle(card, {
        'display':'flex',
        'flex-direction':'column',
        'flex-wrap':'nowrap',
        'align-items':'center',
        'justify-content':'flex-start',
        'width':'90px',
        'min-width':'90px',
        'max-width':'90px',
        'height':'auto',
        'margin':'0',
        'margin-left':'0',
        'margin-right':'0',
        'padding':'0',
        'overflow':'visible',
        'transform':'none',
        'position':'relative',
        'background':'transparent',
        'border':'0',
        'box-shadow':'none'
      });
    });
    applyNameMarquee();
  }

  var scheduled = false;
  function schedule(){
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function(){
      scheduled = false;
      applyHorizontalLayout();
    });
  }

  window.addEventListener('load', schedule);
  setInterval(schedule, 800);

  new MutationObserver(schedule).observe(document.documentElement, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['class','style']
  });

  schedule();
})();
</script>`;
}

function injectIntoHtml(html) {
  let out = String(html || '');

  // Cloudflare challenge scripts are not useful in the local proxy and can break MIME checks.
  out = out.replace(/<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform[^"']*["'][^>]*><\/script>/gi, '');

  const injection = `${injectedBridgeScript()}${injectedStyle()}${injectedSafeHorizontalScript()}`;
  if (out.includes('</head>')) return out.replace('</head>', `${injection}</head>`);
  return `${injection}${out}`;
}

async function proxyStreamkitHtml(req, res, guild, channel) {
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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${STREAMKIT_ORIGIN}/overlay`
      },
      validateStatus: status => status >= 200 && status < 400
    });

    res.type('html');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(injectIntoHtml(response.data));
  } catch (err) {
    console.error('Discord StreamKit proxy error:', err.response?.status, err.message);
    return res.status(502).type('html').send(`
      <meta charset="utf-8">
      <body style="margin:0;background:transparent;color:#fff;font-family:system-ui;padding:16px;">
        <strong>Discord StreamKit 載入失敗</strong><br>
        <small>${String(err.message || 'unknown error')}</small>
      </body>
    `);
  }
}

async function proxyRaw(req, res, targetPath) {
  const targetUrl = `${STREAMKIT_ORIGIN}${targetPath}`;
  try {
    const response = await axios({
      url: targetUrl,
      method: req.method,
      responseType: 'arraybuffer',
      data: req.body && Object.keys(req.body).length ? req.body : undefined,
      maxRedirects: 5,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 OBS-Live-Helper Discord Overlay',
        'Accept': req.headers.accept || '*/*',
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Origin': STREAMKIT_ORIGIN,
        'Referer': `${STREAMKIT_ORIGIN}/overlay`
      },
      validateStatus: status => status >= 200 && status < 500
    });

    res.status(response.status);
    res.setHeader('Cache-Control', 'no-store');
    if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
    return res.send(response.data);
  } catch (err) {
    console.error('Discord StreamKit raw proxy error:', targetPath, err.response?.status, err.message);
    return res.status(502).type('text/plain').send(`Discord StreamKit proxy error: ${err.message}`);
  }
}

router.get('/voice/:guild/:channel', (req, res) => proxyStreamkitHtml(req, res, req.params.guild, req.params.channel));
router.get('/streamkit', (req, res) => proxyStreamkitHtml(
  req,
  res,
  String(req.query.guild || DEFAULT_GUILD_ID),
  String(req.query.channel || DEFAULT_CHANNEL_ID)
));

// StreamKit posts OAuth/RPC authorization exchange data here as a relative endpoint.
router.post('/token', (req, res) => proxyRaw(req, res, '/overlay/token'));

const staticRouter = express.Router();
staticRouter.use((req, res) => proxyRaw(req, res, req.originalUrl));

const noOpScriptRouter = express.Router();
noOpScriptRouter.use((req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-store');
  res.send('/* Cloudflare challenge disabled by OBS Live Helper local proxy. */');
});

router.staticRouter = staticRouter;
router.noOpScriptRouter = noOpScriptRouter;
router.proxyAsset = (pathName) => (req, res) => proxyRaw(req, res, pathName);

module.exports = router;
