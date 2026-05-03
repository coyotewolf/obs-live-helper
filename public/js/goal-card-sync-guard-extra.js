/* OBS Live Helper – guard Goal Card overlay from stale server echoes.
   When Dashboard changes a goal, BroadcastChannel reaches this overlay before
   the debounced server write finishes. During that short window, the overlay's
   polling request can still read the old server value and overwrite the fresh
   local value, which is most visible on 1 -> 0 progress changes. */
(function goalCardSyncGuardExtra(){
  const GOAL_KEY = 'obsHelperGoalCards';
  const CONFIG_KEY = 'obsHelperOverlayConfigCache';
  const CHANNEL_NAME = 'obs-helper-overlay-config';
  const GUARD_MS = 3500;

  let guardUntil = 0;
  let lastChannelGoalSignature = '';

  function safeParseJson(text, fallback = null){
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function normalizeForSignature(goal){
    if (!goal || typeof goal !== 'object') return null;
    return JSON.stringify(goal);
  }

  function readLocalGoal(){
    return safeParseJson(localStorage.getItem(GOAL_KEY) || 'null');
  }

  function isOverlayConfigGet(input, init){
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET') return false;
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return false;
    return String(raw).includes('/api/overlay-config');
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', event => {
    if (event.data?.type !== 'overlay-config-change' || !event.data.goal) return;
    lastChannelGoalSignature = normalizeForSignature(event.data.goal) || '';
    guardUntil = Date.now() + GUARD_MS;
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function guardedFetch(input, init){
    const response = await originalFetch(input, init);
    if (!isOverlayConfigGet(input, init) || Date.now() > guardUntil) return response;

    const cloned = response.clone();
    const data = await cloned.json().catch(() => null);
    if (!data?.ok || !data.config?.goal) return response;

    const localGoal = readLocalGoal();
    const localSignature = normalizeForSignature(localGoal);
    const serverSignature = normalizeForSignature(data.config.goal);

    if (!localGoal || !localSignature || localSignature === serverSignature) return response;

    // Only block stale echoes right after a channel update. If localStorage still
    // matches the last channel goal, the server response is older than the UI state.
    if (lastChannelGoalSignature && localSignature !== lastChannelGoalSignature) return response;

    const patched = {
      ...data,
      config: {
        ...data.config,
        goal: localGoal,
        updatedAt: Math.max(Number(data.config.updatedAt || 0), Date.now())
      }
    };

    try {
      const shared = safeParseJson(localStorage.getItem(CONFIG_KEY) || '{}', {});
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...shared, ...patched.config }));
    } catch {}

    return new Response(JSON.stringify(patched), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  };
})();
