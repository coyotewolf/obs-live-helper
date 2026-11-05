const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
function requestStatus(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
}

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-security-'));
const runtime = { STORAGE_DIR: temp, storagePath: name => path.join(temp, name) };
const sandbox = { URL, module: { exports: {} }, process: { env: {} }, console,
  require: name => name === './runtimePaths' ? runtime : require(name) };
vm.runInNewContext(fs.readFileSync(path.join(root, 'services/securityStore.js'), 'utf8'), sandbox);
const { isLocalRequest, requireLocalOrAdmin } = sandbox.module.exports;
const req = (host, peer, extra = {}) => ({ headers: { host, ...extra }, socket: { remoteAddress: peer }, query: {}, body: {} });

test('only direct loopback hosts and peers qualify as local', () => {
  assert.equal(isLocalRequest(req('127.0.0.1:5172', '127.0.0.1')), true);
  assert.equal(isLocalRequest(req('localhost:5172', '::ffff:127.0.0.1')), true);
  assert.equal(isLocalRequest(req('[::1]:5172', '::1')), true);
  assert.equal(isLocalRequest(req('localhost:5172', '203.0.113.7')), false);
  assert.equal(isLocalRequest(req('example.trycloudflare.com', '127.0.0.1')), false);
  assert.equal(isLocalRequest(req('localhost:5172', '127.0.0.10')), false);
});
test('forwarded and cross-origin requests do not inherit local privilege', () => {
  assert.equal(isLocalRequest(req('localhost:5172', '127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('localhost:5172', '127.0.0.1', { origin: 'https://evil.example' })), false);
  assert.equal(isLocalRequest(req('localhost:5172', '127.0.0.1', { origin: 'http://localhost:5172' })), true);
});
test('remote callers need the actual admin token', () => {
  let status, advanced = false;
  const response = { status: x => { status=x; return response; }, json: () => response };
  const request = req('public.example', '127.0.0.1');
  requireLocalOrAdmin(request, response, () => { advanced = true; });
  assert.equal(status, 401); assert.equal(advanced, false);
  request.headers['x-admin-token'] = sandbox.module.exports.getAdminToken();
  requireLocalOrAdmin(request, response, () => { advanced = true; });
  assert.equal(advanced, true);
});
test('HTTP server does not serve credential files and guards writes', async () => {
  const express = require('express');
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-public-'));
  fs.writeFileSync(path.join(publicDir, 'audience.html'), 'audience');
  fs.writeFileSync(path.join(temp, 'spotify.json'), '{"refresh_token":"test-secret"}');
  const runtimePaths = { ...runtime, PUBLIC_DIR: publicDir, LYRICS_DIR: publicDir, FONTS_DIR: publicDir,
    ENV_PATH: path.join(temp, '.env'), DATA_DIR: temp, ensureRuntimeDirs() {} };
  const emptyRouter = () => express.Router();
  const discord = emptyRouter();
  discord.staticRouter = emptyRouter(); discord.noOpScriptRouter = emptyRouter();
  discord.proxyAsset = () => emptyRouter();
  const context = { module: { exports: {} }, console: { log() {}, error() {} }, Buffer, URL, BroadcastChannel, setTimeout, clearTimeout,
    process: { env: { PORT: '0' }, on() {}, exit() {} },
    require(name) {
      if(name === './services/runtimePaths') return runtimePaths;
      if(name === './services/securityStore') return sandbox.module.exports;
      if(name === 'dotenv') return { config() {} };
      if(name === 'ws') return { Server: class { on() {} } };
      if(name === './routes/discordProfile') return discord;
      if(name.startsWith('./routes')) return emptyRouter();
      if(name === './services/lyricsFetcher') return { startLyricSync() {}, stopLyricSync() {} };
      if(name === './services/tunnelManager') return { startIfEnabled() {} };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8')+'\nglobalThis.httpServer=server;', context);
  const server = context.httpServer;
  try {
    if(!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for(const file of ['security.json', 'spotify.json', '%73ecurity.json']) {
      const response = await fetch(base+'/'+file);
      assert.equal(response.status, 404, file);
    }
    assert.equal((await fetch(base+'/audience.html')).status, 200);
    const response = await fetch(base+'/api/style/save', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"css":"body{}"}' });
    assert.equal(response.status, 401);
    for (const endpoint of ['/api/config/status', '/api/config/discord-streamkit']) {
      assert.equal(await requestStatus(base+endpoint, { host: 'public.example' }), 403);
      assert.equal((await fetch(base+endpoint, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 403);
    }
    assert.equal(await requestStatus(base+'/api/spotify/auth/login', { host: 'public.example' }), 401);
    const local = await fetch(base+'/api/style/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"css":"body{}"}' });
    assert.equal(local.status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(publicDir,{recursive:true,force:true}); }
});
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
