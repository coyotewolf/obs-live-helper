/**
 * /api/spotify routes  ——  改版：把 code_verifier 放進 state
 */
const router = require('express').Router();
const axios  = require('axios');
const {
  generateCodePair,
  exchangeCodeForToken,
  getAccessToken,
  readTokens,
} = require('../services/spotifyAuth');

const CLIENT_ID    = process.env.CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
].join(' ');

/**
 * Step 1 ── 產生 PKCE + redirect 至 Spotify
 */
router.get('/auth/login', (req, res) => {
  const { verifier, challenge } = generateCodePair();

  // 把 code_verifier 放進 state（Base64URL）
  const state = Buffer.from(verifier).toString('base64url');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state,                           // ← 帶出去
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

/**
 * Step 2 ── Spotify 回呼帶回 code 與 state (= verifier)
 */
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error)          return res.status(400).send('Authorization error: ' + error);
  if (!code || !state) return res.status(400).send('Missing code or state');

  // 從 state 取回原本的 code_verifier
  const verifier = Buffer.from(state, 'base64url').toString('utf8');

  try {
    await exchangeCodeForToken(code, verifier);
    res.send('<h3>✅ Spotify 授權成功！可關閉此視窗</h3>');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('Token exchange failed');
  }
});

/**
 * 目前播放狀態
 */
router.get('/status', async (req, res) => {
  const access_token = await getAccessToken();
  if (!access_token) return res.json({ authorized: false });

  try {
    const { data, status } = await axios.get(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    if (status === 204 || !data) {
      return res.json({ authorized: true, playing: false });
    }

    const track = {
      name: data.item?.name,
      artists: data.item?.artists?.map(a => a.name).join(', '),
      progress_ms: data.progress_ms,
      duration_ms: data.item?.duration_ms,
      is_playing: data.is_playing,
    };

    res.json({ authorized: true, playing: true, track, lyricsSynced: false });
  } catch (err) {
    console.error('status error:', err.response?.data || err.message);
    res.status(500).json({ authorized: true, error: 'failed to fetch playback' });
  }
});

/**
 * 播放紀錄 log
 */
const fs   = require('fs');
const path = require('path');
router.get('/log', (req, res) => {
  const logPath = path.join(__dirname, '..', 'storage', 'lyrics.log');
  if (!fs.existsSync(logPath)) return res.send('');
  res.send(fs.readFileSync(logPath, 'utf8'));
});

module.exports = router;
