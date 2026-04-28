/**
 * server.js
 * -------------------------------------------
 * Local OBS helper server.
 * Security notes:
 * - Dashboard is local-only by default. Public tunnels can serve request.html,
 *   overlays, and APIs, but dashboard.html requires localhost or ?admin=<token>.
 * - Spotify tokens stay in storage/spotify.json on the local machine.
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { getAdminToken, isLocalRequest } = require('./services/securityStore');

const app = express();
const PORT = process.env.PORT || 5172;

/* ---------- Basic settings ---------- */
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '2mb', type: 'text/plain' }));

/* ---------- Runtime directories ---------- */
const storageDir = path.join(__dirname, 'storage');
const lyricsDir = path.join(__dirname, 'lyrics');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
if (!fs.existsSync(lyricsDir)) fs.mkdirSync(lyricsDir, { recursive: true });

/* ---------- Dashboard guard before static files ---------- */
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

/* ---------- Static files ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lyrics', express.static(lyricsDir, {
  etag: false,
  lastModified: false,
  maxAge: 0
}));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts')));
app.use(express.static(storageDir));

/* ---------- /style.css for message.html ---------- */
const stylePath = path.join(storageDir, 'style.css');

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

/* ---------- APIs ---------- */
app.use('/api/editor', require('./routes/editor'));
app.use('/api', require('./routes'));
app.use('/api/font', require('./routes/font'));

/* ---------- Lyrics sync ---------- */
const { startLyricSync } = require('./services/lyricsFetcher');
startLyricSync();

/* ---------- Optional public tunnel ---------- */
const tunnelManager = require('./services/tunnelManager');

app.listen(PORT, () => {
  console.log('Server running on', PORT);
  console.log('Dashboard:', `http://127.0.0.1:${PORT}/html/dashboard.html`);
  console.log('Audience page will be generated in Dashboard.');
  tunnelManager.startIfEnabled(PORT);
});
