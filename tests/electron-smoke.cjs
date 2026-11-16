/* Runs the actual Electron entry with hidden windows, synthetic data and offline networking. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const Module = require('node:module');
const project = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  controller().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  runElectron().catch(error => { console.error(error); require('electron').app.exit(1); });
}

async function controller() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const fixtureParent = path.join(project, 'test-results');
  fs.mkdirSync(fixtureParent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(fixtureParent, 'electron-'));
  assert.ok(fixture.startsWith(fixtureParent + path.sep));
  const childEnv = { ...process.env, PORT: String(port), OBS_SMOKE_DATA: fixture,
    ENABLE_PUBLIC_TUNNEL: 'false', CLIENT_ID: '', DISCORD_STREAMKIT_URL: '', DEFAULT_STREAMKIT_URL: '',
    ELECTRON_ENABLE_LOGGING: '0' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    cwd: project,
    windowsHide: true,
    timeout: 45000,
    encoding: 'utf8',
    env: childEnv,
  });
  if (result.status !== 0) throw new Error(`Electron smoke failed (${result.status}): ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('OBS_ELECTRON_SMOKE='));
  assert.ok(line, 'child must report its runtime checks');
  const report = JSON.parse(line.slice('OBS_ELECTRON_SMOKE='.length));
  assert.equal(report.electron, require('electron/package.json').version);
  await assert.rejects(new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/api/config/status`, response => { response.resume(); resolve(); });
    request.on('error', reject);
  }), /ECONNREFUSED/);
  report.shutdown = 'server port closed after app quit';
  report.status = 'passed';
  fs.writeFileSync(path.join(fixtureParent, 'electron-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

async function runElectron() {
  const electron = require('electron');
  const fixture = path.resolve(process.env.OBS_SMOKE_DATA || '');
  assert.ok(fixture.startsWith(path.join(project, 'test-results') + path.sep));
  electron.app.setPath('userData', fixture);
  fs.mkdirSync(path.join(fixture, 'session'), { recursive: true });
  electron.app.setPath('sessionData', path.join(fixture, 'session'));
  electron.app.commandLine.appendSwitch('disable-gpu');
  const port = process.env.PORT;
  const origin = `http://127.0.0.1:${port}`;
  const external = [];
  const windows = [];
  let checked = false;

  // Bind only loopback during the probe; do not expose a public test server.
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' || /^\d+$/.test(String(args[0]))) {
      if (typeof args[1] === 'function' || args[1] === undefined) args.splice(1, 0, '127.0.0.1');
    }
    return listen.apply(this, args);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = options && typeof options === 'object' ? options.host || options.hostname : typeof args[1] === 'string' ? args[1] : undefined;
    const targetPort = options && typeof options === 'object' ? options.port : typeof options === 'number' ? options : undefined;
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Offline smoke blocked external Node connection');
    if (targetPort !== undefined && Number(targetPort) !== Number(port)) throw new Error('Offline smoke blocked another local service');
    return connect.apply(this, args);
  };
  electron.app.whenReady().then(() => {
    electron.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let local = false;
      try { local = new URL(details.url).origin === origin || details.url.startsWith('devtools:'); } catch {}
      callback({ cancel: !local });
    });
  });

  const shim = new Proxy(electron, { get(target, property) {
    if (property === 'BrowserWindow') return function (options) {
      const window = new target.BrowserWindow({ ...options, show: false });
      windows.push(window);
      window.webContents.once('did-finish-load', () => {
        if (!checked) { checked = true; verifyWindow(window).catch(error => { console.error(error); target.app.exit(1); }); }
      });
      return window;
    };
    if (property === 'shell') return { openExternal: async url => { external.push(url); } };
    if (property === 'dialog') return { showErrorBox: (_title, message) => { console.error(message); target.app.exit(1); } };
    return target[property];
  } });

  async function verifyWindow(window) {
    assert.equal(window.isVisible(), false);
    assert.ok(window.webContents.getURL().startsWith(origin + '/html/dashboard.html'));
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    const content = await window.webContents.executeJavaScript('({text: document.body.innerText.length, title: document.title, node: typeof require})');
    assert.ok(content.text > 20);
    assert.equal(content.node, 'undefined');
    const configResponse = await fetch(origin + '/api/config/status');
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(path.resolve(config.dataDir), fixture);
    const fontResponse = await fetch(origin + '/api/font/list');
    assert.equal(fontResponse.status, 200);
    assert.ok(Array.isArray(await fontResponse.json()));
    await window.webContents.executeJavaScript("window.open('https://example.invalid/fixture'); true");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(external.includes('https://example.invalid/fixture'));
    assert.equal(windows.length, 1);
    await window.webContents.executeJavaScript("location.href = 'https://example.invalid/navigation'; true");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(external.includes('https://example.invalid/navigation'));
    assert.ok(window.webContents.getURL().startsWith(origin + '/'));
    console.log('OBS_ELECTRON_SMOKE=' + JSON.stringify({electron: process.versions.electron, node: process.versions.node,
      chrome: process.versions.chrome, checks: ['real entry/server startup', 'hidden dashboard renderer', 'renderer Node isolation',
        'isolated runtime data', 'local configuration/font APIs', 'popup and navigation guards'], liveServices: false}));
    electron.app.quit();
  }

  const entry = path.join(project, 'electron-main.js');
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(project);
  loaded.require = function (name) { return name === 'electron' ? shim : Module.prototype.require.call(this, name); };
  loaded._compile(fs.readFileSync(entry, 'utf8'), entry);
}
