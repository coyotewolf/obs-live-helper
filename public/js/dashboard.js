/* OBS Live Helper – Dashboard */
const bcStyle = new BroadcastChannel('obs-style-sync');
const $ = id => document.getElementById(id);

const builtinFonts = [
  'DFKai-SB','Noto Sans TC','Microsoft JhengHei','PMingLiU',
  'Segoe UI','Arial','Verdana','Helvetica','monospace',
  'Noto Sans JP','Yu Gothic','MS PGothic','Meiryo'
];
const userFonts = JSON.parse(localStorage.getItem('userFonts') || '[]');
const fontList = Array.from(new Set([...builtinFonts, ...userFonts]));

const editor = $('editorArea');
const preview = $('previewArea');
const toolbar = $('toolbar');
const fontSel = $('fontSel');
const fontFile = $('fontFile');
const uploadFontBtn = $('uploadFontBtn');
const saveBtn = $('saveTextBtn');
const clearBtn = $('clearTextBtn');
const fontSizeCtrl = $('fontSizeCtrl');
const pageBgColor = $('pageBgColor');
const pageBgTransparent = $('pageBgTransparent');
const toast = $('toast');

const DEFAULT_MESSAGE_FONT_SIZE = 28;
const DEFAULT_MESSAGE_COLOR = '#ffffff';

function showToast(message){
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function rebuildFontOptions(selected = fontSel?.value){
  if (!fontSel) return;
  fontSel.innerHTML = fontList.map(f => `<option value="${f}">${f}</option>`).join('');
  if (fontList.includes(selected)) fontSel.value = selected;
}
rebuildFontOptions();

fontSel?.addEventListener('change', () => {
  document.execCommand('fontName', false, fontSel.value);
  editor?.focus();
  syncPreview();
});

fontFile?.addEventListener('change', () => {
  if (uploadFontBtn) uploadFontBtn.style.display = fontFile.files.length ? '' : 'none';
});

uploadFontBtn?.addEventListener('click', async () => {
  if (!fontFile.files.length) return;
  uploadFontBtn.disabled = true;
  uploadFontBtn.textContent = '⏳ 上傳中…';
  const fd = new FormData();
  fd.append('font', fontFile.files[0]);

  try {
    const { family } = await fetch('/api/font/upload', { method: 'POST', body: fd }).then(r => r.json());
    if (!fontList.includes(family)) {
      fontList.push(family);
      userFonts.push(family);
      localStorage.setItem('userFonts', JSON.stringify(userFonts));
      rebuildFontOptions(family);
    } else {
      fontSel.value = family;
    }
    document.execCommand('fontName', false, family);
    syncPreview();
    bcStyle.postMessage({ type: 'reload-style' });
    showToast('字型已上傳');
  } catch (err) {
    console.error(err);
    alert('字體上傳失敗！');
  } finally {
    fontFile.value = '';
    uploadFontBtn.disabled = false;
    uploadFontBtn.style.display = 'none';
    uploadFontBtn.textContent = '上傳';
  }
});

function syncPreview(){
  if (!preview || !editor) return;
  preview.innerHTML = editor.innerHTML;
}

function applyPreviewContainerStyle(){
  if (!preview) return;
  preview.style.whiteSpace = 'nowrap';
  preview.style.textAlign = 'left';
  preview.style.lineHeight = '1';
  preview.style.fontSize = `${DEFAULT_MESSAGE_FONT_SIZE}px`;
  preview.style.color = '#000000';
  preview.style.fontFamily = 'Arial, Helvetica, sans-serif';
  preview.style.fontVariantNumeric = 'lining-nums';
  preview.style.fontFeatureSettings = '"lnum" 1';
  preview.style.background = pageBgTransparent?.checked ? 'transparent' : (pageBgColor?.value || '#ffffff');
}

pageBgColor?.addEventListener('input', () => {
  applyPreviewContainerStyle();
  bcStyle.postMessage({ type: 'set-css', css: buildCSS() });
});
pageBgTransparent?.addEventListener('change', () => {
  applyPreviewContainerStyle();
  bcStyle.postMessage({ type: 'set-css', css: buildCSS() });
});

toolbar?.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (cmd === 'transparent') document.execCommand('hiliteColor', false, 'transparent');
  else document.execCommand(cmd, false, null);
  editor?.focus();
  syncPreview();
});

$('foreColor')?.addEventListener('input', e => {
  document.execCommand('foreColor', false, e.target.value);
  syncPreview();
});
$('backColor')?.addEventListener('input', e => {
  document.execCommand('hiliteColor', false, e.target.value);
  syncPreview();
});

editor?.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'b') { document.execCommand('bold'); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'i') { document.execCommand('italic'); e.preventDefault(); }
  if (e.ctrlKey && e.key === 's') { saveEditor(); e.preventDefault(); }
});
editor?.addEventListener('input', syncPreview);

(async () => {
  if (!editor) return;
  const raw = await fetch('/api/editor').then(r => r.text()).catch(() => '');
  editor.innerHTML = raw;
  syncPreview();
  applyPreviewContainerStyle();
})();

let lastRange = null;
function saveSelection(){
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor) {
    const r = sel.getRangeAt(0);
    if (editor.contains(r.commonAncestorContainer)) lastRange = r.cloneRange();
  }
}
editor?.addEventListener('mouseup', saveSelection);
editor?.addEventListener('keyup', saveSelection);
editor?.addEventListener('mouseleave', saveSelection);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === editor) saveSelection();
});

function applyFontSizeToSelection(px){
  const size = parseInt(px, 10);
  if (!size || size <= 0 || !editor) return;
  const sel = window.getSelection();
  const range = (lastRange && lastRange.cloneRange()) || (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null);
  if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) return;
  const frag = range.extractContents();
  const wrapper = document.createElement('span');
  wrapper.style.fontSize = `${size}px`;
  wrapper.appendChild(frag);
  range.insertNode(wrapper);
  sel.removeAllRanges();
  range.selectNodeContents(wrapper);
  sel.addRange(range);
  saveSelection();
  syncPreview();
}
function handleFontSizeInput(){
  const v = fontSizeCtrl.value.trim();
  applyFontSizeToSelection(v.endsWith('px') ? v.slice(0, -2) : v);
}
fontSizeCtrl?.addEventListener('change', handleFontSizeInput);
fontSizeCtrl?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); handleFontSizeInput(); }
});

function normalizeFontSizesToPx(rootEl){
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, null);
  const els = [];
  while (walker.nextNode()) els.push(walker.currentNode);
  els.forEach(el => {
    if (el.tagName === 'FONT' && el.hasAttribute('size')) {
      const map = { 1:10, 2:13, 3:16, 4:18, 5:24, 6:32, 7:48 };
      const s = el.getAttribute('size');
      el.style.fontSize = `${map[s] || parseInt(s, 10) || DEFAULT_MESSAGE_FONT_SIZE}px`;
      el.removeAttribute('size');
    }
    if (el.style.fontSize && !el.style.fontSize.endsWith('px')) {
      el.style.fontSize = window.getComputedStyle(el).fontSize;
    }
  });
}

function buildCSS(){
  const pageBg = pageBgTransparent?.checked ? 'transparent' : (pageBgColor?.value || '#ffffff');
  return `html,body{background:${pageBg};margin:0;padding:0;}
#msgBox{
  font-size:${DEFAULT_MESSAGE_FONT_SIZE}px;
  color:${DEFAULT_MESSAGE_COLOR};
  white-space:nowrap;
  text-align:left;
  line-height:1;
  font-family: Arial, Helvetica, sans-serif;
  font-variant-numeric: lining-nums;
  font-feature-settings: "lnum" 1;
}
#msgBox span,
#msgBox b, #msgBox i, #msgBox u, #msgBox s,
#msgBox font{
  display:inline;
  vertical-align:text-bottom;
  line-height:1em;
}`;
}

async function saveEditor(){
  if (!editor) return;
  normalizeFontSizesToPx(editor);
  const html = editor.innerHTML;
  const css = buildCSS();
  await fetch('/api/editor/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: html })
  });
  await fetch('/api/style/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ css })
  }).catch(() => {});
  syncPreview();
  applyPreviewContainerStyle();
  bcStyle.postMessage({ type: 'update-html', html });
  bcStyle.postMessage({ type: 'set-css', css });
  showToast('自訂文字已儲存');
}
saveBtn?.addEventListener('click', saveEditor);

clearBtn?.addEventListener('click', async () => {
  if (!editor) return;
  editor.innerHTML = '';
  syncPreview();
  await fetch('/api/editor/clear', { method: 'POST' });
  bcStyle.postMessage({ type: 'update-html', html: '' });
  bcStyle.postMessage({ type: 'set-css', css: buildCSS() });
  showToast('自訂文字已清空');
});

function getLocalUrl(path){ return `${location.origin}${path}`; }
function hydrateOverlayUrls(){
  [
    ['lyricsUrl', '/html/display.html'],
    ['nowPlayingUrl', '/html/now-playing.html'],
    ['queueUrl', '/html/queue.html'],
    ['messageUrl', '/html/message.html']
  ].forEach(([id, path]) => {
    const el = $(id);
    if (el) el.textContent = getLocalUrl(path);
  });
}
document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.querySelector(btn.dataset.copy);
    const text = target?.textContent?.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast('已複製 Overlay URL'); }
    catch { showToast('無法自動複製，請手動選取 URL'); }
  });
});
hydrateOverlayUrls();

const loginBtn = $('loginBtn');
const trackInfo = $('trackInfo');
const logView = $('logView');
const spotifyStatusPill = $('spotifyStatusPill');
const trackSubInfo = $('trackSubInfo');
const trackCover = $('trackCover');
const clearLogViewBtn = $('clearLogViewBtn');
loginBtn?.addEventListener('click', () => window.open('/api/spotify/auth/login', '_blank'));
function setSpotifyPill(text, state){
  if (!spotifyStatusPill) return;
  spotifyStatusPill.textContent = text;
  spotifyStatusPill.className = `statusPill ${state || ''}`;
}
function renderTrackCover(track){
  if (!trackCover) return;
  const cover = track?.cover_url || track?.cover_large_url || track?.cover_small_url;
  trackCover.innerHTML = cover ? `<img src="${cover}" alt="Album cover">` : '♪';
}
async function loadStatus(){
  try {
    const st = await fetch('/api/spotify/status').then(r => r.json());
    if (!st.authorized) {
      trackInfo.textContent = '尚未授權 Spotify';
      if (trackSubInfo) trackSubInfo.textContent = '請按上方「登入 / 重新授權 Spotify」。';
      renderTrackCover(null); setSpotifyPill('未授權', 'statusError'); return;
    }
    if (!st.playing) {
      trackInfo.textContent = 'Spotify 暫停中';
      if (trackSubInfo) trackSubInfo.textContent = '開始播放歌曲後，歌詞、目前播放與佇列頁會自動更新。';
      renderTrackCover(null); setSpotifyPill('暫停中', 'statusWarn'); return;
    }
    const track = st.track || {};
    trackInfo.textContent = `${track.artists || '未知歌手'} - ${track.name || '未知歌曲'}`;
    if (trackSubInfo) {
      const album = track.album ? `專輯：${track.album}` : '正在播放';
      trackSubInfo.textContent = `${album}・${st.lyricsSynced ? '已找到同步歌詞' : '尚未找到同步歌詞'}`;
    }
    renderTrackCover(track); setSpotifyPill('播放中', 'statusOk');
  } catch (err) {
    console.error('Failed to load Spotify status:', err);
    trackInfo.textContent = '讀取 Spotify 狀態失敗';
    if (trackSubInfo) trackSubInfo.textContent = '請確認 helper server 還在執行，或重新整理 Dashboard。';
    renderTrackCover(null); setSpotifyPill('連線錯誤', 'statusError');
  }
}
async function loadLog(){
  if (!logView) return;
  try {
    const txt = await fetch('/api/spotify/log').then(r => r.text());
    logView.textContent = txt || '目前沒有 log。';
    logView.scrollTop = logView.scrollHeight;
  } catch { logView.textContent = '讀取 log 失敗。'; }
}
clearLogViewBtn?.addEventListener('click', () => {
  if (logView) logView.textContent = '';
  showToast('已清除畫面上的 log');
});
loadStatus(); loadLog();
setInterval(loadStatus, 3000);
setInterval(loadLog, 6000);



/* ---------- Audience QR request + admin moderation ---------- */
const audienceRequestUrl = $('audienceRequestUrl');
const audienceLanUrl = $('audienceLanUrl');
const audienceLocalUrl = $('audienceLocalUrl');
const requestQrImg = $('requestQrImg');
const requestPinEl = $('requestPin');
const requestPreviewLink = $('requestPreviewLink');
const requestList = $('requestList');
const saveRequestSettingsBtn = $('saveRequestSettingsBtn');
const rotateRequestPinBtn = $('rotateRequestPinBtn');
const reloadRequestsBtn = $('reloadRequestsBtn');
const clearFinishedRequestsBtn = $('clearFinishedRequestsBtn');
const startTunnelBtn = $('startTunnelBtn');
const restartTunnelBtn = $('restartTunnelBtn');
const stopTunnelBtn = $('stopTunnelBtn');
const tunnelState = $('tunnelState');
const tunnelHint = $('tunnelHint');

const settingInputs = {
  requestsEnabled: $('requestsEnabled'),
  autoApproveQueue: $('autoApproveQueue'),
  allowPlayNow: $('allowPlayNow'),
  allowPlaybackControl: $('allowPlaybackControl'),
  allowSkipControl: $('allowSkipControl'),
  blockExplicit: $('blockExplicit'),
  cooldownSeconds: $('cooldownSeconds'),
  controlCooldownSeconds: $('controlCooldownSeconds')
};

let adminToken = localStorage.getItem('obsHelperAdminToken') || '';
let currentRequestPin = '';
let requestRefreshTimer = null;

function adminHeaders(){
  return {
    'Content-Type': 'application/json',
    'x-admin-token': adminToken
  };
}

async function adminApi(path, options = {}){
  const res = await fetch(path, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data.ok === false) throw new Error(data.message || '管理 API 操作失敗');
  return data;
}

function formatDuration(ms){
  const total = Math.floor((ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function escapeHtml2(text){
  return String(text || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[ch]));
}

function getSettingPayload(){
  return {
    requestsEnabled: Boolean(settingInputs.requestsEnabled?.checked),
    autoApproveQueue: Boolean(settingInputs.autoApproveQueue?.checked),
    allowPlayNow: Boolean(settingInputs.allowPlayNow?.checked),
    allowPlaybackControl: Boolean(settingInputs.allowPlaybackControl?.checked),
    allowSkipControl: Boolean(settingInputs.allowSkipControl?.checked),
    blockExplicit: Boolean(settingInputs.blockExplicit?.checked),
    cooldownSeconds: Number(settingInputs.cooldownSeconds?.value || 0),
    controlCooldownSeconds: Number(settingInputs.controlCooldownSeconds?.value || 0)
  };
}

function renderSettings(settings = {}){
  Object.entries(settingInputs).forEach(([key, el])=>{
    if(!el) return;
    if(el.type === 'checkbox') el.checked = Boolean(settings[key]);
    else el.value = settings[key] ?? '';
  });
}

function renderTunnel(tunnel = {}){
  const publicUrl = tunnel.publicUrl || '';
  if(tunnelState){
    if(publicUrl) tunnelState.textContent = 'Tunnel 已可用';
    else if(tunnel.running) tunnelState.textContent = 'Tunnel 啟動中，等待網址...';
    else if(tunnel.lastError) tunnelState.textContent = 'Tunnel 未啟動 / 發生錯誤';
    else tunnelState.textContent = 'Tunnel 未啟動';
  }
  if(tunnelHint){
    if(publicUrl) tunnelHint.textContent = `外網網址已產生：${publicUrl}`;
    else if(tunnel.lastError) tunnelHint.textContent = tunnel.lastError;
    else tunnelHint.textContent = '外網觀眾需要 Cloudflare Tunnel；請先安裝 cloudflared，再按「啟動 Tunnel」。';
  }
}

function renderRequestUrls(data = {}){
  const urls = data.urls || {};
  const preferred = urls.publicUrl || urls.lanUrl || urls.localUrl || '';
  currentRequestPin = data.pin || currentRequestPin;
  if(audienceRequestUrl) audienceRequestUrl.textContent = preferred || '尚未產生';
  if(audienceLanUrl) audienceLanUrl.textContent = urls.lanUrl || '尚未產生';
  if(audienceLocalUrl) audienceLocalUrl.textContent = urls.localUrl || '尚未產生';
  if(requestQrImg && data.qrDataUrl) requestQrImg.src = data.qrDataUrl;
  if(requestPinEl) requestPinEl.textContent = currentRequestPin || '------';
  if(requestPreviewLink) requestPreviewLink.href = urls.localUrl || '/html/request.html';
  renderTunnel(urls.tunnel || {});
}

function requestStatusLabel(status){
  const map = {
    pending: '待審',
    approved: '已加入佇列',
    played: '已插播',
    rejected: '已拒絕'
  };
  return map[status] || status || '未知';
}

function renderRequests(requests = []){
  if(!requestList) return;
  if(!requests.length){
    requestList.innerHTML = '<p class="emptyText">目前沒有點歌請求。</p>';
    return;
  }

  requestList.innerHTML = requests.map(req=>{
    const track = req.track || {};
    const isPending = req.status === 'pending';
    return `
      <article class="requestItem ${isPending ? 'isPending' : ''}">
        <img class="requestCover" src="${escapeHtml2(track.cover_url || '')}" alt="">
        <div class="requestMeta">
          <strong>${escapeHtml2(track.name || '未知歌曲')}</strong>
          <span>${escapeHtml2(track.artists || '未知歌手')}</span>
          <small>${escapeHtml2(req.nickname || '匿名觀眾')}・${requestStatusLabel(req.status)}・${req.mode === 'play-now' ? '插播' : '佇列'}・${formatDuration(track.duration_ms)}</small>
        </div>
        <div class="requestActions">
          ${isPending ? `<button class="btnPrimary" data-request-action="approve" data-id="${req.id}">加入佇列</button>
          <button class="btnGhost" data-request-action="play-now" data-id="${req.id}">立即插播</button>
          <button class="btnDanger" data-request-action="reject" data-id="${req.id}">拒絕</button>` : `<span class="statusPill">${requestStatusLabel(req.status)}</span>`}
        </div>
      </article>
    `;
  }).join('');
}

async function loadAdminInfo(){
  try{
    const data = await fetch('/api/request/admin-info').then(r=>r.json());
    if(!data.ok) throw new Error(data.message || '管理資訊讀取失敗');
    adminToken = data.adminToken;
    localStorage.setItem('obsHelperAdminToken', adminToken);
    renderSettings(data.settings || {});
    renderRequestUrls(data);
    renderRequests(data.requests || []);
  }catch(err){
    console.warn('Local admin-info failed, fallback to existing admin token:', err.message);
    if(!adminToken){
      showToast('請用本機 127.0.0.1 開啟 Dashboard 以取得管理權限');
      if(requestList) requestList.innerHTML = '<p class="emptyText">無法取得管理權限。請用本機 127.0.0.1 開啟 Dashboard。</p>';
      return;
    }
    await refreshRequestInfo().catch(e=>showToast(e.message));
    await loadRequestList().catch(()=>{});
  }
}

async function refreshRequestInfo(){
  const data = await adminApi('/api/request/info');
  renderSettings(data.settings || {});
  renderRequestUrls(data);
  return data;
}

async function loadRequestList(){
  const data = await adminApi('/api/request/list');
  renderRequests(data.requests || []);
}

saveRequestSettingsBtn?.addEventListener('click', async ()=>{
  try{
    await adminApi('/api/request/settings', { method:'POST', body: JSON.stringify(getSettingPayload()) });
    await refreshRequestInfo();
    showToast('觀眾權限設定已儲存');
  }catch(err){ showToast(err.message); }
});

rotateRequestPinBtn?.addEventListener('click', async ()=>{
  if(!confirm('重新產生權限碼後，舊 QR Code 會失效。確定要繼續嗎？')) return;
  try{
    const data = await adminApi('/api/request/rotate-pin', { method:'POST', body:'{}' });
    renderRequestUrls(data);
    showToast('已重新產生 QR Code 權限碼');
  }catch(err){ showToast(err.message); }
});

reloadRequestsBtn?.addEventListener('click', ()=>loadRequestList().catch(err=>showToast(err.message)));
clearFinishedRequestsBtn?.addEventListener('click', async ()=>{
  try{
    const data = await adminApi('/api/request/clear-finished', { method:'POST', body:'{}' });
    renderRequests(data.requests || []);
    showToast('已清除已處理請求');
  }catch(err){ showToast(err.message); }
});

requestList?.addEventListener('click', async e=>{
  const btn = e.target.closest('[data-request-action]');
  if(!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.requestAction;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '處理中...';
  try{
    if(action === 'reject'){
      await adminApi('/api/request/reject', { method:'POST', body: JSON.stringify({ id }) });
      showToast('已拒絕點歌');
    }else{
      await adminApi('/api/request/approve', { method:'POST', body: JSON.stringify({ id, mode: action === 'play-now' ? 'play-now' : 'queue' }) });
      showToast(action === 'play-now' ? '已立即插播' : '已加入佇列');
    }
    await loadRequestList();
    loadStatus();
  }catch(err){ showToast(err.message); }
  finally{ btn.disabled = false; btn.textContent = original; }
});

async function tunnelAction(path, message){
  try{
    const data = await adminApi(path, { method:'POST', body:'{}' });
    renderTunnel(data.tunnel || {});
    setTimeout(()=>refreshRequestInfo().catch(()=>{}), 2500);
    showToast(message);
  }catch(err){ showToast(err.message); }
}
startTunnelBtn?.addEventListener('click', ()=>tunnelAction('/api/request/tunnel/start', '已嘗試啟動 Tunnel'));
restartTunnelBtn?.addEventListener('click', ()=>tunnelAction('/api/request/tunnel/restart', '已嘗試重啟 Tunnel'));
stopTunnelBtn?.addEventListener('click', ()=>tunnelAction('/api/request/tunnel/stop', '已停止 Tunnel'));

loadAdminInfo();
requestRefreshTimer = setInterval(()=>{
  if(adminToken){
    refreshRequestInfo().catch(()=>{});
    loadRequestList().catch(()=>{});
  }
}, 8000);
