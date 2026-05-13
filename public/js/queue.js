const QUEUE_URL = '/api/spotify/queue';
const MAX_VISIBLE_ITEMS = 5;

const card = document.getElementById('queueCard');
const queueList = document.getElementById('queueList');
const queueMessage = document.getElementById('queueMessage');

let lastQueueSignature = '';

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isPodcastItem(track) {
  return track?.media_type === 'episode';
}

function setMarqueeText(el, text) {
  if (!el) return;
  el.classList.remove('is-marquee');
  el.style.removeProperty('--marquee-end');
  el.style.removeProperty('--marquee-duration');
  el.innerHTML = '';

  const inner = document.createElement('span');
  inner.className = 'marquee-inner';
  inner.textContent = text;
  el.appendChild(inner);

  requestAnimationFrame(() => {
    const overflow = inner.scrollWidth - el.clientWidth;
    if (overflow <= 2) return;

    const distance = overflow + 34;
    const duration = Math.min(34, Math.max(10, distance / 24));
    el.style.setProperty('--marquee-end', `${-distance}px`);
    el.style.setProperty('--marquee-duration', `${duration}s`);
    el.classList.add('is-marquee');
  });
}

function setMessage(message) {
  queueList.innerHTML = '';
  queueMessage.textContent = message;
  queueMessage.classList.remove('hidden');
  card.classList.remove('hidden');
  lastQueueSignature = '';
}

function createQueueItem(track, index) {
  const item = document.createElement('article');
  item.className = `queue-item ${isPodcastItem(track) ? 'is-podcast' : ''}`;
  item.style.setProperty('--delay', `${index * 70}ms`);

  const number = document.createElement('div');
  number.className = 'queue-number';
  number.textContent = String(index + 1).padStart(2, '0');

  const coverWrap = document.createElement('div');
  coverWrap.className = 'queue-cover-wrap';

  const cover = document.createElement('img');
  cover.className = 'queue-cover';
  cover.alt = `${track.name || (isPodcastItem(track) ? 'Podcast' : '歌曲')} cover`;

  if (track.cover_url) {
    cover.src = track.cover_url;
  } else {
    coverWrap.classList.add('empty-cover');
  }

  coverWrap.appendChild(cover);

  const meta = document.createElement('div');
  meta.className = 'queue-meta';

  const title = document.createElement('div');
  title.className = 'queue-title';
  setMarqueeText(title, track.name || (isPodcastItem(track) ? '未知 Podcast' : '未知歌曲'));

  const artist = document.createElement('div');
  artist.className = 'queue-artist';
  setMarqueeText(artist, track.artists || (isPodcastItem(track) ? 'Podcast' : '未知歌手'));

  meta.append(title, artist);

  const duration = document.createElement('div');
  duration.className = 'queue-duration';
  duration.textContent = isPodcastItem(track) ? `POD ${formatDuration(track.duration_ms)}`.trim() : formatDuration(track.duration_ms);

  item.append(number, coverWrap, meta, duration);
  return item;
}

function renderQueue(queue) {
  const visibleQueue = (queue || []).slice(0, MAX_VISIBLE_ITEMS);
  const signature = visibleQueue.map(track => track.id || track.uri || `${track.name}-${track.artists}`).join('|');

  card.classList.remove('hidden');

  if (!visibleQueue.length) {
    setMessage('目前沒有下一首');
    return;
  }

  if (signature === lastQueueSignature) return;
  lastQueueSignature = signature;

  queueMessage.classList.add('hidden');
  queueList.innerHTML = '';

  visibleQueue.forEach((track, index) => {
    queueList.appendChild(createQueueItem(track, index));
  });
}

function renderError(error) {
  if (error === 'missing_scope_or_forbidden') {
    setMessage('請重新授權 Spotify');
    return;
  }

  if (error === 'no_active_device') {
    setMessage('沒有偵測到播放裝置');
    return;
  }

  setMessage('無法讀取佇列');
}

async function fetchQueue() {
  try {
    const res = await fetch(`${QUEUE_URL}?_t=${Date.now()}`);
    const data = await res.json();

    if (!data.authorized) {
      setMessage('請先登入 Spotify');
      return;
    }

    if (!res.ok || data.error) {
      renderError(data.error);
      return;
    }

    renderQueue(data.queue || []);
  } catch (err) {
    console.error('Failed to fetch Spotify queue:', err);
    setMessage('無法讀取佇列');
  }
}

fetchQueue();
setInterval(fetchQueue, 5000);
