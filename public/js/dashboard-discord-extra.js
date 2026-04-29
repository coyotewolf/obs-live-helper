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
