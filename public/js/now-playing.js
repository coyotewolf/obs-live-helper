const STATUS_URL = '/api/spotify/status';

const card = document.getElementById('nowPlayingCard');
const cover = document.getElementById('cover');
const songName = document.getElementById('songName');
const artistName = document.getElementById('artistName');
const playState = document.getElementById('playState');
const currentTime = document.getElementById('currentTime');
const durationTime = document.getElementById('durationTime');
const progressFill = document.getElementById('progressFill');

let latestTrack = null;
let latestFetchTime = 0;

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isTrackPlaying(track) {
  return Boolean(track?.is_playing);
}

function isPodcastMedia(track) {
  return track?.media_type === 'episode' || track?.playback_type === 'episode' || track?.isPodcast;
}

function setMarqueeText(el, text) {
  if (!el) return;
  const safeText = String(text || '');

  el.classList.remove('is-marquee');
  el.style.removeProperty('--marquee-end');
  el.style.removeProperty('--marquee-duration');
  el.innerHTML = '';

  const inner = document.createElement('span');
  inner.className = 'marquee-inner';

  const track = document.createElement('span');
  track.className = 'marquee-track';

  const first = document.createElement('span');
  first.className = 'marquee-copy marquee-copy-main';
  first.textContent = safeText;

  track.appendChild(first);
  inner.appendChild(track);
  el.appendChild(inner);

  requestAnimationFrame(() => {
    const overflow = first.scrollWidth - el.clientWidth;
    if (overflow <= 2) return;

    const second = document.createElement('span');
    second.className = 'marquee-copy';
    second.textContent = safeText;
    track.appendChild(second);

    requestAnimationFrame(() => {
      const singleCycle = second.offsetLeft - first.offsetLeft;
      const duration = Math.min(42, Math.max(12, singleCycle / 34));
      el.style.setProperty('--marquee-end', `${-singleCycle}px`);
      el.style.setProperty('--marquee-duration', `${duration}s`);
      el.classList.add('is-marquee');
    });
  });
}

function getDisplayProgress(track) {
  if (!track) return 0;

  const baseProgress = track.progress_ms || 0;
  const duration = track.duration_ms || 0;

  if (!isTrackPlaying(track)) return baseProgress;

  const elapsedSinceFetch = Date.now() - latestFetchTime;
  return clamp(baseProgress + elapsedSinceFetch, 0, duration);
}

function renderTrack(track) {
  if (!track) {
    card.classList.add('hidden');
    return;
  }

  const playing = isTrackPlaying(track);
  const isPodcast = isPodcastMedia(track);
  card.classList.remove('hidden');
  card.classList.toggle('paused', !playing);
  card.classList.toggle('playing', playing);
  card.classList.toggle('podcast', isPodcast);

  setMarqueeText(songName, track.name || (isPodcast ? '未知 Podcast' : '未知歌曲'));
  setMarqueeText(artistName, track.artists || (isPodcast ? 'Podcast' : '未知歌手'));

  if (track.cover_url) {
    cover.src = track.cover_url;
    cover.style.visibility = 'visible';
  } else {
    cover.removeAttribute('src');
    cover.style.visibility = 'hidden';
  }

  playState.dataset.state = isPodcast && playing ? 'podcast' : (playing ? 'playing' : 'paused');
  playState.textContent = isPodcast && playing ? 'PODCAST' : (playing ? 'PLAYING' : 'PAUSED');

  updateProgress();
}

function updateProgress() {
  if (!latestTrack) return;

  const duration = latestTrack.duration_ms || 0;
  const progress = getDisplayProgress(latestTrack);
  const percent = duration > 0 ? clamp((progress / duration) * 100, 0, 100) : 0;

  currentTime.textContent = formatTime(progress);
  durationTime.textContent = formatTime(duration);
  progressFill.style.width = `${percent}%`;
}

async function fetchStatus() {
  try {
    const res = await fetch(`${STATUS_URL}?_t=${Date.now()}`);
    const data = await res.json();
    const media = data.track || data.episode;

    if (!data.authorized || !media) {
      latestTrack = null;
      renderTrack(null);
      return;
    }

    const isPodcast = data.isPodcast || data.playback_type === 'episode' || media.media_type === 'episode';
    latestTrack = {
      ...media,
      isPodcast,
      playback_type: data.playback_type,
      is_playing: Boolean(data.playing || media?.is_playing || isPodcast)
    };
    latestFetchTime = Date.now();
    renderTrack(latestTrack);
  } catch (err) {
    console.error('Failed to fetch Spotify status:', err);
  }
}

fetchStatus();
setInterval(fetchStatus, 3000);
setInterval(updateProgress, 500);
