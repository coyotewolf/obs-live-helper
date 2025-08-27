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
let lyricsNotFoundCount = 0;
let lyricsFoundForCurrentTrack = false;
let lastLoggedTrackId = null;
let lastLoggedLrcSynced = false;
let lastLoggedLrcNotFoundCount = 0;
let lastLoggedGiveUpSearch = false; // 新增：追蹤是否已記錄放棄尋找訊息

/**
 * Append one line to lyrics.log
 */
function logLine(msg) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${stamp}] ${msg}\n`);
  console.log(`[${stamp}] ${msg}`);
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
      return;
    }

    // 歌曲切換，重置狀態
    lyricsNotFoundCount = 0;
    lyricsFoundForCurrentTrack = false;
    lastLoggedLrcSynced = false; // 重置 synced 狀態
    lastLoggedLrcNotFoundCount = 0; // 重置 not found 狀態
    lastLoggedGiveUpSearch = false; // 新增：重置放棄尋找狀態

    const name    = data.item.name;
    const artists = data.item.artists.map(a => a.name).join(', ');
    const album   = data.item.album.name;
    const trackId = data.item.id;

    if (currentTrackIdentifier !== lastLoggedTrackId) {
      logLine(`🎵 Now playing: ${artists} - ${name}`);
      lastLoggedTrackId = currentTrackIdentifier;
    }

    // 先清空現有 .lrc
    const tempPath = path.join(__dirname, '..', 'lyrics', 'current.lrc.tmp');
    fs.writeFileSync(tempPath, '');

    // 歌詞尋找邏輯
    // 移除舊的日誌邏輯
    // if (lyricsFoundForCurrentTrack) {
    //   logLine('✅ LRC synced (已找到歌詞，跳過尋找)');
    // } else if (lyricsNotFoundCount >= 3) {
    //   logLine('❌ LRC not found: LRC not found (放棄尋找)');
    //   fs.writeFileSync(LRC_FILE, '', 'utf8'); // 清空 LRC 檔案
    //   lastSyncedObj = null;
    // } else {
      try {
        const lrcText = await fetchLyricsLRC(artists.split(',')[0], name);
        const metadata = `[ti:${trackId}]\n[ar:${artists}]\n[al:${album}]\n`;
        fs.writeFileSync(tempPath, metadata + lrcText, 'utf8');
        fs.renameSync(tempPath, LRC_FILE);

        if (!lastLoggedLrcSynced) { // 只有當從未同步過才記錄
          logLine('✅ LRC synced');
          lastLoggedLrcSynced = true;
        }
        lyricsFoundForCurrentTrack = true;
        lastSyncedObj = { id: trackId, name, artists };
      } catch (err) {
        lyricsNotFoundCount++;
        fs.writeFileSync(LRC_FILE, '', 'utf8'); // 清空 LRC 檔案
        lastSyncedObj = null;

        if (lyricsNotFoundCount < 3) {
          if (lyricsNotFoundCount !== lastLoggedLrcNotFoundCount) {
            logLine(`❌ LRC not found: ${err.message}`);
            lastLoggedLrcNotFoundCount = lyricsNotFoundCount;
          }
        } else if (lyricsNotFoundCount === 3 && !lastLoggedGiveUpSearch) {
          logLine(`❌ LRC not found: ${err.message} (放棄尋找)`);
          lastLoggedGiveUpSearch = true;
          lastLoggedLrcNotFoundCount = lyricsNotFoundCount; // 確保此計數器在記錄放棄尋找時也更新
        }
        // 如果 lyricsNotFoundCount > 3，則不再記錄任何「not found」或「放棄尋找」相關訊息
      }
    // } // 結束舊的 else 區塊

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