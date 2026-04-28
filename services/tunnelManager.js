const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.join(__dirname, '..');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const PUBLIC_URL_FILE = path.join(STORAGE_DIR, 'public-url.json');
const TRY_CLOUDFLARE_RE = /https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/g;

let child = null;
let state = {
  enabled: String(process.env.ENABLE_PUBLIC_TUNNEL || '').toLowerCase() === 'true',
  running: false,
  provider: 'cloudflare-quick-tunnel',
  publicUrl: '',
  manualPublicUrl: '',
  lastError: '',
  logs: [],
  updatedAt: null,
  executable: ''
};

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function pushLog(line) {
  const text = String(line || '').trim();
  if (!text) return;
  state.logs.push(text);
  state.logs = state.logs.slice(-80);
}

function normalizeBaseUrl(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function readPublicUrlFile() {
  if (!fs.existsSync(PUBLIC_URL_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function persistPublicUrl(patch) {
  ensureStorageDir();
  const current = readPublicUrlFile();
  fs.writeFileSync(PUBLIC_URL_FILE, JSON.stringify({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  }, null, 2));
}

function readPersistedPublicUrl() {
  const data = readPublicUrlFile();
  return data.publicUrl || data.manualPublicUrl || '';
}

function readManualPublicUrl() {
  return readPublicUrlFile().manualPublicUrl || '';
}

function setManualPublicUrl(url) {
  const manualPublicUrl = normalizeBaseUrl(url);
  state.manualPublicUrl = manualPublicUrl;
  persistPublicUrl({ manualPublicUrl });
  if (manualPublicUrl) pushLog(`Manual public URL set: ${manualPublicUrl}`);
  else pushLog('Manual public URL cleared.');
  return getStatus();
}

function extractUrl(text) {
  const matches = String(text || '').match(TRY_CLOUDFLARE_RE);
  return matches?.[0] || '';
}

function pathExists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function candidateExecutables() {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [];

  if (process.env.CLOUDFLARED_PATH) candidates.push(process.env.CLOUDFLARED_PATH);

  candidates.push(path.join(ROOT_DIR, 'tools', exe));
  candidates.push(path.join(ROOT_DIR, exe));

  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'Downloads', 'cloudflared.exe'));
    candidates.push(path.join(process.env.USERPROFILE, 'scoop', 'shims', 'cloudflared.exe'));
  }

  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'));
    candidates.push(path.join(process.env.ProgramFiles, 'Cloudflare', 'cloudflared.exe'));
  }

  candidates.push('cloudflared');
  if (isWin) candidates.push('cloudflared.exe');

  return [...new Set(candidates.filter(Boolean))];
}

function resolveExecutable() {
  for (const candidate of candidateExecutables()) {
    if (candidate.includes(path.sep) || candidate.includes('/') || candidate.includes('\\')) {
      if (pathExists(candidate)) return candidate;
    } else {
      return candidate; // Let PATH resolution handle it.
    }
  }
  return 'cloudflared';
}

function getStatus() {
  const persisted = readPublicUrlFile();
  const manual = state.manualPublicUrl || persisted.manualPublicUrl || '';
  const tunnelUrl = state.publicUrl || persisted.publicUrl || '';
  return {
    ...state,
    manualPublicUrl: manual,
    publicUrl: tunnelUrl || manual,
    tunnelUrl,
    pid: child?.pid || null,
    executable: state.executable || resolveExecutable()
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
  state.publicUrl = '';
  state.updatedAt = new Date().toISOString();

  const executable = resolveExecutable();
  state.executable = executable;
  pushLog(`Starting Cloudflare Quick Tunnel with ${executable} for http://127.0.0.1:${port}`);

  try {
    child = spawn(executable, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
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
      persistPublicUrl({ publicUrl: url });
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
  startIfEnabled,
  setManualPublicUrl,
  normalizeBaseUrl,
  resolveExecutable
};
