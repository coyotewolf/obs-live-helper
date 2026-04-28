/**
 * /api/spotify routes
 */
const router = require('express').Router();
const axios = require('axios');
const { generateCodePair, exchangeCodeForToken, getAccessToken, readTokens } = require('../services/spotifyAuth');
const { isLyricsSynced, performLyricSync } = require('../services/lyricsFetcher'); // 引入 performLyricSync
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing'
].join(' ');

// in-memory code verifier just for single‑user local app
let CODE_VERIFIER = null;

/**
 * Step 1 — redirect user to Spotify consent page (PKCE)
 */
router.get('/auth/login', (req, res) => {
  const { verifier, challenge } = generateCodePair();
  CODE_VERIFIER = verifier;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });

  const authURL = `https://accounts.spotify.com/authorize?${params.toString()}`;
  res.redirect(authURL);
});

/**
 * Step 2 — callback endpoint receives ?code=...
 * Exchanges for tokens then redirects to dashboard
 */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send('Authorization error: ' + error);
  if (!code) return res.status(400).send('Missing code');

  try {
    await exchangeCodeForToken(code, CODE_VERIFIER);
    res.send('<h3>✅ Spotify 授權成功！可關閉此視窗</h3>');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('Token exchange failed');
  }
});

/**
 * Current playback / lyric sync status
 */
router.get('/status', async (req, res) => {
  const access_token = await getAccessToken();
  if (!access_token) return res.json({ authorized: false });

  try {
    const { data, status } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (status === 204 || !data) {
      return res.json({ authorized: true, playing: false });
    }

    // 獲取當前播放歌曲的識別符
    const currentTrackIdentifier = data.item?.id || data.item?.name;

    // 為了避免重複同步，我們需要檢查 lastTrackId 和 lastSyncedObj
    // 由於這些變數在 lyricsFetcher.js 內部，我們不能直接訪問。
    // 最好的方法是讓 performLyricSync 函數內部處理這個檢查。

    // 強制執行一次歌詞同步，並等待其完成
    await performLyricSync();

    // 重新獲取最新的 Spotify 狀態，因為 performLyricSync 可能會改變它
    const updatedData = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` }, // 使用之前獲取的 token
    }).then(r => r.data);

    // 如果 updatedData 不存在，則返回錯誤
    if (!updatedData || !updatedData.item) {
      return res.json({ authorized: true, playing: false });
    }

    // 使用更新後的數據構建 track 物件
    const images = updatedData.item?.album?.images || [];
    const largestImage = images[0]?.url || '';
    const mediumImage = images[1]?.url || largestImage;
    const smallImage = images[2]?.url || mediumImage;

    const track = {
      id: updatedData.item?.id,
      uri: updatedData.item?.uri,
      name: updatedData.item?.name,
      artists: updatedData.item?.artists?.map(a => a.name).join(', '),
      album: updatedData.item?.album?.name || '',
      album_images: images,
      cover_url: mediumImage,
      cover_large_url: largestImage,
      cover_small_url: smallImage,
      progress_ms: updatedData.progress_ms || 0,
      duration_ms: updatedData.item?.duration_ms || 0,
      is_playing: updatedData.is_playing,
      external_url: updatedData.item?.external_urls?.spotify || '',
      device: updatedData.device ? {
        name: updatedData.device.name,
        type: updatedData.device.type,
        volume_percent: updatedData.device.volume_percent
      } : null,
      fetched_at: Date.now()
    };

    // lyrics sync flag placeholder (step4 will update)
    const lyricsSynced = isLyricsSynced(track);

    res.json({ authorized: true, playing: true, track, lyricsSynced });
  } catch (err) {
    console.error('status error:', err.response?.data || err.message);
    res.status(500).json({ authorized: true, error: 'failed to fetch playback' });
  }
});

/**
 * Serve the raw log file for dashboard
 */
router.get('/log', (req, res) => {
  const logPath = path.join(__dirname, '..', 'storage', 'lyrics.log');
  if (!fs.existsSync(logPath)) return res.send('');
  res.send(fs.readFileSync(logPath, 'utf8'));
});

module.exports = router;