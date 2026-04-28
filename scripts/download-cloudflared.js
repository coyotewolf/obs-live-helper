#!/usr/bin/env node
/**
 * Download Cloudflare cloudflared binary into ./tools for users who do not
 * want to install it system-wide. Uses only Node built-in modules.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'tools');
const VERSION = process.env.CLOUDFLARED_VERSION || '2025.8.1';
const isWin = process.platform === 'win32';
const binName = isWin ? 'cloudflared.exe' : 'cloudflared';
const target = path.join(TOOLS_DIR, binName);

function assetName() {
  if (process.platform === 'win32') return 'cloudflared-windows-amd64.exe';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
}

function download(url, outFile, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'obs-live-helper-setup' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(download(res.headers.location, outFile, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} when downloading ${url}`));
      }
      const file = fs.createWriteStream(outFile);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error('Download timeout')));
    req.on('error', reject);
  });
}


function existingLocalCandidates() {
  const isWin = process.platform === 'win32';
  const list = [];
  if (process.env.CLOUDFLARED_PATH) list.push(process.env.CLOUDFLARED_PATH);
  if (process.env.USERPROFILE) {
    list.push(path.join(process.env.USERPROFILE, 'Downloads', 'cloudflared.exe'));
    list.push(path.join(process.env.USERPROFILE, 'scoop', 'shims', 'cloudflared.exe'));
  }
  if (process.env.ProgramFiles) {
    list.push(path.join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'));
    list.push(path.join(process.env.ProgramFiles, 'Cloudflare', 'cloudflared.exe'));
  }
  if (!isWin) {
    list.push('/usr/local/bin/cloudflared');
    list.push('/opt/homebrew/bin/cloudflared');
    list.push('/usr/bin/cloudflared');
  }
  return [...new Set(list.filter(Boolean))];
}

function copyExistingCloudflared() {
  for (const candidate of existingLocalCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    if (!checkExisting(candidate)) continue;
    fs.copyFileSync(candidate, target);
    if (!isWin) fs.chmodSync(target, 0o755);
    console.log(`✅ copied existing cloudflared to: ${target}`);
    return true;
  }
  return false;
}

function checkExisting(p) {
  if (!fs.existsSync(p)) return false;
  try {
    const out = execFileSync(p, ['--version'], { encoding: 'utf8', timeout: 10000 });
    console.log(`✅ cloudflared already exists: ${p}`);
    console.log(out.trim());
    return true;
  } catch {
    return false;
  }
}

(async () => {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  if (checkExisting(target)) return;
  if (copyExistingCloudflared()) return;

  const asset = assetName();
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset}`;
  const tmp = path.join(os.tmpdir(), `${asset}-${Date.now()}`);

  console.log(`⬇️  Downloading cloudflared ${VERSION}`);
  console.log(url);

  try {
    await download(url, tmp);

    if (asset.endsWith('.tgz')) {
      // macOS release is a tarball. Let system tar extract it.
      const extractDir = path.join(os.tmpdir(), `cloudflared-${Date.now()}`);
      fs.mkdirSync(extractDir, { recursive: true });
      execFileSync('tar', ['-xzf', tmp, '-C', extractDir], { stdio: 'inherit' });
      const extracted = path.join(extractDir, 'cloudflared');
      fs.copyFileSync(extracted, target);
    } else {
      fs.copyFileSync(tmp, target);
    }

    if (!isWin) fs.chmodSync(target, 0o755);
    fs.rmSync(tmp, { force: true });
    console.log(`✅ cloudflared saved to: ${target}`);
    checkExisting(target);
  } catch (err) {
    console.error('⚠️  cloudflared download failed. You can still use the helper locally.');
    console.error(err.message);
    console.error('Manual install: https://github.com/cloudflare/cloudflared/releases');
    process.exitCode = 0;
  }
})();
