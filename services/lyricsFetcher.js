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
  // console.log(msg);
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

async function performLyricSync() {
  try {
    const token = await getAccessToken();
    if (!token) return;   // 尚未授權

    const { data } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: 'Bearer ' + token },
      timeout: 8000,
    });

    if (!data || !data.item) return;                 // 無播放
    if (!data.is_playing) return;                   // 暫停狀態
    const currentTrackIdentifier = data.item.id || data.item.name; // 優先使用 ID，如果沒有則使用名稱
    const lastTrackIdentifier = lastTrackId || lastSyncedObj?.name;
    // logLine(`DEBUG: performLyricSync - 比較歌曲。Current: ${currentTrackIdentifier}, Last: ${lastTrackIdentifier}`);

    if (currentTrackIdentifier === lastTrackIdentifier) { // 同首歌
      // logLine(`DEBUG: performLyricSync - 歌曲未切換，跳過更新。`);
      return;
    }

    const name    = data.item.name;
    const artists = data.item.artists.map(a => a.name).join(', ');
    const album   = data.item.album.name;
    const trackId = data.item.id;

    // 先清空現有 .lrc
    const tempPath = path.join(__dirname, '..', 'lyrics', 'current.lrc.tmp');
    fs.writeFileSync(tempPath, '');

    // logLine(`DEBUG: performLyricSync - currentTrackId: ${data.item.id}, currentTrackName: ${data.item.name}`);
    // logLine(`DEBUG: performLyricSync - lastTrackId: ${lastTrackId}, lastSyncedObj.name: ${lastSyncedObj?.name}`);
    // logLine(`🎵 Now playing: ${artists} - ${name}`);
    try {
      const lrcText = await fetchLyricsLRC(artists.split(',')[0], name);
      const metadata = `[ti:${trackId}]\n[ar:${artists}]\n[al:${album}]\n`;
      fs.writeFileSync(tempPath, metadata + lrcText, 'utf8');
      fs.renameSync(tempPath, LRC_FILE);
      // logLine(`DEBUG: performLyricSync - lyrics/current.lrc 檔案已更新。`);
      const updatedLrcContent = fs.readFileSync(LRC_FILE, 'utf8');
      // logLine(`DEBUG: performLyricSync - lyrics/current.lrc 檔案實際內容 (前200字元):\n${updatedLrcContent.substring(0, 200)}...`);
      // logLine('✅ LRC synced');
      lastSyncedObj = { id: trackId, name, artists };
    } catch (err) {
      // logLine(`❌ LRC not found: ${err.message}`);
      lastSyncedObj = null;
    }

    lastTrackId  = trackId;
    lastSyncedAt = Date.now();
  } catch (err) {
    console.error('lyrics sync loop error:', err.message);
  }
}

async function syncLoopWrapper() {
  // console.log('syncLoopWrapper: 開始執行歌詞同步');
  await performLyricSync();
  // console.log('syncLoopWrapper: 歌詞同步執行完畢');
}

/**
 * Public: start interval
 */
function startLyricSync(intervalMs = 1000) {
  setInterval(syncLoopWrapper, intervalMs);
}

/**
 * Public helper for /status
 */
function isLyricsSynced(track) {
  if (!track || !lastSyncedObj) return false;
  return track.name === lastSyncedObj.name && track.artists === lastSyncedObj.artists;
}

module.exports = { startLyricSync, isLyricsSynced, performLyricSync }; // 導出 performLyricSync