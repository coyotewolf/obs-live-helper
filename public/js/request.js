const params = new URLSearchParams(location.search);
const pin = params.get('pin') || '';

const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const nicknameInput = document.getElementById('nicknameInput');
const resultList = document.getElementById('resultList');
const toast = document.getElementById('toast');
const settingsHint = document.getElementById('settingsHint');
const modeBadges = document.getElementById('modeBadges');
const controlPanel = document.getElementById('controlPanel');

let currentSettings = null;

function showToast(message){
  alert(message);
}

function escapeHtml(text){
  return String(text || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[ch]));
}

function formatMs(ms){
  const total = Math.floor((ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function api(path, options = {}){
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data.ok === false) throw new Error(data.message || '操作失敗');
  return data;
}

function makeBadge(text, state = ''){
  return `<span class="badge ${state}">${escapeHtml(text)}</span>`;
}

function renderSettings(settings){
  currentSettings = settings;
  if(!settings){
    settingsHint.textContent = '設定讀取失敗，請重新掃描 QR Code。';
    return;
  }

  if(!settings.requestsEnabled){
    settingsHint.textContent = '主播目前暫停開放點歌。';
    modeBadges.innerHTML = makeBadge('點歌關閉', 'off');
    searchInput.disabled = true;
    searchForm.querySelector('button').disabled = true;
  }else{
    searchInput.disabled = false;
    searchForm.querySelector('button').disabled = false;
    const approvalText = settings.autoApproveQueue ? '加入佇列會自動通過' : '加入佇列需主播審核';
    const playNowText = settings.allowPlayNow ? '允許立即插播' : '插播需主播審核';
    settingsHint.textContent = `${approvalText}；${playNowText}。`;
    modeBadges.innerHTML = [
      makeBadge('點歌開放', 'on'),
      makeBadge(settings.autoApproveQueue ? '自動加入佇列' : '佇列待審'),
      makeBadge(settings.allowPlayNow ? '可立即插播' : '插播待審'),
      settings.blockExplicit ? makeBadge('Explicit 禁止', 'off') : makeBadge('Explicit 依主播審核')
    ].join('');
  }

  const showControl = settings.allowPlaybackControl || settings.allowSkipControl;
  controlPanel.classList.toggle('hidden', !showControl);
  document.querySelectorAll('[data-kind="playback"]').forEach(btn=>btn.style.display = settings.allowPlaybackControl ? '' : 'none');
  document.querySelectorAll('[data-kind="skip"]').forEach(btn=>btn.style.display = settings.allowSkipControl ? '' : 'none');
}

async function loadPublicInfo(){
  if(!pin){
    showToast('缺少 QR Code 權限碼，請重新掃描。');
    settingsHint.textContent = '缺少 QR Code 權限碼。';
    return;
  }

  try{
    const data = await api(`/api/request/public-info?pin=${encodeURIComponent(pin)}`);
    renderSettings(data.settings);
  }catch(err){
    settingsHint.textContent = err.message;
    showToast(err.message);
  }
}

function getNickname(){
  return nicknameInput.value.trim() || '匿名觀眾';
}

function renderTracks(tracks){
  if(!tracks.length){
    resultList.innerHTML = '<p class="emptyText">找不到歌曲，換個關鍵字試試。</p>';
    return;
  }

  resultList.innerHTML = tracks.map(track => {
    const payload = encodeURIComponent(JSON.stringify(track));
    const playNowText = currentSettings?.allowPlayNow ? '立即插播' : '要求插播';
    const queueText = currentSettings?.autoApproveQueue ? '加入佇列' : '要求點歌';
    return `
      <article class="trackItem" data-track="${payload}">
        <img class="cover" src="${escapeHtml(track.cover_url || '')}" alt="">
        <div class="trackMeta">
          <strong>${escapeHtml(track.name)}</strong>
          <span>${escapeHtml(track.artists)}</span>
          <small>${escapeHtml(track.album || '')}${track.explicit ? '・Explicit' : ''}・${formatMs(track.duration_ms)}</small>
        </div>
        <div class="trackActions">
          <button data-mode="queue">${queueText}</button>
          <button data-mode="play-now" class="danger">${playNowText}</button>
        </div>
      </article>
    `;
  }).join('');
}

searchForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const q = searchInput.value.trim();
  if(!q) return;

  resultList.innerHTML = '<p class="emptyText">搜尋中...</p>';
  try{
    const data = await api(`/api/request/search?pin=${encodeURIComponent(pin)}&q=${encodeURIComponent(q)}`);
    if(data.settings) renderSettings(data.settings);
    renderTracks(data.tracks || []);
  }catch(err){
    resultList.innerHTML = `<p class="emptyText">${escapeHtml(err.message)}</p>`;
    showToast(err.message);
  }
});

resultList.addEventListener('click', async e=>{
  const btn = e.target.closest('button[data-mode]');
  if(!btn) return;

  const item = e.target.closest('.trackItem');
  const track = JSON.parse(decodeURIComponent(item?.dataset.track || '%7B%7D'));
  const mode = btn.dataset.mode;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '送出中...';

  try{
    const data = await api('/api/request/submit', {
      method:'POST',
      body: JSON.stringify({ pin, track, mode, nickname: getNickname() })
    });
    showToast(data.message || '已送出');
  }catch(err){
    showToast(err.message);
  }finally{
    btn.disabled = false;
    btn.textContent = original;
  }
});

document.querySelectorAll('[data-action]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const action = btn.dataset.action;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '處理中...';

    try{
      const data = await api('/api/request/control', {
        method:'POST',
        body: JSON.stringify({ pin, action })
      });
      showToast(data.message || '已送出控制');
    }catch(err){
      showToast(err.message);
    }finally{
      btn.disabled = false;
      btn.textContent = original;
    }
  });
});

loadPublicInfo();
