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

function getDisplayProgress(track) {
  if (!track) return 0;

  const baseProgress = track.progress_ms || 0;
  const duration = track.duration_ms || 0;

  if (!track.is_playing) return baseProgress;

  const elapsedSinceFetch = Date.now() - latestFetchTime;
  return clamp(baseProgress + elapsedSinceFetch, 0, duration);
}

function renderTrack(track) {
  if (!track) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');

  songName.textContent = track.name || '未知歌曲';
  artistName.textContent = track.artists || '未知歌手';

  if (track.cover_url) {
    cover.src = track.cover_url;
    cover.style.visibility = 'visible';
  } else {
    cover.removeAttribute('src');
    cover.style.visibility = 'hidden';
  }

  playState.textContent = track.is_playing ? 'NOW PLAYING' : 'PAUSED';
  card.classList.toggle('paused', !track.is_playing);

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

    if (!data.authorized || !data.playing || !data.track) {
      latestTrack = null;
      renderTrack(null);
      return;
    }

    latestTrack = data.track;
    latestFetchTime = Date.now();
    renderTrack(latestTrack);
  } catch (err) {
    console.error('Failed to fetch Spotify status:', err);
  }
}

fetchStatus();
setInterval(fetchStatus, 3000);
setInterval(updateProgress, 500);