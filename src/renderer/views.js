'use strict';
// Main views. "Local Changes" is its own screen (unstaged / staged trees, commit box and a full-height diff);
// "All Commits" is the graph with a Commit / Changes / File Tree panel for the selected commit.

const cmpName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

// Renders a flat list of files as a collapsible folder tree. `rowFn(file, depth)` renders a file row.
function renderTree(files, area, defaultOpen, rowFn, dirActs = '') {
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      n = n.dirs[parts[i]] || (n.dirs[parts[i]] = { dirs: {}, files: [], path: parts.slice(0, i + 1).join('/') });
    }
    n.files.push(f);
  }
  const out = [];
  const walk = (n, depth) => {
    for (const name of Object.keys(n.dirs).sort(cmpName)) {
      const d = n.dirs[name];
      const open = state.treeOpen[`${area}:${d.path}`] ?? defaultOpen;
      out.push(`<div class="drow" style="padding-left:${10 + depth * 14}px" data-dir="${esc(d.path)}" data-area="${area}"><span class="caret">${open ? '▾' : '▸'}</span><span class="dname">📁 ${esc(name)}</span>${dirActs}</div>`);
      if (open) walk(d, depth + 1);
    }
    n.files.sort((a, b) => cmpName(a.path, b.path)).forEach((f) => out.push(rowFn(f, depth)));
  };
  walk(root, 0);
  return out.join('');
}

// Tree or flat list of files, remembered between sessions.
let fileView = 'tree';
try { if (localStorage.getItem('fileView') === 'flat') fileView = 'flat'; } catch { /* ignore */ }

function renderFileList(files, area, defaultOpen, rowFn, dirActs = '') {
  if (fileView === 'tree') return renderTree(files, area, defaultOpen, rowFn, dirActs);
  return [...files].sort((a, b) => cmpName(a.path, b.path)).map((f) => rowFn(f, null)).join('');
}

// Every folder of a file list ("src", "src/app", …), for collapsing or expanding them all.
const dirsOf = (files) => {
  const dirs = new Set();
  for (const f of files) { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) dirs.add(p.slice(0, i).join('/')); }
  return [...dirs];
};
const treeFiles = {}; // area -> the files last shown there, for the collapse / expand all button

const COLLAPSE_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8h5"/></svg>';
const EXPAND_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8h5M8 5.5v5"/></svg>';

// Buttons at the top of a file list: collapse / expand all folders (tree view, when there are folders), then
// tree / flat list. A folder counts as open unless closed, the same default renderTree uses for these lists.
const viewToggle = (area, files) => {
  let all = '';
  if (fileView === 'tree' && area && files) {
    treeFiles[area] = files;
    const dirs = dirsOf(files);
    if (dirs.length) {
      const anyOpen = dirs.some((d) => state.treeOpen[`${area}:${d}`] ?? true);
      all = `<button class="vtoggle" data-act="tree-all" data-area="${area}" data-open="${anyOpen ? '0' : '1'}" title="${anyOpen ? 'Collapse all folders' : 'Expand all folders'}">${anyOpen ? COLLAPSE_SVG : EXPAND_SVG}</button>`;
    }
  }
  return all + `<button class="vtoggle" data-act="toggle-files" title="${fileView === 'tree' ? 'Show as a flat list' : 'Show as a tree'}">${fileView === 'tree' ? '☰' : '🗂'}</button>`;
};

function setAllDirs(area, open) {
  for (const d of dirsOf(treeFiles[area] || [])) state.treeOpen[`${area}:${d}`] = open;
  if (state.repo) renderDetail();
}

function toggleFileView() {
  fileView = fileView === 'tree' ? 'flat' : 'tree';
  try { localStorage.setItem('fileView', fileView); } catch { /* ignore */ }
  if (state.repo) renderDetail();
}

function toggleDir(area, dir) {
  const key = `${area}:${dir}`;
  const def = area !== 'tree';
  state.treeOpen[key] = !(state.treeOpen[key] ?? def);
}

/* ---------- layout ---------- */

function applyLayout() {
  const t = state.sel.type;
  const commitTab = t === 'commit' ? state.dtab : null;
  $('#main').classList.toggle('wc-mode', t === 'wc');
  $('#dtabs').classList.toggle('hidden', t !== 'commit');
  $('#detail-left').classList.toggle('wc', t === 'wc');
  if (t !== 'wc') { $('#wc-commit').classList.add('hidden'); $('#wc-commit').innerHTML = ''; }
  $('#detail-left').classList.toggle('full', commitTab === 'commit');
  $('#detail-right').classList.toggle('hidden', commitTab === 'commit');
  // The diff sits in a column with the commit box; hide the column too, or it keeps half the width empty.
  $('.detail-rcol').classList.toggle('hidden', commitTab === 'commit');
  if (t === 'commit') {
    $('#dtabs').innerHTML = [['commit', 'Commit'], ['changes', 'Changes'], ['tree', 'File Tree']]
      .map(([v, l]) => `<button class="dtab ${state.dtab === v ? 'active' : ''}" data-dtab="${v}">${l}</button>`).join('');
  }
}

$('#dtabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dtab]');
  if (!b || state.dtab === b.dataset.dtab) return;
  state.dtab = b.dataset.dtab;
  state.file = null;
  renderDetail();
});

function selectLog() {
  state.draft = readDraft();
  if (state.lastCommit && state.commits.some((c) => c.hash === state.lastCommit)) return selectCommit(state.lastCommit, true);
  state.sel = { type: 'log' };
  state.file = null;
  renderSidebar(); renderList(); renderDetail();
}

/* ---------- Local Changes ---------- */

function renderWorkingCopy() {
  const staged = state.status.filter((f) => f.staged);
  const unstaged = state.status.filter((f) => f.unstaged);
  const conflicts = state.status.filter((f) => f.conflict);
  const left = $('#detail-left');
  const scroll = [...left.querySelectorAll('.wc-files')].map((el) => el.scrollTop);
  const fileActs = { unstaged: '<span class="acts"><button data-act="stage">Stage</button><button data-act="discard">Discard</button></span>', staged: '<span class="acts"><button data-act="unstage">Unstage</button></span>' };
  const section = (title, list, area, allAct, allLabel) => `<div class="wc-sec wc-${area}"><div class="fhead"><span>${title} (${list.length})</span><span class="fh-act">${viewToggle(area, list)}<button data-act="${allAct}" ${list.length ? '' : 'disabled'}>${allLabel}</button></span></div>
    <div class="wc-files">${renderFileList(list, area, true,
    (f, d) => fileRow(f.path, area === 'staged' ? f.x : f.untracked ? '?' : f.y, { area, depth: d, acts: fileActs[area], lfs: f.lfs }),
    `<span class="acts"><button data-act="${area === 'staged' ? 'unstage-dir' : 'stage-dir'}">${area === 'staged' ? 'Unstage' : 'Stage'}</button></span>`)}</div></div>`;
  left.innerHTML = opBanner() +
    (conflicts.length ? `<div class="fhead conflict-head"><span>Conflicts (${conflicts.length})</span></div>` + conflicts.map((f) => fileRow(f.path, '!', { area: 'conflict' })).join('') : '') +
    section('Unstaged', unstaged, 'unstaged', 'stage-all', 'Stage all') +
    '<div class="splitter h" id="sp-wc" title="Drag to resize · double-click to reset"></div>' +
    section('Staged', staged, 'staged', 'unstage-all', 'Unstage all');
  makeWcSplitter($('#sp-wc'));
  renderCommitBox();
  left.querySelectorAll('.wc-files').forEach((el, i) => { el.scrollTop = scroll[i] || 0; });
  if (state.file && !state.status.some((f) => f.path === state.file.path && (state.file.area !== 'conflict' || f.conflict))) state.file = null;
  if (state.file) showFileDiff(); else $('#detail-right').innerHTML = '<div class="empty">Select a file to see its changes</div>';
}

// The commit box sits under the diff, on the right. It is built once and kept while Local Changes is shown, so
// a refresh (for example after an automatic fetch) never interrupts typing; only the button label follows HEAD.
function renderCommitBox() {
  const box = $('#wc-commit');
  box.classList.remove('hidden');
  const label = 'Commit' + (state.head ? ' to ' + state.head : '');
  if ($('#wc-commit #msg')) { $('#do-commit').textContent = label; return updateCommitButton(); }
  const keep = state.draft || '';
  box.innerHTML = `<div class="commitbox"><div class="subj-row"><input type="text" id="msg" placeholder="Commit subject" spellcheck="true"><span id="msg-count" class="subj-count"></span></div>
      <textarea id="desc" placeholder="Description" spellcheck="true"></textarea>
      <div class="cb-row"><label><input type="checkbox" id="amend"> Amend last commit</label>
      <button class="primary" id="do-commit">${esc(label)}</button></div></div>`;
  const parts = splitMessage(keep);
  $('#msg').value = parts.subject;
  $('#desc').value = parts.desc;
  updateSubjectCount();
  updateCommitButton();
}

// Commit is available once something is staged (a new, changed or deleted file) and no conflict is left.
// Amending works without staged files, since it may only change the message of the last commit.
function updateCommitButton() {
  const btn = $('#do-commit');
  if (!btn) return;
  const amend = $('#amend') && $('#amend').checked;
  const conflicts = state.status.some((f) => f.conflict);
  const staged = state.status.some((f) => f.staged);
  const why = conflicts ? 'Resolve all conflicts before committing'
    : !staged && !amend ? 'Stage the new, changed or deleted files to commit' : '';
  btn.disabled = !!why;
  btn.title = why ? window.t(why) : '';
}

/* ---------- All Commits: Commit / Changes / File Tree ---------- */


async function commitFiles(c) {
  const args = c.parents.length
    ? ['diff', '--name-status', '-M', '-z', c.parents[0], c.hash]
    : ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', c.hash];
  const out = (await git(args)).split('\0').filter((x) => x !== '');
  const files = [];
  for (let i = 0; i < out.length;) {
    const st = out[i++];
    if (st[0] === 'R' || st[0] === 'C') i++;
    files.push({ code: st[0], path: out[i++] });
  }
  return files;
}

async function renderCommitDetail() {
  const hash = state.sel.hash;
  const c = state.commits.find((x) => x.hash === hash);
  const left = $('#detail-left');
  if (!c) { left.innerHTML = '<div class="empty">Commit not found</div>'; return; }
  if (state.dtab === 'tree') return renderTreeTab(c);
  const [full, files] = await Promise.all([
    git(['show', '-s', '--format=%an%n%ae%n%cn <%ce>%n%aI%n%B', hash]),
    commitFiles(c).catch(() => []),
  ]);
  if (state.sel.type !== 'commit' || state.sel.hash !== hash) return;
  const [author, email, committer, date, ...bodyLines] = full.split('\n');
  const body = bodyLines.join('\n').trim().split('\n').slice(1).join('\n').trim();

  if (state.dtab === 'commit') {
    left.innerHTML = `<div class="ci-wrap"><div class="ci-author">${avatarHtml(author, email, 40, true)}
        <div><div class="ci-name"><b>${esc(author)}</b> <span class="dim">${esc(email)}</span></div><div class="dim">${new Date(date).toLocaleString(kgLocale())}</div>
        ${committer.split(' <')[0] !== author ? `<div class="dim">Committed by ${esc(committer)}</div>` : ''}</div></div>
      <div class="ci-grid"><span class="dim">REFS</span><span>${badges(c) || '<span class="dim">—</span>'}</span>
        <span class="dim">SHA</span><span class="ci-sha">${c.hash}</span>
        <span class="dim">PARENTS</span><span>${c.parents.map((p) => `<a href="#" data-goto="${p}" style="color:var(--accent)">${p.slice(0, 7)}</a>`).join(', ') || '<span class="dim">none</span>'}</span></div>
      <div class="ci-subject">${esc(c.subject)}</div>${body ? `<div class="cbody">${esc(body)}</div>` : ''}
      <div class="fhead"><span>Changed files (${files.length})</span><span class="fh-act">${viewToggle('commit', files)}</span></div>
      <div class="ci-files">${renderFileList(files, 'commit', true, (f, d) => fileRow(f.path, f.code, { area: 'commit', depth: d }))}</div></div>`;
    return;
  }

  // Changes tab
  if (!state.file && files.length) state.file = { path: files[0].path, area: 'commit' };
  left.innerHTML = `<div class="fhead"><span>Changed files (${files.length})</span><span class="fh-act">${viewToggle('commit', files)}</span></div>` +
    renderFileList(files, 'commit', true, (f, d) => fileRow(f.path, f.code, { area: 'commit', depth: d }));
  if (state.file && files.some((f) => f.path === state.file.path)) showFileDiff();
  else { state.file = null; $('#detail-right').innerHTML = '<div class="empty">Select a file to see its changes</div>'; }
}

let treeCache = { key: '', paths: [] };

async function renderTreeTab(c) {
  const key = state.repo + '@' + c.hash;
  if (treeCache.key !== key) {
    const r = await window.api.git(state.repo, ['ls-tree', '-r', '--name-only', '-z', c.hash]);
    treeCache = { key, paths: r.stdout.split('\0').filter(Boolean) };
  }
  if (state.sel.type !== 'commit' || state.sel.hash !== c.hash || state.dtab !== 'tree') return;
  const files = treeCache.paths.map((path) => ({ path }));
  $('#detail-left').innerHTML = `<div class="fhead"><span>Files (${files.length})</span></div>` +
    renderTree(files, 'tree', false, (f, d) => fileRow(f.path, '', { area: 'tree', depth: d }));
  if (state.file && state.file.area === 'tree') showTreeFile(state.file.path);
  else $('#detail-right').innerHTML = '<div class="empty">Select a file to view it at this commit</div>';
}

async function showTreeFile(path) {
  const hash = state.sel.hash;
  const r = await window.api.git(state.repo, ['show', `${hash}:${path}`]);
  if (!state.file || state.file.path !== path || state.file.area !== 'tree') return;
  const title = `<div class="diff-title"><span>${esc(path)} <small class="dim">@ ${hash.slice(0, 7)}</small></span><span class="seg"><button data-hist="${esc(path)}">History</button><button data-blame-file="${esc(path)}">Blame</button></span></div>`;
  if (r.code !== 0 || r.stdout.includes('\u0000')) {
    $('#detail-right').innerHTML = title + '<div class="empty">This file cannot be shown as text.</div>';
    return;
  }
  const lines = r.stdout.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const cut = lines.length > 5000;
  const shown = cut ? lines.slice(0, 5000) : lines;
  const code = highlightLines(shown, langFor(path));
  $('#detail-right').innerHTML = title + `<table class="codeview">${code.map((h, i) => `<tr><td class="bn">${i + 1}</td><td class="bc">${h || ' '}</td></tr>`).join('')}</table>` + (cut ? '<div class="empty">… file truncated at 5000 lines …</div>' : '');
}

$('#detail-right').addEventListener('click', (e) => {
  const h = e.target.closest('[data-hist]');
  if (h) return showFileHistory(h.dataset.hist);
  const b = e.target.closest('[data-blame-file]');
  if (b && state.sel.type === 'commit') showBlame(b.dataset.blameFile, state.sel.hash);
});

/* ---------- commit message: subject + description ---------- */

// The draft is kept as one string: subject, a blank line, then the description.
function splitMessage(m) {
  const t = (m || '').replace(/\r\n/g, '\n');
  const i = t.indexOf('\n');
  return i < 0 ? { subject: t, desc: '' } : { subject: t.slice(0, i), desc: t.slice(i + 1).replace(/^\n+/, '') };
}

function readDraft() {
  const s = $('#msg'), d = $('#desc');
  return s && d ? s.value + (d.value ? '\n\n' + d.value : '') : state.draft;
}

function updateSubjectCount() {
  const s = $('#msg'), c = $('#msg-count');
  if (!s || !c) return;
  const n = s.value.length;
  c.textContent = n ? String(n) : '';
  c.classList.toggle('over', n > 72);
}

function fillMessage(m) {
  const p = splitMessage(m);
  $('#msg').value = p.subject;
  $('#desc').value = p.desc;
  updateSubjectCount();
}

let amendFilled = null;

$('#wc-commit').addEventListener('input', (e) => { if (e.target.id === 'msg') updateSubjectCount(); });
$('#wc-commit').addEventListener('click', (e) => { if (e.target.closest('#do-commit')) doCommit(); });

// Enter in the subject moves to the description; Backspace at the very start of the description (nothing
// selected) goes back to the end of the subject — the reverse of that Enter, so nothing is deleted.
$('#wc-commit').addEventListener('keydown', (e) => {
  if (e.target.id === 'msg' && e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); $('#desc').focus(); }
  if (e.target.id === 'desc' && e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey &&
      e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
    e.preventDefault();
    const s = $('#msg');
    s.focus();
    s.setSelectionRange(s.value.length, s.value.length);
  }
});

// Ticking "Amend" on an empty message loads the last commit's message; unticking removes it again if untouched.
$('#wc-commit').addEventListener('change', async (e) => {
  if (e.target.id !== 'amend') return;
  updateCommitButton();
  if (e.target.checked) {
    if ($('#msg').value || $('#desc').value) return;
    const r = await window.api.git(state.repo, ['log', '-1', '--format=%B']);
    if (r.code !== 0 || !$('#amend').checked) return;
    amendFilled = r.stdout.trim();
    fillMessage(amendFilled);
  } else if (amendFilled !== null && readDraft().trim() === amendFilled) {
    fillMessage('');
    amendFilled = null;
  }
});
