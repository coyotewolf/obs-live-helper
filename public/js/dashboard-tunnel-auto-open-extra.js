/* OBS Live Helper – Dashboard Tunnel auto-open option */
(function dashboardTunnelAutoOpenExtra(){
  const POLL_MS = 3000;

  function ensureStyles(){
    if (document.getElementById('dashboardTunnelAutoOpenStyle')) return;
    const style = document.createElement('style');
    style.id = 'dashboardTunnelAutoOpenStyle';
    style.textContent = `
      .tunnelAutoOpenBox{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px;padding:12px 14px;border:1px solid rgba(125,211,252,.16);border-radius:18px;background:rgba(125,211,252,.055)}
      .tunnelAutoOpenBox strong{display:block;margin-bottom:4px}.tunnelAutoOpenBox p{margin:0;font-size:.88rem}.tunnelAutoSwitch{display:inline-flex;align-items:center;gap:10px;min-height:38px;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:var(--text);font-weight:900;white-space:nowrap;cursor:pointer}.tunnelAutoSwitch input{width:18px;height:18px;accent-color:#38bdf8}.tunnelAutoSwitch.isOn{border-color:rgba(134,239,172,.34);background:rgba(134,239,172,.10);color:var(--good)}
      @media(max-width:760px){.tunnelAutoOpenBox{display:block}.tunnelAutoSwitch{margin-top:10px}}
    `;
    document.head.appendChild(style);
  }

  function adminHeaders(){
    const token = localStorage.getItem('obsHelperAdminToken') || '';
    return {'Content-Type':'application/json','x-admin-token':token};
  }

  function ensureControl(){
    const tunnelBox = document.querySelector('.tunnelBox');
    if (!tunnelBox) return null;
    let box = document.getElementById('tunnelAutoOpenBox');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'tunnelAutoOpenBox';
    box.className = 'tunnelAutoOpenBox';
    box.innerHTML = `
      <div>
        <strong>自動開啟 Tunnel</strong>
        <p id="tunnelAutoOpenHint">開啟後，每次啟動 Helper 會自動建立外網點歌網址。</p>
      </div>
      <label class="tunnelAutoSwitch" id="tunnelAutoOpenSwitch">
        <input type="checkbox" id="tunnelAutoOpenToggle">
        <span>啟動時自動開啟</span>
      </label>
    `;
    tunnelBox.insertAdjacentElement('afterend', box);

    document.getElementById('tunnelAutoOpenToggle')?.addEventListener('change', onToggle);
    return box;
  }

  function applyStatus(tunnel = {}){
    ensureControl();
    const toggle = document.getElementById('tunnelAutoOpenToggle');
    const switchEl = document.getElementById('tunnelAutoOpenSwitch');
    const hint = document.getElementById('tunnelAutoOpenHint');
    if (!toggle || !switchEl) return;

    const enabled = Boolean(tunnel.autoOpenTunnel ?? tunnel.enabled);
    toggle.checked = enabled;
    switchEl.classList.toggle('isOn', enabled);
    if (hint) {
      hint.textContent = enabled
        ? '已啟用；下次啟動 Helper 時會自動建立 Cloudflare Tunnel。'
        : '已關閉；需要外網點歌時請手動按「啟動 Tunnel」。';
    }
  }

  async function fetchStatus(){
    try {
      const res = await fetch('/api/request/tunnel/status', { headers: adminHeaders(), cache:'no-store' });
      const data = await res.json().catch(() => null);
      if (data?.ok) applyStatus(data.tunnel || {});
    } catch {}
  }

  async function onToggle(event){
    const enabled = Boolean(event.target.checked);
    event.target.disabled = true;
    try {
      const res = await fetch('/api/request/tunnel/auto-open', {
        method:'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ enabled })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok === false) throw new Error(data?.message || 'Tunnel 自動開啟設定失敗');
      applyStatus(data.tunnel || {});
      if (typeof window.showToast === 'function') window.showToast(enabled ? '已啟用 Tunnel 自動開啟' : '已關閉 Tunnel 自動開啟');
      setTimeout(() => {
        if (typeof window.loadAdminInfo === 'function') window.loadAdminInfo();
      }, 1200);
    } catch (err) {
      event.target.checked = !enabled;
      if (typeof window.showToast === 'function') window.showToast(err.message || 'Tunnel 自動開啟設定失敗');
    } finally {
      event.target.disabled = false;
    }
  }

  ensureStyles();
  ensureControl();
  fetchStatus();
  setInterval(fetchStatus, POLL_MS);
})();
