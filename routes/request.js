/**
 * Audience QR song request + optional remote Spotify controls.
 *
 * Safer model for livestream use:
 * - Audience only gets request.html?pin=XXXXXX.
 * - Dashboard/admin APIs require x-admin-token.
 * - Song requests can be auto-approved or held for review.
 * - Playback controls are controlled by Dashboard settings and blocked server-side.
 */
const router = require('express').Router();
const axios = require('axios');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('../services/spotifyAuth');
const {
  getSecurity,
  getRequestPin,
  rotateRequestPin,
  requireAdmin,
  isLocalRequest
} = require('../services/securityStore');
const tunnelManager = require('../services/tunnelManager');

const PORT = process.env.PORT || 5172;
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'request-settings.json');
const REQUESTS_FILE = path.join(STORAGE_DIR, 'song-requests.json');

const DEFAULT_SETTINGS = {
  requestsEnabled: true,
  autoApproveQueue: false,
  allowPlayNow: false,
  allowPlaybackControl: false,
  allowSkipControl: false,
  blockExplicit: false,
  cooldownSeconds: 60,
  controlCooldownSeconds: 10,
  duplicateWindowMinutes: 10,
  maxPending: 80
};

const requestCooldownMap = new Map();
const controlCooldownMap = new Map();
const recentTrackMap = new Map();

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureStorageDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`⚠️ ${path.basename(file)} 解析失敗，使用預設值。`, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureStorageDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getSettings() {
  return {
    ...DEFAULT_SETTINGS,
    ...(readJson(SETTINGS_FILE, {}) || {})
  };
}

function saveSettings(patch = {}) {
  const current = getSettings();
  const next = {
    ...current,
    requestsEnabled: Boolean(patch.requestsEnabled ?? current.requestsEnabled),
    autoApproveQueue: Boolean(patch.autoApproveQueue ?? current.autoApproveQueue),
    allowPlayNow: Boolean(patch.allowPlayNow ?? current.allowPlayNow),
    allowPlaybackControl: Boolean(patch.allowPlaybackControl ?? current.allowPlaybackControl),
    allowSkipControl: Boolean(patch.allowSkipControl ?? current.allowSkipControl),
    blockExplicit: Boolean(patch.blockExplicit ?? current.blockExplicit),
    cooldownSeconds: clampInt(patch.cooldownSeconds ?? current.cooldownSeconds, 0, 3600),
    controlCooldownSeconds: clampInt(patch.controlCooldownSeconds ?? current.controlCooldownSeconds, 0, 3600),
    duplicateWindowMinutes: clampInt(patch.duplicateWindowMinutes ?? current.duplicateWindowMinutes, 0, 1440),
    maxPending: clampInt(patch.maxPending ?? current.maxPending, 1, 300),
    updatedAt: new Date().toISOString()
  };
  writeJson(SETTINGS_FILE, next);
  return next;
}

function readRequests() {
  const list = readJson(REQUESTS_FILE, []);
  return Array.isArray(list) ? list : [];
}

function saveRequests(list) {
  writeJson(REQUESTS_FILE, list);
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function buildUrl(base, pin = getRequestPin()) {
  return `${base.replace(/\/$/, '')}/html/request.html?pin=${encodeURIComponent(pin)}`;
}

function getUrlBundle(pin = getRequestPin()) {
  const tunnel = tunnelManager.getStatus();
  const publicBase = tunnel.publicUrl || '';
  const lanBase = `http://${getLanIp()}:${PORT}`;
  const localBase = `http://127.0.0.1:${PORT}`;
  const preferredBase = publicBase || lanBase;

  return {
    publicUrl: publicBase ? buildUrl(publicBase, pin) : '',
    lanUrl: buildUrl(lanBase, pin),
    localUrl: buildUrl(localBase, pin),
    preferredUrl: buildUrl(preferredBase, pin),
    tunnel
  };
}

function normalizeTrack(item) {
  if (!item || item.type !== 'track') return null;
  const images = item.album?.images || [];
  const largestImage = images[0]?.url || '';
  const mediumImage = images[1]?.url || largestImage;
  const smallImage = images[2]?.url || mediumImage;
  return {
    id: item.id,
    uri: item.uri,
    name: item.name || '未知歌曲',
    artists: item.artists?.map(a => a.name).join(', ') || '未知歌手',
    album: item.album?.name || '',
    cover_url: mediumImage,
    cover_large_url: largestImage,
    cover_small_url: smallImage,
    duration_ms: item.duration_ms || 0,
    explicit: Boolean(item.explicit),
    external_url: item.external_urls?.spotify || ''
  };
}

function normalizeClientTrack(raw = {}) {
  const uri = String(raw.uri || '').trim();
  if (!uri.startsWith('spotify:track:')) return null;
  return {
    id: String(raw.id || uri.split(':').pop() || ''),
    uri,
    name: String(raw.name || '未知歌曲').slice(0, 220),
    artists: String(raw.artists || '未知歌手').slice(0, 220),
    album: String(raw.album || '').slice(0, 220),
    cover_url: String(raw.cover_url || '').slice(0, 1200),
    cover_large_url: String(raw.cover_large_url || raw.cover_url || '').slice(0, 1200),
    cover_small_url: String(raw.cover_small_url || raw.cover_url || '').slice(0, 1200),
    duration_ms: clampInt(raw.duration_ms || 0, 0, 1000 * 60 * 60 * 5),
    explicit: Boolean(raw.explicit),
    external_url: String(raw.external_url || '').slice(0, 1200)
  };
}

function getClientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function requirePin(req, res, next) {
  const provided = String(req.query.pin || req.body?.pin || '').toUpperCase();
  const expected = String(getRequestPin() || '').toUpperCase();
  if (!provided || provided !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'invalid_pin',
      message: 'QR Code 權限碼不正確，請重新掃描最新的 QR Code。'
    });
  }
  next();
}

async function getAuthorizedToken(res) {
  const access_token = await getAccessToken();
  if (!access_token) {
    res.status(401).json({
      ok: false,
      authorized: false,
      error: 'spotify_not_authorized',
      message: 'Spotify 尚未授權，請先在 Dashboard 登入 Spotify。'
    });
    return null;
  }
  return access_token;
}

function spotifyErrorResponse(res, err, fallback = 'Spotify 操作失敗') {
  const status = err.response?.status;
  const data = err.response?.data;
  console.error('request route spotify error:', data || err.message);

  if (status === 403) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden_or_missing_scope',
      message: 'Spotify 權限不足。請回 Dashboard 重新授權；播放控制需要 user-modify-playback-state，且通常需要 Premium。'
    });
  }
  if (status === 404) {
    return res.status(404).json({
      ok: false,
      error: 'no_active_device',
      message: '找不到正在播放的 Spotify 裝置。請先在電腦或手機打開 Spotify 並播放一首歌。'
    });
  }
  if (status === 429) {
    return res.status(429).json({ ok: false, error: 'rate_limited', message: '操作太頻繁，請稍後再試。' });
  }
  return res.status(status || 500).json({ ok: false, error: 'spotify_error', message: data?.error?.message || fallback });
}

async function addToQueue(uri, access_token) {
  await axios.post('https://api.spotify.com/v1/me/player/queue', null, {
    headers: { Authorization: `Bearer ${access_token}` },
    params: { uri }
  });
}

async function playNow(uri, access_token) {
  await axios.put('https://api.spotify.com/v1/me/player/play', { uris: [uri] }, {
    headers: { Authorization: `Bearer ${access_token}` }
  });
}

function cooldownCheck(map, key, seconds) {
  if (!seconds || seconds <= 0) return { ok: true };
  const now = Date.now();
  const prev = map.get(key) || 0;
  const waitMs = (seconds * 1000) - (now - prev);
  if (waitMs > 0) return { ok: false, waitSeconds: Math.ceil(waitMs / 1000) };
  map.set(key, now);
  return { ok: true };
}

function duplicateCheck(track, settings) {
  if (!settings.duplicateWindowMinutes || !track?.uri) return { ok: true };
  const now = Date.now();
  const windowMs = settings.duplicateWindowMinutes * 60 * 1000;
  for (const [uri, t] of recentTrackMap.entries()) {
    if (now - t > windowMs) recentTrackMap.delete(uri);
  }
  const prev = recentTrackMap.get(track.uri);
  if (prev && now - prev < windowMs) {
    return { ok: false, waitMinutes: Math.ceil((windowMs - (now - prev)) / 60000) };
  }
  recentTrackMap.set(track.uri, now);
  return { ok: true };
}

function makeRequest({ track, mode, nickname, ip }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    status: 'pending',
    mode,
    track,
    nickname: String(nickname || '匿名觀眾').slice(0, 40),
    ip,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function publicSettings(settings = getSettings()) {
  return {
    requestsEnabled: settings.requestsEnabled,
    autoApproveQueue: settings.autoApproveQueue,
    allowPlayNow: settings.allowPlayNow,
    allowPlaybackControl: settings.allowPlaybackControl,
    allowSkipControl: settings.allowSkipControl,
    blockExplicit: settings.blockExplicit,
    cooldownSeconds: settings.cooldownSeconds,
    controlCooldownSeconds: settings.controlCooldownSeconds
  };
}

async function buildQrDataUrl(url, options = {}) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    ...options
  });
}

async function buildQrOverlayDataUrl(url) {
  return buildQrDataUrl(url, {
    scale: 10,
    color: {
      dark: '#000000ff',
      light: '#ffffffcc'
    }
  });
}

/* Local-only bootstrap: lets the owner Dashboard obtain admin token without exposing it through a public tunnel. */
router.get('/admin-info', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ ok: false, error: 'local_only', message: '管理資訊只能從本機 localhost / 127.0.0.1 讀取。' });
  }

  const security = getSecurity();
  const urls = getUrlBundle(security.requestPin);
  const qrDataUrl = await buildQrDataUrl(urls.preferredUrl).catch(() => '');

  res.json({
    ok: true,
    adminToken: security.adminToken,
    pin: security.requestPin,
    settings: getSettings(),
    requests: readRequests().slice(-100).reverse(),
    urls,
    qrDataUrl
  });
});


/* Local-only OBS QR overlay endpoint. Does not expose adminToken. */
router.get('/qr-info', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: 'local_only',
      message: 'QR Overlay 資訊只能從本機 localhost / 127.0.0.1 讀取。'
    });
  }

  const security = getSecurity();
  const urls = getUrlBundle(security.requestPin);
  const preferredUrl = urls.publicUrl || urls.lanUrl || urls.localUrl;
  const qrDataUrl = await buildQrOverlayDataUrl(preferredUrl).catch(() => '');

  res.json({
    ok: true,
    pin: security.requestPin,
    url: preferredUrl,
    urls,
    qrDataUrl,
    settings: publicSettings(getSettings())
  });
});

router.get('/public-info', requirePin, (req, res) => {
  res.json({ ok: true, settings: publicSettings() });
});

router.get('/info', requireAdmin, async (req, res) => {
  const security = getSecurity();
  const urls = getUrlBundle(security.requestPin);
  const qrDataUrl = await buildQrDataUrl(urls.preferredUrl).catch(() => '');
  res.json({ ok: true, pin: security.requestPin, settings: getSettings(), urls, qrDataUrl });
});

router.post('/rotate-pin', requireAdmin, async (req, res) => {
  const security = rotateRequestPin();
  const urls = getUrlBundle(security.requestPin);
  const qrDataUrl = await buildQrDataUrl(urls.preferredUrl).catch(() => '');
  res.json({ ok: true, pin: security.requestPin, urls, qrDataUrl });
});

router.get('/settings', requireAdmin, (req, res) => {
  res.json({ ok: true, settings: getSettings() });
});

router.post('/settings', requireAdmin, (req, res) => {
  res.json({ ok: true, settings: saveSettings(req.body || {}) });
});

router.get('/list', requireAdmin, (req, res) => {
  res.json({ ok: true, requests: readRequests().slice(-100).reverse() });
});

router.post('/clear-finished', requireAdmin, (req, res) => {
  const keep = readRequests().filter(r => r.status === 'pending');
  saveRequests(keep);
  res.json({ ok: true, requests: keep.slice(-100).reverse() });
});

router.post('/tunnel/start', requireAdmin, (req, res) => {
  res.json({ ok: true, tunnel: tunnelManager.startTunnel(PORT) });
});

router.post('/tunnel/restart', requireAdmin, (req, res) => {
  res.json({ ok: true, tunnel: tunnelManager.restartTunnel(PORT) });
});

router.post('/tunnel/stop', requireAdmin, (req, res) => {
  tunnelManager.stopTunnel();
  res.json({ ok: true, tunnel: tunnelManager.getStatus() });
});

router.get('/tunnel/status', requireAdmin, (req, res) => {
  res.json({ ok: true, tunnel: tunnelManager.getStatus() });
});

router.get('/search', requirePin, async (req, res) => {
  const settings = getSettings();
  if (!settings.requestsEnabled) {
    return res.status(403).json({ ok: false, error: 'requests_disabled', message: '目前沒有開放觀眾點歌。' });
  }

  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, tracks: [] });

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;

  try {
    const { data } = await axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { q, type: 'track', limit: 8 }
    });
    res.json({ ok: true, tracks: (data.tracks?.items || []).map(normalizeTrack).filter(Boolean), settings: publicSettings(settings) });
  } catch (err) {
    if (err.response?.status === 403) {
      return res.status(403).json({
        ok: false,
        error: 'search_forbidden',
        message: 'Spotify 拒絕搜尋請求。請回 Dashboard 重新授權；如果仍失敗，請確認登入帳號已加入 Spotify Developer App 的使用者名單。搜尋本身不需要 Premium。'
      });
    }
    spotifyErrorResponse(res, err, '搜尋歌曲失敗');
  }
});

router.post('/submit', requirePin, async (req, res) => {
  const settings = getSettings();
  if (!settings.requestsEnabled) {
    return res.status(403).json({ ok: false, error: 'requests_disabled', message: '目前沒有開放觀眾點歌。' });
  }

  const ip = getClientIp(req);
  const cd = cooldownCheck(requestCooldownMap, ip, settings.cooldownSeconds);
  if (!cd.ok) {
    return res.status(429).json({ ok: false, error: 'cooldown', message: `點歌太快了，請 ${cd.waitSeconds} 秒後再試。` });
  }

  const track = normalizeClientTrack(req.body?.track || req.body || {});
  const mode = String(req.body?.mode || 'queue') === 'play-now' ? 'play-now' : 'queue';
  const nickname = req.body?.nickname;

  if (!track) return res.status(400).json({ ok: false, error: 'invalid_track', message: '歌曲資料不正確，請重新搜尋後再送出。' });
  if (settings.blockExplicit && track.explicit) return res.status(403).json({ ok: false, error: 'explicit_blocked', message: '目前不接受 Explicit 歌曲。' });

  const dup = duplicateCheck(track, settings);
  if (!dup.ok) return res.status(409).json({ ok: false, error: 'duplicate_track', message: `這首歌剛剛有人點過，約 ${dup.waitMinutes} 分鐘後可再點。` });

  const shouldAutoQueue = mode === 'queue' && settings.autoApproveQueue;
  const shouldPlayNow = mode === 'play-now' && settings.allowPlayNow;

  if (shouldAutoQueue || shouldPlayNow) {
    const access_token = await getAuthorizedToken(res);
    if (!access_token) return;
    try {
      if (shouldPlayNow) await playNow(track.uri, access_token);
      else await addToQueue(track.uri, access_token);

      const done = makeRequest({ track, mode, nickname, ip });
      done.status = shouldPlayNow ? 'played' : 'approved';
      done.updatedAt = new Date().toISOString();
      const list = readRequests();
      list.push(done);
      saveRequests(list.slice(-settings.maxPending));

      return res.json({ ok: true, status: done.status, message: shouldPlayNow ? '已立即插播。' : '已自動加入佇列。' });
    } catch (err) {
      return spotifyErrorResponse(res, err, shouldPlayNow ? '立即插播失敗' : '加入佇列失敗');
    }
  }

  const list = readRequests();
  const item = makeRequest({ track, mode, nickname, ip });
  list.push(item);
  saveRequests(list.slice(-settings.maxPending));
  return res.json({ ok: true, status: 'pending', message: mode === 'play-now' ? '已送出插播請求，等待管理員審核。' : '已送出點歌請求，等待管理員審核。' });
});

router.post('/approve', requireAdmin, async (req, res) => {
  const id = String(req.body?.id || '');
  const modeOverride = req.body?.mode === 'play-now' ? 'play-now' : null;
  const list = readRequests();
  const item = list.find(r => r.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'not_found', message: '找不到這筆點歌請求。' });

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;

  const mode = modeOverride || item.mode || 'queue';
  try {
    if (mode === 'play-now') await playNow(item.track.uri, access_token);
    else await addToQueue(item.track.uri, access_token);

    item.status = mode === 'play-now' ? 'played' : 'approved';
    item.mode = mode;
    item.updatedAt = new Date().toISOString();
    saveRequests(list);
    res.json({ ok: true, request: item, message: mode === 'play-now' ? '已立即插播。' : '已加入佇列。' });
  } catch (err) {
    spotifyErrorResponse(res, err, '審核點歌失敗');
  }
});

router.post('/reject', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '');
  const list = readRequests();
  const item = list.find(r => r.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'not_found', message: '找不到這筆點歌請求。' });
  item.status = 'rejected';
  item.updatedAt = new Date().toISOString();
  saveRequests(list);
  res.json({ ok: true, request: item, message: '已拒絕這筆點歌。' });
});

router.post('/control', requirePin, async (req, res) => {
  const settings = getSettings();
  const action = String(req.body?.action || '').trim();
  const playbackActions = ['play', 'pause'];
  const skipActions = ['next', 'previous'];

  if (playbackActions.includes(action) && !settings.allowPlaybackControl) {
    return res.status(403).json({ ok: false, error: 'control_disabled', message: '目前沒有開放觀眾播放 / 暫停。' });
  }
  if (skipActions.includes(action) && !settings.allowSkipControl) {
    return res.status(403).json({ ok: false, error: 'skip_disabled', message: '目前沒有開放觀眾切歌。' });
  }
  if (!playbackActions.includes(action) && !skipActions.includes(action)) {
    return res.status(400).json({ ok: false, error: 'invalid_action', message: '不支援的播放控制。' });
  }

  const ip = getClientIp(req);
  const cd = cooldownCheck(controlCooldownMap, `${ip}:${action}`, settings.controlCooldownSeconds);
  if (!cd.ok) return res.status(429).json({ ok: false, error: 'cooldown', message: `操作太快了，請 ${cd.waitSeconds} 秒後再試。` });

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;
  const headers = { Authorization: `Bearer ${access_token}` };

  try {
    if (action === 'pause') {
      await axios.put('https://api.spotify.com/v1/me/player/pause', null, { headers });
      return res.json({ ok: true, message: '已暫停。' });
    }
    if (action === 'play') {
      await axios.put('https://api.spotify.com/v1/me/player/play', null, { headers });
      return res.json({ ok: true, message: '已開始播放。' });
    }
    if (action === 'next') {
      await axios.post('https://api.spotify.com/v1/me/player/next', null, { headers });
      return res.json({ ok: true, message: '已跳到下一首。' });
    }
    if (action === 'previous') {
      await axios.post('https://api.spotify.com/v1/me/player/previous', null, { headers });
      return res.json({ ok: true, message: '已回到上一首。' });
    }
  } catch (err) {
    spotifyErrorResponse(res, err, '播放控制失敗');
  }
});

module.exports = router;
