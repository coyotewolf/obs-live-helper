/**
 * lyricsFetcher.js
 *  - Uses centralized Spotify playback cache to avoid API rate limits.
 *  - When track changes, immediately clears stale lyrics and writes [ti:<track-id>] metadata.
 *  - Fetches LRCLib synced lyrics and writes lyrics/current.lrc atomically.
 *  - Uses exact LRCLib lookup first, then fuzzy search fallback to avoid false "not found".
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getCurrentPlayback } = require('./spotifyPlayback');

const LRC_DIR = path.join(__dirname, '..', 'lyrics');
const LRC_FILE = path.join(LRC_DIR, 'current.lrc');
const LOG_FILE = path.join(__dirname, '..', 'storage', 'lyrics.log');

if (!fs.existsSync(LRC_DIR)) fs.mkdirSync(LRC_DIR, { recursive: true });

let lastTrackId = null;
let lastSyncedAt = 0;
let lastSyncedObj = null;
let lastLoggedTrackId = null;
let lastLoggedLrcSynced = false;
let lastLoggedLrcNotFound = false;
let activeSyncPromise = null;
let lrclibBackoffUntil = 0;
let currentTrackAttemptCount = 0;
let lastLyricAttemptAt = 0;

const SAME_TRACK_RETRY_MS = Number(process.env.LYRICS_SAME_TRACK_RETRY_MS || 8000);
const MAX_SAME_TRACK_RETRIES = Number(process.env.LYRICS_MAX_SAME_TRACK_RETRIES || 12);
const LRCLIB_TIMEOUT_MS = Number(process.env.LRCLIB_TIMEOUT_MS || 8000);
const LRCLIB_MAX_BACKOFF_MS = Number(process.env.LRCLIB_MAX_BACKOFF_MS || 60000);

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

function writeCurrentLrc(text) {
  const tempPath = path.join(LRC_DIR, 'current.lrc.tmp');
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, LRC_FILE);
}

function buildMetadata(trackId, artists, album) {
  return `[ti:${trackId || ''}]\n[ar:${artists || ''}]\n[al:${album || ''}]\n`;
}

function getRetryAfterMs(err) {
  const raw = err.response?.headers?.['retry-after'];
  if (!raw) return 8000;

  const asSeconds = Number.parseInt(raw, 10);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(asSeconds * 1000, LRCLIB_MAX_BACKOFF_MS);
  }

  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(asDate - Date.now(), 1000), LRCLIB_MAX_BACKOFF_MS);
  }

  return 8000;
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

  // Remove common version/credit suffixes that often break LRCLib exact matching.
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

function makeLrclibClient() {
  return axios.create({
    baseURL: 'https://lrclib.net',
    timeout: LRCLIB_TIMEOUT_MS,
    headers: {
      // LRCLib asks clients to identify themselves; this also helps debugging.
      'User-Agent': 'OBS-Live-Helper/1.0 (https://github.com/coyotewolf/obs-live-helper)'
    },
    validateStatus: status => (status >= 200 && status < 300) || status === 404
  });
}

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
  const now = Date.now();
  if (lrclibBackoffUntil > now) {
    throw new Error(`LRCLib rate limited, retry later`);
  }

  const client = makeLrclibClient();

  try {
    const response = await client.get(pathname, { params });

    if (response.status === 404) {
      return null;
    }

    return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      const waitMs = getRetryAfterMs(err);
      lrclibBackoffUntil = Date.now() + waitMs;
      throw new Error(`LRCLib too many requests, backing off ${Math.ceil(waitMs / 1000)}s`);
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
    },
    {
      label: 'exact original title + all artists',
      artist_name: context.artists,
      track_name: context.title,
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
  const searchQueries = uniqueObjects([
    {
      label: 'search by first artist + original title',
      params: { artist_name: context.firstArtist, track_name: context.title }
    },
    {
      label: 'search by first artist + cleaned title',
      params: { artist_name: context.firstArtist, track_name: context.cleanedTitle }
    },
    {
      label: 'search by q original',
      params: { q: `${context.firstArtist} ${context.title}` }
    },
    {
      label: 'search by q cleaned',
      params: { q: `${context.firstArtist} ${context.cleanedTitle}` }
    }
  ], item => JSON.stringify(item.params));

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

  throw new Error('LRCLib synced lyrics not found after exact + fuzzy search');
}

async function fetchLyricsLRC({ artists, title, album, duration_ms }) {
  const artistList = splitArtists(artists);
  const firstArtist = artistList[0] || artists;
  const cleanedTitle = cleanTrackTitle(title);
  const durationSec = duration_ms ? Math.round(duration_ms / 1000) : null;

  const context = {
    artists,
    firstArtist,
    title,
    cleanedTitle,
    album,
    duration_ms,
    durationSec
  };

  const exact = await tryExactGet(context);
  if (exact?.lyrics) {
    return exact;
  }

  logLine(`ℹ️ LRCLib exact match not found, trying fuzzy search: ${firstArtist} - ${cleanedTitle}`);
  return searchLrclib(context);
}

function shouldRetrySameTrack(trackId) {
  if (!trackId || lastSyncedObj?.id === trackId) return false;
  if (currentTrackAttemptCount >= MAX_SAME_TRACK_RETRIES) return false;
  return Date.now() - lastLyricAttemptAt >= SAME_TRACK_RETRY_MS;
}

async function performLyricSyncCore() {
  const playback = await getCurrentPlayback({ ttlMs: 1800 });
  if (!playback.authorized || playback.rate_limited) return;

  if (!playback.track) {
    if (lastTrackId !== null) {
      lastTrackId = null;
      lastSyncedObj = null;
      writeCurrentLrc('');
    }
    return;
  }

  const item = playback.track;
  const trackId = item.id || `${item.name || ''}-${item.artists || ''}`;
  const name = item.name || '未知歌曲';
  const artists = item.artists || '未知歌手';
  const album = item.album || '';
  const durationMs = item.duration_ms || 0;

  const switchedTrack = trackId !== lastTrackId;

  if (!switchedTrack && !shouldRetrySameTrack(trackId)) return;

  if (switchedTrack) {
    lastTrackId = trackId;
    lastSyncedObj = null;
    lastSyncedAt = Date.now();
    lastLoggedLrcSynced = false;
    lastLoggedLrcNotFound = false;
    currentTrackAttemptCount = 0;
    lastLyricAttemptAt = 0;

    if (trackId !== lastLoggedTrackId) {
      logLine(`🎵 Now playing: ${artists} - ${name}`);
      lastLoggedTrackId = trackId;
    }
  }

  currentTrackAttemptCount += 1;
  lastLyricAttemptAt = Date.now();

  // Important: remove stale lyrics immediately on track switch.
  // Keep metadata so display.js can tell which track the LRC belongs to.
  writeCurrentLrc(buildMetadata(trackId, artists, album));

  try {
    const result = await fetchLyricsLRC({
      artists,
      title: name,
      album,
      duration_ms: durationMs
    });

    // If another sync changed the track while LRCLib was responding, do not write stale lyrics.
    if (lastTrackId !== trackId) return;

    writeCurrentLrc(buildMetadata(trackId, artists, album) + result.lyrics);

    if (!lastLoggedLrcSynced) {
      const matchedName = result.matched?.trackName || result.matched?.name || name;
      const matchedArtist = result.matched?.artistName || result.matched?.artist || artists;
      logLine(`✅ LRC synced via ${result.source}: ${matchedArtist} - ${matchedName}`);
      lastLoggedLrcSynced = true;
    }

    lastSyncedObj = { id: trackId, name, artists };
    lastSyncedAt = Date.now();
    currentTrackAttemptCount = 0;
  } catch (err) {
    if (lastTrackId === trackId) writeCurrentLrc(buildMetadata(trackId, artists, album));
    lastSyncedObj = null;

    if (!lastLoggedLrcNotFound || currentTrackAttemptCount === MAX_SAME_TRACK_RETRIES) {
      const retryNote = currentTrackAttemptCount < MAX_SAME_TRACK_RETRIES
        ? `，將自動重試 ${currentTrackAttemptCount}/${MAX_SAME_TRACK_RETRIES}`
        : '，已達重試上限';
      logLine(`❌ LRC not found: ${err.message}${retryNote}`);
      lastLoggedLrcNotFound = true;
    }
  }
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

function startLyricSync(intervalMs = 2000) {
  performLyricSync();
  setInterval(syncLoopWrapper, intervalMs);
}

function isLyricsSynced(track) {
  if (!track || !lastSyncedObj) return false;
  const trackId = track.id || `${track.name || ''}-${track.artists || ''}`;
  return trackId === lastSyncedObj.id;
}

module.exports = {
  startLyricSync,
  isLyricsSynced,
  performLyricSync
};
