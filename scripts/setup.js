#!/usr/bin/env node
/** First-run local setup. Never writes Spotify tokens. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');
const envExamplePath = path.join(ROOT, '.env.example');
const storageDir = path.join(ROOT, 'storage');
const lyricsDir = path.join(ROOT, 'lyrics');
const securityPath = path.join(storageDir, 'security.json');

function token(bytes = 18) { return crypto.randomBytes(bytes).toString('base64url').toUpperCase(); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

ensureDir(storageDir);
ensureDir(lyricsDir);
if (!fs.existsSync(path.join(storageDir, '.keep'))) fs.writeFileSync(path.join(storageDir, '.keep'), '');
if (!fs.existsSync(path.join(lyricsDir, '.keep'))) fs.writeFileSync(path.join(lyricsDir, '.keep'), '');
if (!fs.existsSync(path.join(lyricsDir, 'current.lrc'))) fs.writeFileSync(path.join(lyricsDir, 'current.lrc'), '');

if (!fs.existsSync(envPath)) {
  const base = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : '';
  fs.writeFileSync(envPath, base);
  console.log('✅ Created .env from .env.example');
} else {
  console.log('✅ .env already exists; setup will not overwrite it.');
}

let security = {};
if (fs.existsSync(securityPath)) {
  try { security = JSON.parse(fs.readFileSync(securityPath, 'utf8')); } catch { security = {}; }
}
security.adminToken = security.adminToken || token(24);
security.requestPin = security.requestPin || token(6).slice(0, 6);
security.createdAt = security.createdAt || new Date().toISOString();
security.updatedAt = new Date().toISOString();
fs.writeFileSync(securityPath, JSON.stringify(security, null, 2));
console.log('✅ Security tokens are stored locally in storage/security.json');

if (!process.argv.includes('--skip-cloudflared')) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'download-cloudflared.js')], { stdio: 'inherit' });
  if (result.error) console.warn('⚠️ cloudflared setup skipped:', result.error.message);
}

console.log('\nNext steps:');
console.log('1. Edit .env and set CLIENT_ID from your own Spotify Developer App.');
console.log('2. Spotify Redirect URI must be: http://127.0.0.1:5172/api/spotify/callback');
console.log('3. Run npm start, open http://127.0.0.1:5172/html/dashboard.html, then authorize Spotify.');
