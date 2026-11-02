const fs = require('fs');
const path = require('path');
const { storagePath, STORAGE_DIR } = require('./runtimePaths');
const crypto = require('crypto');

const SECURITY_FILE = storagePath('security.json');

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url').toUpperCase();
}

function readSecurity() {
  ensureStorageDir();

  let data = {};
  if (fs.existsSync(SECURITY_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8')) || {};
    } catch (err) {
      console.warn('⚠️ security.json 解析失敗，將重新產生安全碼。', err.message);
      data = {};
    }
  }

  const next = {
    adminToken: process.env.ADMIN_TOKEN || data.adminToken || randomToken(24),
    requestPin: process.env.REQUEST_PIN || data.requestPin || randomToken(6).slice(0, 6),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(SECURITY_FILE, JSON.stringify(next, null, 2));
  return next;
}

function getSecurity() {
  return readSecurity();
}

function getAdminToken() {
  return getSecurity().adminToken;
}

function getRequestPin() {
  return String(getSecurity().requestPin || '').toUpperCase();
}

function rotateRequestPin() {
  ensureStorageDir();
  const current = getSecurity();
  const next = {
    ...current,
    requestPin: randomToken(6).slice(0, 6),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(SECURITY_FILE, JSON.stringify(next, null, 2));
  return next;
}

function isLocalRequest(req) {
  // A tunnel's TCP peer is often loopback. Neither Host nor the peer alone is proof.
  const peer = String(req.socket?.remoteAddress || '');
  const loopbackPeers = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!loopbackPeers.includes(peer)) return false;
  if (['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'cf-connecting-ip']
      .some(name => req.headers[name] !== undefined)) return false;
  let url;
  try { url = new URL(`http://${req.headers.host || ''}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).origin !== url.origin) return false; } catch { return false; }
  }
  return true;
}

function requireLocalOrAdmin(req, res, next) {
  if (isLocalRequest(req)) return next();
  return requireAdmin(req, res, next);
}

function getProvidedAdminToken(req) {
  return String(
    req.headers['x-admin-token'] ||
    req.query.admin ||
    req.body?.adminToken ||
    ''
  ).trim();
}

function requireAdmin(req, res, next) {
  const expected = getAdminToken();
  const provided = getProvidedAdminToken(req);

  if (!provided || provided !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'admin_required',
      message: '需要管理員權限。請在本機開啟 Dashboard，或使用正確的管理員 token。'
    });
  }

  next();
}

module.exports = {
  getSecurity,
  getAdminToken,
  getRequestPin,
  rotateRequestPin,
  requireAdmin,
  isLocalRequest,
  requireLocalOrAdmin
};
