// === CONFIG ===
const LRC_URL = '/lyrics/current.lrc';
const STATUS_URL = '/api/spotify/status';
const WINDOW_SIZE = 3; // 維持原本設定：前後各 3 行，畫面約保留 7 行的視覺密度
const POLL_MS = 1000;
const NO_LYRICS_TEXT = '找沒歌詞><';
const LOADING_TEXT = '正在載入歌詞...';

// === DOM ===
const container = document.getElementById('lyrics');

// === STATE ===
let lrcLines = [];
let currentTrackKey = null;
let isLoadingLyrics = false;
let lyricsState = 'idle'; // idle | loading | ready | not_found
let status = {};
let activeIndex = null;
let trackEl = null;
let lineEls = [];

// === 解析 LRC ===
function parseLRC(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => !/^\[(ti|ar|al|by|offset):/i.test(line))
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
  const [min, sec] = timeText.split(':');
  return (parseInt(min, 10) * 60 + parseFloat(sec)) * 1000;
}

function getTrackKey(track) {
  if (!track) return null;
  return track.id || `${track.name || ''}-${track.artists || ''}`;
}

function clearLyrics() {
  activeIndex = null;
  trackEl = null;
  lineEls = [];
  container.innerHTML = '';
}

function renderMessage(message, className = 'message') {
  activeIndex = null;
  trackEl = null;
  lineEls = [];
  container.innerHTML = '';

  const div = document.createElement('div');
  div.className = className;
  div.textContent = message;
  container.appendChild(div);
}

function renderLyricsList() {
  container.innerHTML = '';

  trackEl = document.createElement('div');
  trackEl.className = 'lyrics-track no-transition';

  lineEls = lrcLines.map((line, index) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.index = String(index);
    div.textContent = line.text || ' ';
    trackEl.appendChild(div);
    return div;
  });

  container.appendChild(trackEl);
  activeIndex = null;

  // 初次渲染先不做動畫，避免剛載入時從畫面外飛進來。
  requestAnimationFrame(() => {
    updateActiveLine(0, { immediate: true });
    requestAnimationFrame(() => {
      if (trackEl) trackEl.classList.remove('no-transition');
    });
  });
}

function getVisibleIndex(pos) {
  if (lrcLines.length === 0) return -1;

  const idx = lrcLines.findIndex((line, index) => {
    const nextLine = lrcLines[index + 1];
    return pos >= line.time && (!nextLine || pos < nextLine.time);
  });

  // 歌曲剛開始、還沒到第一句歌詞前：把第一句維持在垂直置中。
  if (idx === -1) return 0;
  return idx;
}

function updateActiveLine(nextIndex, options = {}) {
  if (!trackEl || lineEls.length === 0) return;

  const safeIndex = Math.min(Math.max(nextIndex, 0), lineEls.length - 1);
  const shouldMove = safeIndex !== activeIndex || options.immediate;
  if (!shouldMove) return;

  const previous = activeIndex !== null ? lineEls[activeIndex] : null;
  const current = lineEls[safeIndex];

  if (previous) previous.classList.remove('current');
  if (current) current.classList.add('current');

  activeIndex = safeIndex;

  if (options.immediate) trackEl.classList.add('no-transition');
  else trackEl.classList.remove('no-transition');

  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const lineRect = current.getBoundingClientRect();
    const trackRect = trackEl.getBoundingClientRect();

    const currentCenterInTrack = lineRect.top - trackRect.top + lineRect.height / 2;
    const targetCenter = containerRect.height / 2;
    const translateY = targetCenter - currentCenterInTrack;

    trackEl.style.transform = `translate3d(0, ${translateY}px, 0)`;

    if (options.immediate) {
      requestAnimationFrame(() => {
        if (trackEl) trackEl.classList.remove('no-transition');
      });
    }
  });
}

async function fetchLRC() {
  try {
    lyricsState = 'loading';
    renderMessage(LOADING_TEXT, 'message loading');

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
    renderLyricsList();
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
    activeIndex = null;
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

  if (!trackEl || lineEls.length !== lrcLines.length) {
    renderLyricsList();
    return;
  }

  const pos = status.track.progress_ms || 0;
  const nextIndex = getVisibleIndex(pos);
  updateActiveLine(nextIndex);
}

// === 啟動 ===
tick();
setInterval(tick, POLL_MS);
