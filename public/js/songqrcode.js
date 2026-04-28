const INFO_URL = '/api/request/qr-info';

const card = document.getElementById('qrCard');
const qrImage = document.getElementById('qrImage');
const qrHint = document.getElementById('qrHint');
const qrPin = document.getElementById('qrPin');

function setState(state) {
  card.classList.toggle('loading', state === 'loading');
  card.classList.toggle('error', state === 'error');
}

function shortUrl(url = '') {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function render(data) {
  if (!data?.ok || !data.qrDataUrl) {
    throw new Error(data?.message || 'QR Code 尚未產生');
  }

  setState('ready');
  qrImage.src = data.qrDataUrl;
  qrImage.style.display = 'block';
  qrPin.textContent = `PIN ${data.pin || '------'}`;

  const tunnel = data.urls?.tunnel || {};
  const isPublic = Boolean(data.urls?.publicUrl || tunnel.publicUrl);
  const isLan = !isPublic && Boolean(data.urls?.lanUrl);

  if (isPublic) {
    qrHint.textContent = `外網點歌｜${shortUrl(data.url)}`;
  } else if (isLan) {
    qrHint.textContent = '區網點歌｜同一個 Wi‑Fi 才能掃';
  } else {
    qrHint.textContent = '本機預覽｜請先啟動 Tunnel';
  }
}

async function loadQrInfo() {
  try {
    const res = await fetch(`${INFO_URL}?_t=${Date.now()}`);
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.message || '讀取 QR Code 失敗');
    render(data);
  } catch (err) {
    console.error('Failed to load QR info:', err);
    setState('error');
    qrHint.textContent = err.message || 'QR Code 讀取失敗';
    qrPin.textContent = '請確認用 127.0.0.1 開啟此 OBS 頁面';
  }
}

setState('loading');
loadQrInfo();
setInterval(loadQrInfo, 5000);
