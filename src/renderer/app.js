'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ROW = window.kgRow || 26;
const LANE_W = 14, LOG_LIMIT = 2000;
const COLORS = ['#4a8cf0', '#e2b340', '#4fc26b', '#d96fd0', '#f0605a', '#3ec9c9', '#f08a3c', '#9b8cf0'];

const freshRepoState = () => ({
  repo: null, commits: [], graph: [], graphW: 0,
  branches: [], remotes: [], tags: [], stashes: [], head: null, headHash: null,
  status: [], sel: { type: 'wc' }, file: null, filter: '', draft: '', hunks: null, op: null, conflict: null, undo: [], redo: [], submodules: [], worktrees: [], flow: null, lfs: { available: false, patterns: [] }, dtab: 'commit', treeOpen: {}, lastCommit: null,
});
const state = { busy: false, ...freshRepoState() };

/* ---------- tabs ---------- */

const tabs = [];
let active = -1;

function snapshot() {
  if (active < 0) return;
  state.draft = readDraft();
  const snap = {};
  for (const k of Object.keys(freshRepoState())) snap[k] = state[k];
  tabs[active].snap = snap;
}

function persistTabs() {
  localStorage.setItem('tabs', JSON.stringify({ repos: tabs.map((t) => t.repo), active }));
}

function renderTabs() {
  $('#tabs').innerHTML =
    tabs.map((t, i) => `<div class="tab ${i === active ? 'active' : ''}" data-i="${i}" title="${esc(t.repo)}"><span class="tname">${esc(t.repo.split(/[\\/]/).pop())}</span><span class="x" data-close="${i}">✕</span></div>`).join('') +
    '<button class="tab-add" id="tab-add" title="Open repository in a new tab">+</button>';
}

async function activate(i) {
  if (state.busy) return setStatus('Wait for the running operation to finish', true);
  snapshot();
  active = i;
  const t = tabs[i];
  Object.assign(state, t.snap || freshRepoState(), { repo: t.repo });
  $('#welcome').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#repo-title').textContent = t.repo.split(/[\\/]/).pop();
  $('#search').value = state.filter;
  $('#detail-left').innerHTML = '';
  renderTabs();
  persistTabs();
  if (t.snap) { renderSidebar(); renderList(); renderDetail(); }
  await refresh();
}

function closeTab(i) {
  if (state.busy) return;
  const wasActive = i === active;
  tabs.splice(i, 1);
  if (!tabs.length) {
    active = -1;
    Object.assign(state, freshRepoState());
    $('#app').classList.add('hidden');
    $('#welcome').classList.remove('hidden');
    renderRecent();
  } else if (wasActive) {
    active = -1;
    activate(Math.min(i, tabs.length - 1));
    return;
  } else if (i < active) active--;
  renderTabs();
  persistTabs();
}

/* ---------- git helpers ---------- */

async function git(args, input) {
  const r = await window.api.git(state.repo, args, input);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'git failed').trim());
  return r.stdout;
}

function setStatus(msg, err = false) {
  const el = $('#statusbar');
  el.textContent = msg;
  el.classList.toggle('err', err);
}

// Runs a repository operation with busy-state, status line and error dialog. Destructive operations
// (see UNDOABLE) snapshot the repository first so they can be undone. Resolves to false on failure.
async function execRun(label, fn, track) {
  if (state.busy) return;
  state.busy = true;
  setStatus(label + '…');
  let undo = null;
  if (track) { try { undo = await captureUndo(label); } catch { undo = null; } }
  try {
    const out = await fn();
    setStatus(label + ' — done');
    if (undo) pushUndo(undo);
    return out;
  } catch (e) {
    setStatus(e.message.split('\n')[0], true);
    const hint = errorHint(e.message);
    const again = await modal({ title: label + ' failed', body: `<pre>${esc(e.message)}</pre>${hint ? `<p class="hint">${esc(hint.text)}</p>` : ''}`, buttons: [{ label: 'Close', value: hint ? 'close' : true, primary: !hint }, ...(hint ? [{ label: hint.action, value: 'fix', primary: true }] : [])] });
    if (again === 'fix') setTimeout(prefsDialog, 0);
    return false;
  } finally {
    state.busy = false;
    await refresh();
  }
}

const run = (label, fn) => execRun(label, fn, UNDOABLE.test(label));
const runRaw = (label, fn) => execRun(label, fn, false);

/* ---------- modal / context menu ---------- */

function modal({ title, body = '', fields = [], buttons }) {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>${body}
      ${fields.map((f, i) => `<div class="field"><label>${esc(f.label)}</label><input type="text" id="mf${i}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"></div>`).join('')}
      <div class="btns">${buttons.map((b, i) => `<button class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    ov.classList.remove('hidden');
    const done = (v) => {
      const vals = fields.map((_, i) => $('#mf' + i).value.trim());
      ov.classList.add('hidden');
      ov.innerHTML = '';
      resolve(v === true || v === 'ok' ? (fields.length ? vals : true) : v === false ? null : v);
    };
    ov.querySelectorAll('button').forEach((b) => (b.onclick = () => done(buttons[+b.dataset.i].value)));
    ov.onkeydown = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter' && fields.length) done(buttons.find((b) => b.primary).value);
    };
    const first = $('#mf0');
    if (first) { first.focus(); first.select(); } else ov.querySelector('button.primary, button').focus();
  });
}

const prompt2 = (title, label, value = '') =>
  modal({ title, fields: [{ label, value }], buttons: [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }] }).then((v) => (v && v[0]) || null);

const confirm2 = (title, msg, danger = false) =>
  modal({ title, body: `<p>${esc(msg)}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Confirm', value: true, primary: !danger, danger }] });

function ctxMenu(x, y, items) {
  const el = $('#ctx');
  el.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<div data-i="${i}">${esc(it.label)}</div>`)).join('');
  el.classList.remove('hidden');
  el.style.left = Math.min(x, innerWidth - 220) + 'px';
  el.style.top = Math.min(y, innerHeight - el.offsetHeight - 8) + 'px';
  el.onclick = (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    el.classList.add('hidden');
    if (i != null) items[+i].action();
  };
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) $('#ctx').classList.add('hidden'); });

/* ---------- loading data ---------- */

async function openRepo(dir) {
  let top;
  try {
    const r = await window.api.git(dir, ['rev-parse', '--show-toplevel']);
    if (r.code !== 0) throw new Error(r.stderr);
    top = r.stdout.trim();
  } catch {
    await modal({ title: 'Not a repository', body: `<p>${esc(dir)} is not a Git repository.</p>`, buttons: [{ label: 'OK', value: true, primary: true }] });
    return;
  }
  saveRecent(top);
  let i = tabs.findIndex((t) => t.repo === top);
  if (i < 0) { tabs.push({ repo: top, snap: null }); i = tabs.length - 1; }
  await activate(i);
}

async function pickAndOpen() {
  const dir = await window.api.pickFolder();
  if (dir) openRepo(dir);
}

async function refresh() {
  if (!state.repo) return;
  try {
    await Promise.all([loadRefs(), loadLog(), loadStatus(), loadSubmodules(), loadWorktrees(), loadLfs(), loadFlow()]);
    renderSidebar();
    renderList();
    renderDetail();
    updateUndoUi();
  } catch (e) {
    setStatus(e.message.split('\n')[0], true);
  }
}

async function loadRefs() {
  const out = await git(['for-each-ref', '--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  state.branches = []; state.remotes = []; state.tags = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, hash, head, upstream, track] = line.split('\t');
    if (ref.startsWith('refs/heads/')) state.branches.push({ name: ref.slice(11), hash, current: head === '*', upstream, track });
    else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice(13);
      if (!name.endsWith('/HEAD')) state.remotes.push({ name, hash });
    } else state.tags.push({ name: ref.slice(10), hash });
  }
  const cur = state.branches.find((b) => b.current);
  state.head = cur ? cur.name : null;
  state.headHash = (await window.api.git(state.repo, ['rev-parse', 'HEAD'])).stdout.trim() || null;
  const st = await window.api.git(state.repo, ['stash', 'list', '--format=%gd%x09%s']);
  state.stashes = st.stdout.split('\n').filter(Boolean).map((l) => { const [ref, msg] = l.split('\t'); return { ref, msg }; });
}

async function loadLog() {
  const r = await window.api.git(state.repo, ['log', '--exclude=refs/stash', '--all', '--date-order', `-n${LOG_LIMIT}`, '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e']);
  state.commits = r.code ? [] : r.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [hash, parents, author, email, at, refs, subject] = rec.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], author, email, time: +at * 1000, refs: parseRefs(refs), subject };
  });
  await prepareGravatars(state.commits);
  buildGraph();
}

function parseRefs(d) {
  if (!d) return [];
  return d.split(', ').map((r) => {
    if (r.startsWith('HEAD -> ')) return { type: 'head', name: r.slice(8) };
    if (r === 'HEAD') return { type: 'head', name: 'HEAD' };
    if (r.startsWith('tag: ')) return { type: 'tag', name: r.slice(5) };
    if (/\/HEAD$/.test(r)) return null;
    return { type: r.includes('/') && state.remotes.some((x) => x.name === r) ? 'remote' : 'local', name: r };
  }).filter(Boolean);
}

async function loadStatus() {
  const r = await window.api.git(state.repo, ['status', '--porcelain=v1', '-z', '-uall']);
  const parts = r.stdout.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const x = p[0], y = p[1], path = p.slice(3);
    let orig = null;
    if (x === 'R' || x === 'C') orig = parts[++i];
    const conflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    files.push({ x, y, path, orig, conflict, staged: !conflict && x !== ' ' && x !== '?', unstaged: !conflict && (y !== ' ' || x === '?'), untracked: x === '?' });
  }
  await markLfsFiles(files);
  state.status = files;
  state.op = await detectOperation();
}

/* ---------- graph ---------- */

function buildGraph() {
  let lanes = [];
  let maxLanes = 1;
  state.graph = state.commits.map((c) => {
    const top = lanes.slice();
    let col = lanes.indexOf(c.hash);
    if (col < 0) {
      col = lanes.indexOf(null);
      if (col < 0) col = lanes.length;
      lanes[col] = c.hash;
    }
    for (let i = 0; i < lanes.length; i++) if (i !== col && lanes[i] === c.hash) lanes[i] = null;
    const parentCols = [];
    c.parents.forEach((p, idx) => {
      let pi = lanes.indexOf(p);
      if (idx === 0) {
        if (pi >= 0 && pi !== col) lanes[col] = null;
        else { lanes[col] = p; pi = col; }
      } else if (pi < 0) {
        pi = lanes.indexOf(null);
        if (pi < 0) pi = lanes.length;
        lanes[pi] = p;
      }
      parentCols.push(pi);
    });
    if (!c.parents.length) lanes[col] = null;
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    maxLanes = Math.max(maxLanes, top.length, lanes.length, col + 1);
    return { col, top, parentCols, hash: c.hash };
  });
  state.graphW = Math.min(maxLanes, 14) * LANE_W + 10;
}

function graphSvg(g, wc) {
  const W = state.graphW, H = ROW, mid = H / 2;
  const x = (i) => Math.min(i, 13) * LANE_W + LANE_W / 2 + 2;
  let s = `<svg class="graph" width="${W}" height="${H}">`;
  if (wc) return s + `<circle cx="${x(g.col)}" cy="${mid}" r="4.5" fill="none" stroke="#8b8f96" stroke-width="2" stroke-dasharray="2 2"/>` + (g.down ? `<line x1="${x(g.col)}" y1="${mid}" x2="${x(g.col)}" y2="${H}" stroke="#8b8f96" stroke-width="2" stroke-dasharray="3 3"/>` : '') + '</svg>';
  const line = (x1, y1, x2, y2, ci) => `<path d="M${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" stroke="${COLORS[ci % COLORS.length]}" stroke-width="2" fill="none"/>`;
  g.top.forEach((h, i) => {
    if (!h) return;
    if (h === g.hash) s += line(x(i), 0, x(g.col), mid, i);
    else s += `<line x1="${x(i)}" y1="0" x2="${x(i)}" y2="${H}" stroke="${COLORS[i % COLORS.length]}" stroke-width="2"/>`;
  });
  g.parentCols.forEach((pc) => (s += line(x(g.col), mid, x(pc), H, pc)));
  s += `<circle cx="${x(g.col)}" cy="${mid}" r="4.5" fill="${COLORS[g.col % COLORS.length]}" style="stroke:var(--bg)" stroke-width="1.5"/></svg>`;
  return s;
}

/* ---------- rendering ---------- */

function renderSidebar() {
  const sb = $('#sidebar');
  const n = state.status.length;
  const sect = (title, items, tool) => items.length ? `<div class="sb-head">${title}${tool ? '<button class="sb-tool" data-act="bulk-branches" title="Delete multiple branches">🗑</button>' : ''}</div>${items.join('')}` : '';
  sb.innerHTML =
    `<div class="sb-item wc ${state.sel.type === 'wc' ? 'active' : ''}" data-act="wc">Local Changes${n ? `<span class="count">${n}</span>` : ''}</div>` +
    `<div class="sb-item wc ${['commit', 'log', 'stash'].includes(state.sel.type) ? 'active' : ''}" data-act="log">All Commits</div>` +
    sect('Branches', state.branches.map((b) => `<div class="sb-item ${b.current ? 'current' : ''}" data-kind="branch" data-name="${esc(b.name)}" title="${esc(b.name)}">${b.current ? '● ' : ''}${esc(b.name)}<span class="ab">${esc(trackText(b.track))}</span></div>`), true) +
    sect('Remotes', state.remotes.map((b) => `<div class="sb-item" data-kind="remote" data-name="${esc(b.name)}">${esc(b.name)}</div>`)) +
    sect('Tags', state.tags.map((b) => `<div class="sb-item" data-kind="tag" data-name="${esc(b.name)}">${esc(b.name)}</div>`)) +
    sect('Stashes', state.stashes.map((b) => `<div class="sb-item ${state.sel.type === 'stash' && state.sel.ref === b.ref ? 'active' : ''}" data-kind="stash" data-name="${esc(b.ref)}" title="${esc(b.msg)}">${esc(b.msg)}</div>`)) +
    submoduleSection() +
    worktreeSection() +
    lfsSection() +
    flowSection();
}

function trackText(t) {
  if (!t) return '';
  return t.replace(/ahead (\d+)/, '↑$1').replace(/behind (\d+)/, '↓$1').replace(/[\[\],]/g, '').replace('gone', '✕');
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function badges(c) {
  if (!kgGetAppearance().showRefs) return '';
  return c.refs.map((r) => `<span class="badge ${r.type}">${esc(r.name)}</span>`).join('');
}

// Relative dates ("3 days ago") for the log; the exact date and time stay available as a tooltip.
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function fmtCommitDate(ms) {
  if (kgGetAppearance().dateFmt !== 'relative') return fmtDate(ms);
  const s = Math.round((ms - Date.now()) / 1000);
  for (const [unit, secs] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= secs) return relFmt.format(Math.round(s / secs), unit);
  }
  return relFmt.format(0, 'second');
}

const LOG_COLUMNS = {
  author: (c) => `<span class="auth">${avatarHtml(c.author, c.email)}<span class="an">${esc(c.author)}</span></span>`,
  date: (c) => `<span class="date" title="${esc(new Date(c.time).toLocaleString())}">${fmtCommitDate(c.time)}</span>`,
  sha: (c) => `<span class="sha">${c.hash.slice(0, 7)}</span>`,
};

function renderList() {
  const list = $('#commit-list');
  const f = state.filter.toLowerCase();
  const scroll = list.scrollTop;
  const cols = kgGetAppearance().columns.filter((k) => LOG_COLUMNS[k]);
  let html = '';
  state.commits.forEach((c, i) => {
    if (f && !(`${c.subject} ${c.author} ${c.hash}`.toLowerCase().includes(f))) return;
    html += `<div class="crow ${state.sel.type === 'commit' && state.sel.hash === c.hash ? 'sel' : ''}" data-hash="${c.hash}">` +
      (f ? '' : graphSvg(state.graph[i])) +
      `<span class="msg">${badges(c)}${esc(c.subject)}</span>` + cols.map((k) => LOG_COLUMNS[k](c)).join('') + '</div>';
  });
  list.innerHTML = html || '<div class="empty">No commits</div>';
  list.scrollTop = scroll;
}

const STATUS_LABEL = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', '?': 'U', T: 'M', U: 'U' };

function fileRow(path, code, opts = {}) {
  const base = path.split('/').pop(), dir = path.slice(0, path.length - base.length);
  const sel = state.file && state.file.path === path && state.file.area === opts.area ? 'sel' : '';
  const c = STATUS_LABEL[code] || code;
  const tree = opts.depth != null;
  const pad = tree ? ` style="padding-left:${26 + opts.depth * 14}px"` : '';
  const label = tree ? esc(base) : `${esc(base)} <small>${esc(dir)}</small>`;
  return `<div class="frow ${sel}"${pad} data-path="${esc(path)}" data-area="${opts.area || ''}"><span class="st ${c === '!' ? 'X' : c}">${c}</span><span class="name" title="${esc(path)}">${label}</span>${opts.lfs ? '<span class="lfs-badge" title="Stored with Git LFS">LFS</span>' : ''}${opts.acts || ''}</div>`;
}

function renderDetail() {
  applyLayout();
  const t = state.sel.type;
  if (t === 'wc') return renderWorkingCopy();
  if (t === 'stash') return renderStashDetail();
  if (t === 'log') {
    $('#detail-left').innerHTML = '<div class="empty">Select a commit to see its details</div>';
    $('#detail-right').innerHTML = '';
    return;
  }
  return renderCommitDetail();
}

/* ---------- diff ---------- */

async function showFileDiff() {
  const { path, area } = state.file;
  if (area === 'conflict') return showConflict(path);
  const right = $('#detail-right');
  let r;
  if (area === 'stash') return showStashFileDiff(path);
  if (IMAGE_EXT.test(path) && ['commit', 'staged', 'unstaged'].includes(area)) return showImageDiff(path, area);
  if (area === 'tree') return showTreeFile(path);
  if (area === 'commit') {
    const c = state.commits.find((x) => x.hash === state.sel.hash);
    r = c.parents.length
      ? await window.api.git(state.repo, ['diff', '-M', c.parents[0], c.hash, '--', path])
      : await window.api.git(state.repo, ['show', '--format=', c.hash, '--', path]);
  } else if (area === 'staged') {
    r = await window.api.git(state.repo, ['diff', '--cached', '--', path]);
  } else {
    const f = state.status.find((x) => x.path === path);
    r = f && f.untracked
      ? await window.api.git(state.repo, ['diff', '--no-index', '--', '/dev/null', path])
      : await window.api.git(state.repo, ['diff', '--', path]);
  }
  if (!state.file || state.file.path !== path || state.file.area !== area) return;
  const f = state.status.find((x) => x.path === path);
  const mode = area === 'staged' ? 'staged' : area === 'unstaged' && f && !f.untracked ? 'unstaged' : null;
  const seg = (v, label) => `<button data-view="${v}" class="${diffView === v ? 'primary' : ''}">${label}</button>`;
  right.innerHTML = `<div class="diff-title"><span>${esc(path)}</span><span class="seg">${seg('unified', 'Unified')}${seg('split', 'Side by side')}</span></div>` + renderDiff(r.stdout, mode, path);
}

let diffLang = null;
let diffView = 'unified';
try { diffView = localStorage.getItem('diffView') === 'split' ? 'split' : 'unified'; } catch { /* ignore */ }

// Splits a unified diff into its file header and hunks (each hunk: header line + body lines).
function parseDiff(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const first = lines.findIndex((l) => l.startsWith('@@'));
  if (first < 0) return null;
  const hunks = [];
  for (const l of lines.slice(first)) {
    if (l.startsWith('@@')) hunks.push([l]); else hunks[hunks.length - 1].push(l);
  }
  return { header: lines.slice(0, first), hunks };
}

function hunkButtons(mode) {
  const btn = (i, op, label) => `<button data-hunk="${i}" data-op="${op}">${label}</button>`;
  if (mode === 'staged') return (i) => btn(i, 'unstage-lines', 'Unstage lines') + btn(i, 'unstage', 'Unstage hunk');
  if (mode === 'unstaged') return (i) => btn(i, 'stage-lines', 'Stage lines') + btn(i, 'discard-lines', 'Discard lines') + btn(i, 'stage', 'Stage hunk') + btn(i, 'discard', 'Discard hunk');
  return () => '';
}

const lineBox = (mode, hi, k) => (mode ? `<input type="checkbox" class="lc" data-h="${hi}" data-l="${k}">` : '<span class="lc"></span>');

// Renders hunks as unified or side-by-side; when mode is set, hunks/lines can be staged individually.
function renderHunks(text, mode) {
  const d = parseDiff(text);
  if (!d) return null;
  state.hunks = mode ? { header: d.header.join('\n') + '\n', hunks: d.hunks.map((h) => h.join('\n') + '\n'), lines: d.hunks } : null;
  const acts = hunkButtons(mode);
  const hl = d.hunks.map((h) => highlightHunk(h, diffLang));
  const wd = d.hunks.map(hunkWordRanges);
  const codeOf = (hi, k, text) => markRanges(hl[hi][k] ?? esc(text), wd[hi][k]) || ' ';
  const bar = (h, i) => `<span>${esc(h[0])}</span><span class="hacts">${acts(i)}</span>`;
  if (diffView === 'split') return renderSplit(d, mode, bar, codeOf);
  const line = (hi) => (l, k) => {
    const cls = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '';
    return `<div class="${cls}">${lineBox(cls && mode, hi, k + 1)}<span class="pm">${l[0] === ' ' ? ' ' : esc(l[0])}</span>${codeOf(hi, k + 1, l.slice(1))}</div>`;
  };
  const body = d.header.map((l) => `<div class="meta">${esc(l)}</div>`).join('') +
    d.hunks.map((h, i) => `<div class="hunkbar">${bar(h, i)}</div>${h.slice(1).map(line(i)).join('')}`).join('');
  return `<pre class="diff">${body}</pre>`;
}

function renderSplit(d, mode, bar, codeOf) {
  const cell = (side, hi, item) => {
    if (!item) return '<td class="ln"></td><td class="code empty"></td>';
    const cls = item.type === 'ctx' ? '' : side === 'old' ? 'del' : 'add';
    return `<td class="ln">${item.no}</td><td class="code ${cls}">${lineBox(cls && mode, hi, item.k)}${codeOf(hi, item.k, item.text)}</td>`;
  };
  let rows = '';
  d.hunks.forEach((h, hi) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(h[0]);
    let o = m ? +m[1] : 1, n = m ? +m[2] : 1;
    let dels = [], adds = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows += `<tr>${cell('old', hi, dels[i])}${cell('new', hi, adds[i])}</tr>`;
      dels = []; adds = [];
    };
    rows += `<tr class="hunkbar"><td colspan="4"><div class="hb">${bar(h, hi)}</div></td></tr>`;
    for (let k = 1; k < h.length; k++) {
      const l = h[k], c = l[0], text = l.slice(1);
      if (c === '-') dels.push({ type: 'del', no: o++, text, k });
      else if (c === '+') adds.push({ type: 'add', no: n++, text, k });
      else if (c === '\\') continue;
      else { flush(); rows += `<tr>${cell('old', hi, { type: 'ctx', no: o++, text, k })}${cell('new', hi, { type: 'ctx', no: n++, text, k })}</tr>`; }
    }
    flush();
  });
  return `<table class="split"><colgroup><col class="cn"><col><col class="cn"><col></colgroup>${rows}</table>`;
}

function renderDiff(text, mode, path) {
  state.hunks = null;
  diffLang = path ? langFor(path) : null;
  if (!text.trim()) return '<div class="empty">No textual changes (empty or binary file)</div>';
  if (LFS_POINTER.test(text)) return lfsDiffHtml(text);
  if (text.split('\n').length <= 6000) { const h = renderHunks(text, mode); if (h) return h; }
  const lines = text.split('\n');
  const cut = lines.length > 6000;
  const out = lines.slice(0, 6000).map((l) => {
    let cls = '';
    if (l.startsWith('@@')) cls = 'hunk';
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(l)) cls = 'meta';
    else if (l[0] === '+') cls = 'add';
    else if (l[0] === '-') cls = 'del';
    return `<div class="${cls}">${esc(l) || ' '}</div>`;
  });
  if (cut) out.push('<div class="meta">… diff truncated …</div>');
  return `<pre class="diff">${out.join('')}</pre>`;
}

/* ---------- actions ---------- */

const stage = (paths) => run('Stage', () => git(['add', '--', ...paths]));
async function unstage(paths) {
  return run('Unstage', async () => {
    try { await git(['restore', '--staged', '--', ...paths]); }
    catch { await git(['rm', '--cached', '-r', '--', ...paths]); }
  });
}

async function discard(path) {
  const f = state.status.find((x) => x.path === path);
  if (!(await confirm2('Discard changes', `Discard changes to ${path}? This cannot be undone.`, true))) return;
  await run('Discard', async () => {
    if (f && f.untracked) await git(['clean', '-f', '--', path]);
    else await git(['restore', '--', path]);
  });
}

async function doCommit() {
  const msg = readDraft().trim();
  const subject = $('#msg').value.trim();
  const amend = $('#amend').checked;
  if (!subject && !amend) return setStatus('Enter a commit subject', true);
  if (state.status.some((f) => f.conflict)) return setStatus('Resolve all conflicts before committing', true);
  if (!state.status.some((f) => f.staged) && !amend) return setStatus('Nothing staged', true);
  const ok = await run(amend ? 'Amend commit' : 'Commit', () => git(['commit', ...(amend ? ['--amend'] : []), ...(msg ? ['-F', '-'] : ['--no-edit'])], msg || undefined));
  state.draft = '';
  if (state.sel.type === 'wc' && $('#msg')) { fillMessage(''); $('#amend').checked = false; amendFilled = null; }
  return ok;
}

const fetchAll = () => run('Fetch', () => git(['fetch', '--all', '--prune']));
const pull = () => run('Pull', () => gitAllowConflict(['pull']));
const NO_UPSTREAM = /no upstream|--set-upstream/;
const PUSH_REJECTED = /rejected|non-fast-forward|fetch first|stale info/i;

async function push() {
  if (state.busy) return;
  let rejected = false;
  await run('Push', async () => {
    try { await git(['push']); }
    catch (e) {
      if (NO_UPSTREAM.test(e.message) && state.head) return git(['push', '--set-upstream', 'origin', state.head]);
      if (!PUSH_REJECTED.test(e.message)) throw e;
      rejected = true;
    }
  });
  if (!rejected) return;
  setStatus('Push rejected by the remote', true);
  const ok = await confirm2('Push rejected', 'The remote branch has commits you do not have, or its history differs (for example after a rebase). Force push with --force-with-lease? It overwrites the remote branch only if nobody pushed to it since your last fetch.', true);
  if (ok) forcePush(true);
}

async function forcePush(confirmed = false) {
  if (state.busy) return;
  if (!state.head) return notice('Force push', 'Check out a branch first (HEAD is detached).');
  if (!confirmed && !(await confirm2('Force push', `Force push ${state.head} with --force-with-lease? The remote branch is overwritten if nobody pushed to it since your last fetch.`, true))) return;
  await run('Force push', async () => {
    try { await git(['push', '--force-with-lease']); }
    catch (e) {
      if (!NO_UPSTREAM.test(e.message)) throw e;
      await git(['push', '--force-with-lease', '--set-upstream', 'origin', state.head]);
    }
  });
}

async function newBranch(from) {
  const name = await prompt2('New branch', 'Branch name' + (from ? ` (from ${from.slice(0, 7)})` : ''));
  if (name) run('Create branch', () => git(['checkout', '-b', name, ...(from ? [from] : [])]));
}

const checkout = (ref) => run('Checkout ' + ref, () => git(['checkout', ref]));
const checkoutRemote = (name) => run('Checkout ' + name, async () => {
  const local = name.split('/').slice(1).join('/');
  if (state.branches.some((b) => b.name === local)) await git(['checkout', local]);
  else await git(['checkout', '--track', name]);
});

function branchMenu(e, el) {
  e.preventDefault();
  const { kind, name } = el.dataset;
  if (kind === 'submodule') return submoduleMenu(e, name);
  if (kind === 'worktree') return worktreeMenu(e, name);
  if (kind === 'lfs') return lfsMenu(e, name);
  if (kind === 'flow') return flowMenu(e, name);
  if (kind === 'branch') {
    const cur = name === state.head;
    ctxMenu(e.clientX, e.clientY, [
      !cur && { label: 'Checkout', action: () => checkout(name) },
      !cur && { label: `Merge into ${state.head}`, action: () => run('Merge', () => gitAllowConflict(['merge', name])) },
      { label: `Rebase ${state.head} onto ${name}`, action: () => rebaseOnto(name) },
      { label: 'Rename…', action: async () => { const n = await prompt2('Rename branch', 'New name', name); if (n) run('Rename', () => git(['branch', '-m', name, n])); } },
      cur && { label: 'Force push (with lease)', action: () => forcePush() },
      { label: 'Create worktree…', action: () => addWorktreeDialog(name) },
      !cur && '-',
      !cur && { label: 'Delete', action: async () => { if (await confirm2('Delete branch', `Delete branch ${name}?`, true)) run('Delete branch', () => git(['branch', '-D', name])); } },
    ].filter(Boolean));
  } else if (kind === 'remote') {
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Checkout', action: () => checkoutRemote(name) },
      { label: `Merge into ${state.head}`, action: () => run('Merge', () => gitAllowConflict(['merge', name])) },
      { label: `Rebase ${state.head} onto ${name}`, action: () => rebaseOnto(name) },
      '-',
      { label: 'Delete on remote', action: async () => { const [rm, ...b] = name.split('/'); if (await confirm2('Delete remote branch', `Delete ${name} on the server?`, true)) run('Delete remote branch', () => git(['push', rm, '--delete', b.join('/')])); } },
    ]);
  } else if (kind === 'tag') {
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Checkout', action: () => checkout(name) },
      { label: 'Push to origin', action: () => run('Push tag', () => git(['push', 'origin', name])) },
      { label: 'Delete', action: async () => { if (await confirm2('Delete tag', `Delete tag ${name}?`, true)) run('Delete tag', () => git(['tag', '-d', name])); } },
    ]);
  } else if (kind === 'stash') {
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Apply', action: () => run('Apply stash', () => gitAllowConflict(['stash', 'apply', name])) },
      { label: 'Pop', action: () => run('Pop stash', () => gitAllowConflict(['stash', 'pop', name])) },
      { label: 'Drop', action: async () => { if (await confirm2('Drop stash', 'Drop this stash?', true)) run('Drop stash', () => git(['stash', 'drop', name])); } },
    ]);
  }
}

function commitMenu(e, hash) {
  e.preventDefault();
  const c = state.commits.find((x) => x.hash === hash);
  const short = hash.slice(0, 7);
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Checkout (detached)', action: () => checkout(hash) },
    { label: 'Create branch here…', action: () => newBranch(hash) },
    { label: 'Create tag here…', action: async () => { const n = await prompt2('New tag', 'Tag name'); if (n) run('Tag', () => git(['tag', n, hash])); } },
    '-',
    { label: 'Cherry-pick', action: () => run('Cherry-pick', () => gitAllowConflict(['cherry-pick', ...(c.parents.length > 1 ? ['-m', '1'] : []), hash])) },
    { label: 'Revert', action: () => run('Revert', () => gitAllowConflict(['revert', '--no-edit', ...(c.parents.length > 1 ? ['-m', '1'] : []), hash])) },
    '-',
    ...['soft', 'mixed', 'hard'].map((m) => ({
      label: `Reset ${state.head || 'HEAD'} here (${m})`,
      action: async () => { if (m !== 'hard' || (await confirm2('Hard reset', `Hard reset to ${short}? Uncommitted changes will be lost.`, true))) run('Reset', () => git(['reset', '--' + m, hash])); },
    })),
    '-',
    { label: `Rebase ${state.head || 'HEAD'} onto this commit`, action: () => rebaseOnto(hash, short) },
    { label: 'Interactive rebase onto here…', action: () => interactiveRebase(c, false) },
    { label: 'Interactive rebase from here…', action: () => interactiveRebase(c, true) },
    '-',
    { label: 'Copy SHA', action: () => navigator.clipboard.writeText(hash) },
  ]);
}

/* ---------- clone ---------- */

function repoNameFromUrl(url) {
  return url.trim().replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/:]/).pop() || '';
}

function cloneDialog() {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="modal"><h3>Clone repository</h3>
      <div class="field"><label>Repository URL</label><input type="text" id="cl-url" placeholder="https://github.com/user/repo.git"></div>
      <div class="field"><label>Parent folder</label><div class="row"><input type="text" id="cl-dir"><button id="cl-browse">Browse…</button></div></div>
      <div class="field"><label>Folder name</label><input type="text" id="cl-name"></div>
      <label class="cl-opt"><input type="checkbox" id="cl-sub" checked> Also clone submodules</label>
      <div class="btns"><button id="cl-cancel">Cancel</button><button class="primary" id="cl-ok">Clone</button></div></div>`;
    ov.classList.remove('hidden');
    const url = $('#cl-url'), dir = $('#cl-dir'), name = $('#cl-name');
    dir.value = localStorage.getItem('cloneDir') || '';
    let nameEdited = false;
    const close = (v) => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; resolve(v); };
    url.oninput = () => { if (!nameEdited) name.value = repoNameFromUrl(url.value); };
    name.oninput = () => { nameEdited = true; };
    $('#cl-browse').onclick = async () => { const d = await window.api.pickFolder(); if (d) dir.value = d; };
    $('#cl-cancel').onclick = () => close(null);
    const submit = () => {
      if (!url.value.trim() || !dir.value.trim() || !name.value.trim()) return;
      close({ url: url.value.trim(), dir: dir.value.trim(), name: name.value.trim(), submodules: $('#cl-sub').checked });
    };
    $('#cl-ok').onclick = submit;
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') submit(); };
    url.focus();
  });
}

async function cloneRepo() {
  const c = await cloneDialog();
  if (!c) return;
  localStorage.setItem('cloneDir', c.dir);
  const target = c.dir.replace(/[\\/]+$/, '') + '/' + c.name;
  const ok = await run('Clone ' + c.name, async () => {
    const ov = $('#overlay');
    ov.innerHTML = '<div class="modal"><h3>Cloning…</h3><p>' + esc(c.url) + '</p></div>';
    ov.classList.remove('hidden');
    try {
      const r = await window.api.git(c.dir, ['clone', ...(c.submodules ? ['--recurse-submodules'] : []), '--', c.url, c.name]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'git clone failed').trim());
      return true;
    } finally {
      ov.classList.add('hidden');
      ov.innerHTML = '';
    }
  });
  if (ok) await openRepo(target);
}

/* ---------- recents ---------- */

function recents() {
  try { return JSON.parse(localStorage.getItem('recent') || '[]'); } catch { return []; }
}
function saveRecent(p) {
  localStorage.setItem('recent', JSON.stringify([p, ...recents().filter((x) => x !== p)].slice(0, 8)));
}
function renderRecent() {
  $('#recent').innerHTML = recents().map((p) => `<div class="item" data-path="${esc(p)}"><span>${esc(p.split(/[\\/]/).pop())}</span><small>${esc(p)}</small></div>`).join('');
}

/* ---------- events ---------- */

$('#btn-open').onclick = pickAndOpen;
$('#tb-open').onclick = pickAndOpen;
$('#btn-clone').onclick = cloneRepo;
$('#tb-clone').onclick = cloneRepo;
$('#recent').onclick = (e) => { const it = e.target.closest('.item'); if (it) openRepo(it.dataset.path); };
$('#tb-fetch').onclick = fetchAll;
$('#tb-pull').onclick = pull;
$('#tb-push').onclick = push;
$('#tb-push').oncontextmenu = (e) => {
  e.preventDefault();
  ctxMenu(e.clientX, e.clientY, [{ label: 'Push', action: push }, { label: 'Force push (with lease)', action: () => forcePush() }]);
};
$('#tb-branch').onclick = () => newBranch();
$('#tb-stash').onclick = () => stashDialog();
$('#tb-reflog').onclick = () => showReflog();
$('#search').oninput = (e) => { state.filter = e.target.value.trim(); renderList(); };

$('#sidebar').onclick = (e) => {
  if (e.target.closest('[data-act=bulk-branches]')) return deleteBranchesDialog();
  if (e.target.closest('[data-act=add-submodule]')) return addSubmodule();
  if (e.target.closest('[data-act=add-worktree]')) return addWorktreeDialog();
  if (e.target.closest('[data-act=flow-init]')) return flowInit();
  if (e.target.closest('[data-act=flow-start]')) return flowStartMenu(e);
  if (e.target.closest('[data-act=lfs-track]')) return lfsTrack();
  if (e.target.closest('[data-act=lfs-files]')) return lfsFilesDialog();
  if (e.target.closest('[data-act=lfs-pull]')) return lfsPull();
  if (e.target.closest('[data-act=prune-worktrees]')) return pruneWorktrees();
  if (e.target.closest('[data-act=update-submodules]')) return updateAllSubmodules();
  if (e.target.closest('[data-act=wc]')) { selectWc(); return; }
  if (e.target.closest('[data-act=log]')) { selectLog(); return; }
  const it = e.target.closest('.sb-item[data-kind]');
  if (!it) return;
  if (it.dataset.kind === 'stash') return selectStash(it.dataset.name);
  const target = { branch: state.branches, flow: state.branches, remote: state.remotes, tag: state.tags }[it.dataset.kind];
  const hit = target && target.find((x) => x.name === it.dataset.name);
  if (hit) selectCommit(hit.hash, true);
};
$('#sidebar').ondblclick = (e) => {
  const it = e.target.closest('.sb-item[data-kind]');
  if (!it) return;
  if (it.dataset.kind === 'worktree') {
    const w = state.worktrees.find((x) => x.path === it.dataset.name);
    return w && !w.current && !w.prunable ? openRepo(w.path) : undefined;
  }
  if (it.dataset.kind === 'submodule') {
    const s = state.submodules.find((x) => x.path === it.dataset.name);
    return s && s.flag !== '-' ? openRepo(state.repo + '/' + s.path) : undefined;
  }
  if ((it.dataset.kind === 'branch' || it.dataset.kind === 'flow') && it.dataset.name !== state.head) checkout(it.dataset.name);
  if (it.dataset.kind === 'remote') checkoutRemote(it.dataset.name);
  if (it.dataset.kind === 'tag') checkout(it.dataset.name);
};
$('#sidebar').oncontextmenu = (e) => { const it = e.target.closest('.sb-item[data-kind]'); if (it) branchMenu(e, it); };

function selectWc() {
  state.sel = { type: 'wc' };
  state.file = null;
  renderSidebar(); renderList(); renderDetail();
}
function selectCommit(hash, scroll) {
  state.draft = readDraft();
  state.sel = { type: 'commit', hash };
  state.lastCommit = hash;
  state.file = null;
  renderSidebar(); renderList(); renderDetail();
  if (scroll) {
    const row = $(`.crow[data-hash="${hash}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }
}

$('#commit-list').onclick = (e) => {
  const row = e.target.closest('.crow');
  if (!row) return;
  if (row.dataset.wc) selectWc(); else selectCommit(row.dataset.hash);
};
$('#commit-list').oncontextmenu = (e) => {
  const row = e.target.closest('.crow[data-hash]');
  if (row) commitMenu(e, row.dataset.hash);
};

$('#detail-left').onclick = async (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.preventDefault(); return selectCommit(goto.dataset.goto, true); }
  if (e.target.closest('#do-commit')) return doCommit();
  if (e.target.closest('[data-act=toggle-files]')) return toggleFileView();
  const dr = e.target.closest('.drow');
  if (dr) {
    const dact = e.target.closest('[data-act]');
    const pre = dr.dataset.dir + '/';
    if (dact && dact.dataset.act === 'stage-dir') return stage(state.status.filter((f) => f.unstaged && f.path.startsWith(pre)).map((f) => f.path));
    if (dact && dact.dataset.act === 'unstage-dir') return unstage(state.status.filter((f) => f.staged && f.path.startsWith(pre)).map((f) => f.path));
    toggleDir(dr.dataset.area, dr.dataset.dir);
    return renderDetail();
  }
  const act = e.target.closest('[data-act]');
  const row = e.target.closest('.frow');
  if (act && !row) {
    if (act.dataset.act === 'op-continue') return opAction('continue');
    if (act.dataset.act === 'op-abort') return opAction('abort');
    if (act.dataset.act === 'op-skip') return opAction('skip');
    if (act.dataset.act === 'op-tool') return openMergeTool();
    if (act.dataset.act === 'stage-all') return stage(state.status.filter((f) => f.unstaged).map((f) => f.path));
    if (act.dataset.act === 'unstage-all') return unstage(state.status.filter((f) => f.staged).map((f) => f.path));
  }
  if (!row) return;
  const path = row.dataset.path;
  if (act) {
    if (act.dataset.act === 'stage') return stage([path]);
    if (act.dataset.act === 'unstage') return unstage([path]);
    if (act.dataset.act === 'discard') return discard(path);
  }
  if (state.sel.type === 'commit' && state.dtab === 'commit') {
    state.dtab = 'changes';
    state.file = { path, area: row.dataset.area };
    return renderDetail();
  }
  state.file = { path, area: row.dataset.area };
  document.querySelectorAll('#detail-left .frow').forEach((r) => r.classList.toggle('sel', r === row));
  showFileDiff();
};

$('#detail-right').onclick = async (e) => {
  if (state.file && state.file.area === 'conflict') return conflictClick(e);
  const v = e.target.closest('[data-view]');
  if (v) {
    diffView = v.dataset.view;
    try { localStorage.setItem('diffView', diffView); } catch { /* ignore */ }
    return state.file && showFileDiff();
  }
  const b = e.target.closest('[data-hunk]');
  if (!b || !state.hunks) return;
  const hi = +b.dataset.hunk;
  const [op, lineMode] = b.dataset.op.split('-');
  const what = lineMode ? 'lines' : 'hunk';
  let patch = state.hunks.header + state.hunks.hunks[hi];
  if (lineMode) {
    const picked = new Set([...document.querySelectorAll(`#detail-right input[data-h="${hi}"]:checked`)].map((c) => +c.dataset.l));
    if (!picked.size) return setStatus('Tick the lines to ' + op + ' first', true);
    patch = state.hunks.header + partialHunk(state.hunks.lines[hi], picked, op === 'stage');
  }
  if (op === 'discard' && !(await confirm2('Discard ' + what, `Discard the selected ${what} from the working copy? This cannot be undone.`, true))) return;
  const flags = { stage: ['--cached'], unstage: ['--cached', '-R'], discard: ['-R'] }[op];
  run(op[0].toUpperCase() + op.slice(1) + ' ' + what, () => git(['apply', ...flags, '--recount', '--whitespace=nowarn', '-'], patch));
};

// Rebuilds a hunk so only the picked +/- lines are kept as changes. Forward patches (stage)
// turn unpicked '-' into context and drop unpicked '+'; reverse patches (unstage/discard) do the opposite.
function partialHunk(h, picked, forward) {
  const out = [h[0]];
  let lastKept = false;
  for (let k = 1; k < h.length; k++) {
    const l = h[k];
    const c = l[0];
    if (c === '\\') { if (lastKept) out.push(l); continue; }
    if (c === ' ' || picked.has(k)) { out.push(l); lastKept = true; continue; }
    const unpickedAdd = c === '+', unpickedDel = c === '-';
    if (forward ? unpickedDel : unpickedAdd) { out.push(' ' + l.slice(1)); lastKept = true; }
    else if (unpickedAdd || unpickedDel) lastKept = false;
    else { out.push(l); lastKept = true; }
  }
  return out.join('\n') + '\n';
}

$('#tabs').onclick = (e) => {
  if (e.target.closest('#tab-add')) return pickAndOpen();
  const x = e.target.closest('[data-close]');
  if (x) return closeTab(+x.dataset.close);
  const t = e.target.closest('.tab');
  if (t && +t.dataset.i !== active) activate(+t.dataset.i);
};
$('#tabs').onauxclick = (e) => {
  const t = e.target.closest('.tab');
  if (e.button === 1 && t) closeTab(+t.dataset.i);
};

window.addEventListener('focus', () => state.repo && !state.busy && refresh());

renderRecent();
(async () => {
  let saved = { repos: [], active: -1 };
  try { saved = JSON.parse(localStorage.getItem('tabs')) || saved; } catch { /* ignore */ }
  saved.repos.forEach((repo) => tabs.push({ repo, snap: null }));
  const initial = await window.api.initialRepo();
  // Later scripts (submodules, worktrees, …) define functions used while loading a repository.
  if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
  if (initial) await openRepo(initial);
  else if (tabs.length) await activate(Math.min(Math.max(saved.active, 0), tabs.length - 1));
})();
