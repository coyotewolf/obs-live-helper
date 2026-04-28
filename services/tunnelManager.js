const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const PUBLIC_URL_FILE = path.join(STORAGE_DIR, 'public-url.json');
const TRY_CLOUDFLARE_RE = /https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/g;

let child = null;
let state = {
  enabled: String(process.env.ENABLE_PUBLIC_TUNNEL || '').toLowerCase() === 'true',
  running: false,
  provider: 'cloudflare-quick-tunnel',
  publicUrl: '',
  lastError: '',
  logs: [],
  updatedAt: null
};

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function pushLog(line) {
  const text = String(line || '').trim();
  if (!text) return;
  state.logs.push(text);
  state.logs = state.logs.slice(-40);
}

function persistPublicUrl(url) {
  ensureStorageDir();
  fs.writeFileSync(PUBLIC_URL_FILE, JSON.stringify({ publicUrl: url, updatedAt: new Date().toISOString() }, null, 2));
}

function readPersistedPublicUrl() {
  if (!fs.existsSync(PUBLIC_URL_FILE)) return '';
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, 'utf8')).publicUrl || '';
  } catch {
    return '';
  }
}

function extractUrl(text) {
  const matches = String(text || '').match(TRY_CLOUDFLARE_RE);
  return matches?.[0] || '';
}

function getStatus() {
  return {
    ...state,
    publicUrl: state.publicUrl || readPersistedPublicUrl(),
    pid: child?.pid || null
  };
}

function stopTunnel() {
  if (child) {
    try { child.kill(); } catch {}
  }
  child = null;
  state.running = false;
  state.updatedAt = new Date().toISOString();
}

function startTunnel(port = process.env.PORT || 5172) {
  if (child && state.running) return getStatus();

  state.enabled = true;
  state.running = false;
  state.lastError = '';
  state.updatedAt = new Date().toISOString();
  pushLog(`Starting Cloudflare Quick Tunnel for http://127.0.0.1:${port}`);

  try {
    child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (err) {
    state.lastError = `cloudflared 啟動失敗：${err.message}`;
    pushLog(state.lastError);
    return getStatus();
  }

  state.running = true;

  const onData = (buf) => {
    const text = buf.toString();
    pushLog(text);
    const url = extractUrl(text);
    if (url) {
      state.publicUrl = url;
      state.updatedAt = new Date().toISOString();
      persistPublicUrl(url);
      console.log(`🌍 Cloudflare Tunnel ready: ${url}`);
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', err => {
    state.running = false;
    state.lastError = `cloudflared 錯誤：${err.message}`;
    pushLog(state.lastError);
  });

  child.on('exit', (code, signal) => {
    state.running = false;
    child = null;
    const msg = `cloudflared stopped. code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    state.lastError = code === 0 ? '' : msg;
    state.updatedAt = new Date().toISOString();
    pushLog(msg);
  });

  return getStatus();
}

function startIfEnabled(port) {
  if (state.enabled) startTunnel(port);
}

function restartTunnel(port) {
  stopTunnel();
  return startTunnel(port);
}

module.exports = {
  getStatus,
  startTunnel,
  stopTunnel,
  restartTunnel,
  startIfEnabled
};
