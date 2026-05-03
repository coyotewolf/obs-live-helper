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
    if (st.spotify_timeout) {
      timingBox.textContent = `Spotify timeout：請求 ${formatTime(st.spotify_request_started_at) || '-'}，逾時 ${formatTime(st.spotify_timeout_at || st.spotify_response_at) || '-'}，等待 ${st.spotify_response_elapsed_ms || st.spotify_timeout_ms || 0} ms。`;
    } else if (st.rate_limited || st.error === 'rate_limited') {
      timingBox.textContent = `Spotify rate limit：時間 ${formatTime(st.rate_limited_at) || '-'}，建議等待 ${Math.ceil(Number(st.retry_after_ms || 0) / 1000) || '?'} 秒後重試。`;
    } else if (st.manual_retry_required) {
      timingBox.textContent = 'Spotify 需要手動重試：請按「手動重試 Spotify」。';
    } else if (st.spotify_response_elapsed_ms || st.spotify_response_at) {
      timingBox.textContent = `Spotify 回應時間：${formatTime(st.spotify_response_at) || '-'}，耗時 ${st.spotify_response_elapsed_ms || 0} ms。`;
    } else {
      timingBox.textContent = 'Spotify 回應時間：等待狀態更新，可隨時手動重試 Spotify。';
    }
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

(function addSettingsTabAndBackupVerification(){
  const nav = document.querySelector('.dashboardTabs');
  const wrapper = document.querySelector('.wrapper');
  if (!nav || !wrapper || document.querySelector('[data-dashboard-tab="settings"]')) return;

  const style = document.createElement('style');
  style.textContent = `
    .verificationGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:14px}
    .verificationItem{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.045)}
    .verificationItem strong{font-size:.92rem}.verificationBadge{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;font-size:.82rem;font-weight:900}.verificationBadge.ok{color:#052e14;background:var(--good)}.verificationBadge.fail{color:#fff;background:#fb7185}.verificationMeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}.verificationMeta code{width:100%}
    body[data-theme="pink-cute"] .verificationItem{background:rgba(255,255,255,.72);border-color:rgba(210,72,122,.18)}
  `;
  document.head.appendChild(style);

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
        <p class="introText">這裡會直接讀取 <code>/api/backup/summary</code>，確認目前備份是否包含重要 runtime 檔案、小目標設定與時鐘設定。</p>
        <div class="btnRow">
          <button id="refreshBackupVerificationBtn" class="btnGhost" type="button">重新檢查備份內容</button>
          <button id="settingsTabBackupBtn" class="btnPrimary" type="button">建立並下載備份</button>
        </div>
        <div class="verificationMeta">
          <div><span class="eyebrow">Files</span><p id="backupSummaryCount">讀取中...</p></div>
          <div><span class="eyebrow">Size</span><p id="backupSummarySize">讀取中...</p></div>
          <div><span class="eyebrow">Data Dir</span><code id="backupSummaryDataDir">讀取中...</code></div>
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

  tabButton.addEventListener('click', () => {
    activate('settings');
    refreshBackupVerification();
  });

  function formatBytes(bytes = 0){
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  const labels = {
    includesLyricsLog: '包含 lyrics.log',
    includesLrclibCache: '包含 lrclib-cache.json',
    includesStorageKeep: '包含 storage/.keep',
    includesLyricsKeep: '包含 lyrics/.keep',
    includesFontsKeep: '包含 fonts/.keep',
    includesOverlayConfigFile: '包含 overlay-config.json',
    includesGoalSettings: '包含小目標設定',
    includesClockSettings: '包含時鐘設定'
  };

  function renderVerification(summary){
    const grid = document.getElementById('backupVerificationGrid');
    const verification = summary?.verification || {};
    document.getElementById('backupSummaryCount').textContent = `${summary?.fileCount ?? 0} 個檔案${summary?.includesEnv ? '，包含 .env' : '，未包含 .env'}`;
    document.getElementById('backupSummarySize').textContent = formatBytes(summary?.approxBytes || 0);
    document.getElementById('backupSummaryDataDir').textContent = summary?.dataDir || '-';

    grid.innerHTML = Object.entries(labels).map(([key, label]) => {
      const ok = Boolean(verification[key]);
      return `<div class="verificationItem"><strong>${label}</strong><span class="verificationBadge ${ok ? 'ok' : 'fail'}">${ok ? '已包含' : '未找到'}</span></div>`;
    }).join('');
  }

  async function refreshBackupVerification(){
    const grid = document.getElementById('backupVerificationGrid');
    if (grid) grid.innerHTML = '<p class="emptyText">檢查中...</p>';
    try {
      const data = await fetch('/api/backup/summary', { cache: 'no-store' }).then(r => r.json());
      if (!data.ok) throw new Error(data.message || '備份資訊讀取失敗');
      renderVerification(data);
    } catch (err) {
      if (grid) grid.innerHTML = `<p class="emptyText">${err.message || '備份資訊讀取失敗'}</p>`;
      window.showToast?.(err.message || '備份資訊讀取失敗');
    }
  }

  document.getElementById('refreshBackupVerificationBtn')?.addEventListener('click', refreshBackupVerification);
  document.getElementById('settingsTabBackupBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.getElementById('backupBtn')?.click();
  });

  pane.querySelectorAll('.dashboardAccordion').forEach((details, index) => {
    const title = details.querySelector('summary strong')?.textContent?.trim() || `settings-${index}`;
    const key = `obsHelperAccordion:${title}`;
    const saved = localStorage.getItem(key);
    if (saved === 'open') details.open = true;
    if (saved === 'closed') details.open = false;
    details.addEventListener('toggle', () => localStorage.setItem(key, details.open ? 'open' : 'closed'));
  });

  const backupIntro = Array.from(document.querySelectorAll('.dashboardAccordion .introText')).find(el => el.textContent.includes('匯出目前 OBS Live Helper'));
  if (backupIntro) {
    backupIntro.textContent = '匯出目前 OBS Live Helper 的本機設定與 runtime 資料，包含 Spotify / Discord 設定、自訂文字樣式、Overlay 設定、觀眾點歌設定、上傳字型、lyrics.log、LRCLib 快取與 .keep 檔。備份檔會下載成 JSON。';
  }

  const savedTab = localStorage.getItem('obsHelperDashboardTab');
  if (savedTab === 'settings') {
    activate('settings');
    refreshBackupVerification();
  }
})();
