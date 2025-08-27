// === CONFIG ===
const LRC_URL   = '/lyrics/current.lrc';
const STATUS_URL = '/api/spotify/status';
const WINDOW_SIZE = 3;          // 前後各 3 行 => 總共 7 行
const POLL_MS = 1000;

// === 解析 LRC ===
function parseLRC(text) {
  const lines = text.split(/\r?\n/);
  console.log('parseLRC: 原始文本行數:', lines.length, '內容:', lines);

  const lrcContentLines = [];
  for (const line of lines) {
    // 其他 metadata 也可以在這裡解析，例如 [ar:artist], [al:album]
    const arMatch = line.match(/^\[ar:(.*)]$/);
    const alMatch = line.match(/^\[al:(.*)]$/);
    if (arMatch || alMatch) {
      continue;
    }

    lrcContentLines.push(line);
  }

  const parsedLines = lrcContentLines.map(l => {
    const m = l.match(/^\[([0-9:.]+)]\s*(.*)$/);
    if (!m) return null;
    const time = toMs(m[1]);
    const text = m[2];
    return { time, text };
  }).filter(Boolean);
  console.log('parseLRC: 解析後的歌詞行數:', parsedLines.length, '內容:', parsedLines);
  return parsedLines;
}
function toMs(t) {                       // 00:10.23 -> 10230 ms
  const [min, sec] = t.split(':');
  return (parseInt(min, 10) * 60 + parseFloat(sec)) * 1000;
}

// === DOM ===
const container = document.getElementById('lyrics');
function render(windowLines, currentIdx) {
  console.log('render: 函數開始執行。windowLines:', windowLines, 'currentIdx:', currentIdx);
  container.innerHTML = '';
  windowLines.forEach((line, i) => {
    const div = document.createElement('div');
    div.textContent = line.text || ' ';
    if (i === currentIdx) div.classList.add('current');
    container.appendChild(div);
  });
  console.log('render: 更新 DOM。container.innerHTML (前200字元):\n', container.innerHTML.substring(0, 200), '...');
}

// === 主循環 ===
let lrcLines = [];
var currentLyricsName = null;
let isLoadingLyrics = false; // 追蹤歌詞是否正在載入
var lyricsSynced = false; // 新增一個全域變數來追蹤歌詞是否已同步
let status = {}; // 移除 lyricsSynced 的初始化

async function fetchLRC() {
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    const res = await fetch(LRC_URL + '?_t=' + Date.now());
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const text = await res.text();
    console.log('fetchLRC: 從伺服器獲取的原始歌詞文本:', text);
    
    // 在解析歌詞之前，再次檢查歌曲是否已切換

    const parsedLines = parseLRC(text); // 傳遞 trackId
    lrcLines = parsedLines; // parseLRC 已經處理了 trackId，所以這裡直接賦值
    console.log('fetchLRC: 更新 lrcLines。歌詞行數:', lrcLines.length);
    lyricsSynced = true; // 解析完成後設置為 true
    render(lrcLines, -1); // 歌詞載入完成後立即渲染一次
  } catch (error) {
    lrcLines = []; // 發生錯誤時也清空歌詞
    // 可以考慮在這裡顯示錯誤訊息給使用者
  } finally {
    isLoadingLyrics = false; // 無論成功或失敗，載入都已完成
    console.log('fetchLRC: 載入完成，isLoadingLyrics 設定為 false。當前歌曲名稱:', currentLyricsName);
  }
}
async function tick() {
  console.log('tick 函數開始執行');
  Object.assign(status, await fetch(STATUS_URL).then(r => r.json()));
  console.log('tick: 獲取到的 Spotify 狀態:', status);
  console.log('tick: 當前 lrcLines.length:', lrcLines.length, 'lyricsSynced:', lyricsSynced, 'currentLyricsName:', currentLyricsName);

  if (isLoadingLyrics) {
    render([{ text: '正在載入歌詞...' }], 0); // 顯示載入訊息
    console.log('tick: 歌詞正在載入中，顯示載入訊息並跳過渲染。');
    return;
  }

  if (status.track && (status.track.name !== currentLyricsName || !lyricsSynced) && !isLoadingLyrics) {
    isLoadingLyrics = true;
    currentLyricsName = status.track.name; // 在觸發 fetchLRC 之前更新 currentLyricsName
    lyricsSynced = false; // 在觸發 fetchLRC 之前重置
    lrcLines = [];        // 在觸發 fetchLRC 之前清空
    render([]);           // 清空顯示
    fetchLRC();
    console.log('tick: 檢測到歌曲切換或未同步，觸發 fetchLRC。新歌曲名稱:', status.track.name);
  }


  let pos = status.track.progress_ms;
  let idx = lrcLines.findIndex((l, i) =>
    pos >= l.time && (i === lrcLines.length - 1 || pos < lrcLines[i + 1].time)
  );
  
  // 這裡不再需要檢查 isLoadingLyrics，因為歌曲切換邏輯已經處理了
  // if (isLoadingLyrics) {
  //   return render([{ lyric: '正在載入歌詞...' }], 0);
  // }

  if (!status.playing || idx === -1) {
    console.log('tick: 歌詞索引為 -1。當前歌曲進度 (pos):', pos);
    if (lrcLines.length > 0) {
      console.log('tick: lrcLines 第一行時間:', lrcLines[0].time, '最後一行時間:', lrcLines[lrcLines.length - 1].time);
    }
    console.log('tick: 未播放或歌詞索引為 -1。lrcLines.length:', lrcLines.length, 'lyricsSynced:', lyricsSynced);
    if (lrcLines.length > 0 && lyricsSynced) { // 移除 lrcLines[0].trackId === status.track.id 檢查
      // 當未播放或尚未開始時，顯示前幾行歌詞，不加粗
      // 這裡我們取前 3 行作為預顯示，可以根據需要調整
      const previewLines = lrcLines.slice(0, Math.min(lrcLines.length, 3));
      console.log('tick: 準備渲染預覽歌詞。previewLines:', previewLines);
      return render(previewLines, -1); // 顯示預覽行，不加粗
    } else {
      console.log('tick: 渲染空歌詞。');
      return render([]);
    }
  }

  const start = Math.max(0, idx - WINDOW_SIZE);
  const end   = Math.min(lrcLines.length, idx + WINDOW_SIZE + 1);
  const windowLines = lrcLines.slice(start, end);
  const currentInWindow = idx - start;
  render(windowLines, currentInWindow);
  console.log('tick: 渲染當前歌詞窗口。');
}

// === 啟動 ===
fetchLRC(); // 初始調用
setInterval(tick, POLL_MS);
