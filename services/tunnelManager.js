const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { APP_ROOT_DIR, STORAGE_DIR, TOOLS_DIR, RESOURCE_DIR, storagePath, toolsPath } = require('./runtimePaths');

const ROOT_DIR = APP_ROOT_DIR;
const PUBLIC_URL_FILE = storagePath('public-url.json');
const TRY_CLOUDFLARE_RE = /https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/g;

const TUNNEL_HEALTH_CHECK_MS = Number(process.env.TUNNEL_HEALTH_CHECK_MS || 45000);
const TUNNEL_START_GRACE_MS = Number(process.env.TUNNEL_START_GRACE_MS || 20000);
const TUNNEL_RESTART_COOLDOWN_MS = Number(process.env.TUNNEL_RESTART_COOLDOWN_MS || 15000);
const TUNNEL_HEALTH_TIMEOUT_MS = Number(process.env.TUNNEL_HEALTH_TIMEOUT_MS || 6000);

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function readPublicUrlFile() {
  if (!fs.existsSync(PUBLIC_URL_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function envAutoOpenEnabled() {
  return String(process.env.ENABLE_PUBLIC_TUNNEL || '').toLowerCase() === 'true';
}

function getInitialAutoOpen() {
  const persisted = readPublicUrlFile();
  if (typeof persisted.autoOpenTunnel === 'boolean') return persisted.autoOpenTunnel;
  return envAutoOpenEnabled();
}

let child = null;
let healthCheckPromise = null;
const initialAutoOpen = getInitialAutoOpen();
let state = {
  enabled: initialAutoOpen,
  autoOpenTunnel: initialAutoOpen,
  running: false,
  provider: 'cloudflare-quick-tunnel',
  publicUrl: '',
  manualPublicUrl: '',
  lastError: '',
  logs: [],
  updatedAt: null,
  startedAt: 0,
  lastHealthCheckAt: 0,
  lastHealthOkAt: 0,
  lastRestartAt: 0,
  restartCount: 0,
  executable: ''
};

function pushLog(line) {
  const text = String(line || '').trim();
  if (!text) return;
  state.logs.push(text);
  state.logs = state.logs.slice(-100);
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

function persistPublicUrl(patch) {
  ensureStorageDir();
  const current = readPublicUrlFile();
  fs.writeFileSync(PUBLIC_URL_FILE, JSON.stringify({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  }, null, 2));
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

  candidates.push(toolsPath(exe));
  candidates.push(path.join(ROOT_DIR, 'tools', exe));
  candidates.push(path.join(RESOURCE_DIR, 'tools', exe));
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
  const autoOpenTunnel = typeof persisted.autoOpenTunnel === 'boolean' ? persisted.autoOpenTunnel : state.autoOpenTunnel;

  // Quick Tunnel URLs are temporary. Do not reuse the persisted publicUrl after restart,
  // otherwise QR Code may keep showing an expired trycloudflare URL.
  const tunnelUrl = state.publicUrl || '';

  return {
    ...state,
    autoOpenTunnel,
    manualPublicUrl: manual,
    publicUrl: tunnelUrl || manual,
    tunnelUrl,
    pid: child?.pid || null,
    executable: state.executable || resolveExecutable()
  };
}

function stopTunnel(options = {}) {
  const { disableAutoOpen = true } = options;
  if (child) {
    try { child.kill(); } catch {}
  }
  child = null;
  state.running = false;
  state.updatedAt = new Date().toISOString();

  if (disableAutoOpen) {
    state.enabled = false;
    state.autoOpenTunnel = false;
    persistPublicUrl({ autoOpenTunnel: false, publicUrl: '' });
    pushLog('Tunnel stopped and auto-open disabled.');
  }
}

function startTunnel(port = process.env.PORT || 5172) {
  if (child && state.running) return getStatus();

  // Manual start keeps health checks enabled for the current session. It does not
  // persist auto-open unless setAutoOpenTunnel(true) is called.
  state.enabled = true;
  state.running = false;
  state.lastError = '';
  state.publicUrl = '';
  state.startedAt = Date.now();
  state.lastHealthCheckAt = 0;
  state.lastHealthOkAt = 0;
  state.updatedAt = new Date().toISOString();
  persistPublicUrl({ publicUrl: '' });

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
      state.lastError = '';
      state.lastHealthOkAt = Date.now();
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
    state.publicUrl = '';
    persistPublicUrl({ publicUrl: '' });
    const msg = `cloudflared stopped. code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    state.lastError = code === 0 ? '' : msg;
    state.updatedAt = new Date().toISOString();
    pushLog(msg);
  });

  return getStatus();
}

function setAutoOpenTunnel(enabled, port = process.env.PORT || 5172) {
  const autoOpenTunnel = Boolean(enabled);
  state.autoOpenTunnel = autoOpenTunnel;
  state.enabled = autoOpenTunnel;
  persistPublicUrl({ autoOpenTunnel });

  if (autoOpenTunnel) {
    pushLog('Tunnel auto-open enabled.');
    startTunnel(port);
  } else {
    pushLog('Tunnel auto-open disabled. Current tunnel process is unchanged until Stop is pressed.');
  }

  return getStatus();
}

function startIfEnabled(port) {
  state.autoOpenTunnel = getInitialAutoOpen();
  state.enabled = state.autoOpenTunnel;
  if (state.enabled) startTunnel(port);
}

function restartTunnel(port) {
  const now = Date.now();
  if (now - state.lastRestartAt < TUNNEL_RESTART_COOLDOWN_MS) return getStatus();
  state.lastRestartAt = now;
  state.restartCount += 1;
  pushLog(`Restarting Cloudflare Quick Tunnel automatically (#${state.restartCount}).`);
  stopTunnel({ disableAutoOpen: false });
  return startTunnel(port);
}

async function checkTunnelUrl(publicUrl) {
  const base = normalizeBaseUrl(publicUrl);
  if (!base) return false;

  const { status } = await axios.get(`${base}/api/hello?_t=${Date.now()}`, {
    timeout: TUNNEL_HEALTH_TIMEOUT_MS,
    validateStatus: s => s >= 200 && s < 500
  });

  return status >= 200 && status < 500;
}

async function ensureTunnelAlive(port = process.env.PORT || 5172) {
  if (!state.enabled) return getStatus();

  const now = Date.now();

  if (!child && !state.running) {
    pushLog('Tunnel is enabled but process is not running. Starting again.');
    return startTunnel(port);
  }

  if (state.running && !state.publicUrl) {
    if (state.startedAt && now - state.startedAt > TUNNEL_START_GRACE_MS) {
      state.lastError = 'Tunnel 啟動太久仍未取得外網網址，正在自動重啟。';
      pushLog(state.lastError);
      return restartTunnel(port);
    }
    return getStatus();
  }

  if (!state.publicUrl) return getStatus();
  if (healthCheckPromise) return healthCheckPromise;
  if (now - state.lastHealthCheckAt < TUNNEL_HEALTH_CHECK_MS) return getStatus();

  state.lastHealthCheckAt = now;
  healthCheckPromise = (async () => {
    try {
      const ok = await checkTunnelUrl(state.publicUrl);
      if (ok) {
        state.lastHealthOkAt = Date.now();
        state.lastError = '';
        return getStatus();
      }
      state.lastError = 'Tunnel 外網網址健康檢查失敗，正在自動重啟。';
      pushLog(state.lastError);
      return restartTunnel(port);
    } catch (err) {
      state.lastError = `Tunnel 外網網址可能已失效：${err.message}，正在自動重啟。`;
      pushLog(state.lastError);
      return restartTunnel(port);
    } finally {
      healthCheckPromise = null;
    }
  })();

  return healthCheckPromise;
}

module.exports = {
  getStatus,
  startTunnel,
  stopTunnel,
  restartTunnel,
  startIfEnabled,
  ensureTunnelAlive,
  setManualPublicUrl,
  setAutoOpenTunnel,
  normalizeBaseUrl,
  resolveExecutable
};
