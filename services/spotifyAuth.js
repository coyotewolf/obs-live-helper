/**
 * Spotify OAuth (PKCE) helper
 * Handles: code verifier/challenge, token exchange, token refresh, token storage
 */
const fs = require('fs');
const path = require('path');
const { storagePath } = require('./runtimePaths');
const axios = require('axios');
const crypto = require('crypto');

function getClientId() {
  const clientId = String(process.env.CLIENT_ID || '').trim();
  if (!clientId) throw new Error('Spotify CLIENT_ID is not configured.');
  return clientId;
}

function getRedirectUri() {
  return process.env.REDIRECT_URI || 'http://127.0.0.1:5172/api/spotify/callback';
}

const TOKEN_FILE = storagePath('spotify.json');

// ----------------------------------------------------------------------------
// utils
// ----------------------------------------------------------------------------
function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

/**
 * Generate PKCE code verifier & challenge
 * @returns {{verifier: string, challenge: string}}
 */
function generateCodePair() {
  const verifier = base64URLEncode(crypto.randomBytes(64));
  const challenge = base64URLEncode(sha256(verifier));
  return { verifier, challenge };
}

/**
 * Return stored tokens or null
 */
function readTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to parse token file:', e);
    return null;
  }
}

/**
 * Save tokens to disk
 */
function saveTokens(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get a valid access token (refresh if needed)
 */
async function getAccessToken() {
  let tokens = readTokens();
  if (!tokens) return null;

  const now = Date.now() / 1000;
  if (tokens.expires_at && tokens.expires_at - 60 > now) {
    return tokens.access_token;          // 尚未過期
  }

  // 需要刷新
  try {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    return refreshed.access_token;
  } catch (err) {
    // 自動移除無效 token
    if (err.response?.data?.error === 'invalid_grant') {
      fs.unlinkSync(TOKEN_FILE);
      console.warn('⚠️  Refresh token invalid, deleted token file.');
    } else {
      console.error('Error refreshing access token:', err);
    }
    return null;
  }
}

/**
 * Refresh access token with refresh_token
 */
async function refreshAccessToken(refresh_token) {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refresh_token);
  params.append('client_id', getClientId());

  const { data } = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
  saveTokens(tokens);
  return tokens;
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForToken(code, code_verifier) {
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', getRedirectUri());
  params.append('client_id', getClientId());
  params.append('code_verifier', code_verifier);

  const { data } = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
  saveTokens(tokens);
  return tokens;
}

module.exports = {
  generateCodePair,
  getAccessToken,
  exchangeCodeForToken,
  readTokens,
};