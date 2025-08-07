// === CONFIG ===
const LRC_URL   = '/lyrics/current.lrc';
const STATUS_URL = '/api/spotify/status';
const WINDOW_SIZE = 3;          // 前後各 3 行 => 總共 7 行
const POLL_MS = 1000;
const NO_LRC_TEXT = '好像找不到歌詞呢 (〒︿〒)';   // ← 新增

// === 解析 LRC ===
function parseLRC(text) {
  const lines = text.split(/\r?\n/).map(l => {
    const m = l.match(/^\[([0-9:.]+)]\s*(.*)$/);
    if (!m) return null;
    const time = toMs(m[1]);
    const lyric = m[2];
    return { time, lyric };
  }).filter(Boolean);
  return lines;
}
function toMs(t) {                       // 00:10.23 -> 10230 ms
  const [min, sec] = t.split(':');
  return (parseInt(min, 10) * 60 + parseFloat(sec)) * 1000;
}

// === DOM ===
const container = document.getElementById('lyrics');
function render(windowLines, currentIdx) {
  container.innerHTML = '';
  windowLines.forEach((line, i) => {
    const div = document.createElement('div');
    div.textContent = line.lyric || ' ';
    if (i === currentIdx) div.classList.add('current');
    container.appendChild(div);
  });
}

// === 主循環 ===
let lrcLines = [];
async function fetchLRC() {
  const res = await fetch(LRC_URL + '?_t=' + Date.now());
  const text = await res.text();
  lrcLines = parseLRC(text);
}
async function tick() {
  const status = await fetch(STATUS_URL).then(r => r.json());

  // 直播暫停或 Spotify 暫停
  if (!status.playing) return render([{ lyric: '' }], 0);

  // 播放中但沒有同步歌詞
  if (!status.lyricsSynced) {
    return render([{ lyric: NO_LRC_TEXT }], 0);
  }

  const pos = status.track.progress_ms;
  const idx = lrcLines.findIndex((l, i) =>
    pos >= l.time && (i === lrcLines.length - 1 || pos < lrcLines[i + 1].time)
  );
  if (idx === -1) return render([{ lyric: '' }], 0);

  const start = Math.max(0, idx - WINDOW_SIZE);
  const end   = Math.min(lrcLines.length, idx + WINDOW_SIZE + 1);
  const windowLines = lrcLines.slice(start, end);
  const currentInWindow = idx - start;
  render(windowLines, currentInWindow);
}

// === 啟動 ===
fetchLRC();
setInterval(fetchLRC, 10_000); // 每 10 秒重新抓一次，處理換歌
setInterval(tick, POLL_MS);
