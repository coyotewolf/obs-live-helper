const $ = id => document.getElementById(id);
const statusBox = $('statusBox');
const redirectUriEl = $('redirectUri');
const clientIdInput = $('clientIdInput');
const copyRedirectBtn = $('copyRedirectBtn');
const saveBtn = $('saveBtn');
const toast = $('toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function loadStatus() {
  try {
    const data = await fetch('/api/config/status', { cache: 'no-store' }).then(r => r.json());
    if (!data.ok) throw new Error('status failed');
    redirectUriEl.textContent = data.redirectUri;
    statusBox.textContent = data.configured
      ? `目前已設定 Client ID：${data.clientIdMasked}。可以更新後重新儲存，或直接進入控制台。`
      : '尚未設定 Client ID。請依照下方步驟完成第一次設定。';
    statusBox.classList.toggle('isOk', Boolean(data.configured));
    if (data.configured) {
      const go = document.createElement('a');
      go.href = '/html/dashboard.html';
      go.className = 'btnGhost inlineGo';
      go.textContent = '前往控制台';
      statusBox.appendChild(go);
    }
  } catch (err) {
    statusBox.textContent = '無法讀取設定狀態，請確認程式仍在執行。';
    statusBox.classList.add('isError');
  }
}

copyRedirectBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(redirectUriEl.textContent.trim());
    showToast('Redirect URI 已複製');
  } catch {
    showToast('無法自動複製，請手動選取');
  }
});

saveBtn.addEventListener('click', async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    showToast('請先貼上 Spotify Client ID');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '儲存中...';
  try {
    const res = await fetch('/api/config/client-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || '儲存失敗');
    showToast('Client ID 已儲存');
    setTimeout(() => { location.href = '/html/dashboard.html'; }, 700);
  } catch (err) {
    showToast(err.message || '儲存失敗');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存並前往控制台';
  }
});

loadStatus();
