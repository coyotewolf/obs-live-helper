/**
 * Centralized Spotify playback cache.
 *
 * Why this exists:
 * - OBS overlays, Dashboard, lyrics sync, and queue pages all ask for Spotify state.
 * - If every endpoint calls Spotify directly, Spotify can return 429 Too many requests.
 * - This module makes one shared cached request and switches to manual retry when Spotify rate limits or times out.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('./spotifyAuth');

let storagePath;
try {
  ({ storagePath } = require('./runtimePaths'));
} catch {
  storagePath = (fileName) => path.join(__dirname, '..', 'storage', fileName);
}

// Safer defaults for Spotify's rolling 30-second rate-limit window.
const PLAYBACK_TTL_MS = Number(process.env.SPOTIFY_PLAYBACK_CACHE_MS || 10000);
const QUEUE_TTL_MS = Number(process.env.SPOTIFY_QUEUE_CACHE_MS || 30000);
const DEFAULT_BACKOFF_MS = Number(process.env.SPOTIFY_DEFAULT_BACKOFF_MS || 8000);
const MAX_BACKOFF_MS = Number(process.env.SPOTIFY_MAX_BACKOFF_MS || 60000);
const SPOTIFY_PLAYBACK_TIMEOUT_MS = Number(process.env.SPOTIFY_PLAYBACK_TIMEOUT_MS || 8000);
const SPOTIFY_QUEUE_TIMEOUT_MS = Number(process.env.SPOTIFY_QUEUE_TIMEOUT_MS || 8000);

let playbackCache = null;
let playbackFetchedAt = 0;
let playbackPromise = null;
let playbackBackoffUntil = 0;
let playbackManualRetryRequired = false;
let playbackRateLimitInfo = null;
let playbackTimeoutInfo = null;

let queueCache = null;
let queueFetchedAt = 0;
let queuePromise = null;
let queueBackoffUntil = 0;
let queueManualRetryRequired = false;
let queueRateLimitInfo = null;
let queueTimeoutInfo = null;

let lastPlaybackRateLimitLogAt = 0;
let lastQueueRateLimitLogAt = 0;
let lastPlaybackTimeoutLogAt = 0;
let lastQueueTimeoutLogAt = 0;

function appendSpotifyLog(message) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${message}\n`;
  try {
    const file = storagePath('lyrics.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
  } catch (err) {
    console.warn('Failed to write Spotify log:', err.message);
  }
}

function warnAndLogRateLimit(kind, rawRetryAfter, waitMs) {
  const message = `⚠️ Spotify ${kind} rate limited. Retry-After=${rawRetryAfter || 'not provided'}, manual retry required. Suggested wait: ${Math.ceil(waitMs / 1000)}s.`;
  console.warn(message);

  const now = Date.now();
  const isPlayback = kind === 'playback';
  const last = isPlayback ? lastPlaybackRateLimitLogAt : lastQueueRateLimitLogAt;

  if (now - last > 5000) {
    appendSpotifyLog(message);
    if (isPlayback) lastPlaybackRateLimitLogAt = now;
    else lastQueueRateLimitLogAt = now;
  }
}

function warnAndLogTimeout(kind, info) {
  const message = `⚠️ Spotify ${kind} timeout after ${info.elapsed_ms}ms. requested_at=${new Date(info.request_started_at).toISOString()}, timeout_at=${new Date(info.timed_out_at).toISOString()}, manual retry required.`;
  console.warn(message);

  const now = Date.now();
  const isPlayback = kind === 'playback';
  const last = isPlayback ? lastPlaybackTimeoutLogAt : lastQueueTimeoutLogAt;

  if (now - last > 5000) {
    appendSpotifyLog(message);
    if (isPlayback) lastPlaybackTimeoutLogAt = now;
    else lastQueueTimeoutLogAt = now;
  }
}

function isTimeoutError(err) {
  return err?.code === 'ECONNABORTED' || /timeout|timed out/i.test(String(err?.message || ''));
}

function getRetryAfterMs(err) {
  const raw = err.response?.headers?.['retry-after'];

  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();

    const seconds = Number.parseFloat(text);
    if (Number.isFinite(seconds) && seconds > 0) {
      const ms = seconds * 1000;
      return Math.min(ms, MAX_BACKOFF_MS);
    }

    const dateMs = Date.parse(text);
    if (Number.isFinite(dateMs)) {
      return Math.min(Math.max(dateMs - Date.now(), DEFAULT_BACKOFF_MS), MAX_BACKOFF_MS);
    }
  }

  return Math.min(DEFAULT_BACKOFF_MS, MAX_BACKOFF_MS);
}

function buildManualRateLimitPayload(kind, now = Date.now()) {
  const info = kind === 'playback' ? playbackRateLimitInfo : queueRateLimitInfo;
  return {
    rate_limited: true,
    manual_retry_required: true,
    retry_after_ms: info?.waitMs || 0,
    retry_after_raw: info?.rawRetryAfter || '',
    rate_limited_at: info?.at || now
  };
}

function buildManualTimeoutPayload(kind, now = Date.now()) {
  const info = kind === 'playback' ? playbackTimeoutInfo : queueTimeoutInfo;
  return {
    spotify_timeout: true,
    manual_retry_required: true,
    retry_after_ms: info?.waitMs || DEFAULT_BACKOFF_MS,
    spotify_timeout_ms: info?.timeout_ms || 0,
    spotify_response_elapsed_ms: info?.elapsed_ms || 0,
    spotify_request_started_at: info?.request_started_at || now,
    spotify_timeout_at: info?.timed_out_at || now,
    spotify_response_at: info?.timed_out_at || now
  };
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
    media_type: 'track',
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

function normalizeEpisode(item) {
  if (!item || item.type !== 'episode') return null;

  const images = item.images || item.show?.images || [];
  const largestImage = images[0]?.url || '';
  const mediumImage = images[1]?.url || largestImage;
  const smallImage = images[2]?.url || mediumImage;
  const showName = item.show?.name || item.publisher || '';

  return {
    id: item.id,
    uri: item.uri,
    media_type: 'episode',
    name: item.name || '未知 Podcast',
    artists: showName || 'Podcast',
    album: showName,
    album_images: images,
    cover_url: mediumImage,
    cover_large_url: largestImage,
    cover_small_url: smallImage,
    duration_ms: item.duration_ms || 0,
    explicit: Boolean(item.explicit),
    external_url: item.external_urls?.spotify || '',
    description: item.description || '',
    release_date: item.release_date || ''
  };
}

function attachPlaybackFields(item, data) {
  if (!item) return null;

  item.progress_ms = data.progress_ms || 0;
  item.is_playing = Boolean(data.is_playing);
  item.device = data.device ? {
    id: data.device.id,
    name: data.device.name,
    type: data.device.type,
    volume_percent: data.device.volume_percent
  } : null;
  item.fetched_at = Date.now();
  return item;
}

function withLiveProgress(payload) {
  if (!payload) return payload;
  const media = payload.track || payload.episode;
  if (!media) return payload;

  const cloned = JSON.parse(JSON.stringify(payload));
  const clonedMedia = cloned.track || cloned.episode;
  const fetchedAt = clonedMedia.fetched_at || cloned.fetched_at || Date.now();

  if (clonedMedia.is_playing && clonedMedia.duration_ms) {
    const elapsed = Date.now() - fetchedAt;
    clonedMedia.progress_ms = Math.min(clonedMedia.duration_ms, Math.max(0, (clonedMedia.progress_ms || 0) + elapsed));
  }

  clonedMedia.fetched_at = Date.now();
  cloned.fetched_at = Date.now();
  return cloned;
}

function buildPlaybackPayload(data) {
  if (!data || !data.item) {
    return {
      authorized: true,
      playing: false,
      track: null,
      episode: null,
      playback_type: data?.currently_playing_type || 'none',
      fetched_at: Date.now()
    };
  }

  const playbackType = data.currently_playing_type || data.item?.type || 'unknown';
  const track = attachPlaybackFields(normalizeTrack(data.item), data);
  const episode = attachPlaybackFields(normalizeEpisode(data.item), data);
  const media = track || episode;

  return {
    authorized: true,
    playing: Boolean(media && (data.is_playing || episode)),
    track,
    episode,
    playback_type: playbackType,
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
      episode: null,
      playback_type: 'none',
      fetched_at: Date.now()
    };
  }

  const requestStartedAt = Date.now();
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: SPOTIFY_PLAYBACK_TIMEOUT_MS,
      validateStatus: status => (status >= 200 && status < 300) || status === 204
    });

    const payload = response.status === 204 ? buildPlaybackPayload(null) : buildPlaybackPayload(response.data);
    payload.spotify_response_elapsed_ms = Date.now() - requestStartedAt;
    payload.spotify_response_at = Date.now();
    return payload;
  } catch (err) {
    err.spotifyTiming = {
      request_started_at: requestStartedAt,
      timed_out_at: Date.now(),
      elapsed_ms: Date.now() - requestStartedAt,
      timeout_ms: SPOTIFY_PLAYBACK_TIMEOUT_MS
    };
    throw err;
  }
}

async function getCurrentPlayback(options = {}) {
  const now = Date.now();
  const ttlMs = Number(options.ttlMs ?? PLAYBACK_TTL_MS);

  if (!options.force && playbackManualRetryRequired) {
    const manual = playbackTimeoutInfo ? buildManualTimeoutPayload('playback', now) : buildManualRateLimitPayload('playback', now);
    if (playbackCache) return { ...withLiveProgress(playbackCache), ...manual };
    return { authorized: true, playing: false, track: null, episode: null, playback_type: 'none', ...manual, fetched_at: now };
  }

  if (!options.force && playbackCache && now - playbackFetchedAt < ttlMs) {
    return withLiveProgress(playbackCache);
  }

  if (!options.force && playbackBackoffUntil > now) {
    const waitMs = playbackBackoffUntil - now;
    if (playbackCache) return { ...withLiveProgress(playbackCache), rate_limited: true, retry_after_ms: waitMs };
    return { authorized: true, playing: false, track: null, episode: null, playback_type: 'none', rate_limited: true, retry_after_ms: waitMs, fetched_at: now };
  }

  if (playbackPromise) return withLiveProgress(await playbackPromise);

  playbackPromise = fetchPlaybackFromSpotify()
    .then(payload => {
      playbackCache = payload;
      playbackFetchedAt = Date.now();
      playbackBackoffUntil = 0;
      playbackManualRetryRequired = false;
      playbackRateLimitInfo = null;
      playbackTimeoutInfo = null;
      return payload;
    })
    .catch(err => {
      if (err.response?.status === 429) {
        const waitMs = getRetryAfterMs(err);
        const rawRetryAfter = err.response?.headers?.['retry-after'];
        playbackBackoffUntil = 0;
        playbackManualRetryRequired = true;
        playbackRateLimitInfo = { rawRetryAfter, waitMs, at: Date.now() };
        playbackTimeoutInfo = null;
        warnAndLogRateLimit('playback', rawRetryAfter, waitMs);
        const manual = buildManualRateLimitPayload('playback');
        if (playbackCache) return { ...withLiveProgress(playbackCache), ...manual };
        return { authorized: true, playing: false, track: null, episode: null, playback_type: 'none', ...manual, fetched_at: Date.now() };
      }
      if (isTimeoutError(err)) {
        const timing = err.spotifyTiming || { request_started_at: Date.now(), timed_out_at: Date.now(), elapsed_ms: SPOTIFY_PLAYBACK_TIMEOUT_MS, timeout_ms: SPOTIFY_PLAYBACK_TIMEOUT_MS };
        playbackBackoffUntil = 0;
        playbackManualRetryRequired = true;
        playbackRateLimitInfo = null;
        playbackTimeoutInfo = { ...timing, waitMs: DEFAULT_BACKOFF_MS };
        warnAndLogTimeout('playback', playbackTimeoutInfo);
        const manual = buildManualTimeoutPayload('playback');
        if (playbackCache) return { ...withLiveProgress(playbackCache), ...manual };
        return { authorized: true, playing: false, track: null, episode: null, playback_type: 'none', ...manual, fetched_at: Date.now() };
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

  const requestStartedAt = Date.now();
  try {
    const { data } = await axios.get('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: SPOTIFY_QUEUE_TIMEOUT_MS
    });

    return {
      authorized: true,
      currently_playing: normalizeTrack(data.currently_playing),
      queue: (data.queue || []).map(normalizeTrack).filter(Boolean).slice(0, 8),
      fetched_at: Date.now(),
      spotify_response_elapsed_ms: Date.now() - requestStartedAt,
      spotify_response_at: Date.now()
    };
  } catch (err) {
    err.spotifyTiming = {
      request_started_at: requestStartedAt,
      timed_out_at: Date.now(),
      elapsed_ms: Date.now() - requestStartedAt,
      timeout_ms: SPOTIFY_QUEUE_TIMEOUT_MS
    };
    throw err;
  }
}

async function getQueue(options = {}) {
  const now = Date.now();
  const ttlMs = Number(options.ttlMs ?? QUEUE_TTL_MS);

  if (!options.force && queueManualRetryRequired) {
    const manual = queueTimeoutInfo ? buildManualTimeoutPayload('queue', now) : buildManualRateLimitPayload('queue', now);
    if (queueCache) return { ...queueCache, ...manual };
    return { authorized: true, queue: [], ...manual };
  }

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
      queueBackoffUntil = 0;
      queueManualRetryRequired = false;
      queueRateLimitInfo = null;
      queueTimeoutInfo = null;
      return payload;
    })
    .catch(err => {
      if (err.response?.status === 429) {
        const waitMs = getRetryAfterMs(err);
        const rawRetryAfter = err.response?.headers?.['retry-after'];
        queueBackoffUntil = 0;
        queueManualRetryRequired = true;
        queueRateLimitInfo = { rawRetryAfter, waitMs, at: Date.now() };
        queueTimeoutInfo = null;
        warnAndLogRateLimit('queue', rawRetryAfter, waitMs);
        const manual = buildManualRateLimitPayload('queue');
        if (queueCache) return { ...queueCache, ...manual };
        return { authorized: true, queue: [], ...manual };
      }
      if (isTimeoutError(err)) {
        const timing = err.spotifyTiming || { request_started_at: Date.now(), timed_out_at: Date.now(), elapsed_ms: SPOTIFY_QUEUE_TIMEOUT_MS, timeout_ms: SPOTIFY_QUEUE_TIMEOUT_MS };
        queueBackoffUntil = 0;
        queueManualRetryRequired = true;
        queueRateLimitInfo = null;
        queueTimeoutInfo = { ...timing, waitMs: DEFAULT_BACKOFF_MS };
        warnAndLogTimeout('queue', queueTimeoutInfo);
        const manual = buildManualTimeoutPayload('queue');
        if (queueCache) return { ...queueCache, ...manual };
        return { authorized: true, queue: [], ...manual };
      }
      throw err;
    })
    .finally(() => {
      queuePromise = null;
    });

  return queuePromise;
}

function clearSpotifyRateLimitLocks() {
  playbackBackoffUntil = 0;
  queueBackoffUntil = 0;
  playbackManualRetryRequired = false;
  queueManualRetryRequired = false;
  playbackRateLimitInfo = null;
  queueRateLimitInfo = null;
  playbackTimeoutInfo = null;
  queueTimeoutInfo = null;
  appendSpotifyLog('ℹ️ Spotify manual retry triggered: rate-limit / timeout locks cleared.');
}

function clearPlaybackCache() {
  playbackCache = null;
  playbackFetchedAt = 0;
  playbackBackoffUntil = 0;
  playbackManualRetryRequired = false;
  playbackRateLimitInfo = null;
  playbackTimeoutInfo = null;
}

function clearQueueCache() {
  queueCache = null;
  queueFetchedAt = 0;
  queueBackoffUntil = 0;
  queueManualRetryRequired = false;
  queueRateLimitInfo = null;
  queueTimeoutInfo = null;
}

function clearAllSpotifyCache() {
  clearPlaybackCache();
  clearQueueCache();
}

module.exports = {
  getCurrentPlayback,
  getQueue,
  normalizeTrack,
  normalizeEpisode,
  clearPlaybackCache,
  clearQueueCache,
  clearAllSpotifyCache,
  clearSpotifyRateLimitLocks
};
