/* OBS Live Helper – Dashboard */
const bcStyle = new BroadcastChannel('obs-style-sync');
const $ = id => document.getElementById(id);

/* ---------- UI dialog + toast ---------- */
function ensureDialogStyles(){
  if (document.getElementById('obsHelperDialogStyles')) return;
  const style = document.createElement('style');
  style.id = 'obsHelperDialogStyles';
  style.textContent = `
    .uiDialogBackdrop{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:rgba(2,6,23,.62);backdrop-filter:blur(10px)}
    .uiDialogBox{width:min(460px,100%);border:1px solid rgba(125,211,252,.32);border-radius:24px;background:linear-gradient(135deg,rgba(255,255,255,.11),rgba(255,255,255,.055)),rgba(15,23,42,.96);box-shadow:0 24px 80px rgba(0,0,0,.45);color:#f8fbff;overflow:hidden}
    .uiDialogHeader{padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:900;color:#7dd3fc;letter-spacing:.04em}
    .uiDialogBody{padding:20px;line-height:1.7;white-space:pre-wrap;color:rgba(248,251,255,.9)}
    .uiDialogActions{display:flex;justify-content:flex-end;gap:10px;padding:0 20px 20px}.uiDialogActions button{min-height:38px;padding:0 18px;border:0;border-radius:999px;font-weight:900;cursor:pointer}.uiDialogOk{color:#06111f;background:linear-gradient(135deg,#7dd3fc,#a78bfa)}.uiDialogCancel{color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16)!important}
    body[data-theme="pink-cute"] .uiDialogBackdrop{background:rgba(67,33,54,.35)}body[data-theme="pink-cute"] .uiDialogBox{background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(255,238,247,.92));border-color:rgba(210,72,122,.28);color:#432136;box-shadow:0 24px 80px rgba(210,72,122,.2)}body[data-theme="pink-cute"] .uiDialogHeader{color:#d9467f;border-bottom-color:rgba(210,72,122,.18)}body[data-theme="pink-cute"] .uiDialogBody{color:rgba(67,33,54,.88)}body[data-theme="pink-cute"] .uiDialogOk{color:#fff;background:linear-gradient(135deg,#df4b86,#6ab4e5)}body[data-theme="pink-cute"] .uiDialogCancel{color:#432136;background:rgba(255,255,255,.78);border-color:rgba(210,72,122,.22)!important}
  `;
  document.head.appendChild(style);
}

function showDialog(message, { title = '提示', confirm = false, okText = '確定', cancelText = '取消' } = {}){
  ensureDialogStyles();
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'uiDialogBackdrop';
    backdrop.innerHTML = `
      <div class="uiDialogBox" role="dialog" aria-modal="true">
        <div class="uiDialogHeader"></div>
        <div class="uiDialogBody"></div>
        <div class="uiDialogActions">
          ${confirm ? '<button class="uiDialogCancel" type="button"></button>' : ''}
          <button class="uiDialogOk" type="button"></button>
        </div>
      </div>`;
    backdrop.querySelector('.uiDialogHeader').textContent = title;
    backdrop.querySelector('.uiDialogBody').textContent = String(message || '');
    const ok = backdrop.querySelector('.uiDialogOk');
    const cancel = backdrop.querySelector('.uiDialogCancel');
    ok.textContent = okText;
    if (cancel) cancel.textContent = cancelText;
    function close(value){ backdrop.remove(); resolve(value); }
    ok.addEventListener('click', () => close(true));
    cancel?.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', e => { if (e.target === backdrop && !confirm) close(true); });
    document.addEventListener('keydown', function onKey(e){
      if (!document.body.contains(backdrop)) return document.removeEventListener('keydown', onKey);
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(!confirm); }
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); close(true); }
    });
    document.body.appendChild(backdrop);
    ok.focus();
  });
}
function showToast(message){
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
window.showToast = showToast;
window.showDialog = showDialog;
window.showConfirmDialog = (message, options={}) => showDialog(message, { ...options, confirm:true });

/* ---------- text overlay editor ---------- */
const builtinFonts = ['DFKai-SB','Noto Sans TC','Microsoft JhengHei','PMingLiU','Segoe UI','Arial','Verdana','Helvetica','monospace','Noto Sans JP','Yu Gothic','MS PGothic','Meiryo'];
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
const DEFAULT_MESSAGE_FONT_SIZE = 28;
const DEFAULT_MESSAGE_COLOR = '#ffffff';
let suppressNextLogAutoRefresh = false;
let logManuallyClearedAt = 0;

function rebuildFontOptions(selected = fontSel?.value){
  if (!fontSel) return;
  fontSel.innerHTML = fontList.map(f => `<option value="${f}">${f}</option>`).join('');
  if (fontList.includes(selected)) fontSel.value = selected;
}
function syncPreview(){ if (preview && editor) preview.innerHTML = editor.innerHTML; }
function applyPreviewContainerStyle(){
  if (!preview) return;
  preview.style.whiteSpace = 'nowrap'; preview.style.textAlign = 'left'; preview.style.lineHeight = '1';
  preview.style.fontSize = `${DEFAULT_MESSAGE_FONT_SIZE}px`; preview.style.color = '#000';
  preview.style.fontFamily = 'Arial, Helvetica, sans-serif'; preview.style.fontVariantNumeric = 'lining-nums';
  preview.style.fontFeatureSettings = '"lnum" 1';
  preview.style.background = pageBgTransparent?.checked ? 'transparent' : (pageBgColor?.value || '#ffffff');
}
function buildCSS(){
  const pageBg = pageBgTransparent?.checked ? 'transparent' : (pageBgColor?.value || '#ffffff');
  return `html,body{background:${pageBg};margin:0;padding:0;}#msgBox{font-size:${DEFAULT_MESSAGE_FONT_SIZE}px;color:${DEFAULT_MESSAGE_COLOR};white-space:nowrap;text-align:left;line-height:1;font-family:Arial,Helvetica,sans-serif;font-variant-numeric:lining-nums;font-feature-settings:"lnum" 1;}#msgBox span,#msgBox b,#msgBox i,#msgBox u,#msgBox s,#msgBox font{display:inline;vertical-align:text-bottom;line-height:1em;}`;
}
function normalizeFontSizesToPx(rootEl){
  if (!rootEl) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, null); const els = [];
  while (walker.nextNode()) els.push(walker.currentNode);
  els.forEach(el => {
    if (el.tagName === 'FONT' && el.hasAttribute('size')) {
      const map = {1:10,2:13,3:16,4:18,5:24,6:32,7:48}; const s = el.getAttribute('size');
      el.style.fontSize = `${map[s] || parseInt(s,10) || DEFAULT_MESSAGE_FONT_SIZE}px`; el.removeAttribute('size');
    }
    if (el.style.fontSize && !el.style.fontSize.endsWith('px')) el.style.fontSize = window.getComputedStyle(el).fontSize;
  });
}
async function saveEditor(){
  if (!editor) return;
  normalizeFontSizesToPx(editor);
  const html = editor.innerHTML; const css = buildCSS();
  await fetch('/api/editor/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:html})});
  await fetch('/api/style/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({css})}).catch(()=>{});
  syncPreview(); applyPreviewContainerStyle(); bcStyle.postMessage({type:'update-html', html}); bcStyle.postMessage({type:'set-css', css});
  showToast('自訂文字已儲存');
}
rebuildFontOptions();
fontSel?.addEventListener('change',()=>{ document.execCommand('fontName', false, fontSel.value); editor?.focus(); syncPreview(); });
fontFile?.addEventListener('change',()=>{ if(uploadFontBtn) uploadFontBtn.style.display = fontFile.files.length ? '' : 'none'; });
uploadFontBtn?.addEventListener('click', async()=>{
  if (!fontFile.files.length) return;
  uploadFontBtn.disabled = true; uploadFontBtn.textContent = '⏳ 上傳中…';
  const fd = new FormData(); fd.append('font', fontFile.files[0]);
  try{
    const { family } = await fetch('/api/font/upload',{method:'POST',body:fd}).then(r=>r.json());
    if (!fontList.includes(family)) { fontList.push(family); userFonts.push(family); localStorage.setItem('userFonts', JSON.stringify(userFonts)); rebuildFontOptions(family); }
    else fontSel.value = family;
    document.execCommand('fontName', false, family); syncPreview(); bcStyle.postMessage({type:'reload-style'}); showToast('字型已上傳');
  }catch{ showToast('字體上傳失敗！'); }
  finally{ fontFile.value=''; uploadFontBtn.disabled=false; uploadFontBtn.style.display='none'; uploadFontBtn.textContent='上傳'; }
});
toolbar?.addEventListener('click', e=>{ const btn=e.target.closest('button'); if(!btn) return; const cmd=btn.dataset.cmd; document.execCommand(cmd==='transparent'?'hiliteColor':cmd,false,cmd==='transparent'?'transparent':null); editor?.focus(); syncPreview(); });
$('foreColor')?.addEventListener('input', e=>{ document.execCommand('foreColor',false,e.target.value); syncPreview(); });
$('backColor')?.addEventListener('input', e=>{ document.execCommand('hiliteColor',false,e.target.value); syncPreview(); });
editor?.addEventListener('input', syncPreview);
pageBgColor?.addEventListener('input',()=>{ applyPreviewContainerStyle(); bcStyle.postMessage({type:'set-css', css:buildCSS()}); });
pageBgTransparent?.addEventListener('change',()=>{ applyPreviewContainerStyle(); bcStyle.postMessage({type:'set-css', css:buildCSS()}); });
fontSizeCtrl?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); document.execCommand('fontSize', false, '5'); syncPreview(); }});
saveBtn?.addEventListener('click', saveEditor);
clearBtn?.addEventListener('click', async()=>{ if(!editor) return; editor.innerHTML=''; syncPreview(); await fetch('/api/editor/clear',{method:'POST'}); bcStyle.postMessage({type:'update-html', html:''}); bcStyle.postMessage({type:'set-css', css:buildCSS()}); showToast('自訂文字已清空'); });
(async()=>{ if(!editor) return; const raw=await fetch('/api/editor').then(r=>r.text()).catch(()=>''); editor.innerHTML=raw; syncPreview(); applyPreviewContainerStyle(); })();

/* ---------- overlay shortcuts ---------- */
function getLocalUrl(path){ return `${location.origin}${path}`; }
function hydrateOverlayUrls(){
  [['lyricsUrl','/html/display.html'],['nowPlayingUrl','/html/now-playing.html'],['queueUrl','/html/queue.html'],['messageUrl','/html/message.html'],['songQrUrl','/html/songqrcode.html'],['dcProfilePicUrl','/html/dcprofilepic.html'],['goalCardUrl','/html/goal-card.html'],['liveClockUrl','/html/live-clock.html']].forEach(([id,path])=>{ const el=$(id); if(el) el.textContent=getLocalUrl(path); });
}
document.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',async()=>{ const text=document.querySelector(btn.dataset.copy)?.textContent?.trim(); if(!text) return; try{ await navigator.clipboard.writeText(text); showToast('已複製 Overlay URL'); }catch{ showToast('無法自動複製，請手動選取 URL'); }}));
hydrateOverlayUrls();

/* ---------- backup ---------- */
async function downloadBackup(){
  const ok = await showDialog('確定要建立備份嗎？\n\n備份會下載 JSON 檔，包含本機設定、Overlay 設定、點歌設定、自訂文字樣式與上傳字型。歌詞 log 與 LRCLib 快取不會包含在內。', { title:'建立備份', confirm:true, okText:'建立備份' });
  if (!ok) return;

  const buttons = [document.getElementById('backupBtn'), document.getElementById('backupSettingsBtn')].filter(Boolean);
  buttons.forEach(btn => { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = '備份中...'; });
  try {
    const res = await fetch('/api/backup/export', { cache:'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '備份建立失敗');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `obs-live-helper-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('備份檔已開始下載');
  } catch (err) {
    showToast(err.message || '備份建立失敗');
  } finally {
    buttons.forEach(btn => { btn.disabled = false; btn.textContent = btn.dataset.originalText || '備份設定'; delete btn.dataset.originalText; });
  }
}
document.getElementById('backupBtn')?.addEventListener('click', downloadBackup);
document.getElementById('backupSettingsBtn')?.addEventListener('click', downloadBackup);

/* ---------- Spotify status / log ---------- */
const loginBtn=$('loginBtn'), trackInfo=$('trackInfo'), logView=$('logView'), spotifyStatusPill=$('spotifyStatusPill'), trackSubInfo=$('trackSubInfo'), trackCover=$('trackCover'), clearLogViewBtn=$('clearLogViewBtn'), clearLyricsCacheBtn=$('clearLyricsCacheBtn');
loginBtn?.addEventListener('click',()=>window.open('/api/spotify/auth/login','_blank'));
function setSpotifyPill(text,state){ if(!spotifyStatusPill) return; spotifyStatusPill.textContent=text; spotifyStatusPill.className=`statusPill ${state||''}`; }
function renderTrackCover(track){ if(!trackCover) return; const cover=track?.cover_url||track?.cover_large_url||track?.cover_small_url; trackCover.innerHTML=cover?`<img src="${cover}" alt="Album cover">`:'♪'; }
async function loadStatus(){
  try{
    const st=await fetch('/api/spotify/status',{cache:'no-store'}).then(r=>r.json());
    if(!st.authorized){ if(trackInfo) trackInfo.textContent='尚未授權 Spotify'; if(trackSubInfo) trackSubInfo.textContent='請按上方「登入 / 重新授權 Spotify」。'; renderTrackCover(null); setSpotifyPill('未授權','statusError'); return; }
    if(!st.playing){ if(trackInfo) trackInfo.textContent='Spotify 暫停中'; if(trackSubInfo) trackSubInfo.textContent='開始播放歌曲後，歌詞、目前播放與佇列頁會自動更新。'; renderTrackCover(null); setSpotifyPill('暫停中','statusWarn'); return; }
    const track=st.track||{}; if(trackInfo) trackInfo.textContent=`${track.artists||'未知歌手'} - ${track.name||'未知歌曲'}`;
    if(trackSubInfo){ const album=track.album?`專輯：${track.album}`:'正在播放'; trackSubInfo.textContent=`${album}・${st.lyricsSynced?'已找到同步歌詞':'尚未找到同步歌詞'}`; }
    renderTrackCover(track); setSpotifyPill('播放中','statusOk');
  }catch(err){ console.error('Failed to load Spotify status:',err); if(trackInfo) trackInfo.textContent='讀取 Spotify 狀態失敗'; if(trackSubInfo) trackSubInfo.textContent='請確認 helper server 還在執行，或重新整理 Dashboard。'; renderTrackCover(null); setSpotifyPill('連線錯誤','statusError'); }
}
async function loadLog(options={}){
  if(!logView) return; if(suppressNextLogAutoRefresh && !options.force) return;
  try{ const txt=await fetch('/api/spotify/log',{cache:'no-store'}).then(r=>r.text()); if(logManuallyClearedAt && !txt){ logView.textContent=''; return; } logView.textContent=txt||'目前沒有 log。'; logView.scrollTop=logView.scrollHeight; }catch{ logView.textContent='讀取 log 失敗。'; }
}
clearLogViewBtn?.addEventListener('click',async()=>{
  if(!logView) return; if(!await showDialog('確定要清除 Spotify / Lyrics Log 畫面嗎？\n\n這會清空 Dashboard 顯示的 log，並同步清空 storage/lyrics.log。',{title:'清除畫面',confirm:true})) return;
  clearLogViewBtn.disabled=true; const original=clearLogViewBtn.textContent; clearLogViewBtn.textContent='清除中...';
  try{ const res=await fetch('/api/spotify/log/clear',{method:'POST'}); const data=await res.json().catch(()=>({})); if(!res.ok||data.ok===false) throw new Error(data.message||'清除 log 失敗'); logManuallyClearedAt=Date.now(); suppressNextLogAutoRefresh=false; logView.textContent=''; showToast('已清除 Spotify / Lyrics Log'); }
  catch(err){ logView.textContent=''; suppressNextLogAutoRefresh=true; showToast(`${err.message}，已先清除目前畫面`); }
  finally{ clearLogViewBtn.disabled=false; clearLogViewBtn.textContent=original; }
});
clearLyricsCacheBtn?.addEventListener('click',async()=>{
  if(!await showDialog('確定要清除 LRCLib 歌詞快取嗎？下一次播放會重新查詢歌詞。',{title:'清除歌詞快取',confirm:true})) return;
  clearLyricsCacheBtn.disabled=true; const original=clearLyricsCacheBtn.textContent; clearLyricsCacheBtn.textContent='清除中...';
  try{ const res=await fetch('/api/spotify/lyrics-cache/clear',{method:'POST'}); const data=await res.json().catch(()=>({})); if(!res.ok||data.ok===false) throw new Error(data.message||'清除歌詞快取失敗'); showToast('已清除 LRCLib 歌詞快取'); loadLog({force:true}); }
  catch(err){ showToast(err.message); }
  finally{ clearLyricsCacheBtn.disabled=false; clearLyricsCacheBtn.textContent=original; }
});
window.loadStatus=loadStatus; window.loadLog=loadLog;
loadStatus(); loadLog(); setInterval(loadStatus,3000); setInterval(loadLog,6000);

/* ---------- Audience QR request + admin moderation ---------- */
const audienceRequestUrl=$('audienceRequestUrl'), audienceLanUrl=$('audienceLanUrl'), audienceLocalUrl=$('audienceLocalUrl'), requestQrImg=$('requestQrImg'), requestPinEl=$('requestPin'), requestPreviewLink=$('requestPreviewLink'), requestList=$('requestList'), saveRequestSettingsBtn=$('saveRequestSettingsBtn'), rotateRequestPinBtn=$('rotateRequestPinBtn'), reloadRequestsBtn=$('reloadRequestsBtn'), clearFinishedRequestsBtn=$('clearFinishedRequestsBtn'), startTunnelBtn=$('startTunnelBtn'), restartTunnelBtn=$('restartTunnelBtn'), stopTunnelBtn=$('stopTunnelBtn'), tunnelState=$('tunnelState'), tunnelHint=$('tunnelHint');
const settingInputs={requestsEnabled:$('requestsEnabled'),autoApproveQueue:$('autoApproveQueue'),allowPlayNow:$('allowPlayNow'),allowPlaybackControl:$('allowPlaybackControl'),allowSkipControl:$('allowSkipControl'),blockExplicit:$('blockExplicit'),cooldownSeconds:$('cooldownSeconds'),controlCooldownSeconds:$('controlCooldownSeconds')};
let adminToken=localStorage.getItem('obsHelperAdminToken')||'', currentRequestPin='';
function adminHeaders(){ return {'Content-Type':'application/json','x-admin-token':adminToken}; }
async function adminApi(path,options={}){ const res=await fetch(path,{...options,headers:{...adminHeaders(),...(options.headers||{})}}); const data=await res.json().catch(()=>({})); if(!res.ok||data.ok===false) throw new Error(data.message||'管理 API 操作失敗'); return data; }
function formatDuration(ms){ const total=Math.floor((ms||0)/1000); return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`; }
function escapeHtml2(text){ return String(text||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
function renderSettings(settings={}){ Object.entries(settingInputs).forEach(([key,el])=>{ if(!el) return; if(el.type==='checkbox') el.checked=Boolean(settings[key]); else el.value=settings[key]??''; }); }
function renderTunnel(tunnel={}){ const publicUrl=tunnel.publicUrl||''; if(tunnelState) tunnelState.textContent=publicUrl?'Tunnel 已可用':tunnel.running?'Tunnel 啟動中，等待網址...':tunnel.lastError?'Tunnel 未啟動 / 發生錯誤':'Tunnel 未啟動'; if(tunnelHint) tunnelHint.textContent=publicUrl?`外網網址已產生：${publicUrl}`:tunnel.lastError||'外網觀眾需要 Cloudflare Tunnel；請先安裝 cloudflared，再按「啟動 Tunnel」。'; }
function renderRequestUrls(data={}){ const urls=data.urls||{}; const preferred=urls.publicUrl||urls.lanUrl||urls.localUrl||''; currentRequestPin=data.pin||currentRequestPin; if(audienceRequestUrl) audienceRequestUrl.textContent=preferred||'尚未產生'; if(audienceLanUrl) audienceLanUrl.textContent=urls.lanUrl||'尚未產生'; if(audienceLocalUrl) audienceLocalUrl.textContent=urls.localUrl||'尚未產生'; if(requestQrImg&&data.qrDataUrl) requestQrImg.src=data.qrDataUrl; if(requestPinEl) requestPinEl.textContent=currentRequestPin||'------'; if(requestPreviewLink) requestPreviewLink.href=urls.localUrl||'/html/request.html'; renderTunnel(urls.tunnel||{}); }
function requestStatusLabel(status){ return ({pending:'待審',approved:'已加入佇列',played:'已插播',rejected:'已拒絕'}[status]||status||'未知'); }
function renderRequests(requests=[]){ if(!requestList) return; if(!requests.length){ requestList.innerHTML='<p class="emptyText">目前沒有點歌請求。</p>'; return; } requestList.innerHTML=requests.map(req=>{ const track=req.track||{}; const isPending=req.status==='pending'; return `<article class="requestItem ${isPending?'isPending':''}"><img class="requestCover" src="${escapeHtml2(track.cover_url||'')}" alt=""><div class="requestMeta"><strong>${escapeHtml2(track.name||'未知歌曲')}</strong><span>${escapeHtml2(track.artists||'未知歌手')}</span><small>${escapeHtml2(req.nickname||'匿名觀眾')}・${requestStatusLabel(req.status)}・${req.mode==='play-now'?'插播':'佇列'}・${formatDuration(track.duration_ms)}</small></div><div class="requestActions">${isPending?`<button class="btnPrimary" data-request-action="approve" data-id="${req.id}">加入佇列</button><button class="btnGhost" data-request-action="play-now" data-id="${req.id}">立即插播</button><button class="btnDanger" data-request-action="reject" data-id="${req.id}">拒絕</button>`:`<span class="statusPill">${requestStatusLabel(req.status)}</span>`}</div></article>`; }).join(''); }
async function loadAdminInfo(){ try{ const data=await fetch('/api/request/admin-info').then(r=>r.json()); if(!data.ok) throw new Error(data.message||'管理資訊讀取失敗'); adminToken=data.adminToken; localStorage.setItem('obsHelperAdminToken',adminToken); renderSettings(data.settings||{}); renderRequestUrls(data); renderRequests(data.requests||[]); }catch(err){ console.warn('Local admin-info failed:',err.message); if(!adminToken){ showToast('請用本機 127.0.0.1 開啟 Dashboard 以取得管理權限'); if(requestList) requestList.innerHTML='<p class="emptyText">無法取得管理權限。請用本機 127.0.0.1 開啟 Dashboard。</p>'; return; } await refreshRequestInfo().catch(e=>showToast(e.message)); await loadRequestList().catch(()=>{}); } }
async function refreshRequestInfo(){ const data=await adminApi('/api/request/info'); renderSettings(data.settings||{}); renderRequestUrls(data); return data; }
async function loadRequestList(){ const data=await adminApi('/api/request/list'); renderRequests(data.requests||[]); }
function getSettingPayload(){ return {requestsEnabled:Boolean(settingInputs.requestsEnabled?.checked),autoApproveQueue:Boolean(settingInputs.autoApproveQueue?.checked),allowPlayNow:Boolean(settingInputs.allowPlayNow?.checked),allowPlaybackControl:Boolean(settingInputs.allowPlaybackControl?.checked),allowSkipControl:Boolean(settingInputs.allowSkipControl?.checked),blockExplicit:Boolean(settingInputs.blockExplicit?.checked),cooldownSeconds:Number(settingInputs.cooldownSeconds?.value||0),controlCooldownSeconds:Number(settingInputs.controlCooldownSeconds?.value||0)}; }
saveRequestSettingsBtn?.addEventListener('click',async()=>{ try{ await adminApi('/api/request/settings',{method:'POST',body:JSON.stringify(getSettingPayload())}); await refreshRequestInfo(); showToast('觀眾權限設定已儲存'); }catch(err){ showToast(err.message); }});
rotateRequestPinBtn?.addEventListener('click',async()=>{ if(!await showDialog('重新產生權限碼後，舊 QR Code 會失效。確定要繼續嗎？',{title:'重新產生 QR Code 權限碼',confirm:true})) return; try{ const data=await adminApi('/api/request/rotate-pin',{method:'POST',body:'{}'}); renderRequestUrls(data); showToast('已重新產生 QR Code 權限碼'); }catch(err){ showToast(err.message); }});
reloadRequestsBtn?.addEventListener('click',()=>loadRequestList().catch(err=>showToast(err.message)));
clearFinishedRequestsBtn?.addEventListener('click',async()=>{ try{ const data=await adminApi('/api/request/clear-finished',{method:'POST',body:'{}'}); renderRequests(data.requests||[]); showToast('已清除已處理請求'); }catch(err){ showToast(err.message); }});
requestList?.addEventListener('click',async e=>{ const btn=e.target.closest('[data-request-action]'); if(!btn) return; const id=btn.dataset.id; const action=btn.dataset.requestAction; btn.disabled=true; const original=btn.textContent; btn.textContent='處理中...'; try{ let data; if(action==='reject'){ data=await adminApi('/api/request/reject',{method:'POST',body:JSON.stringify({id})}); showToast('已拒絕點歌'); }else{ data=await adminApi('/api/request/approve',{method:'POST',body:JSON.stringify({id,mode:action==='play-now'?'play-now':'queue'})}); showToast(action==='play-now'?'已立即插播':'已加入佇列'); } if(Array.isArray(data?.requests)) renderRequests(data.requests); else await loadRequestList(); loadStatus(); }catch(err){ showToast(err.message); }finally{ btn.disabled=false; btn.textContent=original; }});
async function tunnelAction(path,message){ try{ const data=await adminApi(path,{method:'POST',body:'{}'}); renderTunnel(data.tunnel||{}); setTimeout(()=>refreshRequestInfo().catch(()=>{}),2500); showToast(message); }catch(err){ showToast(err.message); }}
startTunnelBtn?.addEventListener('click',()=>tunnelAction('/api/request/tunnel/start','已嘗試啟動 Tunnel'));
restartTunnelBtn?.addEventListener('click',()=>tunnelAction('/api/request/tunnel/restart','已嘗試重啟 Tunnel'));
stopTunnelBtn?.addEventListener('click',()=>tunnelAction('/api/request/tunnel/stop','已停止 Tunnel'));
window.renderRequests=renderRequests; window.loadRequestList=loadRequestList;
loadAdminInfo(); setInterval(()=>{ if(adminToken){ refreshRequestInfo().catch(()=>{}); loadRequestList().catch(()=>{}); } },3000);
