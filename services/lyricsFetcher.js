/**
 * lyricsFetcher.js
 *  - Poll Spotify every N seconds
 *  - When track changes, call LRCLib (or Musixmatch) to fetch .lrc
 *  - Write lyrics/current.lrc
 *  - Append storage/lyrics.log
 *
 * NOTE: LRCLib API 不需要金鑰；Musixmatch 需自行申請 key。
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { getAccessToken } = require('./spotifyAuth');

const LRC_DIR   = path.join(__dirname, '..', 'lyrics');
const LRC_FILE  = path.join(LRC_DIR, 'current.lrc');
const LOG_FILE  = path.join(__dirname, '..', 'storage', 'lyrics.log');

if (!fs.existsSync(LRC_DIR)) fs.mkdirSync(LRC_DIR, { recursive: true });

let lastTrackId   = null;      // Spotify track.id
let lastSyncedAt  = 0;
let lastSyncedObj = null;      // {id,name,artists}

/**
 * Append one line to lyrics.log
 */
function logLine(msg) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${stamp}] ${msg}\n`);
  console.log(msg);
}

/**
 * Query LRCLib for LRC lyrics
 * https://lrclib.net/api/get?artist_name=…&track_name=…
 */
async function fetchLyricsLRC(artist, title) {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
  const { data } = await axios.get(url, { timeout: 8000 });

  // 1️⃣ 先看新欄位（syncedLyrics）
  if (data && data.syncedLyrics) return data.syncedLyrics;

  // 2️⃣ 向下相容舊欄位（lrc）
  if (data && data.lrc) return data.lrc;

  throw new Error('LRC not found');
}

async function syncLoop() {
  try {
    const token = await getAccessToken();
    if (!token) return;   // 尚未授權

    const { data } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: 'Bearer ' + token },
      timeout: 8000,
    });

    if (!data || !data.item) return;                 // 無播放
    if (!data.is_playing) return;                   // 暫停狀態
    if (data.item.id === lastTrackId) return;       // 同首歌

    const name    = data.item.name;
    const artists = data.item.artists.map(a => a.name).join(', ');
    const trackId = data.item.id;

    // 先清空現有 .lrc
    fs.writeFileSync(LRC_FILE, '');

    logLine(`🎵 Now playing: ${artists} - ${name}`);
    try {
      const lrcText = await fetchLyricsLRC(artists.split(',')[0], name);
      fs.writeFileSync(LRC_FILE, lrcText, 'utf8');
      logLine('✅ LRC synced');
      lastSyncedObj = { id: trackId, name, artists };
    } catch (err) {
      logLine(`❌ LRC not found: ${err.message}`);
      lastSyncedObj = null;
    }

    lastTrackId  = trackId;
    lastSyncedAt = Date.now();
  } catch (err) {
    console.error('lyrics sync loop error:', err.message);
  }
}

/**
 * Public: start interval
 */
function startLyricSync(intervalMs = 5000) {
  setInterval(syncLoop, intervalMs);
}

/**
 * Public helper for /status
 */
function isLyricsSynced(track) {
  if (!track || !lastSyncedObj) return false;
  return track.name === lastSyncedObj.name && track.artists === lastSyncedObj.artists;
}

module.exports = { startLyricSync, isLyricsSynced };