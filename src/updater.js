// Automatic updates from GitHub Releases (electron-updater). The app checks shortly after start and every few
// hours, tells the window when a newer version exists, and only downloads it when the user agrees.
//
// Private repositories need an access token that can read releases; it is stored encrypted with the operating
// system's protection (safeStorage) and never sent back to the window.
// KGITTY_UPDATE_URL points the updater at any folder that serves latest.yml (for testing or self-hosting).
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const REPO = { provider: 'github', owner: 'kenyshirata', repo: 'KGitty' };
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let getWin = () => null;
let updater = null;
let state = { state: 'idle' };
let opts = { auto: true };
let token = '';
let timer = null;
let manual = false;

const tokenFile = () => path.join(app.getPath('userData'), 'update-token');

function loadToken() {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(tokenFile())) token = safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch { token = ''; }
}

function send(patch) {
  // Release notes and the version are learned when the update is found; keep them while it downloads.
  const carry = patch.state === 'downloading' || patch.state === 'ready' ? { notes: state.notes, version: patch.version || state.version } : {};
  state = { ...patch, ...carry, manual };
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('update-status', state);
}

const canCheck = () => app.isPackaged || !!process.env.KGITTY_UPDATE_URL;

function plainNotes(n) {
  const text = Array.isArray(n) ? n.map((x) => (typeof x === 'string' ? x : x.note || '')).join('\n\n') : String(n || '');
  return text.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

function setup() {
  if (updater) return updater;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = null;
  updater.forceDevUpdateConfig = !!process.env.KGITTY_UPDATE_URL;
  updater.on('checking-for-update', () => send({ state: 'checking' }));
  updater.on('update-available', (i) => send({ state: 'available', version: i.version, notes: plainNotes(i.releaseNotes) }));
  updater.on('update-not-available', (i) => send({ state: 'none', version: i.version }));
  updater.on('download-progress', (p) => send({ state: 'downloading', version: state.version, percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version, notes: state.notes }));
  updater.on('error', (e) => send({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 300) }));
  return updater;
}

function configureFeed() {
  const u = setup();
  if (process.env.KGITTY_UPDATE_URL) u.setFeedURL({ provider: 'generic', url: process.env.KGITTY_UPDATE_URL });
  else u.setFeedURL(token ? { ...REPO, private: true, token } : REPO);
  return u;
}

async function check(isManual) {
  manual = !!isManual;
  if (!canCheck()) return send({ state: 'dev' });
  if (['checking', 'downloading', 'ready'].includes(state.state)) return send(state);
  try { await configureFeed().checkForUpdates(); } catch (e) { send({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 300) }); }
}

function schedule() {
  clearInterval(timer);
  timer = null;
  if (!opts.auto || !canCheck()) return;
  timer = setInterval(() => check(false), CHECK_EVERY);
}

function init(winGetter) {
  getWin = winGetter;
  loadToken();

  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-state', () => ({ ...state, hasToken: !!token, canCheck: canCheck() }));
  ipcMain.handle('update-opts', (_e, o) => {
    const first = !timer && !opts.started;
    opts = { auto: !(o && o.auto === false), started: true };
    schedule();
    if (first && opts.auto && canCheck()) setTimeout(() => check(false), 15000);
  });
  ipcMain.handle('update-check', () => check(true));
  ipcMain.handle('update-download', async () => {
    manual = true;
    try { await setup().downloadUpdate(); } catch (e) { send({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 300) }); }
  });
  ipcMain.handle('update-install', () => { if (updater) updater.quitAndInstall(true, true); });
  ipcMain.handle('update-set-token', (_e, t) => {
    t = String(t || '').trim();
    if (!t) {
      token = '';
      try { fs.rmSync(tokenFile(), { force: true }); } catch { /* ignore */ }
      return { ok: true };
    }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Secure storage is not available on this system.' };
    fs.writeFileSync(tokenFile(), safeStorage.encryptString(t));
    token = t;
    return { ok: true };
  });
}

module.exports = { init };
