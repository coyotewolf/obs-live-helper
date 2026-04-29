const $ = id => document.getElementById(id);
const statusBox = $('statusBox');
const redirectUriEl = $('redirectUri');
const clientIdInput = $('clientIdInput');
const streamKitInput = $('streamKitInput');
const copyRedirectBtn = $('copyRedirectBtn');
const saveClientIdBtn = $('saveClientIdBtn');
const saveStreamKitBtn = $('saveStreamKitBtn');
const useDefaultStreamKitBtn = $('useDefaultStreamKitBtn');
const goDashboardBtn = $('goDashboardBtn');
const toast = $('toast');

let latestStatus = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function renderStatus(data) {
  latestStatus = data;
  redirectUriEl.textContent = data.redirectUri;

  if (data.streamKitUrl && !streamKitInput.value.trim()) {
    streamKitInput.value = data.streamKitUrl;
  }

  const spotify = data.spotifyConfigured ? `✅ Spotify Client ID：${data.clientIdMasked}` : '❌ 尚未設定 Spotify Client ID';
  const streamKit = data.streamKitConfigured ? '✅ Discord StreamKit URL 已設定' : '❌ 尚未設定 Discord StreamKit URL';
  statusBox.innerHTML = `${spotify}<br>${streamKit}`;
  statusBox.classList.toggle('isOk', Boolean(data.featuresFullyConfigured));
  statusBox.classList.toggle('isError', !data.featuresFullyConfigured);

  if (goDashboardBtn) {
    goDashboardBtn.classList.remove('disabledLink');
    goDashboardBtn.setAttribute('aria-disabled', 'false');
  }
}

async function loadStatus() {
  try {
    const data = await fetch('/api/config/status', { cache: 'no-store' }).then(r => r.json());
    if (!data.ok) throw new Error('status failed');
    renderStatus(data);
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

saveClientIdBtn.addEventListener('click', async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    showToast('請先貼上 Spotify Client ID');
    return;
  }

  saveClientIdBtn.disabled = true;
  saveClientIdBtn.textContent = '儲存中...';
  try {
    const res = await fetch('/api/config/client-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || '儲存失敗');
    showToast('Spotify Client ID 已儲存');
    await loadStatus();
  } catch (err) {
    showToast(err.message || '儲存失敗');
  } finally {
    saveClientIdBtn.disabled = false;
    saveClientIdBtn.textContent = '儲存 Spotify Client ID';
  }
});

useDefaultStreamKitBtn.addEventListener('click', () => {
  const defaultUrl = latestStatus?.streamKitDefaultUrl || '';
  if (!defaultUrl) {
    showToast('目前沒有內建範例 StreamKit URL，請貼上自己的 Discord StreamKit URL');
    return;
  }

  streamKitInput.value = defaultUrl;
  showToast('已填入範例 StreamKit URL，請確認是否要改成自己的頻道');
});

saveStreamKitBtn.addEventListener('click', async () => {
  const streamKitUrl = streamKitInput.value.trim();
  if (!streamKitUrl) {
    showToast('請先貼上 Discord StreamKit URL');
    return;
  }

  saveStreamKitBtn.disabled = true;
  saveStreamKitBtn.textContent = '儲存中...';
  try {
    const res = await fetch('/api/config/streamkit-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKitUrl })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || '儲存失敗');
    showToast('Discord StreamKit URL 已儲存');
    await loadStatus();
  } catch (err) {
    showToast(err.message || '儲存失敗');
  } finally {
    saveStreamKitBtn.disabled = false;
    saveStreamKitBtn.textContent = '儲存 StreamKit URL';
  }
});

goDashboardBtn?.addEventListener('click', () => {
  if (!latestStatus?.featuresFullyConfigured) {
    showToast('可以先進入控制台，但仍建議先完成 Spotify Client ID 與 Discord StreamKit URL 設定');
  }
});

loadStatus();
