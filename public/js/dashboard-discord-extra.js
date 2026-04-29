(() => {
  const $ = id => document.getElementById(id);
  const getLocalUrl = path => `${location.origin}${path}`;

  function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function addDiscordOverlayCard() {
    const grid = document.querySelector('.overlayGrid');
    if (!grid || $('discordAvatarUrl')) return;

    const article = document.createElement('article');
    article.className = 'overlayCard panel';
    article.innerHTML = `
      <div class="overlayIcon">DC</div>
      <div class="overlayBody">
        <h3>Discord 語音頭貼 Overlay</h3>
        <p>顯示 Discord 語音頻道中正在說話的使用者頭貼，套用 OBS Live Helper 風格光暈。</p>
        <code id="discordAvatarUrl"></code>
      </div>
      <div class="overlayActions">
        <a href="/html/dcprofilepic.html" target="_blank">預覽</a>
        <button class="btnMini" type="button" data-discord-copy>複製</button>
      </div>
    `;
    grid.appendChild(article);

    const urlEl = $('discordAvatarUrl');
    if (urlEl) urlEl.textContent = getLocalUrl('/html/dcprofilepic.html');

    article.querySelector('[data-discord-copy]')?.addEventListener('click', async () => {
      const text = urlEl?.textContent?.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast('已複製 Discord Overlay URL');
      } catch {
        showToast('無法自動複製，請手動選取 URL');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addDiscordOverlayCard);
  } else {
    addDiscordOverlayCard();
  }
})();
