// === CONFIG ===
const LRC_URL = '/lyrics/current.lrc';
const STATUS_URL = '/api/spotify/status';
const POLL_MS = 2000;
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
let retryTimer = null;
let staleRetryCount = 0;
let statusBackoffUntil = 0;

function toMs(timeText) {
  const [min, sec] = timeText.split(':');
  return (parseInt(min, 10) * 60 + parseFloat(sec)) * 1000;
}

function getTrackKey(track) {
  if (!track) return null;
  return track.id || `${track.name || ''}-${track.artists || ''}`;
}

function parseLRC(text) {
  const metadata = {};
  const lines = [];

  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trimEnd();

    const metaMatch = line.match(/^\[(ti|ar|al|by|offset):([^\]]*)\]/i);
    if (metaMatch) {
      metadata[metaMatch[1].toLowerCase()] = metaMatch[2] || '';
      return;
    }

    const lyricMatch = line.match(/^\[([0-9:.]+)]\s*(.*)$/);
    if (!lyricMatch) return;

    const time = toMs(lyricMatch[1]);
    if (!Number.isFinite(time)) return;

    lines.push({
      time,
      text: lyricMatch[2]
    });
  });

  return { metadata, lines };
}

function clearRetryTimer() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleLrcRetry(delay = 650) {
  // Do not keep canceling and rescheduling on every tick.
  // The previous version called clearRetryTimer() here, but tick() runs every 2s
  // and the retry delay is often 2.5s, so the timer was repeatedly canceled
  // before it could fire. That made OBS stay on "找沒歌詞><" until manual refresh.
  if (retryTimer) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!currentTrackKey || isLoadingLyrics) return;
    isLoadingLyrics = true;
    fetchLRC(currentTrackKey);
  }, delay);
}

function clearLyrics() {
  clearRetryTimer();
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
  clearRetryTimer();
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

async function fetchLRC(expectedTrackKey = currentTrackKey) {
  try {
    lyricsState = 'loading';
    renderMessage(LOADING_TEXT, 'message loading');

    const res = await fetch(`${LRC_URL}?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const { metadata, lines } = parseLRC(text);
    const lrcTrackKey = metadata.ti || null;

    // If lyrics/current.lrc still belongs to the previous track, do not render it.
    // Keep retrying briefly while lyricsFetcher catches up.
    if (lrcTrackKey && expectedTrackKey && lrcTrackKey !== expectedTrackKey) {
      lrcLines = [];
      lyricsState = 'loading';
      staleRetryCount += 1;
      if (staleRetryCount <= 10) scheduleLrcRetry(500);
      return;
    }

    staleRetryCount = 0;

    if (!text.trim() || lines.length === 0) {
      lrcLines = [];

      // If current.lrc belongs to the current track but only contains metadata,
      // the backend is probably still fetching or retrying LRCLib. Keep trying.
      if (expectedTrackKey && lrcTrackKey === expectedTrackKey) {
        lyricsState = 'not_found';
        scheduleLrcRetry(2200);
        renderMessage(NO_LYRICS_TEXT, 'message no-lyrics');
        return;
      }

      lyricsState = 'not_found';
      renderMessage(NO_LYRICS_TEXT, 'message no-lyrics');
      return;
    }

    lrcLines = lines;
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
  if (statusBackoffUntil > Date.now()) return;

  try {
    const response = await fetch(`${STATUS_URL}?_t=${Date.now()}`, { cache: 'no-store' });
    status = await response.json();

    if (response.status === 429 || status.error === 'rate_limited') {
      const waitMs = status.retry_after_ms || 8000;
      statusBackoffUntil = Date.now() + waitMs;
      return;
    }
  } catch (error) {
    console.error('Failed to fetch Spotify status:', error);
    return;
  }

  if (!status.authorized || !status.track) {
    currentTrackKey = null;
    lrcLines = [];
    lyricsState = 'idle';
    staleRetryCount = 0;
    clearLyrics();
    return;
  }

  const nextTrackKey = getTrackKey(status.track);
  const switchedTrack = nextTrackKey !== currentTrackKey;

  if (switchedTrack) {
    clearRetryTimer();
    currentTrackKey = nextTrackKey;
    lrcLines = [];
    lyricsState = 'loading';
    isLoadingLyrics = true;
    activeIndex = null;
    staleRetryCount = 0;
    fetchLRC(nextTrackKey);
    return;
  }

  if (isLoadingLyrics) {
    renderMessage(LOADING_TEXT, 'message loading');
    return;
  }

  if (lyricsState === 'loading') {
    isLoadingLyrics = true;
    fetchLRC(nextTrackKey);
    return;
  }

  if (lyricsState === 'not_found' || lrcLines.length === 0) {
    // The backend may write current.lrc a moment after the track changed.
    // Keep retrying slowly so OBS does not require manual Browser Source refresh.
    if (!isLoadingLyrics && currentTrackKey) {
      scheduleLrcRetry(2500);
    }
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

tick();
setInterval(tick, POLL_MS);
