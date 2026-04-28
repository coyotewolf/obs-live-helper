/**
 * Audience song request + remote Spotify control routes.
 *
 * Security model:
 * - This is intended for local/LAN use.
 * - A random PIN is generated on server start unless REQUEST_PIN is set in .env.
 * - Dashboard QR Code includes that PIN in the URL.
 */
const router = require('express').Router();
const axios = require('axios');
const QRCode = require('qrcode');
const os = require('os');
const { getAccessToken } = require('../services/spotifyAuth');

const PORT = process.env.PORT || 5172;
const REQUEST_PIN = String(process.env.REQUEST_PIN || Math.random().toString(36).slice(2, 8)).toUpperCase();

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
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

function requirePin(req, res, next) {
  const provided = String(req.query.pin || req.body?.pin || '').toUpperCase();
  if (!provided || provided !== REQUEST_PIN) {
    return res.status(401).json({
      ok: false,
      error: 'invalid_pin',
      message: 'QR Code 權限碼不正確，請重新掃描 Dashboard 上的 QR Code。'
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
      message: 'Spotify 權限不足。請回 Dashboard 重新授權一次；播放控制需要 user-modify-playback-state，且通常需要 Premium。'
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
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: '操作太頻繁，請稍後再試。'
    });
  }

  return res.status(status || 500).json({
    ok: false,
    error: 'spotify_error',
    message: data?.error?.message || fallback
  });
}

router.get('/info', async (req, res) => {
  const lanUrl = `http://${getLanIp()}:${PORT}/html/request.html?pin=${encodeURIComponent(REQUEST_PIN)}`;
  const localUrl = `http://127.0.0.1:${PORT}/html/request.html?pin=${encodeURIComponent(REQUEST_PIN)}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(lanUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8
    });

    res.json({
      ok: true,
      pin: REQUEST_PIN,
      lanUrl,
      localUrl,
      qrDataUrl
    });
  } catch (err) {
    console.error('QR generation failed:', err);
    res.status(500).json({
      ok: false,
      error: 'qr_failed',
      message: 'QR Code 產生失敗'
    });
  }
});

router.get('/search', requirePin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, tracks: [] });

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;

  try {
    const { data } = await axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: `Bearer ${access_token}` },
      params: {
        q,
        type: 'track',
        limit: 8,
        market: 'from_token'
      }
    });

    const tracks = (data.tracks?.items || [])
      .map(normalizeTrack)
      .filter(Boolean);

    res.json({ ok: true, tracks });
  } catch (err) {
    spotifyErrorResponse(res, err, '搜尋歌曲失敗');
  }
});

router.post('/queue', requirePin, async (req, res) => {
  const uri = String(req.body?.uri || '').trim();
  if (!uri.startsWith('spotify:track:')) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_track_uri',
      message: '歌曲 URI 不正確。'
    });
  }

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;

  try {
    await axios.post('https://api.spotify.com/v1/me/player/queue', null, {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { uri }
    });

    res.json({ ok: true, message: '已加入 Spotify 佇列。' });
  } catch (err) {
    spotifyErrorResponse(res, err, '加入佇列失敗');
  }
});

router.post('/play-now', requirePin, async (req, res) => {
  const uri = String(req.body?.uri || '').trim();
  if (!uri.startsWith('spotify:track:')) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_track_uri',
      message: '歌曲 URI 不正確。'
    });
  }

  const access_token = await getAuthorizedToken(res);
  if (!access_token) return;

  try {
    await axios.put('https://api.spotify.com/v1/me/player/play', {
      uris: [uri]
    }, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    res.json({ ok: true, message: '已立即播放這首歌。' });
  } catch (err) {
    spotifyErrorResponse(res, err, '立即播放失敗');
  }
});

router.post('/control', requirePin, async (req, res) => {
  const action = String(req.body?.action || '').trim();
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

    return res.status(400).json({
      ok: false,
      error: 'invalid_action',
      message: '不支援的播放控制。'
    });
  } catch (err) {
    spotifyErrorResponse(res, err, '播放控制失敗');
  }
});

module.exports = router;
