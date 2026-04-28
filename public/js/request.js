const params = new URLSearchParams(location.search);
const pin = params.get('pin') || '';

const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const resultList = document.getElementById('resultList');
const toast = document.getElementById('toast');

function showToast(message){
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(()=>toast.classList.remove('show'), 2200);
}

function escapeHtml(text){
  return String(text || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
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
  if(!res.ok || data.ok === false){
    throw new Error(data.message || '操作失敗');
  }
  return data;
}

function renderTracks(tracks){
  if(!tracks.length){
    resultList.innerHTML = '<p class="emptyText">找不到歌曲，換個關鍵字試試。</p>';
    return;
  }

  resultList.innerHTML = tracks.map(track => `
    <article class="trackItem" data-uri="${escapeHtml(track.uri)}">
      <img class="cover" src="${escapeHtml(track.cover_url || '')}" alt="">
      <div class="trackMeta">
        <strong>${escapeHtml(track.name)}</strong>
        <span>${escapeHtml(track.artists)}</span>
        <small>${escapeHtml(track.album || '')}${track.explicit ? '・Explicit' : ''}・${formatMs(track.duration_ms)}</small>
      </div>
      <div class="trackActions">
        <button data-mode="queue">加入佇列</button>
        <button data-mode="play-now" class="danger">立即插播</button>
      </div>
    </article>
  `).join('');
}

searchForm.addEventListener('submit', async e=>{
  e.preventDefault();

  const q = searchInput.value.trim();
  if(!q) return;

  resultList.innerHTML = '<p class="emptyText">搜尋中...</p>';

  try{
    const data = await api(`/api/request/search?pin=${encodeURIComponent(pin)}&q=${encodeURIComponent(q)}`);
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
  const uri = item?.dataset.uri;
  const mode = btn.dataset.mode;
  if(!uri) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '送出中...';

  try{
    const data = await api(`/api/request/${mode === 'play-now' ? 'play-now' : 'queue'}`, {
      method:'POST',
      body: JSON.stringify({ pin, uri })
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

if(!pin){
  showToast('缺少 QR Code 權限碼，請重新掃描。');
}
