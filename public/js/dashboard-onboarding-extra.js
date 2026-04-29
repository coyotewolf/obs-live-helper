(function(){
  const $ = id => document.getElementById(id);
  const localUrl = path => `${location.origin}${path}`;

  function ensureHeroActions() {
    const heroActions = document.querySelector('.heroActions');
    if (!heroActions) return;

    if (!heroActions.querySelector('[data-setup-link]')) {
      const setup = document.createElement('a');
      setup.className = 'btnGhost';
      setup.href = '/html/setup.html';
      setup.dataset.setupLink = 'true';
      setup.textContent = '設定 Spotify / StreamKit';
      heroActions.prepend(setup);
    }
  }

  function updateHeroText() {
    const heroP = document.querySelector('.heroPanel p');
    if (heroP) {
      heroP.textContent = '集中管理 Spotify 歌詞、目前播放、佇列清單、自訂文字公告、Discord 語音頭貼與觀眾 QR Code 點歌。第一次使用請先完成 Spotify Client ID 與 Discord StreamKit URL 設定，再登入 Spotify，最後把需要的 Overlay URL 加到 OBS Browser Source。';
    }
  }

  function updateQuickStart() {
    const title = document.querySelector('.quickGuide h2');
    const grid = document.querySelector('.quickGuide .guideGrid');
    if (!grid) return;
    if (title) title.textContent = '第一次使用照這樣做';
    grid.innerHTML = `
      <article><strong>01 開啟軟體</strong><p>從 Start Menu 開啟 OBS Live Helper。第一次啟動時會自動進入設定頁，不需要使用者打開 terminal。</p></article>
      <article><strong>02 設定 Spotify Client ID</strong><p>到 Spotify Developer Dashboard 建立自己的 App，加入 Redirect URI，並把 Client ID 貼到設定頁。</p></article>
      <article><strong>03 設定 Discord StreamKit</strong><p>到 Discord StreamKit 產生自己的 Voice Overlay URL，貼到設定頁。這會供 <code>dcprofilepic.html</code> 使用。</p></article>
      <article><strong>04 登入 Spotify</strong><p>回到控制台按「登入 / 重新授權 Spotify」。如果更換 Client ID 或播放控制失敗，就重新授權一次。</p></article>
      <article><strong>05 加入 OBS</strong><p>在 OBS 新增 Browser Source，貼下方 Overlay URL，例如歌詞、目前播放、點歌 QR Code 或 Discord 語音頭貼。</p></article>
      <article><strong>06 開放觀眾點歌</strong><p>按「啟動 Tunnel」產生外網點歌網址，觀眾掃 QR Code 後即可送出點歌請求。</p></article>
    `;
  }

  function ensureDiscordUrl() {
    const dc = $('dcProfilePicUrl');
    if (dc) dc.textContent = localUrl('/html/dcprofilepic.html');
  }

  function ensureSpotifyRetryButton() {
    const titleRow = document.querySelector('#spotifyBlock .titleRow');
    if (!titleRow || $('manualSpotifyRetryBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'manualSpotifyRetryBtn';
    btn.type = 'button';
    btn.className = 'btnGhost small';
    btn.style.display = 'none';
    btn.textContent = '手動重試 Spotify';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '重試中...';
      try {
        const res = await fetch('/api/spotify/retry', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.message || '重試失敗');
        if (window.showToast) window.showToast('已解除 Spotify 限流鎖，下一次更新會重新嘗試');
        else alert('已解除 Spotify 限流鎖，下一次更新會重新嘗試');
      } catch (err) {
        alert(err.message || '重試失敗');
      } finally {
        btn.disabled = false;
        btn.textContent = '手動重試 Spotify';
        setTimeout(() => location.reload(), 600);
      }
    });

    titleRow.appendChild(btn);
  }

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/spotify/status') || url.endsWith('/api/spotify/status')) {
        const cloned = response.clone();
        cloned.json().then(data => {
          const btn = $('manualSpotifyRetryBtn');
          const sub = $('trackSubInfo');
          if (!btn) return;
          if (data?.rate_limited && data?.manual_retry_required) {
            btn.style.display = '';
            if (sub) {
              const raw = data.retry_after_raw ? `Retry-After=${data.retry_after_raw}` : 'Retry-After=not provided';
              sub.textContent = `Spotify API 已限流，已停止自動重試。請稍候再按「手動重試 Spotify」。${raw}`;
            }
          } else {
            btn.style.display = 'none';
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  function boot() {
    ensureHeroActions();
    updateHeroText();
    updateQuickStart();
    ensureDiscordUrl();
    ensureSpotifyRetryButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
