/**
 * /api/spotify routes
 */
const router = require('express').Router();
const axios = require('axios');
const { generateCodePair, exchangeCodeForToken, getAccessToken, readTokens } = require('../services/spotifyAuth');
const { isLyricsSynced } = require('../services/lyricsFetcher');
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

    const track = {
      name: data.item?.name,
      artists: data.item?.artists?.map(a => a.name).join(', '),
      progress_ms: data.progress_ms,
      duration_ms: data.item?.duration_ms,
      is_playing: data.is_playing
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