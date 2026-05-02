/**
 * lyricsFetcher.js
 *  - Uses centralized Spotify playback cache to avoid API rate limits.
 *  - Uses LRCLib cache + circuit breaker so the helper can run 24/7.
 *  - Reduces fuzzy search attempts and stores not-found results to avoid repeated timeouts.
 *  - Supports background prefetch for tracks already visible in Spotify queue.
 *  - Writes lyrics/current.lrc atomically for OBS overlays.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { LYRICS_DIR, lyricsPath, storagePath } = require('./runtimePaths');
const { getCurrentPlayback } = require('./spotifyPlayback');

const LRC_DIR = LYRICS_DIR;
const LRC_FILE = lyricsPath('current.lrc');
const LOG_FILE = storagePath('lyrics.log');
const CACHE_FILE = storagePath('lrclib-cache.json');

if (!fs.existsSync(LRC_DIR)) fs.mkdirSync(LRC_DIR, { recursive: true });

let lastTrackId = null;
let lastSyncedAt = 0;
let lastSyncedObj = null;
let lastLoggedTrackId = null;
let lastLoggedLrcSynced = false;
let lastLoggedLrcNotFound = false;
let lastLoggedFuzzySearchTrackId = null;
let activeSyncPromise = null;
let syncInterval = null;

// Current track context is intentionally cached here.
// Same-track LRCLib retries use this object directly, so they do not call Spotify again.
let currentTrackContext = null;
let currentTrackAttemptCount = 0;
let lastLyricAttemptAt = 0;
let lyricRetryPending = false;

const PLAYBACK_POLL_TTL_MS = Number(process.env.SPOTIFY_PLAYBACK_CACHE_MS || 10000);
const LYRICS_LOOP_INTERVAL_MS = Number(process.env.LYRICS_LOOP_INTERVAL_MS || 5000);
const SAME_TRACK_RETRY_MS = Number(process.env.LYRICS_SAME_TRACK_RETRY_MS || 8000);
const MAX_SAME_TRACK_RETRIES = Number(process.env.LYRICS_MAX_SAME_TRACK_RETRIES || 3);
const LRCLIB_TIMEOUT_MS = Number(process.env.LRCLIB_TIMEOUT_MS || 8000);
const LRCLIB_MAX_BACKOFF_MS = Number(process.env.LRCLIB_MAX_BACKOFF_MS || 120000);
const LRCLIB_CIRCUIT_FAILURE_THRESHOLD = Number(process.env.LRCLIB_CIRCUIT_FAILURE_THRESHOLD || 3);
const LRCLIB_CIRCUIT_OPEN_MS = Number(process.env.LRCLIB_CIRCUIT_OPEN_MS || 120000);
const LRCLIB_CACHE_READY_TTL_MS = Number(process.env.LRCLIB_CACHE_READY_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const LRCLIB_CACHE_NOT_FOUND_TTL_MS = Number(process.env.LRCLIB_CACHE_NOT_FOUND_TTL_MS || 6 * 60 * 60 * 1000);
const LRCLIB_PREFETCH_LIMIT = Number(process.env.LRCLIB_PREFETCH_LIMIT || 3);
const LRCLIB_MAX_FUZZY_SEARCHES = Number(process.env.LRCLIB_MAX_FUZZY_SEARCHES || 1);
const LRCLIB_REQUEST_INTERVAL_MS = Number(process.env.LRCLIB_REQUEST_INTERVAL_MS || 1500);
const LRCLIB_PREFETCH_TRACK_INTERVAL_MS = Number(process.env.LRCLIB_PREFETCH_TRACK_INTERVAL_MS || 6000);

let lyricsCache = loadLyricsCache();
let cacheDirty = false;
const inFlightLookupMap = new Map();
const prefetchingTrackIds = new Set();
let prefetchQueuePromise = null;
let lastLrclibRequestAt = 0;
let lastPrefetchTrackAt = 0;

let lrclibCircuit = {
  state: 'closed',
  failures: 0,
  openUntil: 0,
  lastError: ''
};

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logLine(msg) {
  ensureLogDir();
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${stamp}] ${msg}\n`);
  console.log(`[${stamp}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function waitForLrclibRequestSlot() {
  if (!LRCLIB_REQUEST_INTERVAL_MS || LRCLIB_REQUEST_INTERVAL_MS <= 0) return;
  const waitMs = LRCLIB_REQUEST_INTERVAL_MS - (Date.now() - lastLrclibRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastLrclibRequestAt = Date.now();
}

async function waitForPrefetchTrackSlot() {
  if (!LRCLIB_PREFETCH_TRACK_INTERVAL_MS || LRCLIB_PREFETCH_TRACK_INTERVAL_MS <= 0) return;
  const waitMs = LRCLIB_PREFETCH_TRACK_INTERVAL_MS - (Date.now() - lastPrefetchTrackAt);
  if (waitMs > 0) await sleep(waitMs);
  lastPrefetchTrackAt = Date.now();
}

function writeCurrentLrc(text) {
  const tempPath = path.join(LRC_DIR, 'current.lrc.tmp');
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, LRC_FILE);
}

function buildMetadata(trackId, artists, album, obsStatus = 'searching') {
  return `[ti:${trackId || ''}]\n[ar:${artists || ''}]\n[al:${album || ''}]\n[obsstatus:${obsStatus}]\n`;
}

function loadLyricsCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn('⚠️ LRCLib cache 解析失敗，重建空快取。', err.message);
    return {};
  }
}

function saveLyricsCacheNow() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const temp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(lyricsCache, null, 2), 'utf8');
    fs.renameSync(temp, CACHE_FILE);
    cacheDirty = false;
  } catch (err) {
    console.warn('⚠️ LRCLib cache 寫入失敗：', err.message);
  }
}

function scheduleCacheSave() {
  if (cacheDirty) return;
  cacheDirty = true;
  setTimeout(() => {
    if (cacheDirty) saveLyricsCacheNow();
  }, 800);
}

function getCacheKey(context) {
  return String(context.trackId || `${context.firstArtist || context.artists}|${context.cleanedTitle || context.title}|${context.durationSec || ''}`);
}

function getCachedLyrics(context) {
  const key = getCacheKey(context);
  const entry = lyricsCache[key];
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    delete lyricsCache[key];
    scheduleCacheSave();
    return null;
  }
  return entry;
}

function setCachedLyrics(context, entry) {
  const key = getCacheKey(context);
  lyricsCache[key] = {
    ...entry,
    key,
    trackId: context.trackId,
    title: context.title,
    artists: context.artists,
    album: context.album || '',
    updatedAt: Date.now()
  };
  scheduleCacheSave();
}

function clearLyricsCache() {
  lyricsCache = {};
  cacheDirty = false;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch (err) {
    console.warn('⚠️ LRCLib cache 刪除失敗：', err.message);
  }
  inFlightLookupMap.clear();
  prefetchingTrackIds.clear();
  lrclibCircuit = { state: 'closed', failures: 0, openUntil: 0, lastError: '' };
  logLine('🧹 LRCLib lyrics cache cleared.');
  return { ok: true, cleared: true };
}

function getRetryAfterMs(err) {
  const raw = err.response?.headers?.['retry-after'];
  if (!raw) return 8000;

  const asSeconds = Number.parseFloat(raw);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(asSeconds * 1000, LRCLIB_MAX_BACKOFF_MS);
  }

  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(asDate - Date.now(), 1000), LRCLIB_MAX_BACKOFF_MS);
  }

  return 8000;
}

function isTimeoutLikeError(err) {
  return err?.code === 'ECONNABORTED' || /timeout|timed out/i.test(String(err?.message || ''));
}

function openCircuit(waitMs, reason) {
  lrclibCircuit.state = 'open';
  lrclibCircuit.openUntil = Date.now() + Math.min(waitMs, LRCLIB_MAX_BACKOFF_MS);
  lrclibCircuit.lastError = reason;
}

function beforeLrclibRequest() {
  const now = Date.now();
  if (lrclibCircuit.state === 'open') {
    if (lrclibCircuit.openUntil > now) {
      const waitSeconds = Math.ceil((lrclibCircuit.openUntil - now) / 1000);
      const err = new Error(`LRCLib circuit open, retry after ${waitSeconds}s: ${lrclibCircuit.lastError || 'temporary failure'}`);
      err.isCircuitOpen = true;
      throw err;
    }
    lrclibCircuit.state = 'half-open';
  }
}

function recordLrclibSuccess() {
  if (lrclibCircuit.state !== 'closed' || lrclibCircuit.failures > 0) {
    lrclibCircuit = { state: 'closed', failures: 0, openUntil: 0, lastError: '' };
  }
}

function recordLrclibFailure(err) {
  const status = err.response?.status;
  if (status === 404) return;

  let waitMs = LRCLIB_CIRCUIT_OPEN_MS;
  let reason = err.message || 'LRCLib request failed';

  if (status === 429) {
    waitMs = getRetryAfterMs(err);
    reason = `LRCLib 429 rate limit`;
    openCircuit(waitMs, reason);
    return;
  }

  if (isTimeoutLikeError(err)) {
    reason = `LRCLib timeout after ${LRCLIB_TIMEOUT_MS}ms`;
  }

  lrclibCircuit.failures += 1;
  lrclibCircuit.lastError = reason;

  if (lrclibCircuit.failures >= LRCLIB_CIRCUIT_FAILURE_THRESHOLD || lrclibCircuit.state === 'half-open') {
    openCircuit(waitMs, reason);
  }
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTrackTitle(title = '') {
  let cleaned = String(title);

  cleaned = cleaned.replace(/\s*[-–—]\s*(remaster(?:ed)?|[0-9]{4}\s*remaster(?:ed)?|radio edit|single edit|album version|live|acoustic|instrumental|karaoke|sped up|slowed|nightcore).*$/i, '');
  cleaned = cleaned.replace(/\s*\((?:feat\.?|ft\.?|with|remaster(?:ed)?|[0-9]{4}\s*remaster(?:ed)?|radio edit|single edit|album version|live|acoustic|instrumental|karaoke|sped up|slowed|nightcore)[^)]*\)/ig, '');
  cleaned = cleaned.replace(/\s*\[(?:feat\.?|ft\.?|with|remaster(?:ed)?|[0-9]{4}\s*remaster(?:ed)?|radio edit|single edit|album version|live|acoustic|instrumental|karaoke|sped up|slowed|nightcore)[^\]]*\]/ig, '');

  return cleaned.replace(/\s+/g, ' ').trim() || title;
}

function splitArtists(artists = '') {
  return String(artists)
    .split(/\s*,\s*|\s*&\s*|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)
    .map(a => a.trim())
    .filter(Boolean);
}

function uniqueObjects(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const lrclibClient = axios.create({
  baseURL: 'https://lrclib.net',
  timeout: LRCLIB_TIMEOUT_MS,
  headers: {
    'User-Agent': 'OBS-Live-Helper/1.0 (https://github.com/coyotewolf/obs-live-helper)'
  },
  validateStatus: status => (status >= 200 && status < 300) || status === 404
});

function hasSyncedLyrics(item) {
  return Boolean(item?.syncedLyrics || item?.lrc);
}

function getSyncedLyrics(item) {
  return item?.syncedLyrics || item?.lrc || '';
}

function scoreSearchResult(item, context) {
  if (!item || !hasSyncedLyrics(item)) return -Infinity;

  const expectedTitle = normalizeText(context.cleanedTitle || context.title);
  const originalTitle = normalizeText(context.title);
  const expectedArtists = splitArtists(context.artists).map(normalizeText);
  const firstArtist = normalizeText(context.firstArtist);
  const resultTitle = normalizeText(item.trackName || item.name || '');
  const resultArtist = normalizeText(item.artistName || item.artist || '');
  const resultAlbum = normalizeText(item.albumName || '');

  let score = 0;

  if (resultTitle === expectedTitle) score += 80;
  else if (resultTitle === originalTitle) score += 70;
  else if (resultTitle.includes(expectedTitle) || expectedTitle.includes(resultTitle)) score += 38;

  if (firstArtist && resultArtist.includes(firstArtist)) score += 38;
  for (const artist of expectedArtists) {
    if (artist && resultArtist.includes(artist)) score += 18;
  }

  const durationSec = Number(context.duration_ms || 0) / 1000;
  const resultDurationSec = Number(item.duration || item.durationSec || 0);
  if (durationSec > 0 && resultDurationSec > 0) {
    const diff = Math.abs(durationSec - resultDurationSec);
    if (diff <= 2) score += 70;
    else if (diff <= 5) score += 45;
    else if (diff <= 10) score += 24;
    else if (diff <= 20) score += 8;
    else score -= Math.min(45, diff);
  }

  if (resultAlbum && context.album && resultAlbum === normalizeText(context.album)) score += 12;
  if (item.instrumental) score -= 100;

  return score;
}

async function callLrclib(pathname, params) {
  beforeLrclibRequest();
  await waitForLrclibRequestSlot();

  try {
    const response = await lrclibClient.get(pathname, { params });
    recordLrclibSuccess();
    if (response.status === 404) return null;
    return response.data;
  } catch (err) {
    recordLrclibFailure(err);
    if (err.response?.status === 429) {
      const waitMs = getRetryAfterMs(err);
      throw new Error(`LRCLib too many requests, backing off ${Math.ceil(waitMs / 1000)}s`);
    }
    if (isTimeoutLikeError(err)) {
      throw new Error(`LRCLib request timed out after ${LRCLIB_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

async function tryExactGet(context) {
  const exactCandidates = uniqueObjects([
    {
      label: 'exact original title + first artist',
      artist_name: context.firstArtist,
      track_name: context.title,
      album_name: context.album,
      duration: context.durationSec
    },
    {
      label: 'exact cleaned title + first artist',
      artist_name: context.firstArtist,
      track_name: context.cleanedTitle,
      album_name: context.album,
      duration: context.durationSec
    }
  ], item => `${item.artist_name}|${item.track_name}|${item.album_name}|${item.duration}`);

  for (const candidate of exactCandidates) {
    const params = {
      artist_name: candidate.artist_name,
      track_name: candidate.track_name
    };

    if (candidate.album_name) params.album_name = candidate.album_name;
    if (candidate.duration) params.duration = String(candidate.duration);

    const data = await callLrclib('/api/get', params);
    if (hasSyncedLyrics(data)) {
      return {
        lyrics: getSyncedLyrics(data),
        source: `/api/get (${candidate.label})`,
        matched: data
      };
    }
  }

  return null;
}

async function searchLrclib(context) {
  const allSearchQueries = uniqueObjects([
    {
      label: 'search by q cleaned',
      params: { q: `${context.firstArtist} ${context.cleanedTitle}` }
    },
    {
      label: 'search by first artist + cleaned title',
      params: { artist_name: context.firstArtist, track_name: context.cleanedTitle }
    },
    {
      label: 'search by q original',
      params: { q: `${context.firstArtist} ${context.title}` }
    }
  ], item => JSON.stringify(item.params));

  const searchQueries = allSearchQueries.slice(0, Math.max(0, LRCLIB_MAX_FUZZY_SEARCHES));
  let allResults = [];
  let plainOnlyCount = 0;

  for (const query of searchQueries) {
    const data = await callLrclib('/api/search', query.params);
    const list = Array.isArray(data) ? data : [];
    if (list.length === 0) continue;

    plainOnlyCount += list.filter(item => item?.plainLyrics && !hasSyncedLyrics(item)).length;
    allResults = allResults.concat(list);
  }

  allResults = uniqueObjects(allResults, item => String(item.id || `${item.artistName}|${item.trackName}|${item.duration}`));

  const scored = allResults
    .map(item => ({ item, score: scoreSearchResult(item, context) }))
    .filter(entry => Number.isFinite(entry.score) && entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      lyrics: getSyncedLyrics(scored[0].item),
      source: `/api/search fuzzy (score ${Math.round(scored[0].score)})`,
      matched: scored[0].item
    };
  }

  if (plainOnlyCount > 0) {
    throw new Error(`LRCLib only plain lyrics found (${plainOnlyCount}), no synced lyrics`);
  }

  throw new Error('LRCLib synced lyrics not found after exact + limited fuzzy search');
}

function buildLookupContext({ trackId, artists, title, album, duration_ms }) {
  const artistList = splitArtists(artists);
  const firstArtist = artistList[0] || artists;
  const cleanedTitle = cleanTrackTitle(title);
  const durationSec = duration_ms ? Math.round(duration_ms / 1000) : null;

  return {
    trackId,
    artists,
    firstArtist,
    title,
    cleanedTitle,
    album,
    duration_ms,
    durationSec
  };
}

async function fetchLyricsLRC(input, options = {}) {
  const context = buildLookupContext(input);
  const cacheKey = getCacheKey(context);
  const cached = getCachedLyrics(context);

  if (cached?.status === 'ready' && cached.lyrics) {
    return {
      lyrics: cached.lyrics,
      source: `cache:${cached.source || 'lrclib'}`,
      matched: cached.matched || null,
      cached: true
    };
  }

  if (cached?.status === 'not_found') {
    const err = new Error(cached.reason || 'LRCLib synced lyrics not found (cached)');
    err.isCachedNotFound = true;
    throw err;
  }

  if (inFlightLookupMap.has(cacheKey)) return inFlightLookupMap.get(cacheKey);

  const lookupPromise = (async () => {
    try {
      const exact = await tryExactGet(context);
      const result = exact?.lyrics ? exact : await searchLrclib(context);
      setCachedLyrics(context, {
        status: 'ready',
        lyrics: result.lyrics,
        source: result.source,
        matched: result.matched || null,
        expiresAt: Date.now() + LRCLIB_CACHE_READY_TTL_MS
      });
      return result;
    } catch (err) {
      // Do not permanently cache network, timeout, 429, or circuit-breaker failures.
      // Only cache real not-found / plain-only outcomes so 24/7 operation does not hammer LRCLib.
      const message = err.message || 'LRCLib lookup failed';
      const shouldCacheNotFound =
        err.isCachedNotFound ||
        /not found|no synced lyrics|only plain lyrics/i.test(message);

      if (shouldCacheNotFound) {
        setCachedLyrics(context, {
          status: 'not_found',
          reason: message,
          expiresAt: Date.now() + LRCLIB_CACHE_NOT_FOUND_TTL_MS
        });
      }
      throw err;
    } finally {
      inFlightLookupMap.delete(cacheKey);
    }
  })();

  inFlightLookupMap.set(cacheKey, lookupPromise);
  return lookupPromise;
}

function makeTrackContext(item) {
  const trackId = item.id || `${item.name || ''}-${item.artists || ''}`;
  return {
    trackId,
    name: item.name || '未知歌曲',
    artists: item.artists || '未知歌手',
    album: item.album || '',
    durationMs: item.duration_ms || 0
  };
}

function isSameTrackContext(a, b) {
  return Boolean(a?.trackId && b?.trackId && a.trackId === b.trackId);
}

function shouldRetryCurrentTrackWithoutSpotify() {
  if (!lyricRetryPending || !currentTrackContext) return false;
  if (currentTrackAttemptCount >= MAX_SAME_TRACK_RETRIES) return false;
  return Date.now() - lastLyricAttemptAt >= SAME_TRACK_RETRY_MS;
}

async function fetchLyricsForCurrentTrack(reason = 'track-change') {
  if (!currentTrackContext) return;

  const { trackId, name, artists, album, durationMs } = currentTrackContext;
  currentTrackAttemptCount += 1;
  lastLyricAttemptAt = Date.now();

  // Remove stale lyrics immediately while searching/retrying this track.
  writeCurrentLrc(buildMetadata(trackId, artists, album, 'searching'));

  if (reason === 'retry') {
    logLine(`🔁 Retrying LRCLib for same track without Spotify API: ${artists} - ${name} (${currentTrackAttemptCount}/${MAX_SAME_TRACK_RETRIES})`);
  }

  try {
    const result = await fetchLyricsLRC({
      trackId,
      artists,
      title: name,
      album,
      duration_ms: durationMs
    });

    // If the track changed while LRCLib was responding, do not write stale lyrics.
    if (!currentTrackContext || currentTrackContext.trackId !== trackId || lastTrackId !== trackId) return;

    writeCurrentLrc(buildMetadata(trackId, artists, album, 'ready') + result.lyrics);

    if (!lastLoggedLrcSynced) {
      const matchedName = result.matched?.trackName || result.matched?.name || name;
      const matchedArtist = result.matched?.artistName || result.matched?.artist || artists;
      logLine(`✅ LRC synced via ${result.source}: ${matchedArtist} - ${matchedName}`);
      lastLoggedLrcSynced = true;
    }

    lastSyncedObj = { id: trackId, name, artists };
    lastSyncedAt = Date.now();
    currentTrackAttemptCount = 0;
    lyricRetryPending = false;
  } catch (err) {
    if (!currentTrackContext || currentTrackContext.trackId !== trackId || lastTrackId !== trackId) return;

    const transient = err.isCircuitOpen || /timeout|too many requests|circuit open|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String(err.message || ''));
    const reachedLimit = currentTrackAttemptCount >= MAX_SAME_TRACK_RETRIES;
    const finalStatus = reachedLimit && !transient ? 'not_found' : 'searching';

    writeCurrentLrc(buildMetadata(trackId, artists, album, finalStatus));
    lastSyncedObj = null;
    lyricRetryPending = !reachedLimit;

    const retryNote = reachedLimit
      ? `，已達查找上限 ${MAX_SAME_TRACK_RETRIES}/${MAX_SAME_TRACK_RETRIES}`
      : `，將只重試 LRCLib ${currentTrackAttemptCount}/${MAX_SAME_TRACK_RETRIES}（不重新呼叫 Spotify API）`;

    logLine(`❌ LRC not found: ${err.message}${retryNote}`);
    lastLoggedLrcNotFound = true;
  }
}

async function performLyricSyncCore() {
  // Important: same-track lyric retries happen before checking Spotify.
  // This keeps retries LRCLib-only and avoids extra Spotify Web API calls.
  if (shouldRetryCurrentTrackWithoutSpotify()) {
    await fetchLyricsForCurrentTrack('retry');
    return;
  }

  const playback = await getCurrentPlayback({ ttlMs: PLAYBACK_POLL_TTL_MS });
  if (!playback.authorized || playback.rate_limited) return;

  if (!playback.track) {
    if (lastTrackId !== null) {
      lastTrackId = null;
      currentTrackContext = null;
      lastSyncedObj = null;
      lyricRetryPending = false;
      currentTrackAttemptCount = 0;
      writeCurrentLrc('');
    }
    return;
  }

  const nextContext = makeTrackContext(playback.track);
  const switchedTrack = !isSameTrackContext(currentTrackContext, nextContext);

  if (!switchedTrack) return;

  lastTrackId = nextContext.trackId;
  currentTrackContext = nextContext;
  lastSyncedObj = null;
  lastSyncedAt = Date.now();
  lastLoggedLrcSynced = false;
  lastLoggedLrcNotFound = false;
  lastLoggedFuzzySearchTrackId = null;
  currentTrackAttemptCount = 0;
  lastLyricAttemptAt = 0;
  lyricRetryPending = false;

  if (nextContext.trackId !== lastLoggedTrackId) {
    logLine(`🎵 Now playing: ${nextContext.artists} - ${nextContext.name}`);
    lastLoggedTrackId = nextContext.trackId;
  }

  await fetchLyricsForCurrentTrack('track-change');
}

async function performLyricSync() {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = performLyricSyncCore()
    .catch(err => {
      console.error('lyrics sync loop error:', err.response?.data || err.message);
    })
    .finally(() => {
      activeSyncPromise = null;
    });

  return activeSyncPromise;
}

async function syncLoopWrapper() {
  await performLyricSync();
}

function startLyricSync(intervalMs = LYRICS_LOOP_INTERVAL_MS) {
  if (syncInterval) return;
  performLyricSync();
  syncInterval = setInterval(syncLoopWrapper, intervalMs);
}

function stopLyricSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
}

function isLyricsSynced(track) {
  if (!track || !lastSyncedObj) return false;
  const trackId = track.id || `${track.name || ''}-${track.artists || ''}`;
  return trackId === lastSyncedObj.id;
}

async function prefetchLyricsForTracks(tracks = []) {
  const candidates = uniqueObjects(
    (Array.isArray(tracks) ? tracks : [])
      .filter(track => track?.id || track?.uri)
      .filter(track => !currentTrackContext || (track.id || track.uri) !== currentTrackContext.trackId)
      .slice(0, LRCLIB_PREFETCH_LIMIT),
    track => track.id || track.uri
  );

  if (!candidates.length) return { ok: true, checked: 0 };
  if (prefetchQueuePromise) return prefetchQueuePromise;

  prefetchQueuePromise = (async () => {
    let checked = 0;
    for (const track of candidates) {
      const context = makeTrackContext(track);
      if (prefetchingTrackIds.has(context.trackId)) continue;

      const lookupContext = buildLookupContext({
        trackId: context.trackId,
        artists: context.artists,
        title: context.name,
        album: context.album,
        duration_ms: context.durationMs
      });

      if (getCachedLyrics(lookupContext)) continue;

      prefetchingTrackIds.add(context.trackId);
      try {
        await waitForPrefetchTrackSlot();
        checked += 1;
        await fetchLyricsLRC({
          trackId: context.trackId,
          artists: context.artists,
          title: context.name,
          album: context.album,
          duration_ms: context.durationMs
        }, { prefetch: true });
        logLine(`📦 Prefetched LRC cache for queue track: ${context.artists} - ${context.name}`);
      } catch (err) {
        if (!/cached|not found|plain lyrics/i.test(String(err.message || ''))) {
          logLine(`⚠️ Queue LRC prefetch skipped: ${context.artists} - ${context.name}: ${err.message}`);
        }
      } finally {
        prefetchingTrackIds.delete(context.trackId);
      }
    }
    return { ok: true, checked };
  })().finally(() => {
    prefetchQueuePromise = null;
  });

  return prefetchQueuePromise;
}

module.exports = {
  startLyricSync,
  isLyricsSynced,
  performLyricSync,
  stopLyricSync,
  prefetchLyricsForTracks,
  clearLyricsCache
};
