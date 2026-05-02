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
