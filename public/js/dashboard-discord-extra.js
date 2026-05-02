(function setupDashboardTabs(){
  const buttons = Array.from(document.querySelectorAll('[data-dashboard-tab]'));
  const panes = Array.from(document.querySelectorAll('[data-dashboard-pane]'));
  if (!buttons.length || !panes.length) return;

  const saved = localStorage.getItem('obsHelperDashboardTab') || 'start';

  function activate(tabName){
    buttons.forEach(btn => btn.classList.toggle('isActive', btn.dataset.dashboardTab === tabName));
    panes.forEach(pane => pane.classList.toggle('isActive', pane.dataset.dashboardPane === tabName));
    localStorage.setItem('obsHelperDashboardTab', tabName);
  }

  buttons.forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.dashboardTab)));
  activate(buttons.some(btn => btn.dataset.dashboardTab === saved) ? saved : buttons[0].dataset.dashboardTab);
})();

(function persistDashboardAccordions(){
  document.querySelectorAll('.dashboardAccordion').forEach((details, index) => {
    const title = details.querySelector('summary strong')?.textContent?.trim() || `section-${index}`;
    const key = `obsHelperAccordion:${title}`;
    const saved = localStorage.getItem(key);
    if (saved === 'open') details.open = true;
    if (saved === 'closed') details.open = false;
    details.addEventListener('toggle', () => localStorage.setItem(key, details.open ? 'open' : 'closed'));
  });
})();

(function addDiscordProfileOverlayCard(){
  const grid = document.querySelector('.overlayGrid');
  if (!grid || document.getElementById('dcProfilePicUrl')) return;

  const card = document.createElement('article');
  card.className = 'overlayCard panel';
  card.innerHTML = `
    <div class="overlayIcon">DC</div>
    <div class="overlayBody">
      <h3>Discord 語音頭貼 Overlay</h3>
      <p>顯示 Discord 語音頻道中正在說話的使用者頭貼，已套用 OBS Live Helper 發光風格。</p>
      <code id="dcProfilePicUrl"></code>
    </div>
    <div class="overlayActions">
      <a href="/html/dcprofilepic.html" target="_blank">預覽</a>
      <button class="btnMini" type="button" data-copy-discord-url>複製</button>
    </div>
  `;
  grid.appendChild(card);

  const urlEl = document.getElementById('dcProfilePicUrl');
  if (urlEl) urlEl.textContent = `${location.origin}/html/dcprofilepic.html`;

  card.querySelector('[data-copy-discord-url]')?.addEventListener('click', async () => {
    const text = urlEl?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = '已複製 Discord Overlay URL';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1800);
      }
    } catch {
      alert('無法自動複製，請手動選取 URL');
    }
  });
})();

(function addSpotifyManualRetryPanel(){
  const spotifyBlock = document.getElementById('spotifyBlock');
  const logTitle = spotifyBlock?.querySelector('.logTitle');
  if (!spotifyBlock || !logTitle || document.getElementById('retrySpotifyBtn')) return;

  let btnRow = logTitle.querySelector('.btnRow');
  if (!btnRow) {
    btnRow = document.createElement('div');
    btnRow.className = 'btnRow compact';
    const existingButtons = Array.from(logTitle.querySelectorAll('button'));
    existingButtons.forEach(btn => btnRow.appendChild(btn));
    logTitle.appendChild(btnRow);
  }

  const retryBtn = document.createElement('button');
  retryBtn.id = 'retrySpotifyBtn';
  retryBtn.className = 'btnMini';
  retryBtn.type = 'button';
  retryBtn.textContent = '手動重試 Spotify';
  retryBtn.style.display = 'none';
  btnRow.prepend(retryBtn);

  const timingBox = document.createElement('p');
  timingBox.id = 'spotifyTimingInfo';
  timingBox.className = 'introText';
  timingBox.style.margin = '8px 0 0';
  timingBox.textContent = 'Spotify 回應時間：等待狀態更新...';
  const cacheBox = document.createElement('p');
  cacheBox.id = 'lyricsCacheStatsInfo';
  cacheBox.className = 'introText';
  cacheBox.style.margin = '4px 0 0';
  cacheBox.textContent = '歌詞快取：讀取中...';
  const trackBox = spotifyBlock.querySelector('.trackBox');
  trackBox?.insertAdjacentElement('afterend', timingBox);
  timingBox.insertAdjacentElement('afterend', cacheBox);

  function toast(message){
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function formatTime(value){
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Date(n).toLocaleTimeString('zh-TW', { hour12: false });
  }

  function renderTiming(st = {}){
    const hasProblem = Boolean(st.manual_retry_required || st.spotify_timeout || st.rate_limited);
    retryBtn.style.display = hasProblem ? '' : 'none';

    if (st.spotify_timeout) {
      const started = formatTime(st.spotify_request_started_at);
      const timeoutAt = formatTime(st.spotify_timeout_at || st.spotify_response_at);
      const elapsed = st.spotify_response_elapsed_ms || st.spotify_timeout_ms || 0;
      timingBox.textContent = `Spotify timeout：請求 ${started || '-'}，逾時 ${timeoutAt || '-'}，等待 ${elapsed} ms。`;
      return;
    }

    if (st.rate_limited) {
      const limitedAt = formatTime(st.rate_limited_at);
      const waitSec = Math.ceil(Number(st.retry_after_ms || 0) / 1000);
      timingBox.textContent = `Spotify rate limit：時間 ${limitedAt || '-'}，建議等待 ${waitSec || '?'} 秒後重試。`;
      return;
    }

    if (st.spotify_response_elapsed_ms || st.spotify_response_at) {
      const responseAt = formatTime(st.spotify_response_at);
      timingBox.textContent = `Spotify 回應時間：${responseAt || '-'}，耗時 ${st.spotify_response_elapsed_ms || 0} ms。`;
      return;
    }

    timingBox.textContent = 'Spotify 回應時間：等待狀態更新...';
  }

  function renderCacheStats(data = {}){
    const cache = data.cache || data;
    if (!cache || cache.exists === false) {
      cacheBox.textContent = '歌詞快取：0 B，0 筆。';
      return;
    }
    const newest = cache.newest_updated_at ? new Date(cache.newest_updated_at).toLocaleTimeString('zh-TW', { hour12: false }) : '-';
    const parseNote = cache.error ? `，錯誤：${cache.error}` : '';
    cacheBox.textContent = `歌詞快取：${cache.file_size_label || '0 B'}，共 ${cache.total_entries || 0} 筆（成功 ${cache.ready_entries || 0}、找不到 ${cache.not_found_entries || 0}、過期 ${cache.expired_entries || 0}），最新 ${newest}${parseNote}`;
  }

  async function refreshCacheStats(){
    try {
      const data = await fetch('/api/spotify/lyrics-cache/stats').then(r => r.json());
      renderCacheStats(data);
    } catch {
      cacheBox.textContent = '歌詞快取：讀取失敗。';
    }
  }

  async function refreshTiming(){
    try {
      const st = await fetch('/api/spotify/status').then(r => r.json());
      renderTiming(st);
    } catch {
      timingBox.textContent = 'Spotify 回應時間：狀態讀取失敗。';
    }
  }

  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    const original = retryBtn.textContent;
    retryBtn.textContent = '重試中...';
    try {
      const res = await fetch('/api/spotify/retry', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || 'Spotify 手動重試失敗');
      toast('已手動重試 Spotify');
      await refreshTiming();
      if (typeof window.loadStatus === 'function') window.loadStatus();
      if (typeof window.loadLog === 'function') window.loadLog();
    } catch (err) {
      toast(err.message);
    } finally {
      retryBtn.disabled = false;
      retryBtn.textContent = original;
    }
  });

  document.getElementById('clearLyricsCacheBtn')?.addEventListener('click', () => {
    setTimeout(refreshCacheStats, 800);
  });

  refreshTiming();
  refreshCacheStats();
  setInterval(refreshTiming, 6000);
  setInterval(refreshCacheStats, 15000);
})();

(function highlightAudienceRequestedAction(){
  if (typeof window.renderRequests !== 'function') return;

  window.renderRequests = function renderRequestsWithRequestedActionHighlight(requests = []){
    const requestList = document.getElementById('requestList');
    if(!requestList) return;
    if(!requests.length){
      requestList.innerHTML = '<p class="emptyText">目前沒有點歌請求。</p>';
      return;
    }

    requestList.innerHTML = requests.map(req=>{
      const track = req.track || {};
      const isPending = req.status === 'pending';
      const requestedMode = req.mode === 'play-now' ? 'play-now' : 'queue';
      const queueButtonClass = requestedMode === 'queue' ? 'btnPrimary' : 'btnGhost';
      const playNowButtonClass = requestedMode === 'play-now' ? 'btnPrimary' : 'btnGhost';

      return `
        <article class="requestItem ${isPending ? 'isPending' : ''}">
          <img class="requestCover" src="${escapeHtml2(track.cover_url || '')}" alt="">
          <div class="requestMeta">
            <strong>${escapeHtml2(track.name || '未知歌曲')}</strong>
            <span>${escapeHtml2(track.artists || '未知歌手')}</span>
            <small>${escapeHtml2(req.nickname || '匿名觀眾')}・${requestStatusLabel(req.status)}・${requestedMode === 'play-now' ? '插播' : '佇列'}・${formatDuration(track.duration_ms)}</small>
          </div>
          <div class="requestActions">
            ${isPending ? `<button class="${queueButtonClass}" data-request-action="approve" data-id="${req.id}">加入佇列</button>
            <button class="${playNowButtonClass}" data-request-action="play-now" data-id="${req.id}">立即插播</button>
            <button class="btnDanger" data-request-action="reject" data-id="${req.id}">拒絕</button>` : `<span class="statusPill">${requestStatusLabel(req.status)}</span>`}
          </div>
        </article>
      `;
    }).join('');
  };

  if (typeof window.loadRequestList === 'function') {
    window.loadRequestList().catch(()=>{});
  }
})();
