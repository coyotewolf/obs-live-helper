/**
 * lyricsFetcher.js
 *  - Uses centralized Spotify playback cache to avoid API rate limits.
 *  - When track changes, immediately clears stale lyrics and writes [ti:<track-id>] metadata.
 *  - Fetches LRCLib synced lyrics and writes lyrics/current.lrc atomically.
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
  const retryAfter = Number(err.response?.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return 8000;
}

async function fetchLyricsLRC(artist, title) {
  const now = Date.now();
  if (lrclibBackoffUntil > now) {
    throw new Error(`LRCLib rate limited, retry later`);
  }

  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title
  });

  try {
    const { data } = await axios.get(`https://lrclib.net/api/get?${params.toString()}`, {
      timeout: 8000
    });

    if (data?.syncedLyrics) return data.syncedLyrics;
    if (data?.lrc) return data.lrc;
    throw new Error('LRC not found');
  } catch (err) {
    if (err.response?.status === 429) {
      const waitMs = getRetryAfterMs(err);
      lrclibBackoffUntil = Date.now() + waitMs;
      throw new Error(`LRCLib too many requests, backing off ${Math.ceil(waitMs / 1000)}s`);
    }
    throw err;
  }
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
  const firstArtist = artists.split(',')[0]?.trim() || artists;
  const album = item.album || '';

  if (trackId === lastTrackId) return;

  lastTrackId = trackId;
  lastSyncedObj = null;
  lastSyncedAt = Date.now();
  lastLoggedLrcSynced = false;
  lastLoggedLrcNotFound = false;

  if (trackId !== lastLoggedTrackId) {
    logLine(`🎵 Now playing: ${artists} - ${name}`);
    lastLoggedTrackId = trackId;
  }

  // Important: remove stale lyrics immediately on track switch.
  // Keep metadata so display.js can tell which track the LRC belongs to.
  writeCurrentLrc(buildMetadata(trackId, artists, album));

  try {
    const lrcText = await fetchLyricsLRC(firstArtist, name);

    // If another sync changed the track while LRCLib was responding, do not write stale lyrics.
    if (lastTrackId !== trackId) return;

    writeCurrentLrc(buildMetadata(trackId, artists, album) + lrcText);

    if (!lastLoggedLrcSynced) {
      logLine('✅ LRC synced');
      lastLoggedLrcSynced = true;
    }

    lastSyncedObj = { id: trackId, name, artists };
    lastSyncedAt = Date.now();
  } catch (err) {
    if (lastTrackId === trackId) writeCurrentLrc(buildMetadata(trackId, artists, album));
    lastSyncedObj = null;

    if (!lastLoggedLrcNotFound) {
      logLine(`❌ LRC not found: ${err.message}`);
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
