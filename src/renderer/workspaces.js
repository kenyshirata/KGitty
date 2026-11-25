'use strict';
// Workspaces: named sets of open tabs ("Home", "Work", …). Switching workspace saves the open tabs into the current
// one and opens the tabs of the other. A "/" in a name puts the workspace in a folder of the menu.
// Also the "Open in" and "Console" toolbar buttons, which open the repository in other programs.

const WS_KEY = 'workspaces';

function wsLoad() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(WS_KEY)); } catch { /* ignore */ }
  if (!d || !Array.isArray(d.names) || !d.names.length) d = { names: ['Default'], current: 'Default', tabs: {}, showInTitle: false };
  if (!d.names.includes(d.current)) d.current = d.names[0];
  d.tabs = d.tabs || {};
  return d;
}
const wsSave = (d) => { try { localStorage.setItem(WS_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const wsTabsNow = () => { try { return JSON.parse(localStorage.getItem('tabs')) || { repos: [], active: -1 }; } catch { return { repos: [], active: -1 }; } };

function wsApplyTitle() {
  const d = wsLoad();
  document.title = d.showInTitle ? `KGitty — ${d.current}` : 'KGitty';
  const b = $('#tb-ws');
  if (b) b.querySelector('.tb-ws-name').textContent = d.current.split('/').pop();
  if (typeof renderTabList === 'function') renderTabList();
}

async function switchWorkspace(name) {
  const d = wsLoad();
  if (name === d.current || !d.names.includes(name)) return;
  if (state.busy) return setStatus('Wait for the running operation to finish', true);
  snapshot();
  d.tabs[d.current] = wsTabsNow();
  d.current = name;
  wsSave(d);
  const next = d.tabs[name] || { repos: [], active: -1 };
  tabs.length = 0;
  active = -1;
  Object.assign(state, freshRepoState());
  next.repos.forEach((repo) => tabs.push(repo === '@mgr' ? { mgr: true, repo: null, snap: null } : { repo, snap: null }));
  wsApplyTitle();
  if (tabs.length) await activate(Math.min(Math.max(next.active, 0), tabs.length - 1));
  else openMgrTab();
}

/* ---------- dropdown menus for toolbar buttons ---------- */

// Shows a dropdown under `anchor`. Items: { label, keys?, run?, check?, header?, off?, indent? } or '-'.
function toolbarMenu(anchor, items) {
  closeMenu();
  const d = document.createElement('div');
  d.className = 'mb-drop main tb-drop';
  d.innerHTML = items.map((it, i) => {
    if (it === '-') return '<hr>';
    if (it.header) return `<div class="mb-head">${esc(it.label)}</div>`;
    return `<div class="mb-item${it.off ? ' off' : ''}" data-tb="${i}" style="${it.indent ? `padding-left:${16 + it.indent * 14}px` : ''}"><span class="mb-label">${it.check ? '<span class="mb-check">✓</span>' : '<span class="mb-check"></span>'}${it.icon || ''}<span ${it.raw ? 'data-no-i18n' : ''}>${esc(it.label)}</span></span><span class="mb-keys" data-no-i18n>${esc(it.keys || '')}</span></div>`;
  }).join('');
  document.body.appendChild(d);
  const r = anchor.getBoundingClientRect();
  d.style.left = Math.max(4, Math.min(r.left, innerWidth - d.offsetWidth - 4)) + 'px';
  d.style.top = r.bottom + 2 + 'px';
  d.onclick = (e) => {
    const row = e.target.closest('[data-tb]');
    if (!row || row.classList.contains('off')) return;
    e.stopPropagation();
    d.remove();
    items[+row.dataset.tb].run();
  };
  setTimeout(() => {
    const away = (e) => { if (!d.contains(e.target)) { d.remove(); document.removeEventListener('mousedown', away, true); } };
    document.addEventListener('mousedown', away, true);
  });
}

function workspaceMenu() {
  const d = wsLoad();
  const items = [{ header: true, label: 'Workspaces' }];
  const shown = new Set();
  for (const n of [...d.names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const parts = n.split('/');
    for (let k = 1; k < parts.length; k++) {
      const folder = parts.slice(0, k).join('/');
      if (!shown.has(folder)) { shown.add(folder); items.push({ label: parts[k - 1], raw: true, off: true, indent: k - 1, icon: icon(FOLDER_OPEN_SVG) }); }
    }
    items.push({ label: parts[parts.length - 1], raw: true, check: n === d.current, indent: parts.length - 1, run: () => switchWorkspace(n) });
  }
  items.push('-', { label: 'Configure…', run: () => workspacesDialog() });
  toolbarMenu($('#tb-ws'), items);
}

function workspacesDialog() {
  const ov = $('#overlay');
  let d = wsLoad();
  let sel = d.current;
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onchange = ov.onkeydown = ov.ondblclick = null; wsApplyTitle(); };
  const draw = () => {
    ov.innerHTML = `<div class="modal ws-modal"><h3>Workspaces</h3><p class="hint">Use '/' as path separator to create folders</p>
      <div class="ws-list">${d.names.map((n) => `<div class="ws-row${n === sel ? ' sel' : ''}" data-n="${esc(n)}"><span data-no-i18n>${esc(n)}</span>${n === d.current ? '<span class="ws-cur">current</span>' : ''}</div>`).join('')}</div>
      <div class="ws-tools"><button data-ws="add" title="Add workspace">+</button><button data-ws="del" title="Remove workspace" ${d.names.length < 2 ? 'disabled' : ''}>−</button><button data-ws="ren" title="Rename workspace">Rename…</button></div>
      <label class="cl-opt"><input type="checkbox" id="ws-title" ${d.showInTitle ? 'checked' : ''}> Show workspace name in title bar</label>
      <div class="btns"><button class="primary" data-ws="close">Close</button></div></div>`;
    // prompt2 / confirm2 reuse the overlay and replace its key handler.
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  };
  const rename = async () => {
    const n = await prompt2('Rename workspace', 'Name', sel);
    d = wsLoad();
    if (n && n !== sel && !d.names.includes(n)) {
      d.names[d.names.indexOf(sel)] = n;
      if (d.tabs[sel]) { d.tabs[n] = d.tabs[sel]; delete d.tabs[sel]; }
      if (d.current === sel) d.current = n;
      sel = n;
      wsSave(d);
    }
    ov.classList.remove('hidden');
    draw();
  };
  ov.classList.remove('hidden');
  draw();
  ov.onchange = (e) => { if (e.target.id === 'ws-title') { d.showInTitle = e.target.checked; wsSave(d); wsApplyTitle(); } };
  ov.ondblclick = (e) => { if (e.target.closest('.ws-row')) rename(); };
  ov.onclick = async (e) => {
    const row = e.target.closest('.ws-row');
    if (row) { sel = row.dataset.n; return draw(); }
    const b = e.target.closest('[data-ws]');
    if (!b) return;
    const act = b.dataset.ws;
    if (act === 'close') return close();
    if (act === 'ren') return rename();
    if (act === 'add') {
      const n = await prompt2('New workspace', 'Name');
      d = wsLoad();
      if (n && !d.names.includes(n)) { d.names.push(n); sel = n; wsSave(d); }
      ov.classList.remove('hidden');
      return draw();
    }
    if (act === 'del' && d.names.length > 1) {
      if (!(await confirm2('Remove workspace', `Remove workspace ${sel}? Its tabs are forgotten; the repositories stay on disk.`, true))) { ov.classList.remove('hidden'); return draw(); }
      d = wsLoad();
      const wasCurrent = sel === d.current;
      d.names = d.names.filter((x) => x !== sel);
      delete d.tabs[sel];
      if (wasCurrent) d.current = d.names[0];
      wsSave(d);
      if (wasCurrent) {
        // Load the tabs of the workspace that becomes current, without saving the removed one.
        const next = d.tabs[d.current] || { repos: [], active: -1 };
        try { localStorage.setItem('tabs', JSON.stringify(next)); } catch { /* ignore */ }
        tabs.length = 0; active = -1; Object.assign(state, freshRepoState());
        next.repos.forEach((repo) => tabs.push(repo === '@mgr' ? { mgr: true, repo: null, snap: null } : { repo, snap: null }));
        if (tabs.length) activate(Math.min(Math.max(next.active, 0), tabs.length - 1)); else openMgrTab();
      }
      sel = d.current;
      ov.classList.remove('hidden');
      draw();
    }
  };
}

/* ---------- Open in / Console ---------- */

const CONSOLE_SVG = SVG('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.25"/><path d="M4.5 6.25 6.75 8 4.5 9.75M8.5 10h3"/>');
const EXPLORER_SVG = SVG('<path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.75h5.5c.69 0 1.25.56 1.25 1.25v6.25c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"/>');
const VS_SVG = SVG('<path d="M11.5 1.75 14.25 3v10l-2.75 1.25L5 8.5zM11.5 1.75 5 7.5 2.5 5.5 1.75 6v4l.75.5L5 8.5M11.5 14.25V1.75"/>');
const CODE_SVG = SVG('<path d="M11 1.75 14.25 3.25v9.5L11 14.25 3.5 7.75 1.75 9.25V6.75L3.5 8.25 11 1.75zM11 1.75v12.5M3.5 8.25 1.75 6.75"/>');
const WEB_SVG = SVG('<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c1.75 1.75 2.5 4 2.5 6.25S9.75 12.5 8 14.25C6.25 12.5 5.5 10.25 5.5 8S6.25 3.5 8 1.75z"/>');

async function openConsole() {
  if (!state.repo) return;
  const err = await window.api.openConsole(state.repo);
  if (err) notice('Open in Console', err);
}

async function openInMenu() {
  if (!state.repo) return;
  const repo = state.repo;
  const anchor = $('#tb-openin');
  const [opts, remotes] = await Promise.all([window.api.openWithOptions(repo), window.api.git(repo, ['remote', '-v'])]);
  if (state.repo !== repo) return;
  const report = (label) => (err) => { if (err) notice(label, err); };
  const items = [
    { label: 'Open in Console', icon: icon(CONSOLE_SVG), off: !opts.console, run: () => openConsole() },
    { label: 'Open in File Explorer', icon: icon(EXPLORER_SVG), run: () => window.api.reveal(repo) },
  ];
  if (opts.solutions.length || opts.vscode) items.push('-');
  for (const sln of opts.solutions) {
    items.push({ label: window.t('Open {0} in Visual Studio').replace('{0}', `'${sln.split('/').pop()}'`), raw: true, icon: icon(VS_SVG), run: () => window.api.openSolution(repo, sln).then(report('Open in Visual Studio')) });
  }
  if (opts.vscode) items.push({ label: 'Open in Visual Studio Code', icon: icon(CODE_SVG), run: () => window.api.openVsCode(repo).then(report('Open in Visual Studio Code')) });
  const webs = new Map();
  remotes.stdout.split('\n').filter(Boolean).forEach((l) => {
    const [name, rest] = l.split('\t');
    const web = mgrWebUrl(rest.replace(/\s+\((fetch|push)\)$/, ''));
    if (web && /^https:\/\//.test(web) && !webs.has(web)) webs.set(web, name);
  });
  if (webs.size) items.push('-');
  for (const [web, name] of webs) {
    const host = new URL(web).hostname.replace(/^www\./, '');
    items.push({ label: window.t('View on {0}').replace('{0}', webs.size > 1 ? `${host} (${name})` : host), raw: true, icon: icon(WEB_SVG), run: () => window.open(web, '_blank') });
  }
  toolbarMenu(anchor, items);
}

$('#tb-openin').onclick = () => openInMenu();
$('#tb-console').onclick = () => openConsole();
$('#tb-ws').onclick = () => workspaceMenu();
wsApplyTitle();
