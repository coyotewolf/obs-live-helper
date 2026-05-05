/* Host-reviewed interruption request dashboard helpers. */
(function dashboardInterruptionHelpers(){
  const API_URL = '/api/interruption';
  const REFRESH_MS = 5000;
  let latestItems = [];

  function escapeHtml(text){
    return String(text || '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[ch]));
  }

  function formatDuration(ms){
    const total = Math.floor((Number(ms) || 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function formatTime(value){
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    return new Date(time).toLocaleString('zh-TW', {
      month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
    });
  }

  function adminHeaders(){
    return {
      'Content-Type': 'application/json',
      'x-admin-token': localStorage.getItem('obsHelperAdminToken') || ''
    };
  }

  async function adminApi(path, options = {}){
    const res = await fetch(path, {
      ...options,
      headers: { ...adminHeaders(), ...(options.headers || {}) },
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || '管理 API 操作失敗');
    return data;
  }

  function ensureStyles(){
    if (document.getElementById('dashboardInterruptionExtraStyle')) return;
    const style = document.createElement('style');
    style.id = 'dashboardInterruptionExtraStyle';
    style.textContent = `
      .approvedInterruptionList{display:grid;gap:12px;margin-top:14px}
      .approvedInterruptionItem{display:grid;grid-template-columns:28px 58px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.11);border-radius:18px;background:rgba(255,255,255,.045)}
      .approvedInterruptionItem img{width:58px;height:58px;border-radius:15px;object-fit:cover;background:rgba(255,255,255,.08)}
      .approvedInterruptionMeta{min-width:0}.approvedInterruptionMeta strong,.approvedInterruptionMeta span,.approvedInterruptionMeta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.approvedInterruptionMeta span{color:var(--muted);margin-top:4px}.approvedInterruptionMeta small{color:rgba(234,241,255,.52);margin-top:4px}.approvedInterruptionBadge{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 12px;border-radius:999px;background:rgba(251,113,133,.15);border:1px solid rgba(251,113,133,.28);color:#fecdd3;font-size:.82rem;font-weight:900;white-space:nowrap}.approvedInterruptionHint{margin-top:10px;color:var(--muted);font-size:.9rem;line-height:1.55}.approvedInterruptionActions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.approvedInterruptionCheck{width:18px;height:18px;accent-color:var(--accent);justify-self:center}.approvedInterruptionToolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end}.approvedInterruptionToolbar .btnMini{min-height:34px}.approvedInterruptionToolbar .btnDanger{min-height:34px;padding:0 14px;border-radius:999px}.approvedInterruptionPlayedBtn{cursor:pointer}.approvedInterruptionPlayedBtn:hover{filter:brightness(1.18)}
      body[data-theme="pink-cute"] .approvedInterruptionItem{background:rgba(255,255,255,.7);border-color:rgba(210,72,122,.18)}
      body[data-theme="pink-cute"] .approvedInterruptionBadge{background:rgba(255,235,246,.88);border-color:rgba(210,72,122,.24);color:#b32a66}
      body[data-theme="pink-cute"] .approvedInterruptionMeta small{color:rgba(67,33,54,.58)}
      @media(max-width:760px){.approvedInterruptionItem{grid-template-columns:28px 50px minmax(0,1fr)}.approvedInterruptionItem img{width:50px;height:50px}.approvedInterruptionActions{grid-column:1/-1}.approvedInterruptionBadge{justify-content:flex-start}.approvedInterruptionToolbar{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function patchLegacyText(){
    document.querySelectorAll('button').forEach(btn => {
      if (btn.textContent.trim() === '立即插播') btn.textContent = '同意插播';
    });
    document.querySelectorAll('.requestItem small').forEach(el => {
      let text = el.textContent || '';
      text = text.replace('已插播', '已同意插播');
      if (text.includes('・插播・')) text = text.replace('・插播・', '・請求插播・');
      el.textContent = text;
    });
  }

  function patchToast(){
    const oldToast = window.showToast;
    if (typeof oldToast !== 'function' || oldToast.__interruptionPatched) return;
    const patched = function(message){
      const text = String(message || '')
        .replace('已立即插播', '已同意插播，請自行在 Spotify 播放')
        .replace('已插播', '已同意插播');
      return oldToast(text);
    };
    patched.__interruptionPatched = true;
    window.showToast = patched;
  }

  function ensureApprovedPanel(){
    let list = document.getElementById('approvedInterruptionList');
    if (list) return list;

    const pendingPanel = document.querySelector('.pendingPanel');
    const spotifyPane = document.querySelector('[data-dashboard-pane="spotify"]');
    if (!pendingPanel || !spotifyPane) return null;

    const panel = document.createElement('details');
    panel.className = 'dashboardAccordion approvedInterruptionPanel panel';
    panel.open = true;
    panel.innerHTML = `
      <summary>
        <span><span class="eyebrow">Approved Interruption</span><strong>已同意插播歌曲</strong></span>
        <span class="accordionHint">展開 / 收合</span>
      </summary>
      <div class="dashboardAccordionBody">
        <div class="titleRow compactTitleRow">
          <p class="introText">這裡列出主播已同意的插播請求。歌曲播完後可點「已插播」或勾選多首後批次清除。</p>
          <div class="approvedInterruptionToolbar">
            <button id="selectAllApprovedInterruptionBtn" class="btnMini" type="button">全選</button>
            <button id="selectNoneApprovedInterruptionBtn" class="btnMini" type="button">全不選</button>
            <button id="clearSelectedApprovedInterruptionBtn" class="btnDanger" type="button">清除已選</button>
            <button id="reloadApprovedInterruptionBtn" class="btnGhost btnMini" type="button">重新整理</button>
          </div>
        </div>
        <div id="approvedInterruptionList" class="approvedInterruptionList"><p class="emptyText">讀取中...</p></div>
      </div>`;

    pendingPanel.insertAdjacentElement('afterend', panel);
    panel.querySelector('#reloadApprovedInterruptionBtn')?.addEventListener('click', loadApprovedInterruptions);
    panel.querySelector('#selectAllApprovedInterruptionBtn')?.addEventListener('click', () => setAllChecked(true));
    panel.querySelector('#selectNoneApprovedInterruptionBtn')?.addEventListener('click', () => setAllChecked(false));
    panel.querySelector('#clearSelectedApprovedInterruptionBtn')?.addEventListener('click', clearSelectedInterruptions);
    return panel.querySelector('#approvedInterruptionList');
  }

  function getSelectedIds(){
    return Array.from(document.querySelectorAll('.approvedInterruptionCheck:checked'))
      .map(input => input.value)
      .filter(Boolean);
  }

  function setAllChecked(checked){
    document.querySelectorAll('.approvedInterruptionCheck').forEach(input => { input.checked = checked; });
  }

  function renderApprovedInterruptions(items = []){
    const list = ensureApprovedPanel();
    if (!list) return;
    latestItems = items;

    if (!items.length) {
      list.innerHTML = '<p class="emptyText">目前沒有已同意插播歌曲。</p>';
      return;
    }

    list.innerHTML = items.map(item => {
      const track = item.track || {};
      const spotifyUrl = track.external_url || (track.id ? `https://open.spotify.com/track/${encodeURIComponent(track.id)}` : '');
      return `
        <article class="approvedInterruptionItem" data-id="${escapeHtml(item.id)}">
          <input class="approvedInterruptionCheck" type="checkbox" value="${escapeHtml(item.id)}" aria-label="選取 ${escapeHtml(track.name || '未知歌曲')}">
          <img src="${escapeHtml(track.cover_url || '')}" alt="">
          <div class="approvedInterruptionMeta">
            <strong>${escapeHtml(track.name || '未知歌曲')}</strong>
            <span>${escapeHtml(track.artists || '未知歌手')}</span>
            <small>${escapeHtml(item.nickname || '匿名觀眾')}・${formatDuration(track.duration_ms)}・同意時間 ${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</small>
          </div>
          <div class="approvedInterruptionActions">
            ${spotifyUrl ? `<a class="btnMini" href="${escapeHtml(spotifyUrl)}" target="_blank" rel="noreferrer">開 Spotify</a>` : ''}
            <button class="approvedInterruptionBadge approvedInterruptionPlayedBtn" type="button" data-played-id="${escapeHtml(item.id)}">已插播</button>
          </div>
        </article>`;
    }).join('');
  }

  async function loadApprovedInterruptions(){
    const list = ensureApprovedPanel();
    if (!list) return;
    try {
      const data = await adminApi(`${API_URL}/approved?_t=${Date.now()}`);
      renderApprovedInterruptions(data.requests || []);
    } catch {
      list.innerHTML = '<p class="emptyText">目前無法讀取已同意插播清單。</p>';
    }
  }

  async function clearInterruptionIds(ids){
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) {
      window.showToast?.('請先選擇要清除的歌曲');
      return;
    }

    const ok = typeof window.showConfirmDialog === 'function'
      ? await window.showConfirmDialog(`確定要將 ${uniqueIds.length} 首歌標記為已插播並從清單清除嗎？`, { title:'清除已同意插播歌曲', okText:'清除' })
      : confirm(`確定要將 ${uniqueIds.length} 首歌標記為已插播並從清單清除嗎？`);
    if (!ok) return;

    try {
      const data = await adminApi(`${API_URL}/clear-approved`, {
        method:'POST',
        body: JSON.stringify({ ids: uniqueIds })
      });
      renderApprovedInterruptions(data.requests || []);
      window.showToast?.(data.message || '已清除已插播歌曲');
    } catch (err) {
      window.showToast?.(err.message || '清除失敗');
    }
  }

  function clearSelectedInterruptions(){
    clearInterruptionIds(getSelectedIds());
  }

  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-played-id]');
    if (!btn) return;
    clearInterruptionIds([btn.dataset.playedId]);
  });

  ensureStyles();
  ensureApprovedPanel();
  patchToast();
  patchLegacyText();
  new MutationObserver(() => requestAnimationFrame(patchLegacyText))
    .observe(document.body, { childList:true, subtree:true, characterData:true });
  loadApprovedInterruptions();
  setInterval(loadApprovedInterruptions, REFRESH_MS);
})();
