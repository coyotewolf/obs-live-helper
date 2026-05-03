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

// Keep this empty on purpose: the user requested a complete runtime backup,
// including lyrics.log, lrclib-cache.json, and .keep files.
const SKIP_FILE_NAMES = new Set();

function assertLocal(req, res) {
  if (isLocalRequest(req)) return true;
  res.status(403).json({ ok: false, error: 'local_only', message: '備份只能從本機 Dashboard 執行。' });
  return false;
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
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

function walkFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_FILE_NAMES.has(name)) continue;
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_BACKUP_FILE_BYTES) continue;
      out.push({ abs, rel: toPosixPath(path.relative(rootDir, abs)), size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  walk(rootDir);
  return out;
}

function readRuntimeFiles() {
  const files = [];
  for (const group of INCLUDED_DIRS) {
    for (const file of walkFiles(group.dir)) {
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
  return files;
}

function makeBackupPayload() {
  runtimePaths.ensureRuntimeDirs();
  const overlayConfigPath = runtimePaths.storagePath('overlay-config.json');
  const files = readRuntimeFiles();
  const includedNames = new Set(files.map(file => `${file.area}/${file.path}`));

  return {
    app: 'OBS Live Helper',
    type: 'obs-live-helper-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    dataDir: runtimePaths.DATA_DIR,
    notes: [
      'This backup contains local OBS Live Helper settings and runtime files.',
      'lyrics.log, lrclib-cache.json, and .keep files are included.',
      'Small goal and live clock settings are stored in storage/overlay-config.json and are included in this backup.',
      'Uploaded fonts are included as base64 files.',
      `Files larger than ${MAX_BACKUP_FILE_BYTES} bytes are skipped to avoid accidental huge backups.`
    ],
    env: readTextFileIfExists(runtimePaths.ENV_PATH),
    overlayConfig: readJsonFileIfExists(overlayConfigPath),
    verification: {
      includesLyricsLog: includedNames.has('storage/lyrics.log'),
      includesLrclibCache: includedNames.has('storage/lrclib-cache.json'),
      includesStorageKeep: includedNames.has('storage/.keep'),
      includesLyricsKeep: includedNames.has('lyrics/.keep'),
      includesFontsKeep: includedNames.has('fonts/.keep'),
      includesOverlayConfigFile: includedNames.has('storage/overlay-config.json'),
      includesGoalSettings: Boolean(readJsonFileIfExists(overlayConfigPath)?.goal),
      includesClockSettings: Boolean(readJsonFileIfExists(overlayConfigPath)?.clock)
    },
    files
  };
}

function backupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `obs-live-helper-backup-${stamp}.json`;
}

router.get('/export', (req, res) => {
  if (!assertLocal(req, res)) return;

  try {
    const payload = makeBackupPayload();
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
    const payload = makeBackupPayload();
    const totalBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    res.json({
      ok: true,
      fileCount: payload.files.length,
      approxBytes: totalBytes,
      includesEnv: Boolean(payload.env),
      excluded: Array.from(SKIP_FILE_NAMES),
      verification: payload.verification,
      dataDir: runtimePaths.DATA_DIR
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'backup_summary_failed', message: err.message || '備份資訊讀取失敗' });
  }
});

module.exports = router;
