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
const { getAdminToken, isLocalRequest } = require('./services/securityStore');

const app = express();
const PORT = process.env.PORT || 5172;

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


// ---------- Spotify Client ID setup ----------
const REQUIRED_REDIRECT_URI = `http://127.0.0.1:${PORT}/api/spotify/callback`;

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
  const order = ['PORT', 'CLIENT_ID', 'REDIRECT_URI', 'ENABLE_PUBLIC_TUNNEL', 'CLOUDFLARED_PATH'];
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

function hasSpotifyClientId() {
  return Boolean(getConfiguredClientId());
}

app.get('/api/config/status', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: 'local_only' });
  const clientId = getConfiguredClientId();
  res.json({
    ok: true,
    configured: Boolean(clientId),
    clientIdMasked: clientId ? `${clientId.slice(0, 6)}...${clientId.slice(-4)}` : '',
    redirectUri: REQUIRED_REDIRECT_URI,
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

  res.json({ ok: true, configured: true, redirectUri: REQUIRED_REDIRECT_URI });
});

function spotifyClientSetupGuard(req, res, next) {
  const pathname = req.path.replace(/\\/g, '/');
  if ((pathname.endsWith('/html/dashboard.html') || pathname === '/dashboard.html') && !hasSpotifyClientId()) {
    return res.redirect('/html/setup.html');
  }
  next();
}
app.use(spotifyClientSetupGuard);


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

async function shutdown() {
  try { stopLyricSync?.(); } catch {}
  try { tunnelManager.stopTunnel?.(); } catch {}
  await new Promise(resolve => server.close(() => resolve()));
}

module.exports = { app, server, shutdown };
