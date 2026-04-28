// === CONFIG ===
const LRC_URL = '/lyrics/current.lrc';
const STATUS_URL = '/api/spotify/status';
const WINDOW_SIZE = 3; // 維持原本設定：前後各 3 行，總共最多 7 行
const POLL_MS = 1000;
const NO_LYRICS_TEXT = '無歌詞';
const LOADING_TEXT = '正在載入歌詞...';

// === DOM ===
const container = document.getElementById('lyrics');

const trackEl = document.createElement('div');
trackEl.className = 'lyrics-track';
container.appendChild(trackEl);

// === STATE ===
let lrcLines = [];
let currentTrackKey = null;
let isLoadingLyrics = false;
let lyricsState = 'idle'; // idle | loading | ready | not_found
let status = {};
let lastRenderedLineKey = null;
let lastRenderedSignature = '';
let currentTranslateY = 0;

// === 解析 LRC ===
function parseLRC(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => {
      // 過濾 metadata，例如 [ti:]、[ar:]、[al:]
      return !/^\[(ti|ar|al|by|offset):/i.test(line);
    })
    .map(line => {
      const match = line.match(/^\[([0-9:.]+)]\s*(.*)$/);
      if (!match) return null;
      return {
        time: toMs(match[1]),
        text: match[2]
      };
    })
    .filter(Boolean)
    .filter(line => Number.isFinite(line.time));
}

function toMs(timeText) {
  // 支援 00:10.23 / 00:10.230
  const [min, sec] = timeText.split(':');
  return (parseInt(min, 10) * 60 + parseFloat(sec)) * 1000;
}

function getTrackKey(track) {
  if (!track) return null;
  return track.id || `${track.name || ''}-${track.artists || ''}`;
}

function resetTrackPosition({ animate = false } = {}) {
  currentTranslateY = 0;
  trackEl.classList.toggle('no-transition', !animate);
  trackEl.style.transform = 'translate3d(0, 0px, 0)';

  if (!animate) {
    requestAnimationFrame(() => {
      trackEl.classList.remove('no-transition');
    });
  }
}

function clearLyrics() {
  trackEl.innerHTML = '';
  lastRenderedLineKey = null;
  lastRenderedSignature = '';
  resetTrackPosition({ animate: false });
}

function renderMessage(message, className = 'message') {
  lastRenderedLineKey = null;
  lastRenderedSignature = `message-${message}-${className}`;
  trackEl.innerHTML = '';
  resetTrackPosition({ animate: false });

  const div = document.createElement('div');
  div.className = className;
  div.textContent = message;
  trackEl.appendChild(div);
}

function getRenderSignature(windowLines, currentIdx) {
  return windowLines
    .map((line, index) => `${index === currentIdx ? '*' : ''}${line.time}:${line.text}`)
    .join('|');
}

function centerActiveLine(currentElement, currentLineKey, shouldAnimate) {
  if (!currentElement) {
    resetTrackPosition({ animate: shouldAnimate });
    return;
  }

  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const currentRect = currentElement.getBoundingClientRect();
    const currentCenter = currentRect.top + currentRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    const delta = containerCenter - currentCenter;
    const nextTranslateY = currentTranslateY + delta;

    trackEl.classList.toggle('no-transition', !shouldAnimate);
    trackEl.style.transform = `translate3d(0, ${nextTranslateY}px, 0)`;
    currentTranslateY = nextTranslateY;

    if (!shouldAnimate) {
      requestAnimationFrame(() => {
        trackEl.classList.remove('no-transition');
      });
    }

    lastRenderedLineKey = currentLineKey;
  });
}

function centerWholeBlock({ animate = false } = {}) {
  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const trackRect = trackEl.getBoundingClientRect();
    const trackCenter = trackRect.top + trackRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    const delta = containerCenter - trackCenter;
    const nextTranslateY = currentTranslateY + delta;

    trackEl.classList.toggle('no-transition', !animate);
    trackEl.style.transform = `translate3d(0, ${nextTranslateY}px, 0)`;
    currentTranslateY = nextTranslateY;

    if (!animate) {
      requestAnimationFrame(() => {
        trackEl.classList.remove('no-transition');
      });
    }
  });
}

function render(windowLines, currentIdx) {
  const signature = getRenderSignature(windowLines, currentIdx);
  const didLineChange = signature !== lastRenderedSignature;

  if (!didLineChange) return;

  lastRenderedSignature = signature;
  trackEl.innerHTML = '';

  let currentElement = null;
  let currentLineKey = null;

  windowLines.forEach((line, index) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.textContent = line.text || ' ';

    if (index === currentIdx) {
      div.classList.add('current');
      currentElement = div;
      currentLineKey = `${line.time}-${line.text}`;
    }

    trackEl.appendChild(div);
  });

  if (currentIdx === -1 || !currentElement) {
    centerWholeBlock({ animate: false });
    return;
  }

  centerActiveLine(
    currentElement,
    currentLineKey,
    lastRenderedLineKey !== null && currentLineKey !== lastRenderedLineKey
  );
}

async function fetchLRC() {
  try {
    lyricsState = 'loading';
    renderMessage(LOADING_TEXT, 'message loading');

    // 讓後端 performLyricSync 有一點時間把 current.lrc 寫完
    await new Promise(resolve => setTimeout(resolve, 250));

    const res = await fetch(`${LRC_URL}?_t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const parsedLines = parseLRC(text);

    if (!text.trim() || parsedLines.length === 0) {
      lrcLines = [];
      lyricsState = 'not_found';
      renderMessage(NO_LYRICS_TEXT, 'message no-lyrics');
      return;
    }

    lrcLines = parsedLines;
    lyricsState = 'ready';
  } catch (error) {
    console.error('Failed to fetch LRC:', error);
    lrcLines = [];
    lyricsState = 'not_found';
    renderMessage(NO_LYRICS_TEXT, 'message no-lyrics');
  } finally {
    isLoadingLyrics = false;
  }
}

async function tick() {
  try {
    status = await fetch(`${STATUS_URL}?_t=${Date.now()}`).then(response => response.json());
  } catch (error) {
    console.error('Failed to fetch Spotify status:', error);
    clearLyrics();
    return;
  }

  if (!status.authorized || !status.track) {
    currentTrackKey = null;
    lrcLines = [];
    lyricsState = 'idle';
    clearLyrics();
    return;
  }

  const nextTrackKey = getTrackKey(status.track);
  const switchedTrack = nextTrackKey !== currentTrackKey;

  if (switchedTrack && !isLoadingLyrics) {
    currentTrackKey = nextTrackKey;
    lrcLines = [];
    lyricsState = 'loading';
    isLoadingLyrics = true;
    lastRenderedLineKey = null;
    lastRenderedSignature = '';
    resetTrackPosition({ animate: false });
    fetchLRC();
    return;
  }

  if (isLoadingLyrics || lyricsState === 'loading') {
    renderMessage(LOADING_TEXT, 'message loading');
    return;
  }

  if (lyricsState === 'not_found' || lrcLines.length === 0) {
    renderMessage(NO_LYRICS_TEXT, 'message no-lyrics');
    return;
  }

  const pos = status.track.progress_ms || 0;
  const idx = lrcLines.findIndex((line, index) => {
    const nextLine = lrcLines[index + 1];
    return pos >= line.time && (!nextLine || pos < nextLine.time);
  });

  if (!status.track.is_playing || idx === -1) {
    // 未播放或歌曲尚未進入第一句前：顯示開頭的既有行數，整組垂直置中
    const previewCount = Math.min(lrcLines.length, WINDOW_SIZE * 2 + 1);
    const previewLines = lrcLines.slice(0, previewCount);
    render(previewLines, -1);
    return;
  }

  const start = Math.max(0, idx - WINDOW_SIZE);
  const end = Math.min(lrcLines.length, idx + WINDOW_SIZE + 1);
  const windowLines = lrcLines.slice(start, end);
  const currentInWindow = idx - start;

  render(windowLines, currentInWindow);
}

// === 啟動 ===
tick();
setInterval(tick, POLL_MS);
