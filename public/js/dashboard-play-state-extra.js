/* OBS Live Helper – Dashboard playback state symbols */
(function dashboardPlayStateExtra(){
  const STATUS_URL = '/api/spotify/status';
  const POLL_MS = 3000;

  function ensureStyles(){
    if (document.getElementById('dashboardPlayStateExtraStyle')) return;
    const style = document.createElement('style');
    style.id = 'dashboardPlayStateExtraStyle';
    style.textContent = `
      .trackBox{position:relative}
      .dashboardPlaybackBadge{display:inline-flex;align-items:center;gap:8px;margin-bottom:7px;padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.075);color:var(--muted);font-size:.78rem;font-weight:1000;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
      .dashboardPlaybackBadge::before{content:'▶';display:grid;place-items:center;width:20px;height:20px;border-radius:999px;color:#06111f;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 0 14px rgba(125,211,252,.48);font-size:10px;line-height:1;padding-left:1px;letter-spacing:0}
      .dashboardPlaybackBadge.isPlaying{color:var(--accent);border-color:rgba(125,211,252,.24);background:rgba(125,211,252,.08);text-shadow:0 0 14px rgba(125,211,252,.28)}
      .dashboardPlaybackBadge.isPlaying::before{animation:dashboardPlayPulse 1.6s ease-in-out infinite}
      .dashboardPlaybackBadge.isPaused{color:rgba(234,241,255,.68);border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.055);text-shadow:none}
      .dashboardPlaybackBadge.isPaused::before{content:'Ⅱ';padding-left:0;color:rgba(8,13,28,.88);background:rgba(255,255,255,.72);box-shadow:none;font-size:11px;font-weight:1000}
      .dashboardPlaybackBadge.isIdle::before{content:'♪';padding-left:0;color:var(--muted);background:rgba(255,255,255,.12);box-shadow:none;font-size:11px}
      @keyframes dashboardPlayPulse{0%,100%{transform:scale(1);box-shadow:0 0 12px rgba(125,211,252,.36)}50%{transform:scale(1.08);box-shadow:0 0 20px rgba(125,211,252,.62)}}
      body[data-theme="pink-cute"] .dashboardPlaybackBadge{background:rgba(255,255,255,.72);border-color:rgba(210,72,122,.16);color:rgba(67,33,54,.74)}
      body[data-theme="pink-cute"] .dashboardPlaybackBadge.isPlaying{color:#d9467f;background:rgba(255,255,255,.82);border-color:rgba(217,70,127,.24);text-shadow:0 0 12px rgba(217,70,127,.18)}
      body[data-theme="pink-cute"] .dashboardPlaybackBadge::before{background:linear-gradient(135deg,#8ec8ff,#ff7fa9)}
    `;
    document.head.appendChild(style);
  }

  function ensureBadge(){
    const trackBox = document.querySelector('#spotifyBlock .trackBox');
    if (!trackBox) return null;
    let badge = document.getElementById('dashboardPlaybackBadge');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'dashboardPlaybackBadge';
    badge.className = 'dashboardPlaybackBadge isIdle';
    badge.textContent = '尚未播放';
    const infoColumn = trackBox.querySelector('#trackInfo')?.parentElement;
    if (infoColumn) infoColumn.prepend(badge);
    return badge;
  }

  function setBadge(state){
    const badge = ensureBadge();
    if (!badge) return;
    badge.classList.remove('isPlaying','isPaused','isIdle');
    if (state === 'playing') {
      badge.classList.add('isPlaying');
      badge.textContent = '播放中';
      return;
    }
    if (state === 'paused') {
      badge.classList.add('isPaused');
      badge.textContent = '暫停中';
      return;
    }
    badge.classList.add('isIdle');
    badge.textContent = '尚未播放';
  }

  async function refresh(){
    try {
      const data = await fetch(`${STATUS_URL}?_t=${Date.now()}`, { cache:'no-store' }).then(res => res.json());
      if (!data.authorized || !data.track) return setBadge('idle');
      setBadge(data.playing || data.track?.is_playing ? 'playing' : 'paused');
    } catch {
      setBadge('idle');
    }
  }

  ensureStyles();
  ensureBadge();
  refresh();
  setInterval(refresh, POLL_MS);
})();
