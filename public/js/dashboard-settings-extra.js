/* OBS Live Helper – settings tab backup options + reset */
(function dashboardSettingsExtra(){
  const BACKUP_DEFAULTS = {
    env: true,
    storageOther: true,
    overlayConfig: true,
    lyricsLog: true,
    lrclibCache: true,
    currentLyrics: true,
    keepFiles: true,
    fonts: true
  };

  const OPTION_LABELS = {
    env: 'Spotify / Discord 設定（.env，含 Client ID、StreamKit URL）',
    overlayConfig: 'Overlay 設定（含小目標、時鐘）',
    storageOther: '其他 storage 設定（token、點歌設定、自訂樣式等）',
    lyricsLog: 'lyrics.log',
    lrclibCache: 'LRCLib 歌詞快取',
    currentLyrics: '目前歌詞 current.lrc',
    fonts: '上傳字型 fonts/',
    keepFiles: '.keep 檔案'
  };

  const VERIFICATION_LABELS = {
    includesEnv: '包含 .env',
    includesClientId: '包含 Spotify Client ID',
    includesStreamKit: '包含 Discord StreamKit URL',
    includesLyricsLog: '包含 lyrics.log',
    includesLrclibCache: '包含 lrclib-cache.json',
    includesStorageKeep: '包含 storage/.keep',
    includesLyricsKeep: '包含 lyrics/.keep',
    includesFontsKeep: '包含 fonts/.keep',
    includesOverlayConfigFile: '包含 overlay-config.json',
    includesGoalSettings: '包含小目標設定',
    includesClockSettings: '包含時鐘設定'
  };

  const VERIFICATION_OPTION_MAP = {
    includesEnv: ['env'],
    includesClientId: ['env'],
    includesStreamKit: ['env'],
    includesLyricsLog: ['lyricsLog'],
    includesLrclibCache: ['lrclibCache'],
    includesStorageKeep: ['keepFiles'],
    includesLyricsKeep: ['keepFiles'],
    includesFontsKeep: ['keepFiles'],
    includesOverlayConfigFile: ['overlayConfig'],
    includesGoalSettings: ['overlayConfig'],
    includesClockSettings: ['overlayConfig']
  };

  let hasRenderedVerificationOnce = false;
  let refreshTimer = null;

  function toast(message){
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  async function confirmDialog(message, options = {}){
    if (typeof window.showConfirmDialog === 'function') return window.showConfirmDialog(message, options);
    return confirm(message);
  }

  function formatBytes(bytes = 0){
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function waitForElement(selector, timeoutMs = 8000){
    return new Promise(resolve => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeoutMs);
    });
  }

  function removeStartBackupContent(){
    document.getElementById('backupBtn')?.remove();
    document.getElementById('backupSettingsBtn')?.closest('.dashboardAccordion')?.remove();
  }

  function ensureSettingsStyle(){
    if (document.getElementById('settingsExtraStyle')) return;
    const style = document.createElement('style');
    style.id = 'settingsExtraStyle';
    style.textContent = `
      .backupSelectToolbar{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 8px}
      .backupOptionGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin:10px 0 16px}
      .backupOptionGrid label{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:10px;min-height:50px;padding:11px 13px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.045);color:var(--muted);font-weight:800;line-height:1.35}
      .backupOptionGrid input{width:18px;height:18px;accent-color:var(--accent);margin:0}
      .backupOptionGrid span{display:block;min-width:0}
      .settingsDangerBox{margin-top:18px;padding:16px;border:1px solid rgba(239,68,68,.32);border-radius:18px;background:rgba(239,68,68,.08)}
      .settingsDangerBox p{margin-top:6px}
      .verificationGrid{align-items:stretch;min-height:186px}
      .verificationItem{display:grid!important;grid-template-columns:minmax(0,1fr) 86px!important;align-items:center!important;min-height:54px!important;gap:12px!important}
      .verificationItem strong{display:block;min-width:0;line-height:1.35}
      .verificationBadge{justify-content:center;white-space:nowrap;text-align:center;min-width:74px}
      .verificationBadge.off{color:rgba(255,255,255,.76);background:rgba(148,163,184,.28)}
      .backupSummaryStable{min-height:1.65em;display:block}
      .backupSummaryCodeStable{min-height:32px;display:inline-flex;align-items:center}
      body[data-theme="pink-cute"] .backupOptionGrid label{background:rgba(255,255,255,.72);border-color:rgba(210,72,122,.18)}
      body[data-theme="pink-cute"] .settingsDangerBox{background:rgba(239,68,68,.06);border-color:rgba(217,45,98,.26)}
      body[data-theme="pink-cute"] .verificationBadge.off{color:rgba(67,33,54,.72);background:rgba(148,163,184,.22)}
      @media(max-width:560px){.backupOptionGrid{grid-template-columns:1fr}.verificationItem{grid-template-columns:1fr!important}.verificationBadge{justify-self:start}}
    `;
    document.head.appendChild(style);
  }

  function selectedOptions(){
    const out = {};
    for (const key of Object.keys(BACKUP_DEFAULTS)) {
      const el = document.querySelector(`[data-backup-option="${key}"]`);
      out[key] = el ? Boolean(el.checked) : BACKUP_DEFAULTS[key];
    }
    return out;
  }

  function optionsToQuery(options = selectedOptions()){
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) params.set(key, value ? 'true' : 'false');
    return params.toString();
  }

  function verificationIsSelected(key, options = selectedOptions()){
    const requiredOptions = VERIFICATION_OPTION_MAP[key] || [];
    return requiredOptions.length ? requiredOptions.every(optionKey => Boolean(options[optionKey])) : true;
  }

  function verificationBadgeHtml(key, verification, options){
    const selected = verificationIsSelected(key, options);
    if (!selected) return '<span class="verificationBadge off">未勾選</span>';
    const ok = Boolean(verification[key]);
    return `<span class="verificationBadge ${ok ? 'ok' : 'fail'}">${ok ? '已包含' : '未包含'}</span>`;
  }

  function ensureVerificationSkeleton(){
    const grid = document.getElementById('backupVerificationGrid');
    if (!grid || grid.dataset.skeletonReady === 'true') return;
    grid.dataset.skeletonReady = 'true';
    grid.innerHTML = Object.entries(VERIFICATION_LABELS).map(([key, label]) => {
      return `<div class="verificationItem" data-verification-key="${key}"><strong>${label}</strong><span class="verificationBadge off">待檢查</span></div>`;
    }).join('');
  }

  function setTextIfChanged(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    const next = String(value ?? '');
    if (el.textContent !== next) el.textContent = next;
  }

  function renderVerification(summary, options){
    ensureVerificationSkeleton();
    const verification = summary?.verification || {};
    const fileText = `${summary?.fileCount ?? 0} 個檔案${summary?.includesEnv ? '，包含 .env' : '，未包含 .env'}`;
    const sizeText = formatBytes(summary?.approxBytes || 0);
    const dataDirText = summary?.dataDir || '-';

    setTextIfChanged('backupSummaryCount', fileText);
    setTextIfChanged('backupSummarySize', sizeText);
    setTextIfChanged('backupSummaryDataDir', dataDirText);

    for (const key of Object.keys(VERIFICATION_LABELS)) {
      const item = document.querySelector(`[data-verification-key="${key}"]`);
      if (!item) continue;
      const nextBadge = verificationBadgeHtml(key, verification, options);
      const badge = item.querySelector('.verificationBadge');
      if (!badge || badge.outerHTML !== nextBadge) {
        const temp = document.createElement('div');
        temp.innerHTML = nextBadge;
        badge?.replaceWith(temp.firstElementChild);
      }
    }
    hasRenderedVerificationOnce = true;
  }

  async function refreshVerification({ silent = false } = {}){
    const grid = document.getElementById('backupVerificationGrid');
    ensureVerificationSkeleton();

    if (!silent) toast('正在檢查備份內容...');

    try {
      const options = selectedOptions();
      const res = await fetch(`/api/backup/summary?${optionsToQuery(options)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || '備份資訊讀取失敗');
      renderVerification(data, options);
      if (!silent && hasRenderedVerificationOnce) toast('備份內容檢查完成');
    } catch (err) {
      // Do not replace the whole verification area here. Keep the old layout stable.
      if (!hasRenderedVerificationOnce && grid) {
        grid.dataset.skeletonReady = 'true';
        grid.innerHTML = Object.entries(VERIFICATION_LABELS).map(([key, label]) => {
          return `<div class="verificationItem" data-verification-key="${key}"><strong>${label}</strong><span class="verificationBadge fail">讀取失敗</span></div>`;
        }).join('');
      }
      toast(err.message || '備份資訊讀取失敗');
    }
  }

  function scheduleRefreshVerification(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshVerification({ silent: true }), 120);
  }

  async function downloadSelectedBackup(){
    const ok = await confirmDialog('確定要依照目前勾選項目建立備份嗎？\n\n若取消 .env，就不會包含 Spotify Client ID 與 Discord StreamKit URL。', {
      title: '建立備份',
      okText: '建立備份'
    });
    if (!ok) return;

    const buttons = [document.getElementById('settingsTabBackupBtn')].filter(Boolean);
    buttons.forEach(btn => { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = '備份中...'; });
    try {
      const res = await fetch(`/api/backup/export?${optionsToQuery()}`, { cache: 'no-store' });
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
      toast('備份檔已開始下載');
    } catch (err) {
      toast(err.message || '備份建立失敗');
    } finally {
      buttons.forEach(btn => { btn.disabled = false; btn.textContent = btn.dataset.originalText || '建立並下載備份'; delete btn.dataset.originalText; });
    }
  }

  async function resetAll(){
    const ok = await confirmDialog('確定要初始化整個 OBS Live Helper 嗎？\n\n這會清空本機設定、Spotify token、Discord StreamKit URL、點歌設定、自訂文字、Overlay 設定、歌詞 log、LRCLib 快取與上傳字型。建議先下載備份。\n\n操作完成後需要重啟 npm start。', {
      title: '初始化整個軟體',
      okText: '確定初始化',
      cancelText: '取消'
    });
    if (!ok) return;

    try {
      const res = await fetch('/api/backup/reset-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || '初始化失敗');
      toast(data.message || '已初始化，請重啟 npm start');
      localStorage.clear();
    } catch (err) {
      toast(err.message || '初始化失敗');
    }
  }

  function setAllBackupOptions(checked){
    document.querySelectorAll('[data-backup-option]').forEach(el => { el.checked = checked; });
    scheduleRefreshVerification();
  }

  function installSettingsUI(){
    removeStartBackupContent();
    ensureSettingsStyle();

    const pane = document.querySelector('[data-dashboard-pane="settings"] .dashboardAccordionBody');
    if (!pane || pane.dataset.settingsExtraReady === 'true') return;
    pane.dataset.settingsExtraReady = 'true';

    document.getElementById('backupSummaryCount')?.classList.add('backupSummaryStable');
    document.getElementById('backupSummarySize')?.classList.add('backupSummaryStable');
    document.getElementById('backupSummaryDataDir')?.classList.add('backupSummaryCodeStable');
    ensureVerificationSkeleton();

    const oldIntro = pane.querySelector('.introText');
    if (oldIntro) {
      oldIntro.innerHTML = '在這裡選擇要備份的內容，並檢查備份是否包含重要設定。<code>.env</code> 會包含 Spotify Client ID 與 Discord StreamKit URL；小目標與時鐘設定位於 <code>storage/overlay-config.json</code>。';
    }

    const options = document.createElement('div');
    options.innerHTML = `
      <div class="backupSelectToolbar">
        <button id="selectAllBackupOptionsBtn" class="btnGhost small" type="button">全選</button>
        <button id="clearAllBackupOptionsBtn" class="btnGhost small" type="button">全部取消</button>
      </div>
      <div class="backupOptionGrid">
        ${Object.entries(OPTION_LABELS).map(([key, label]) => `<label><input type="checkbox" data-backup-option="${key}" ${BACKUP_DEFAULTS[key] ? 'checked' : ''}> <span>${label}</span></label>`).join('')}
      </div>
    `;
    pane.insertBefore(options, pane.querySelector('.btnRow'));

    const btnRow = pane.querySelector('.btnRow');
    if (btnRow && !document.getElementById('resetAllSettingsBtn')) {
      const resetBtn = document.createElement('button');
      resetBtn.id = 'resetAllSettingsBtn';
      resetBtn.className = 'btnDanger';
      resetBtn.type = 'button';
      resetBtn.textContent = '初始化整個軟體';
      btnRow.appendChild(resetBtn);
      resetBtn.addEventListener('click', resetAll);
    }

    document.getElementById('selectAllBackupOptionsBtn')?.addEventListener('click', () => setAllBackupOptions(true));
    document.getElementById('clearAllBackupOptionsBtn')?.addEventListener('click', () => setAllBackupOptions(false));

    document.querySelectorAll('[data-backup-option]').forEach(el => {
      el.addEventListener('change', scheduleRefreshVerification);
    });

    const refreshBtn = document.getElementById('refreshBackupVerificationBtn');
    refreshBtn?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      refreshVerification({ silent: false });
    }, true);

    const backupBtn = document.getElementById('settingsTabBackupBtn');
    backupBtn?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadSelectedBackup();
    }, true);

    refreshVerification({ silent: true });
  }

  waitForElement('[data-dashboard-pane="settings"]').then(installSettingsUI);

  document.addEventListener('click', event => {
    if (event.target?.matches?.('[data-dashboard-tab="settings"]')) {
      setTimeout(() => {
        installSettingsUI();
        refreshVerification({ silent: true });
      }, 60);
    }
  });
})();
