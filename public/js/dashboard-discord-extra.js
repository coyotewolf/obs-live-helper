(function(){
  const buttons = Array.from(document.querySelectorAll('[data-dashboard-tab]'));
  const panes = Array.from(document.querySelectorAll('[data-dashboard-pane]'));
  if (buttons.length && panes.length) {
    const saved = localStorage.getItem('obsHelperDashboardTab') || 'start';
    const activate = tabName => {
      buttons.forEach(btn => btn.classList.toggle('isActive', btn.dataset.dashboardTab === tabName));
      panes.forEach(pane => pane.classList.toggle('isActive', pane.dataset.dashboardPane === tabName));
      localStorage.setItem('obsHelperDashboardTab', tabName);
    };
    buttons.forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.dashboardTab)));
    activate(buttons.some(btn => btn.dataset.dashboardTab === saved) ? saved : buttons[0].dataset.dashboardTab);
  }

  document.querySelectorAll('.dashboardAccordion').forEach((details, index) => {
    const title = details.querySelector('summary strong')?.textContent?.trim() || `section-${index}`;
    const key = `obsHelperAccordion:${title}`;
    const saved = localStorage.getItem(key);
    if (saved === 'open') details.open = true;
    if (saved === 'closed') details.open = false;
    details.addEventListener('toggle', () => localStorage.setItem(key, details.open ? 'open' : 'closed'));
  });
})();

(function(){
  function showUiToast(message){
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(showUiToast.timer);
    showUiToast.timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  window.showToast = showUiToast;
  try { showToast = showUiToast; } catch {}
})();

(function(){
  const grid = document.querySelector('.overlayGrid');
  if (!grid || document.getElementById('dcProfilePicUrl')) return;
  const card = document.createElement('article');
  card.className = 'overlayCard panel';
  card.innerHTML = '<div class="overlayIcon">DC</div><div class="overlayBody"><h3>Discord 語音頭貼 Overlay</h3><p>顯示 Discord 語音頻道中正在說話的使用者頭貼，已套用 OBS Live Helper 發光風格。</p><code id="dcProfilePicUrl"></code></div><div class="overlayActions"><a href="/html/dcprofilepic.html" target="_blank">預覽</a><button class="btnMini" type="button" data-copy-discord-url>複製</button></div>';
  grid.appendChild(card);
  const urlEl = document.getElementById('dcProfilePicUrl');
  if (urlEl) urlEl.textContent = `${location.origin}/html/dcprofilepic.html`;
  card.querySelector('[data-copy-discord-url]')?.addEventListener('click', async () => {
    const text = urlEl?.textContent?.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); window.showToast?.('已複製 Discord Overlay URL'); }
    catch { window.showToast?.('無法自動複製，請手動選取 URL'); }
  });
})();

(function(){
  const spotifyBlock = document.getElementById('spotifyBlock');
  const logTitle = spotifyBlock?.querySelector('.logTitle');
  if (!spotifyBlock || !logTitle) return;

  let btnRow = logTitle.querySelector('.btnRow');
  if (!btnRow) {
    btnRow = document.createElement('div');
    btnRow.className = 'btnRow compact';
    Array.from(logTitle.querySelectorAll('button')).forEach(btn => btnRow.appendChild(btn));
    logTitle.appendChild(btnRow);
  }

  let retryBtn = document.getElementById('retrySpotifyBtn');
  if (!retryBtn) {
    retryBtn = document.createElement('button');
    retryBtn.id = 'retrySpotifyBtn';
    retryBtn.className = 'btnMini spotifyRetryButton';
    retryBtn.type = 'button';
    retryBtn.textContent = '手動重試 Spotify';
    btnRow.prepend(retryBtn);
  }
  retryBtn.hidden = false;
  retryBtn.style.display = '';

  let timingBox = document.getElementById('spotifyTimingInfo');
  if (!timingBox) {
    timingBox = document.createElement('p');
    timingBox.id = 'spotifyTimingInfo';
    timingBox.className = 'introText';
    timingBox.style.margin = '8px 0 0';
    timingBox.textContent = 'Spotify 回應時間：等待狀態更新...';
    spotifyBlock.querySelector('.trackBox')?.insertAdjacentElement('afterend', timingBox);
  }

  let cacheBox = document.getElementById('lyricsCacheStatsInfo');
  if (!cacheBox) {
    cacheBox = document.createElement('p');
    cacheBox.id = 'lyricsCacheStatsInfo';
    cacheBox.className = 'introText';
    cacheBox.style.margin = '4px 0 0';
    cacheBox.textContent = '歌詞快取：讀取中...';
    timingBox.insertAdjacentElement('afterend', cacheBox);
  }

  const keepRetryVisible = () => { retryBtn.hidden = false; retryBtn.style.display = ''; };
  const formatTime = value => {
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleTimeString('zh-TW', { hour12: false }) : '';
  };

  function renderTiming(st = {}){
    keepRetryVisible();
    if (st.spotify_timeout) timingBox.textContent = `Spotify timeout：請求 ${formatTime(st.spotify_request_started_at) || '-'}，逾時 ${formatTime(st.spotify_timeout_at || st.spotify_response_at) || '-'}，等待 ${st.spotify_response_elapsed_ms || st.spotify_timeout_ms || 0} ms。`;
    else if (st.rate_limited || st.error === 'rate_limited') timingBox.textContent = `Spotify rate limit：時間 ${formatTime(st.rate_limited_at) || '-'}，建議等待 ${Math.ceil(Number(st.retry_after_ms || 0) / 1000) || '?'} 秒後重試。`;
    else if (st.manual_retry_required) timingBox.textContent = 'Spotify 需要手動重試：請按「手動重試 Spotify」。';
    else if (st.spotify_response_elapsed_ms || st.spotify_response_at) timingBox.textContent = `Spotify 回應時間：${formatTime(st.spotify_response_at) || '-'}，耗時 ${st.spotify_response_elapsed_ms || 0} ms。`;
    else timingBox.textContent = 'Spotify 回應時間：等待狀態更新，可隨時手動重試 Spotify。';
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
    try { renderCacheStats(await fetch('/api/spotify/lyrics-cache/stats').then(r => r.json())); }
    catch { cacheBox.textContent = '歌詞快取：讀取失敗。'; }
  }

  async function refreshTiming(){
    keepRetryVisible();
    try {
      const response = await fetch('/api/spotify/status');
      const st = await response.json().catch(() => ({}));
      if (!response.ok && !st.manual_retry_required) st.error = st.error || 'failed_to_fetch_playback';
      renderTiming(st);
    } catch {
      keepRetryVisible();
      timingBox.textContent = 'Spotify 回應時間：狀態讀取失敗，可手動重試 Spotify。';
    }
  }

  retryBtn.addEventListener('click', async () => {
    const ok = await (window.showConfirmDialog
      ? window.showConfirmDialog('確定要手動重試 Spotify 嗎？\n\n這會清除目前的 Spotify rate-limit / timeout 鎖定，下一次狀態更新會重新呼叫 Spotify API。', { title: '手動重試 Spotify' })
      : Promise.resolve(true));
    if (!ok) return;
    retryBtn.disabled = true;
    const original = retryBtn.textContent;
    retryBtn.textContent = '重試中...';
    try {
      const res = await fetch('/api/spotify/retry', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || 'Spotify 手動重試失敗');
      window.showToast?.('已手動重試 Spotify');
      await refreshTiming();
      if (typeof window.loadStatus === 'function') window.loadStatus();
      if (typeof window.loadLog === 'function') window.loadLog();
    } catch (err) {
      keepRetryVisible();
      window.showToast?.(err.message);
    } finally {
      retryBtn.disabled = false;
      retryBtn.textContent = original;
      keepRetryVisible();
    }
  });

  document.getElementById('clearLyricsCacheBtn')?.addEventListener('click', () => setTimeout(refreshCacheStats, 800));
  window.refreshSpotifyManualRetryStatus = refreshTiming;
  refreshTiming();
  refreshCacheStats();
  setInterval(refreshTiming, 6000);
  setInterval(refreshCacheStats, 15000);
})();

(function(){
  if (typeof window.renderRequests !== 'function') return;
  window.renderRequests = function(requests = []){
    const requestList = document.getElementById('requestList');
    if(!requestList) return;
    if(!requests.length){ requestList.innerHTML = '<p class="emptyText">目前沒有點歌請求。</p>'; return; }
    requestList.innerHTML = requests.map(req=>{
      const track = req.track || {};
      const isPending = req.status === 'pending';
      const requestedMode = req.mode === 'play-now' ? 'play-now' : 'queue';
      const queueButtonClass = requestedMode === 'queue' ? 'btnPrimary' : 'btnGhost';
      const playNowButtonClass = requestedMode === 'play-now' ? 'btnPrimary' : 'btnGhost';
      return `<article class="requestItem ${isPending ? 'isPending' : ''}"><img class="requestCover" src="${escapeHtml2(track.cover_url || '')}" alt=""><div class="requestMeta"><strong>${escapeHtml2(track.name || '未知歌曲')}</strong><span>${escapeHtml2(track.artists || '未知歌手')}</span><small>${escapeHtml2(req.nickname || '匿名觀眾')}・${requestStatusLabel(req.status)}・${requestedMode === 'play-now' ? '插播' : '佇列'}・${formatDuration(track.duration_ms)}</small></div><div class="requestActions">${isPending ? `<button class="${queueButtonClass}" data-request-action="approve" data-id="${req.id}">加入佇列</button><button class="${playNowButtonClass}" data-request-action="play-now" data-id="${req.id}">立即插播</button><button class="btnDanger" data-request-action="reject" data-id="${req.id}">拒絕</button>` : `<span class="statusPill">${requestStatusLabel(req.status)}</span>`}</div></article>`;
    }).join('');
  };
  if (typeof window.loadRequestList === 'function') window.loadRequestList().catch(()=>{});
})();

(function createSettingsTabOnly(){
  const nav = document.querySelector('.dashboardTabs');
  const wrapper = document.querySelector('.wrapper');
  if (!nav || !wrapper || document.querySelector('[data-dashboard-tab="settings"]')) return;

  const tabButton = document.createElement('button');
  tabButton.className = 'dashboardTabButton';
  tabButton.type = 'button';
  tabButton.dataset.dashboardTab = 'settings';
  tabButton.textContent = '設定';
  nav.appendChild(tabButton);

  const pane = document.createElement('section');
  pane.className = 'dashboardTabPane';
  pane.dataset.dashboardPane = 'settings';
  pane.innerHTML = `
    <details class="dashboardAccordion panel" open>
      <summary>
        <span><span class="eyebrow">Settings</span><strong>備份驗證與設定資訊</strong></span>
        <span class="accordionHint">展開 / 收合</span>
      </summary>
      <div class="dashboardAccordionBody">
        <p class="introText">在這裡選擇要備份的內容，並檢查備份是否包含重要設定。</p>
        <div class="btnRow">
          <button id="refreshBackupVerificationBtn" class="btnGhost" type="button">重新檢查備份內容</button>
          <button id="settingsTabBackupBtn" class="btnPrimary" type="button">建立並下載備份</button>
        </div>
        <div class="verificationMeta">
          <div><span class="eyebrow">Files</span><p id="backupSummaryCount">等待檢查</p></div>
          <div><span class="eyebrow">Size</span><p id="backupSummarySize">等待檢查</p></div>
          <div><span class="eyebrow">Data Dir</span><code id="backupSummaryDataDir">等待檢查</code></div>
        </div>
        <div id="backupVerificationGrid" class="verificationGrid"></div>
      </div>
    </details>
  `;
  wrapper.appendChild(pane);

  function activate(tabName){
    document.querySelectorAll('[data-dashboard-tab]').forEach(btn => btn.classList.toggle('isActive', btn.dataset.dashboardTab === tabName));
    document.querySelectorAll('[data-dashboard-pane]').forEach(tabPane => tabPane.classList.toggle('isActive', tabPane.dataset.dashboardPane === tabName));
    localStorage.setItem('obsHelperDashboardTab', tabName);
  }
  tabButton.addEventListener('click', () => activate('settings'));

  const savedTab = localStorage.getItem('obsHelperDashboardTab');
  if (savedTab === 'settings') activate('settings');
})();
