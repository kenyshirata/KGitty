const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const DEV_ICON = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  const win = (mainWin = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    title: 'KGitty',
    // Packaged builds take the icon embedded in the .exe; running from source uses the one in build/.
    ...(fs.existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));
  // Keyboard shortcuts live in the renderer; the default menu would claim Ctrl+R / Ctrl+W for itself.
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (_e, input) => {
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (input.type === 'keyDown' && devtools) win.webContents.toggleDevTools();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ---------- credential prompts ----------
   Git and ssh ask for passwords through an "askpass" helper. The helper is a tiny script that runs this
   executable as plain node, connects to a loopback server in this process and prints the answer the
   user typed into the app's own dialog. A credential helper (e.g. Git Credential Manager) then stores it. */

let askpass = null; // { port, token, sh }
let mainWin = null;
const pendingAsks = new Map();
let askSeq = 0;
const authOpts = { gcmWindow: false };

function startAskpass() {
  // Git runs GIT_ASKPASS without a shell, so the path must not contain spaces.
  let dir = path.join(app.getPath('userData'), 'askpass');
  if (/[ \t]/.test(dir)) dir = path.join(process.env.ProgramData || os.tmpdir(), 'KGitty-askpass');
  fs.mkdirSync(dir, { recursive: true });
  const fwd = (p) => p.replace(/\\/g, '/');
  const js = path.join(dir, 'askpass.js');
  const sh = path.join(dir, 'askpass.sh');
  fs.writeFileSync(js, `const http = require('http');
const body = JSON.stringify({ prompt: process.argv[2] || '' });
const req = http.request({ host: '127.0.0.1', port: +process.env.KGITTY_ASKPASS_PORT, path: '/ask', method: 'POST',
  headers: { 'x-token': process.env.KGITTY_ASKPASS_TOKEN, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => { if (res.statusCode !== 200) process.exit(1); process.stdout.write(JSON.parse(d).answer + '\\n'); });
});
req.on('error', () => process.exit(1));
req.end(body);
`);
  fs.writeFileSync(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${fwd(process.execPath)}" "${fwd(js)}" "$@"\n`, { mode: 0o755 });
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.headers['x-token'] !== token || req.method !== 'POST') { res.statusCode = 403; return res.end(); }
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      let prompt = '';
      try { prompt = String(JSON.parse(d).prompt); } catch { /* ignore */ }
      if (!mainWin || mainWin.isDestroyed()) { res.statusCode = 410; return res.end(); }
      const id = ++askSeq;
      pendingAsks.set(id, (answer) => {
        if (answer == null) { res.statusCode = 401; return res.end(); }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ answer }));
      });
      req.socket.on('close', () => { if (pendingAsks.delete(id) && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('askpass-cancel', id); });
      mainWin.show();
      mainWin.webContents.send('askpass', { id, prompt });
    });
  });
  server.listen(0, '127.0.0.1', () => { askpass = { port: server.address().port, token, sh: fwd(sh) }; });
}

ipcMain.handle('askpass-answer', (_e, id, answer) => {
  const done = pendingAsks.get(id);
  if (done) { pendingAsks.delete(id); done(answer == null ? null : String(answer)); }
});
ipcMain.handle('set-auth-opts', (_e, o) => { authOpts.gcmWindow = !!(o && o.gcmWindow); });

function authEnv() {
  if (!askpass) return { GIT_TERMINAL_PROMPT: '0' };
  return {
    GIT_ASKPASS: askpass.sh,
    SSH_ASKPASS: askpass.sh,
    SSH_ASKPASS_REQUIRE: 'force',
    KGITTY_ASKPASS_PORT: String(askpass.port),
    KGITTY_ASKPASS_TOKEN: askpass.token,
    GIT_TERMINAL_PROMPT: '0',
    // GCM would open its own sign-in window; by default the app's dialog is used so prompts look the same everywhere.
    ...(authOpts.gcmWindow ? {} : { GCM_INTERACTIVE: 'never' }),
  };
}

// Runs git and always resolves with { code, stdout, stderr }.
function runGit(cwd, args, input, extraEnv) {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...authEnv(), LC_ALL: 'C.UTF-8', ...extraEnv },
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        resolve({ code, stdout, stderr: err && code === -1 ? String(err.message) : stderr });
      }
    );
    if (input != null) child.stdin.end(input);
  });
}

ipcMain.handle('git', (_e, cwd, args, input) => runGit(cwd, args, input));

// Background git (automatic fetch, status of other tabs): never asks for credentials, it just fails instead.
ipcMain.handle('git-quiet', (_e, cwd, args) => runGit(cwd, args, null, {
  GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0',
  ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
}));

// True if a path inside the git dir exists (e.g. "rebase-merge" while a rebase is running).
ipcMain.handle('git-path-exists', async (_e, repo, name) => {
  const r = await runGit(repo, ['rev-parse', '--git-path', name]);
  return r.code === 0 && fs.existsSync(path.resolve(repo, r.stdout.trim()));
});

// Starts `git rebase -i` non-interactively: the todo list is supplied through GIT_SEQUENCE_EDITOR.
// Rewording is expressed as pick + `exec git commit --amend -F <file>`.
ipcMain.handle('rebase-interactive', (_e, repo, base, items) => {
  const hex = /^[0-9a-f]{7,64}$/;
  const actions = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
  if ((base && !hex.test(base)) || !Array.isArray(items) || !items.length) throw new Error('Invalid rebase request');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgitty-rebase-'));
  const fwd = (p) => p.replace(/\\/g, '/');
  const lines = [];
  items.forEach((it, i) => {
    if (!hex.test(it.hash) || !actions.includes(it.action)) throw new Error('Invalid rebase item');
    if (it.action === 'reword') {
      const f = path.join(dir, `msg${i}.txt`);
      fs.writeFileSync(f, String(it.message).trim() + '\n', 'utf8');
      lines.push(`pick ${it.hash}`, `exec git commit --amend -q -F "${fwd(f)}"`);
    } else lines.push(`${it.action} ${it.hash}`);
    if (it.finalMessage && (it.action === 'squash' || it.action === 'fixup')) {
      const f = path.join(dir, `final${i}.txt`);
      fs.writeFileSync(f, String(it.finalMessage).trim() + '\n', 'utf8');
      lines.push(`exec git commit --amend -q -F "${fwd(f)}"`);
    }
  });
  const todo = path.join(dir, 'todo.txt');
  fs.writeFileSync(todo, lines.join('\n') + '\n', 'utf8');
  return runGit(repo, ['rebase', '-i', '--autostash', ...(base ? [base] : ['--root'])], undefined, {
    GIT_SEQUENCE_EDITOR: `cp "${fwd(todo)}"`,
    GIT_EDITOR: 'true',
  });
});

// File access is limited to paths inside the given repository.
function repoPath(repo, rel) {
  const root = path.resolve(repo);
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path outside repository');
  return p;
}

ipcMain.handle('read-file', (_e, repo, rel) => {
  try { return { ok: true, text: fs.readFileSync(repoPath(repo, rel), 'utf8') }; } catch { return { ok: false, text: '' }; }
});

// Binary content as base64 (for image previews): a git object, or a file inside the repository.
const MAX_BLOB = 40 * 1024 * 1024;
ipcMain.handle('git-blob', (_e, repo, spec) => new Promise((resolve) => {
  execFile('git', ['cat-file', 'blob', String(spec)], { cwd: repo, encoding: 'buffer', maxBuffer: MAX_BLOB, windowsHide: true }, (err, out) =>
    resolve(err ? { ok: false } : { ok: true, b64: out.toString('base64'), size: out.length }));
}));

ipcMain.handle('read-file-b64', (_e, repo, rel) => {
  try {
    const p = repoPath(repo, rel);
    if (fs.statSync(p).size > MAX_BLOB) return { ok: false };
    const buf = fs.readFileSync(p);
    return { ok: true, b64: buf.toString('base64'), size: buf.length };
  } catch { return { ok: false }; }
});

// Finds the repositories below a folder (a folder holding .git is a repository and is not searched further).
ipcMain.handle('scan-repos', async (_e, root, depth) => {
  const paths = [];
  const LIMIT = 1000;
  const maxDepth = Math.min(Math.max(+depth || 3, 1), 6);
  const skip = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', 'AppData']);
  let truncated = false;
  const walk = async (dir, d) => {
    if (truncated) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((x) => x.name === '.git')) { paths.push(dir.split(path.sep).join('/')); if (paths.length >= LIMIT) truncated = true; return; }
    if (d >= maxDepth) return;
    for (const x of entries) {
      if (!x.isDirectory() || x.name.startsWith('.') || skip.has(x.name)) continue;
      await walk(path.join(dir, x.name), d + 1);
      if (truncated) return;
    }
  };
  await walk(path.resolve(root), 0);
  return { paths, truncated };
});

ipcMain.handle('write-file', (_e, repo, rel, text) => {
  fs.writeFileSync(repoPath(repo, rel), text, 'utf8');
  return true;
});

ipcMain.handle('set-zoom', (e, f) => { e.sender.setZoomFactor(Math.min(2, Math.max(0.6, +f || 1))); });

ipcMain.handle('set-theme-source', (_e, pref) => {
  if (['system', 'light', 'dark'].includes(pref)) nativeTheme.themeSource = pref;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('initial-repo', () => process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-')) || null);

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(path.normalize(p)));

/* ---------- open the repository in other programs ---------- */

const whereAll = (cmd) => new Promise((resolve) => execFile('where', [cmd], { windowsHide: true }, (err, out) => resolve(err ? [] : out.split(/\r?\n/).filter(Boolean))));
const firstExisting = (list) => list.find((p) => p && fs.existsSync(p)) || null;

// Git Bash (MinGW64) sits in the root of the Git for Windows install, next to cmd\ and mingw64\.
async function findGitBash() {
  const fromPath = (await whereAll('git')).map((g) => {
    const parts = path.normalize(g).split(path.sep);
    const i = parts.findIndex((x) => /^(cmd|mingw64|bin)$/i.test(x));
    return i > 0 ? path.join(parts.slice(0, i).join(path.sep), 'git-bash.exe') : null;
  });
  return firstExisting([...fromPath, path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'git-bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'git-bash.exe')]);
}

async function findVsCode() {
  const fromPath = (await whereAll('code')).map((c) => path.join(path.dirname(c), '..', 'Code.exe'));
  return firstExisting([path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'), ...fromPath]);
}

// Visual Studio solutions in the repository root and up to two folders below it.
async function findSolutions(repo) {
  const found = [];
  const skip = new Set(['node_modules', 'bin', 'obj', 'packages']);
  const walk = async (dir, d) => {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const x of entries) {
      if (x.isFile() && /\.sln$/i.test(x.name)) found.push(path.relative(repo, path.join(dir, x.name)).split(path.sep).join('/'));
      else if (x.isDirectory() && d < 2 && !x.name.startsWith('.') && !skip.has(x.name)) await walk(path.join(dir, x.name), d + 1);
    }
  };
  await walk(repo, 0);
  return found.sort().slice(0, 20);
}

const launch = (exe, args, cwd) => new Promise((resolve) => {
  const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (e) => resolve(e.message));
  child.on('spawn', () => { child.unref(); resolve(null); });
});

ipcMain.handle('open-with-options', async (_e, repo) => {
  const [bash, code, sln] = await Promise.all([findGitBash(), findVsCode(), findSolutions(path.resolve(repo))]);
  return { console: !!bash, vscode: !!code, solutions: sln };
});

ipcMain.handle('open-console', async (_e, repo) => {
  const bash = await findGitBash();
  if (!bash) return 'Git Bash (git-bash.exe) was not found. Install Git for Windows.';
  return launch(bash, ['--cd=' + path.resolve(repo)], path.resolve(repo));
});

ipcMain.handle('open-vscode', async (_e, repo) => {
  const code = await findVsCode();
  if (!code) return 'Visual Studio Code was not found.';
  return launch(code, [path.resolve(repo)], path.resolve(repo));
});

// Opens a solution found by findSolutions with its default program (Visual Studio).
ipcMain.handle('open-solution', async (_e, repo, rel) => {
  if (!/\.sln$/i.test(rel) || !(await findSolutions(path.resolve(repo))).includes(rel)) return 'Not a solution of this repository.';
  const err = await shell.openPath(repoPath(repo, rel));
  return err || null;
});

app.whenReady().then(() => {
  startAskpass();
  require('./updater').init(() => mainWin);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
