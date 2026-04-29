/**
 * server.js
 * -------------------------------------------
 * Local OBS helper server.
 * Packaged Electron builds must not write to Program Files/resources/app.
 * All mutable files are routed through services/runtimePaths.js.
 */

const runtimePaths = require('./services/runtimePaths');
runtimePaths.ensureRuntimeDirs();
require('dotenv').config({ path: runtimePaths.ENV_PATH });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { getAdminToken, isLocalRequest } = require('./services/securityStore');

const app = express();
const PORT = process.env.PORT || 5172;
const DISCORD_STREAMKIT_ORIGIN = 'https://streamkit.discord.com';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '2mb', type: 'text/plain' }));

function dashboardGuard(req, res, next) {
  const pathname = req.path.replace(/\\/g, '/');
  if (!pathname.endsWith('/html/dashboard.html') && pathname !== '/dashboard.html') return next();

  const provided = String(req.query.admin || req.headers['x-admin-token'] || '').trim();
  if (isLocalRequest(req) || (provided && provided === getAdminToken())) return next();

  return res.status(403).send(`
    <meta charset="utf-8">
    <title>Dashboard blocked</title>
    <body style="font-family: system-ui; padding: 32px; line-height: 1.6;">
      <h1>Dashboard 已被保護</h1>
      <p>請從本機開啟 <code>http://127.0.0.1:${PORT}/html/dashboard.html</code>。</p>
      <p>觀眾只需要使用 QR Code 的 <code>request.html</code>，不應進入管理頁。</p>
    </body>
  `);
}
app.use(dashboardGuard);

// ---------- First launch setup ----------
const REQUIRED_REDIRECT_URI = `http://127.0.0.1:${PORT}/api/spotify/callback`;
const DEFAULT_STREAMKIT_URL = '';

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function writeEnvFile(filePath, patch) {
  const current = parseEnvFile(filePath);
  const next = { ...current, ...patch };
  const order = [
    'PORT',
    'CLIENT_ID',
    'REDIRECT_URI',
    'DISCORD_STREAMKIT_URL',
    'ENABLE_PUBLIC_TUNNEL',
    'CLOUDFLARED_PATH'
  ];
  const keys = [...order, ...Object.keys(next).filter(k => !order.includes(k))];
  const lines = ['# OBS Live Helper local settings', '# This file stays on this computer. Do not share it.'];
  for (const key of keys) {
    if (next[key] !== undefined && next[key] !== null && String(next[key]).length > 0) {
      lines.push(`${key}=${next[key]}`);
    }
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function getConfiguredClientId() {
  const fromProcess = String(process.env.CLIENT_ID || '').trim();
  if (fromProcess && !/^請|your_|paste_|replace_|TODO/i.test(fromProcess)) return fromProcess;
  const fromFile = String(parseEnvFile(runtimePaths.ENV_PATH).CLIENT_ID || '').trim();
  if (fromFile && !/^請|your_|paste_|replace_|TODO/i.test(fromFile)) return fromFile;
  return '';
}

function normalizeStreamKitUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /^請|your_|paste_|replace_|TODO/i.test(raw)) return '';

  try {
    const url = new URL(raw);
    const isStreamKit = url.hostname === 'streamkit.discord.com' && url.pathname.startsWith('/overlay/voice/');
    if (!isStreamKit) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function getConfiguredStreamKitUrl() {
  const fromProcess = normalizeStreamKitUrl(process.env.DISCORD_STREAMKIT_URL);
  if (fromProcess) return fromProcess;
  const fromFile = normalizeStreamKitUrl(parseEnvFile(runtimePaths.ENV_PATH).DISCORD_STREAMKIT_URL);
  if (fromFile) return fromFile;
  return '';
}

function buildLocalStreamKitProxyUrl(streamKitUrl) {
  const normalized = normalizeStreamKitUrl(streamKitUrl);
  if (!normalized) return '';
  const url = new URL(normalized);
  const match = url.pathname.match(/^\/overlay\/voice\/(\d{10,30})\/(\d{10,30})/);
  if (!match) return '';
  return `/overlay/voice/${match[1]}/${match[2]}?${url.searchParams.toString()}`;
}

function hasFirstLaunchConfig() {
  return Boolean(getConfiguredClientId() && getConfiguredStreamKitUrl());
}

app.get('/api/config/status', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: 'local_only' });
  const clientId = getConfiguredClientId();
  const streamKitUrl = getConfiguredStreamKitUrl();
  res.json({
    ok: true,
    configured: Boolean(clientId && streamKitUrl),
    spotifyConfigured: Boolean(clientId),
    streamKitConfigured: Boolean(streamKitUrl),
    clientIdMasked: clientId ? `${clientId.slice(0, 6)}...${clientId.slice(-4)}` : '',
    redirectUri: REQUIRED_REDIRECT_URI,
    streamKitUrl,
    streamKitDefaultUrl: DEFAULT_STREAMKIT_URL,
    streamKitProxyUrl: buildLocalStreamKitProxyUrl(streamKitUrl || DEFAULT_STREAMKIT_URL),
    envPath: runtimePaths.ENV_PATH,
    dataDir: runtimePaths.DATA_DIR
  });
});

app.post('/api/config/client-id', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: 'local_only', message: 'Client ID 設定只能從本機修改。' });
  const clientId = String(req.body?.clientId || '').trim();
  if (!/^[A-Za-z0-9]{20,80}$/.test(clientId)) {
    return res.status(400).json({ ok: false, error: 'invalid_client_id', message: 'Client ID 格式看起來不正確，請確認是 Spotify Developer Dashboard 裡的 Client ID。' });
  }

  const previous = getConfiguredClientId();
  writeEnvFile(runtimePaths.ENV_PATH, {
    PORT: String(PORT),
    CLIENT_ID: clientId,
    REDIRECT_URI: REQUIRED_REDIRECT_URI,
    ENABLE_PUBLIC_TUNNEL: process.env.ENABLE_PUBLIC_TUNNEL || 'false'
  });
  process.env.CLIENT_ID = clientId;
  process.env.REDIRECT_URI = REQUIRED_REDIRECT_URI;

  if (previous && previous !== clientId) {
    try { fs.unlinkSync(runtimePaths.storagePath('spotify.json')); } catch {}
  }

  res.json({ ok: true, configured: hasFirstLaunchConfig(), redirectUri: REQUIRED_REDIRECT_URI });
});

app.post('/api/config/streamkit-url', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: 'local_only', message: 'Discord StreamKit 設定只能從本機修改。' });
  const streamKitUrl = normalizeStreamKitUrl(req.body?.streamKitUrl);
  if (!streamKitUrl) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_streamkit_url',
      message: 'Discord StreamKit URL 格式不正確，請貼上 https://streamkit.discord.com/overlay/voice/... 的完整網址。'
    });
  }

  writeEnvFile(runtimePaths.ENV_PATH, {
    PORT: String(PORT),
    REDIRECT_URI: REQUIRED_REDIRECT_URI,
    DISCORD_STREAMKIT_URL: streamKitUrl,
    ENABLE_PUBLIC_TUNNEL: process.env.ENABLE_PUBLIC_TUNNEL || 'false'
  });
  process.env.DISCORD_STREAMKIT_URL = streamKitUrl;

  res.json({
    ok: true,
    configured: hasFirstLaunchConfig(),
    streamKitUrl,
    streamKitProxyUrl: buildLocalStreamKitProxyUrl(streamKitUrl)
  });
});

app.get('/api/config/discord-streamkit', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: 'local_only' });
  const streamKitUrl = getConfiguredStreamKitUrl() || DEFAULT_STREAMKIT_URL;
  res.json({
    ok: true,
    streamKitUrl,
    streamKitProxyUrl: buildLocalStreamKitProxyUrl(streamKitUrl),
    configured: Boolean(getConfiguredStreamKitUrl())
  });
});

function firstLaunchSetupGuard(req, res, next) {
  const pathname = req.path.replace(/\\/g, '/');
  if ((pathname.endsWith('/html/dashboard.html') || pathname === '/dashboard.html') && !hasFirstLaunchConfig()) {
    return res.redirect('/html/setup.html');
  }
  next();
}
app.use(firstLaunchSetupGuard);

// ---------- Dashboard extension injection ----------
// Keep the original dashboard.html usable, but add scripts that insert / update small cards and onboarding text.
app.get('/html/dashboard.html', (req, res, next) => {
  const dashboardPath = path.join(runtimePaths.PUBLIC_DIR, 'html', 'dashboard.html');
  fs.readFile(dashboardPath, 'utf8', (err, html) => {
    if (err) return next(err);
    if (!html.includes('dashboard-discord-extra.js')) {
      html = html.replace('</body>', '<script src="../js/dashboard-discord-extra.js"></script>\n</body>');
    }
    if (!html.includes('dashboard-onboarding-extra.js')) {
      html = html.replace('</body>', '<script src="../js/dashboard-onboarding-extra.js"></script>\n</body>');
    }
    res.type('html').send(html);
  });
});

// ---------- Discord StreamKit local proxy ----------
const discordProfileRouter = require('./routes/discordProfile');

// StreamKit main overlay HTML and /overlay/token.
app.use('/overlay', discordProfileRouter);

// StreamKit React assets are referenced as absolute /static/... paths inside
// the proxied StreamKit HTML. These MUST be registered before express.static,
// otherwise the local public/static fallback returns HTML/404 and Chrome rejects
// CSS/JS because the MIME type is wrong.
app.use('/static', discordProfileRouter.staticRouter);
app.use('/asset-manifest.json', discordProfileRouter.proxyAsset('/asset-manifest.json'));
app.use('/manifest.json', discordProfileRouter.proxyAsset('/manifest.json'));
app.use('/favicon.ico', discordProfileRouter.proxyAsset('/favicon.ico'));
app.use('/cdn-cgi', discordProfileRouter.noOpScriptRouter);

app.use(express.static(runtimePaths.PUBLIC_DIR));
app.use('/lyrics', express.static(runtimePaths.LYRICS_DIR, {
  etag: false,
  lastModified: false,
  maxAge: 0
}));
app.use('/fonts', express.static(runtimePaths.FONTS_DIR));
app.use(express.static(runtimePaths.STORAGE_DIR));

const stylePath = runtimePaths.storagePath('style.css');

app.get('/style.css', (_, res) => {
  if (!fs.existsSync(stylePath)) {
    return res.type('text/css').send('html,body{background:transparent;margin:0;padding:0;}');
  }
  res.sendFile(stylePath);
});

app.post('/api/style/save', (req, res) => {
  const css = typeof req.body === 'string' ? req.body : req.body.css;
  if (!css) return res.status(400).send('missing css');

  fs.writeFile(stylePath, css, err => {
    if (err) {
      console.error('❌ style.css 寫入失敗：', err);
      return res.status(500).send('write fail');
    }
    console.log(`✅ style.css 已更新 (${Buffer.byteLength(css)} bytes)`);
    res.end('ok');
  });
});

app.use('/api/editor', require('./routes/editor'));
app.use('/api', require('./routes'));
app.use('/api/font', require('./routes/font'));

const { startLyricSync, stopLyricSync } = require('./services/lyricsFetcher');
startLyricSync();

const tunnelManager = require('./services/tunnelManager');

const server = app.listen(PORT, () => {
  console.log('Server running on', PORT);
  console.log('Dashboard:', `http://127.0.0.1:${PORT}/html/dashboard.html`);
  console.log('Runtime data:', runtimePaths.DATA_DIR);
  console.log('Audience page will be generated in Dashboard.');
  tunnelManager.startIfEnabled(PORT);
});

// ---------- Discord local RPC WebSocket bridge ----------
// StreamKit normally connects to Discord's local RPC websocket at ws://127.0.0.1:6463.
// When hosted from localhost:5172, Discord rejects the original origin. The injected
// StreamKit patch rewrites the browser connection to /discord-rpc, and this bridge
// forwards it to Discord RPC with Origin: https://streamkit.discord.com.
const discordRpcWss = new WebSocket.Server({ noServer: true });

function safeCloseWs(ws) {
  try {
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close();
  } catch {}
}

function bridgeDiscordRpc(clientWs, req) {
  const incomingUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const targetUrl = `ws://127.0.0.1:6463/${incomingUrl.search || ''}`;
  const targetWs = new WebSocket(targetUrl, {
    headers: {
      Origin: DISCORD_STREAMKIT_ORIGIN
    }
  });

  const queued = [];

  clientWs.on('message', data => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data);
    } else if (targetWs.readyState === WebSocket.CONNECTING) {
      queued.push(data);
    }
  });

  targetWs.on('open', () => {
    while (queued.length) targetWs.send(queued.shift());
  });

  targetWs.on('message', data => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    // StreamKit expects JSON strings. Avoid forwarding empty/null payloads.
    let payload = data;
    if (Buffer.isBuffer(data)) payload = data.toString('utf8');
    if (payload === null || payload === undefined || String(payload).trim() === '') return;

    clientWs.send(payload);
  });

  targetWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code || 1000, reason?.toString?.() || '');
    }
  });

  targetWs.on('error', err => {
    console.warn('Discord RPC target error:', err.message);
    safeCloseWs(clientWs);
  });

  clientWs.on('close', () => safeCloseWs(targetWs));
  clientWs.on('error', () => safeCloseWs(targetWs));
}

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  if (pathname !== '/discord-rpc') {
    socket.destroy();
    return;
  }

  discordRpcWss.handleUpgrade(req, socket, head, ws => {
    bridgeDiscordRpc(ws, req);
  });
});

async function shutdown() {
  try { stopLyricSync?.(); } catch {}
  try { tunnelManager.stopTunnel?.(); } catch {}
  try { discordRpcWss.close(); } catch {}
  await new Promise(resolve => server.close(() => resolve()));
}

module.exports = { app, server, shutdown };
