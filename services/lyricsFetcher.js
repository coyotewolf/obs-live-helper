/**
 * lyricsFetcher.js
 *  - Poll Spotify every N seconds
 *  - When track changes, call LRCLib to fetch .lrc
 *  - Write lyrics/current.lrc atomically
 *
 * Fixes in this version:
 *  - Prevent overlapping sync jobs from racing with each other.
 *  - Clear current.lrc immediately when Spotify changes tracks, so the OBS page
 *    will not keep showing the previous song's lyrics while the new lyrics load.
 *  - Always write [ti:<spotify-track-id>] metadata, allowing display.js to detect
 *    and reject stale LRC content.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken } = require('./spotifyAuth');

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

function logLine(msg) {
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

async function fetchLyricsLRC(artist, title) {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title
  });

  const { data } = await axios.get(`https://lrclib.net/api/get?${params.toString()}`, {
    timeout: 8000
  });

  if (data?.syncedLyrics) return data.syncedLyrics;
  if (data?.lrc) return data.lrc;

  throw new Error('LRC not found');
}

async function performLyricSyncCore() {
  const token = await getAccessToken();
  if (!token) return;

  const { data } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000
  });

  if (!data || !data.item) {
    if (lastTrackId !== null) {
      lastTrackId = null;
      lastSyncedObj = null;
      writeCurrentLrc('');
    }
    return;
  }

  const item = data.item;
  const trackId = item.id || `${item.name || ''}-${item.artists?.map(a => a.name).join(', ') || ''}`;
  const name = item.name || '未知歌曲';
  const artists = item.artists?.map(a => a.name).join(', ') || '未知歌手';
  const firstArtist = item.artists?.[0]?.name || artists.split(',')[0] || artists;
  const album = item.album?.name || '';

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
    writeCurrentLrc(buildMetadata(trackId, artists, album) + lrcText);

    if (!lastLoggedLrcSynced) {
      logLine('✅ LRC synced');
      lastLoggedLrcSynced = true;
    }

    lastSyncedObj = { id: trackId, name, artists };
    lastSyncedAt = Date.now();
  } catch (err) {
    writeCurrentLrc(buildMetadata(trackId, artists, album));
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

function startLyricSync(intervalMs = 1000) {
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
