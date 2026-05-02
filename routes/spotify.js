/**
 * /api/spotify routes
 */
const router = require('express').Router();
const { generateCodePair, exchangeCodeForToken } = require('../services/spotifyAuth');
const { isLyricsSynced, prefetchLyricsForTracks, clearLyricsCache } = require('../services/lyricsFetcher');
const { getCurrentPlayback, getQueue, clearSpotifyRateLimitLocks } = require('../services/spotifyPlayback');
const fs = require('fs');
const { storagePath } = require('../services/runtimePaths');

function getClientId() {
  return String(process.env.CLIENT_ID || '').trim();
}

function getRedirectUri() {
  return process.env.REDIRECT_URI || 'http://127.0.0.1:5172/api/spotify/callback';
}

const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

// in-memory code verifier just for single-user local app
let CODE_VERIFIER = null;

/**
 * Step 1 — redirect user to Spotify consent page (PKCE)
 */
router.get('/auth/login', (req, res) => {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  if (!clientId) {
    return res.redirect('/html/setup.html');
  }

  const { verifier, challenge } = generateCodePair();
  CODE_VERIFIER = verifier;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
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
 * Manual retry after Spotify rate limit or timeout.
 * This clears the local lock; the next status/queue read will try Spotify again.
 */
router.post('/retry', async (req, res) => {
  clearSpotifyRateLimitLocks();
  res.json({ ok: true, message: 'Spotify rate-limit / timeout lock cleared. The next request will retry Spotify.' });
});

router.post('/lyrics-cache/clear', async (req, res) => {
  const result = clearLyricsCache();
  res.json({ ok: true, ...result, message: 'LRCLib lyrics cache cleared.' });
});

function spotifyTimingFields(payload = {}) {
  return {
    rate_limited: Boolean(payload.rate_limited),
    spotify_timeout: Boolean(payload.spotify_timeout),
    manual_retry_required: Boolean(payload.manual_retry_required),
    retry_after_ms: payload.retry_after_ms || 0,
    retry_after_raw: payload.retry_after_raw || '',
    rate_limited_at: payload.rate_limited_at || 0,
    spotify_timeout_ms: payload.spotify_timeout_ms || 0,
    spotify_response_elapsed_ms: payload.spotify_response_elapsed_ms || 0,
    spotify_request_started_at: payload.spotify_request_started_at || 0,
    spotify_timeout_at: payload.spotify_timeout_at || 0,
    spotify_response_at: payload.spotify_response_at || 0
  };
}

/**
 * Current playback / lyric sync status
 * Uses shared cache; does NOT call Spotify directly every time.
 */
router.get('/status', async (req, res) => {
  try {
    const playback = await getCurrentPlayback();

    if (!playback.authorized) return res.json({ authorized: false });
    if (!playback.track) {
      return res.json({
        authorized: true,
        playing: false,
        ...spotifyTimingFields(playback)
      });
    }

    const lyricsSynced = isLyricsSynced(playback.track);
    res.json({
      authorized: true,
      playing: Boolean(playback.playing),
      track: playback.track,
      lyricsSynced,
      ...spotifyTimingFields(playback)
    });
  } catch (err) {
    console.error('status error:', err.response?.data || err.message);

    if (err.response?.status === 429) {
      return res.status(429).json({
        authorized: true,
        error: 'rate_limited',
        manual_retry_required: true,
        message: 'Spotify API 暫時限制請求，請稍後手動重試。'
      });
    }

    res.status(500).json({ authorized: true, error: 'failed to fetch playback' });
  }
});

/**
 * Upcoming Spotify queue for OBS "Up Next" overlay
 */
router.get('/queue', async (req, res) => {
  try {
    const data = await getQueue();
    if (!data.authorized) return res.json({ authorized: false, queue: [] });

    prefetchLyricsForTracks(data.queue || []).catch(err => {
      console.warn('queue lyrics prefetch failed:', err.message);
    });

    return res.json({
      authorized: true,
      currently_playing: data.currently_playing || null,
      queue: data.queue || [],
      fetched_at: data.fetched_at || Date.now(),
      ...spotifyTimingFields(data)
    });
  } catch (err) {
    const spotifyError = err.response?.data;
    console.error('queue error:', spotifyError || err.message);

    if (err.response?.status === 403) {
      return res.status(403).json({
        authorized: true,
        queue: [],
        error: 'missing_scope_or_forbidden'
      });
    }

    if (err.response?.status === 404) {
      return res.json({
        authorized: true,
        queue: [],
        error: 'no_active_device'
      });
    }

    if (err.response?.status === 429) {
      return res.status(429).json({
        authorized: true,
        queue: [],
        error: 'rate_limited',
        manual_retry_required: true
      });
    }

    return res.status(500).json({
      authorized: true,
      queue: [],
      error: 'failed_to_fetch_queue'
    });
  }
});

/**
 * Serve the raw log file for dashboard
 */
router.get('/log', (req, res) => {
  const logPath = storagePath('lyrics.log');
  if (!fs.existsSync(logPath)) return res.send('');
  res.send(fs.readFileSync(logPath, 'utf8'));
});

module.exports = router;
