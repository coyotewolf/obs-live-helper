const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const runtimePaths = require('../services/runtimePaths');
const { isLocalRequest } = require('../services/securityStore');

const MAX_BACKUP_FILE_BYTES = Number(process.env.BACKUP_MAX_FILE_BYTES || 5 * 1024 * 1024);

const INCLUDED_DIRS = [
  { key: 'storage', dir: runtimePaths.STORAGE_DIR },
  { key: 'lyrics', dir: runtimePaths.LYRICS_DIR },
  { key: 'fonts', dir: runtimePaths.FONTS_DIR }
];

function assertLocal(req, res) {
  if (isLocalRequest(req)) return true;
  res.status(403).json({ ok: false, error: 'local_only', message: '備份與初始化只能從本機 Dashboard 執行。' });
  return false;
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function boolFromQuery(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getBackupOptions(query = {}) {
  return {
    env: boolFromQuery(query.env, true),
    storageOther: boolFromQuery(query.storageOther, true),
    overlayConfig: boolFromQuery(query.overlayConfig, true),
    lyricsLog: boolFromQuery(query.lyricsLog, true),
    lrclibCache: boolFromQuery(query.lrclibCache, true),
    currentLyrics: boolFromQuery(query.currentLyrics, true),
    keepFiles: boolFromQuery(query.keepFiles, true),
    fonts: boolFromQuery(query.fonts, true)
  };
}

function parseEnvText(text = '') {
  const env = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJsonFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function shouldIncludeFile(area, relPath, options) {
  const fileName = path.posix.basename(relPath);

  if (fileName === '.keep') return options.keepFiles;
  if (area === 'fonts') return options.fonts;

  if (area === 'lyrics') {
    if (relPath === 'current.lrc') return options.currentLyrics;
    return options.currentLyrics;
  }

  if (area === 'storage') {
    if (relPath === 'lyrics.log') return options.lyricsLog;
    if (relPath === 'lrclib-cache.json') return options.lrclibCache;
    if (relPath === 'overlay-config.json') return options.overlayConfig;
    return options.storageOther;
  }

  return true;
}

function walkFiles(rootDir, area, options) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_BACKUP_FILE_BYTES) continue;

      const rel = toPosixPath(path.relative(rootDir, abs));
      if (!shouldIncludeFile(area, rel, options)) continue;
      out.push({ abs, rel, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  walk(rootDir);
  return out;
}

function readRuntimeFiles(options) {
  const files = [];
  for (const group of INCLUDED_DIRS) {
    for (const file of walkFiles(group.dir, group.key, options)) {
      const buffer = fs.readFileSync(file.abs);
      files.push({
        area: group.key,
        path: file.rel,
        encoding: 'base64',
        content: buffer.toString('base64'),
        size: file.size,
        mtimeMs: file.mtimeMs
      });
    }
  }
  return files.sort((a, b) => `${a.area}/${a.path}`.localeCompare(`${b.area}/${b.path}`));
}

function makeSummaryFiles(payload) {
  const out = [];
  if (payload.env) {
    out.push({ area: 'config', path: '.env', size: Buffer.byteLength(payload.env, 'utf8'), virtual: true });
  }
  for (const file of payload.files) {
    out.push({ area: file.area, path: file.path, size: file.size, mtimeMs: file.mtimeMs, virtual: false });
  }
  return out.sort((a, b) => `${a.area}/${a.path}`.localeCompare(`${b.area}/${b.path}`));
}

function makeBackupPayload(options = getBackupOptions()) {
  runtimePaths.ensureRuntimeDirs();
  const overlayConfigPath = runtimePaths.storagePath('overlay-config.json');
  const files = readRuntimeFiles(options);
  const includedNames = new Set(files.map(file => `${file.area}/${file.path}`));
  const envText = options.env ? readTextFileIfExists(runtimePaths.ENV_PATH) : null;
  const envMap = parseEnvText(envText || '');
  const overlayConfig = options.overlayConfig ? readJsonFileIfExists(overlayConfigPath) : null;

  return {
    app: 'OBS Live Helper',
    type: 'obs-live-helper-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    dataDir: runtimePaths.DATA_DIR,
    backupOptions: options,
    notes: [
      'This backup contains the selected OBS Live Helper local settings and runtime files.',
      'Spotify Client ID and Discord StreamKit URL are stored in the env field when env backup is enabled.',
      'Small goal and live clock settings are stored in storage/overlay-config.json when overlayConfig backup is enabled.',
      'Uploaded fonts are included when fonts backup is enabled.',
      `Files larger than ${MAX_BACKUP_FILE_BYTES} bytes are skipped to avoid accidental huge backups.`
    ],
    env: envText,
    overlayConfig,
    verification: {
      includesEnv: Boolean(envText),
      includesClientId: Boolean(envMap.CLIENT_ID),
      includesStreamKit: Boolean(envMap.DISCORD_STREAMKIT_URL || envMap.DEFAULT_STREAMKIT_URL),
      includesLyricsLog: includedNames.has('storage/lyrics.log'),
      includesLrclibCache: includedNames.has('storage/lrclib-cache.json'),
      includesStorageKeep: includedNames.has('storage/.keep'),
      includesLyricsKeep: includedNames.has('lyrics/.keep'),
      includesFontsKeep: includedNames.has('fonts/.keep'),
      includesOverlayConfigFile: includedNames.has('storage/overlay-config.json'),
      includesGoalSettings: Boolean(overlayConfig?.goal),
      includesClockSettings: Boolean(overlayConfig?.clock)
    },
    files
  };
}

function backupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `obs-live-helper-backup-${stamp}.json`;
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function resetAllRuntimeData() {
  runtimePaths.ensureRuntimeDirs();
  for (const dir of [runtimePaths.STORAGE_DIR, runtimePaths.LYRICS_DIR, runtimePaths.FONTS_DIR]) {
    removeDirContents(dir);
  }
  try { fs.rmSync(runtimePaths.ENV_PATH, { force: true }); } catch {}

  for (const key of [
    'CLIENT_ID',
    'REDIRECT_URI',
    'DISCORD_STREAMKIT_URL',
    'DEFAULT_STREAMKIT_URL',
    'ENABLE_PUBLIC_TUNNEL',
    'CLOUDFLARED_PATH'
  ]) {
    delete process.env[key];
  }

  runtimePaths.ensureRuntimeDirs();
  return {
    ok: true,
    reset: true,
    requiresRestart: true,
    dataDir: runtimePaths.DATA_DIR,
    message: '已初始化 OBS Live Helper runtime 資料。請重啟 npm start，並對 Dashboard 做 Ctrl + F5。'
  };
}

router.get('/export', (req, res) => {
  if (!assertLocal(req, res)) return;

  try {
    const payload = makeBackupPayload(getBackupOptions(req.query));
    const body = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    res.send(body);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'backup_failed', message: err.message || '備份建立失敗' });
  }
});

router.get('/summary', (req, res) => {
  if (!assertLocal(req, res)) return;

  try {
    const options = getBackupOptions(req.query);
    const payload = makeBackupPayload(options);
    const summaryFiles = makeSummaryFiles(payload);
    const totalBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    res.json({
      ok: true,
      fileCount: summaryFiles.length,
      runtimeFileCount: payload.files.length,
      approxBytes: totalBytes,
      includesEnv: Boolean(payload.env),
      backupOptions: options,
      verification: payload.verification,
      files: summaryFiles,
      dataDir: runtimePaths.DATA_DIR
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'backup_summary_failed', message: err.message || '備份資訊讀取失敗' });
  }
});

router.post('/reset-all', (req, res) => {
  if (!assertLocal(req, res)) return;

  try {
    res.json(resetAllRuntimeData());
  } catch (err) {
    res.status(500).json({ ok: false, error: 'reset_failed', message: err.message || '初始化失敗' });
  }
});

module.exports = router;
