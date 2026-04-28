/**
 * Centralized runtime paths.
 *
 * Development:
 *   - mutable data stays in the project folder.
 * Packaged Electron app:
 *   - mutable data goes to Electron userData / AppData, never Program Files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_ROOT_DIR = path.resolve(__dirname, '..');
const IS_ELECTRON = process.env.ELECTRON_APP === 'true' || Boolean(process.versions?.electron);

function defaultUserDataDir() {
  if (process.env.OBS_LIVE_HELPER_DATA_DIR) return process.env.OBS_LIVE_HELPER_DATA_DIR;

  // Safety fallback: if the app is packaged as app.asar, APP_ROOT_DIR is a file-like archive,
  // so writing APP_ROOT_DIR/storage would throw ENOTDIR.
  const appRootLooksReadOnly = APP_ROOT_DIR.includes('.asar') || APP_ROOT_DIR.includes('Program Files');

  if (IS_ELECTRON || appRootLooksReadOnly) {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OBS Live Helper');
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'OBS Live Helper');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'OBS Live Helper');
  }

  return APP_ROOT_DIR;
}

const DATA_DIR = path.resolve(defaultUserDataDir());
const RESOURCE_DIR = process.resourcesPath || APP_ROOT_DIR;

const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const LYRICS_DIR = path.join(DATA_DIR, 'lyrics');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const TOOLS_DIR = path.join(DATA_DIR, 'tools');
const ENV_PATH = path.join(DATA_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(APP_ROOT_DIR, '.env.example');
const PUBLIC_DIR = path.join(APP_ROOT_DIR, 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyIfMissing(src, dest) {
  try {
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    }
  } catch (err) {
    console.warn(`⚠️ Failed to copy ${src} -> ${dest}:`, err.message);
  }
}

function ensureRuntimeDirs() {
  ensureDir(DATA_DIR);
  ensureDir(STORAGE_DIR);
  ensureDir(LYRICS_DIR);
  ensureDir(FONTS_DIR);
  ensureDir(TOOLS_DIR);

  const keepFiles = [
    path.join(STORAGE_DIR, '.keep'),
    path.join(LYRICS_DIR, '.keep'),
    path.join(FONTS_DIR, '.keep'),
    path.join(TOOLS_DIR, '.keep')
  ];
  keepFiles.forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  });

  const lrcFile = path.join(LYRICS_DIR, 'current.lrc');
  if (!fs.existsSync(lrcFile)) fs.writeFileSync(lrcFile, '', 'utf8');

  // First launch in packaged app: create a writable .env in AppData from the bundled example.
  copyIfMissing(ENV_EXAMPLE_PATH, ENV_PATH);

  // Copy bundled fonts into writable user fonts folder so uploads and built-ins share /fonts.
  const bundledFontsDir = path.join(PUBLIC_DIR, 'fonts');
  if (fs.existsSync(bundledFontsDir)) {
    for (const file of fs.readdirSync(bundledFontsDir)) {
      if (/\.(ttf|otf|woff2?)$/i.test(file)) {
        copyIfMissing(path.join(bundledFontsDir, file), path.join(FONTS_DIR, file));
      }
    }
  }

  // Copy bundled cloudflared if present. This is optional.
  for (const src of [
    path.join(APP_ROOT_DIR, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
    path.join(RESOURCE_DIR, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  ]) {
    const dest = path.join(TOOLS_DIR, path.basename(src));
    copyIfMissing(src, dest);
  }
}

function storagePath(fileName) {
  ensureRuntimeDirs();
  return path.join(STORAGE_DIR, fileName);
}

function lyricsPath(fileName) {
  ensureRuntimeDirs();
  return path.join(LYRICS_DIR, fileName);
}

function fontsPath(fileName = '') {
  ensureRuntimeDirs();
  return path.join(FONTS_DIR, fileName);
}

function toolsPath(fileName = '') {
  ensureRuntimeDirs();
  return path.join(TOOLS_DIR, fileName);
}

module.exports = {
  APP_ROOT_DIR,
  DATA_DIR,
  RESOURCE_DIR,
  STORAGE_DIR,
  LYRICS_DIR,
  FONTS_DIR,
  TOOLS_DIR,
  ENV_PATH,
  ENV_EXAMPLE_PATH,
  PUBLIC_DIR,
  ensureRuntimeDirs,
  storagePath,
  lyricsPath,
  fontsPath,
  toolsPath
};
