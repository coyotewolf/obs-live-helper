const fs = require('fs');
const router = require('express').Router();
const runtimePaths = require('../services/runtimePaths');
const { getAdminToken, isLocalRequest } = require('../services/securityStore');

const CONFIG_PATH = runtimePaths.storagePath('overlay-config.json');

const defaultConfig = {
  version: 1,
  updatedAt: 0,
  theme: 'blue-night',
  goal: {
    layout: {
      direction: 'column',
      gap: 30,
      baseAlpha: 0.65,
      completedAlpha: 0.65,
      completeFlashMs: 3000
    },
    cards: [
      {
        uid: 'goal-default',
        text: '今日小目標：完成任務3場',
        current: 0,
        total: 3,
        visible: true,
        completed: false
      }
    ]
  },
  clock: {
    label: 'LIVE',
    timezone: 'Asia/Taipei',
    hour12: false,
    scale: 1,
    timeSize: '56px',
    dateSize: '18px'
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeTheme(theme) {
  return theme === 'pink-cute' ? 'pink-cute' : 'blue-night';
}

function normalizeGoal(goal = {}) {
  const next = {
    ...clone(defaultConfig.goal),
    ...(goal || {})
  };
  next.layout = {
    ...clone(defaultConfig.goal.layout),
    ...(goal.layout || {})
  };
  next.layout.direction = next.layout.direction === 'row' ? 'row' : 'column';
  next.layout.gap = safeNumber(next.layout.gap, 30, 0, 200);
  next.layout.baseAlpha = safeNumber(next.layout.baseAlpha, 0.65, 0, 1);
  next.layout.completedAlpha = safeNumber(next.layout.completedAlpha ?? next.layout.baseAlpha, next.layout.baseAlpha, 0, 1);
  next.layout.completeFlashMs = safeNumber(next.layout.completeFlashMs, 3000, 0, 30000);

  const cards = Array.isArray(goal.cards) && goal.cards.length ? goal.cards : clone(defaultConfig.goal.cards);
  next.cards = cards.slice(0, 20).map((card, index) => {
    const total = Math.max(1, Number(card.total) || 1);
    const current = Math.max(0, Math.min(total, Number(card.current) || 0));
    return {
      uid: String(card.uid || `goal-${index + 1}`),
      text: String(card.text || `今日小目標 ${index + 1}`),
      current,
      total,
      visible: card.visible !== false,
      completed: Boolean(card.completed)
    };
  });

  return next;
}

function normalizeClock(clock = {}) {
  return {
    label: String(clock.label || defaultConfig.clock.label),
    timezone: String(clock.timezone || defaultConfig.clock.timezone),
    hour12: Boolean(clock.hour12),
    scale: safeNumber(clock.scale, 1, 0.3, 3),
    timeSize: String(clock.timeSize || defaultConfig.clock.timeSize),
    dateSize: String(clock.dateSize || defaultConfig.clock.dateSize)
  };
}

function normalizeConfig(raw = {}) {
  return {
    version: 1,
    updatedAt: Number(raw.updatedAt) || 0,
    theme: normalizeTheme(raw.theme),
    goal: normalizeGoal(raw.goal),
    clock: normalizeClock(raw.clock)
  };
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return clone(defaultConfig);
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    console.warn('Failed to read overlay-config.json:', err.message);
    return clone(defaultConfig);
  }
}

function writeConfig(config) {
  const next = normalizeConfig(config);
  next.updatedAt = Date.now();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function canWrite(req) {
  const provided = String(req.query.admin || req.headers['x-admin-token'] || '').trim();
  return isLocalRequest(req) || (provided && provided === getAdminToken());
}

router.get('/', (req, res) => {
  res.json({ ok: true, config: readConfig() });
});

router.post('/', (req, res) => {
  if (!canWrite(req)) {
    return res.status(403).json({ ok: false, error: 'local_only', message: 'Overlay 設定只能從本機 Dashboard 修改。' });
  }

  const current = readConfig();
  const body = req.body || {};
  const next = {
    ...current,
    theme: body.theme ?? current.theme,
    goal: body.goal ?? current.goal,
    clock: body.clock ?? current.clock
  };

  const saved = writeConfig(next);
  res.json({ ok: true, config: saved });
});

router.post('/reset', (req, res) => {
  if (!canWrite(req)) {
    return res.status(403).json({ ok: false, error: 'local_only', message: 'Overlay 設定只能從本機 Dashboard 修改。' });
  }

  const saved = writeConfig(clone(defaultConfig));
  res.json({ ok: true, config: saved });
});

module.exports = router;
