/**
 * Centralized Spotify playback cache.
 *
 * Why this exists:
 * - OBS overlays, Dashboard, lyrics sync, and queue pages all ask for Spotify state.
 * - If every endpoint calls Spotify directly, Spotify can return 429 Too many requests.
 * - This module makes one shared cached request and applies backoff when Spotify asks us to slow down.
 */
const axios = require('axios');
const { getAccessToken } = require('./spotifyAuth');

const PLAYBACK_TTL_MS = Number(process.env.SPOTIFY_PLAYBACK_CACHE_MS || 2500);
const QUEUE_TTL_MS = Number(process.env.SPOTIFY_QUEUE_CACHE_MS || 5000);
const DEFAULT_BACKOFF_MS = 8000;

let playbackCache = null;
let playbackFetchedAt = 0;
let playbackPromise = null;
let playbackBackoffUntil = 0;

let queueCache = null;
let queueFetchedAt = 0;
let queuePromise = null;
let queueBackoffUntil = 0;

function getRetryAfterMs(err) {
  const retryAfter = Number(err.response?.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return DEFAULT_BACKOFF_MS;
}

function normalizeTrack(item) {
  if (!item || item.type !== 'track') return null;

  const images = item.album?.images || [];
  const largestImage = images[0]?.url || '';
  const mediumImage = images[1]?.url || largestImage;
  const smallImage = images[2]?.url || mediumImage;

  return {
    id: item.id,
    uri: item.uri,
    name: item.name || '未知歌曲',
    artists: item.artists?.map(a => a.name).join(', ') || '未知歌手',
    album: item.album?.name || '',
    album_images: images,
    cover_url: mediumImage,
    cover_large_url: largestImage,
    cover_small_url: smallImage,
    duration_ms: item.duration_ms || 0,
    explicit: Boolean(item.explicit),
    external_url: item.external_urls?.spotify || ''
  };
}

function withLiveProgress(payload) {
  if (!payload || !payload.track) return payload;

  const cloned = JSON.parse(JSON.stringify(payload));
  const track = cloned.track;
  const fetchedAt = track.fetched_at || cloned.fetched_at || Date.now();

  if (track.is_playing && track.duration_ms) {
    const elapsed = Date.now() - fetchedAt;
    track.progress_ms = Math.min(track.duration_ms, Math.max(0, (track.progress_ms || 0) + elapsed));
  }

  track.fetched_at = Date.now();
  cloned.fetched_at = Date.now();
  return cloned;
}

function buildPlaybackPayload(data) {
  if (!data || !data.item) {
    return {
      authorized: true,
      playing: false,
      track: null,
      fetched_at: Date.now()
    };
  }

  const track = normalizeTrack(data.item);
  if (track) {
    track.progress_ms = data.progress_ms || 0;
    track.is_playing = Boolean(data.is_playing);
    track.device = data.device ? {
      id: data.device.id,
      name: data.device.name,
      type: data.device.type,
      volume_percent: data.device.volume_percent
    } : null;
    track.fetched_at = Date.now();
  }

  return {
    authorized: true,
    playing: Boolean(data.is_playing && track),
    track,
    fetched_at: Date.now()
  };
}

async function fetchPlaybackFromSpotify() {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return {
      authorized: false,
      playing: false,
      track: null,
      fetched_at: Date.now()
    };
  }

  const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 8000,
    validateStatus: status => (status >= 200 && status < 300) || status === 204
  });

  if (response.status === 204) return buildPlaybackPayload(null);
  return buildPlaybackPayload(response.data);
}

async function getCurrentPlayback(options = {}) {
  const now = Date.now();
  const ttlMs = Number(options.ttlMs ?? PLAYBACK_TTL_MS);

  if (!options.force && playbackCache && now - playbackFetchedAt < ttlMs) {
    return withLiveProgress(playbackCache);
  }

  if (!options.force && playbackBackoffUntil > now) {
    const waitMs = playbackBackoffUntil - now;
    if (playbackCache) return { ...withLiveProgress(playbackCache), rate_limited: true, retry_after_ms: waitMs };
    return { authorized: true, playing: false, track: null, rate_limited: true, retry_after_ms: waitMs, fetched_at: now };
  }

  if (playbackPromise) return withLiveProgress(await playbackPromise);

  playbackPromise = fetchPlaybackFromSpotify()
    .then(payload => {
      playbackCache = payload;
      playbackFetchedAt = Date.now();
      return payload;
    })
    .catch(err => {
      if (err.response?.status === 429) {
        const waitMs = getRetryAfterMs(err);
        playbackBackoffUntil = Date.now() + waitMs;
        console.warn(`Spotify playback rate limited. Backing off for ${Math.ceil(waitMs / 1000)}s.`);
        if (playbackCache) return { ...withLiveProgress(playbackCache), rate_limited: true, retry_after_ms: waitMs };
        return { authorized: true, playing: false, track: null, rate_limited: true, retry_after_ms: waitMs, fetched_at: Date.now() };
      }
      throw err;
    })
    .finally(() => {
      playbackPromise = null;
    });

  return withLiveProgress(await playbackPromise);
}

async function fetchQueueFromSpotify() {
  const accessToken = await getAccessToken();
  if (!accessToken) return { authorized: false, queue: [] };

  const { data } = await axios.get('https://api.spotify.com/v1/me/player/queue', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 8000
  });

  return {
    authorized: true,
    currently_playing: normalizeTrack(data.currently_playing),
    queue: (data.queue || []).map(normalizeTrack).filter(Boolean).slice(0, 8),
    fetched_at: Date.now()
  };
}

async function getQueue(options = {}) {
  const now = Date.now();
  const ttlMs = Number(options.ttlMs ?? QUEUE_TTL_MS);

  if (!options.force && queueCache && now - queueFetchedAt < ttlMs) return queueCache;

  if (!options.force && queueBackoffUntil > now) {
    const waitMs = queueBackoffUntil - now;
    if (queueCache) return { ...queueCache, rate_limited: true, retry_after_ms: waitMs };
    return { authorized: true, queue: [], rate_limited: true, retry_after_ms: waitMs };
  }

  if (queuePromise) return queuePromise;

  queuePromise = fetchQueueFromSpotify()
    .then(payload => {
      queueCache = payload;
      queueFetchedAt = Date.now();
      return payload;
    })
    .catch(err => {
      if (err.response?.status === 429) {
        const waitMs = getRetryAfterMs(err);
        queueBackoffUntil = Date.now() + waitMs;
        console.warn(`Spotify queue rate limited. Backing off for ${Math.ceil(waitMs / 1000)}s.`);
        if (queueCache) return { ...queueCache, rate_limited: true, retry_after_ms: waitMs };
        return { authorized: true, queue: [], rate_limited: true, retry_after_ms: waitMs };
      }
      throw err;
    })
    .finally(() => {
      queuePromise = null;
    });

  return queuePromise;
}

function clearPlaybackCache() {
  playbackCache = null;
  playbackFetchedAt = 0;
  queueCache = null;
  queueFetchedAt = 0;
}

module.exports = {
  getCurrentPlayback,
  getQueue,
  normalizeTrack,
  clearPlaybackCache
};
