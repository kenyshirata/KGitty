'use strict';
// Repository manager tab (the "+" in the tab bar): recent and saved repositories on the left, grouped as in the
// repository manager dialog, and a summary of the selected one on the right — counts, remotes, the latest
// branches, tags and commits, a statistics view and its README. Opening a repository replaces this tab.

let mgrSel = null;
let mgrQuery = '';
let mgrView = 'summary';
let mgrToken = 0;

const mgrOpen = () => !$('#mgr').classList.contains('hidden');

function openMgrTab() {
  let i = tabs.findIndex((t) => t.mgr);
  if (i < 0) { tabs.push({ mgr: true, repo: null, snap: null }); i = tabs.length - 1; }
  activate(i);
}

function showMgr() {
  $('#mgr').classList.remove('hidden');
  mgrDrawList();
  const first = $('#mgr .mgr-row');
  if (!mgrSel && first) mgrSel = first.dataset.path;
  mgrDrawDetail();
}

function hideMgr() { $('#mgr').classList.add('hidden'); }

// Redraws the selected repository, e.g. after the Gravatar setting changed.
function mgrRefreshDetail() { if (mgrOpen()) mgrDrawDetail(); }

// Called when the repository manager dialog closes, so groups and repositories added there show up here.
function mgrRefresh() { if (mgrOpen()) mgrDrawList(); }

const REPO_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.5 1.75h9v10.5h-9a1.25 1.25 0 0 0-1.25 1.25V3c0-.69.56-1.25 1.25-1.25z"/><path d="M2.25 13.5c0 .69.56 1.25 1.25 1.25h9v-2.5"/><path d="M5.5 4.5h4M5.5 7h4"/></svg>';

function mgrDrawList() {
  const data = rmLoad();
  const matches = (name, path) => !mgrQuery || (name + ' ' + path).toLowerCase().includes(mgrQuery);
  const row = (path, name) => `<div class="mgr-row${rmNorm(path) === rmNorm(mgrSel || '') ? ' sel' : ''}" data-path="${esc(path)}" title="${esc(path)}"><span class="mgr-ico">${REPO_SVG}</span><span class="mgr-name" data-no-i18n>${esc(name)}</span></div>`;
  const section = (key, title, rows, groupName) => {
    if (!rows.length && mgrQuery) return '';
    const closed = !mgrQuery && data.collapsed[key];
    return `<div class="mgr-ghead" data-gkey="${esc(key)}"><span class="sb-chev${closed ? '' : ' open'}">${CHEVRON_SVG}</span><span ${groupName != null ? 'data-no-i18n' : ''}>${esc(title)}</span></div>${closed ? '' : rows.join('')}`;
  };
  const rec = recents().filter((p) => matches(rmBase(p), p)).map((p) => row(p, rmBase(p)));
  const byGroup = (g) => data.repos.filter((r) => (r.group && data.groups.includes(r.group) ? r.group : '') === g && matches(r.name, r.path))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map((r) => row(r.path, r.name));
  const parts = [section('@recent', 'Recent', rec)];
  for (const g of data.groups) parts.push(section('g:' + g, g, byGroup(g), g));
  const loose = byGroup('');
  if (loose.length || !data.groups.length) parts.push(section('@none', data.groups.length ? 'Ungrouped' : 'Repositories', loose));
  const list = parts.join('') || `<div class="empty">${mgrQuery ? 'No repository matches' : 'No repositories yet — add one, scan a folder or clone a repository.'}</div>`;
  const left = $('#mgr-left');
  if (!left.querySelector('#mgr-q')) {
    left.innerHTML = `<h2 class="mgr-title">Repository Manager</h2>
      <div class="mgr-tools"><input type="search" id="mgr-q" placeholder="Search repositories…"></div>
      <div class="mgr-btns"><button data-mgr="open">Open…</button><button data-mgr="clone">Clone…</button><button data-mgr="manage" title="Add, scan a folder and organise groups">Manage…</button></div>
      <div class="mgr-list" id="mgr-list"></div>`;
  }
  $('#mgr-list').innerHTML = list;
}

/* ---------- details of the selected repository ---------- */

function mgrRel(ms) {
  const fmt = new Intl.RelativeTimeFormat(kgLocale(), { numeric: 'auto' });
  const s = Math.round((ms - Date.now()) / 1000);
  for (const [unit, secs] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= secs) return fmt.format(Math.round(s / secs), unit);
  }
  return fmt.format(0, 'second');
}

// A browsable https address for a remote URL (https, scp-style ssh or ssh://), or null.
function mgrWebUrl(u) {
  let m;
  if ((m = /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com(?::v3|\/v3)\/([^/]+)\/([^/]+)\/(.+?)$/.exec(u))) return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  if ((m = /^[\w.-]+@([^:/]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(u))) return `https://${m[1]}/${m[2]}`;
  if ((m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(u))) return `https://${m[1]}/${m[2]}`;
  if (/^https?:\/\//.test(u)) return u.replace(/\/\/[^@/]+@/, '//').replace(/\.git\/?$/, '');
  return null;
}

function mgrRemoteLinks(url) {
  const web = mgrWebUrl(url);
  if (!web) return '';
  const host = new URL(web).hostname;
  const links = [[web, host.replace(/^www\./, '')]];
  if (/github\.com$/.test(host)) links.push([web + '/issues', 'Issues'], [web + '/pulls', 'Pull requests']);
  else if (/gitlab\./.test(host)) links.push([web + '/-/issues', 'Issues'], [web + '/-/merge_requests', 'Merge requests']);
  else if (/dev\.azure\.com$|visualstudio\.com$/.test(host) && web.includes('/_git/')) links.push([web + '/pullrequests', 'Pull requests']);
  return links.map(([href, label], i) => `<a href="${esc(href)}" target="_blank" ${i === 0 ? 'data-no-i18n' : ''}>${esc(label)}</a>`).join('');
}

async function mgrLoad(path) {
  const g = (args) => window.api.git(path, args).then((r) => (r.code === 0 ? r.stdout : ''));
  const top = await window.api.git(path, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { missing: true };
  const [st, count, roots, last, remotes, branches, tags, log, tree] = await Promise.all([
    g(['status', '--porcelain']),
    g(['rev-list', '--count', 'HEAD']),
    g(['log', '--max-parents=0', '--format=%ct', 'HEAD']),
    g(['log', '-1', '--format=%ct']),
    g(['remote', '-v']),
    g(['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(refname:short)%09%(contents:subject)%09%(authorname)%09%(authoremail)%09%(committerdate:unix)%09%(symref)', 'refs/heads', 'refs/remotes']),
    g(['for-each-ref', '--sort=-creatordate', '--count=5', '--format=%(refname:short)%09%(contents:subject)%09%(creatordate:unix)', 'refs/tags']),
    g(['log', '-5', '--format=%s%x09%an%x09%ae%x09%ct']),
    g(['ls-tree', '--name-only', 'HEAD']),
  ]);
  const lines = (s) => s.split('\n').filter(Boolean);
  const rootTimes = lines(roots).map(Number);
  const rem = new Map();
  lines(remotes).forEach((l) => { const [name, rest] = l.split('\t'); if (!rem.has(name)) rem.set(name, rest.replace(/\s+\((fetch|push)\)$/, '')); });
  const readmeName = lines(tree).find((n) => /^readme(\.(md|markdown|txt|rst|adoc))?$/i.test(n));
  let readme = readmeName ? await g(['show', 'HEAD:' + readmeName]) : '';
  if (readme.length > 200000) readme = readme.slice(0, 200000) + '\n…';
  return {
    path: top.stdout.trim(),
    changes: lines(st).length,
    commits: +count.trim() || 0,
    first: rootTimes.length ? Math.min(...rootTimes) * 1000 : null,
    last: +last.trim() ? +last.trim() * 1000 : null,
    remotes: [...rem].map(([name, url]) => ({ name, url })),
    branches: lines(branches).map((l) => l.split('\t')).filter((p) => !p[5]).slice(0, 5)
      .map(([name, subject, author, email, time]) => ({ name, subject, author, email: email.replace(/^<|>$/g, ''), time: +time * 1000 })),
    tags: lines(tags).map((l) => { const [name, subject, time] = l.split('\t'); return { name, subject, time: +time * 1000 }; }),
    log: lines(log).map((l) => { const [subject, author, email, time] = l.split('\t'); return { subject, author, email, time: +time * 1000 }; }),
    readmeName,
    readme,
  };
}

async function mgrStats(path) {
  const g = (args) => window.api.git(path, args).then((r) => (r.code === 0 ? r.stdout : ''));
  const [authors, times] = await Promise.all([g(['shortlog', '-sne', '--no-merges', 'HEAD']), g(['log', '--since=12.months', '--format=%ct', 'HEAD'])]);
  const top = authors.split('\n').filter(Boolean).map((l) => { const m = /^\s*(\d+)\t(.*?)(?:\s+<([^>]*)>)?$/.exec(l); return m && { n: +m[1], name: m[2], email: m[3] || '' }; }).filter(Boolean).slice(0, 10);
  const months = [];
  const now = new Date();
  for (let k = 11; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: d.getFullYear() * 12 + d.getMonth(), label: d.toLocaleDateString(kgLocale(), { month: 'short' }), n: 0 }); }
  times.split('\n').filter(Boolean).forEach((t) => { const d = new Date(+t * 1000); const m = months.find((x) => x.key === d.getFullYear() * 12 + d.getMonth()); if (m) m.n++; });
  return { top, months };
}

function mgrRows(items, fn) { return items.length ? items.map(fn).join('') : '<div class="mgr-none">None</div>'; }

function mgrSummaryHtml(d) {
  const when = (ms) => `<span class="mgr-when" title="${esc(new Date(ms).toLocaleString(kgLocale()))}">${mgrRel(ms)}</span>`;
  const who = (name, email) => `<span class="mgr-who" data-no-i18n>${avatarHtml(name, email, 16, true)}<span>${esc(name)}</span></span>`;
  return `<div class="mgr-card"><h3>Branches</h3>${mgrRows(d.branches, (b) => `<div class="mgr-item"><span class="mgr-ref" data-no-i18n>${icon(BRANCH_SVG)}${esc(b.name)}</span><span class="mgr-subj" data-no-i18n>${esc(b.subject)}</span>${who(b.author, b.email)}${when(b.time)}</div>`)}</div>
    <div class="mgr-card"><h3>Tags</h3>${mgrRows(d.tags, (t) => `<div class="mgr-item"><span class="mgr-ref" data-no-i18n>${icon(TAG_SVG)}${esc(t.name)}</span><span class="mgr-subj" data-no-i18n>${esc(t.subject)}</span><span></span>${when(t.time)}</div>`)}</div>
    <div class="mgr-card"><h3>Commits</h3>${mgrRows(d.log, (c) => `<div class="mgr-item mgr-commit"><span class="mgr-subj" data-no-i18n><span class="mgr-dot"></span>${esc(c.subject)}</span>${who(c.author, c.email)}${when(c.time)}</div>`)}</div>
    ${d.readmeName ? `<div class="mgr-card"><h3 data-no-i18n>${esc(d.readmeName.toUpperCase())}</h3><pre class="mgr-readme">${esc(d.readme)}</pre></div>` : ''}`;
}

function mgrStatsHtml(s) {
  const maxA = Math.max(1, ...s.top.map((a) => a.n));
  const maxM = Math.max(1, ...s.months.map((m) => m.n));
  return `<div class="mgr-card"><h3>Top authors</h3>${mgrRows(s.top, (a) => `<div class="mgr-bar-row"><span class="mgr-who" data-no-i18n>${avatarHtml(a.name, a.email, 16, true)}<span>${esc(a.name)}</span></span><span class="mgr-bar"><span style="width:${(a.n / maxA) * 100}%"></span></span><span class="mgr-num">${a.n}</span></div>`)}</div>
    <div class="mgr-card"><h3>Commits in the last 12 months</h3><div class="mgr-months">${s.months.map((m) => `<div class="mgr-month" title="${m.n}"><span class="mgr-col"><span style="height:${(m.n / maxM) * 100}%"></span></span><span class="mgr-num">${m.n}</span><span class="mgr-mlabel" data-no-i18n>${esc(m.label)}</span></div>`).join('')}</div></div>`;
}

async function mgrDrawDetail() {
  const right = $('#mgr-right');
  if (!mgrSel) { right.innerHTML = '<div class="empty">Select a repository</div>'; return; }
  const path = mgrSel;
  const token = ++mgrToken;
  const name = (rmLoad().repos.find((r) => rmNorm(r.path) === rmNorm(path)) || {}).name || rmBase(path);
  right.innerHTML = `<div class="mgr-head"><div><h2 data-no-i18n>${esc(name)}</h2><div class="mgr-path"><span data-no-i18n>${esc(path)}</span><button class="mgr-reveal" data-mgr="reveal" title="Show in file manager">↗</button></div></div><button class="primary" data-mgr="open-sel">Open</button></div><div id="mgr-body"><div class="empty">Loading…</div></div>`;
  const d = await mgrLoad(path);
  if (!d.missing) await prepareGravatars([...d.branches, ...d.log]);
  if (token !== mgrToken) return;
  if (d.missing) { $('#mgr-body').innerHTML = '<div class="empty">This folder is not a Git repository anymore.</div>'; return; }
  $('#mgr-body').innerHTML = `<div class="mgr-card mgr-info">
      <div class="mgr-kv"><span>Uncommitted files:</span><b>${d.changes}</b><span>Commits:</span><b>${d.commits}</b>
        <span>Initial commit:</span><b>${d.first ? mgrRel(d.first) : '—'}</b><span>Last commit:</span><b>${d.last ? mgrRel(d.last) : '—'}</b></div>
      <div class="mgr-remotes"><span class="mgr-lbl">Remotes:</span>${d.remotes.length ? d.remotes.map((r) => `<div class="mgr-remote" title="${esc(r.url)}">${icon(REMOTE_SVG)}<span data-no-i18n>${esc(r.name)}</span>${mgrRemoteLinks(r.url)}</div>`).join('') : '<div class="mgr-none">None</div>'}</div>
    </div>
    <div class="mgr-views"><button data-view="summary" class="${mgrView === 'summary' ? 'on' : ''}">Summary</button><button data-view="stats" class="${mgrView === 'stats' ? 'on' : ''}">Statistics</button></div>
    <div id="mgr-view"></div>`;
  mgrDrawView(d, token);
}

async function mgrDrawView(d, token) {
  const el = $('#mgr-view');
  if (mgrView === 'summary') { el.innerHTML = mgrSummaryHtml(d); return; }
  el.innerHTML = '<div class="empty">Loading…</div>';
  const s = await mgrStats(d.path);
  await prepareGravatars(s.top);
  if (token === mgrToken && mgrView === 'stats') el.innerHTML = mgrStatsHtml(s);
}

/* ---------- events ---------- */

$('#mgr').oninput = (e) => { if (e.target.id === 'mgr-q') { mgrQuery = e.target.value.trim().toLowerCase(); mgrDrawList(); } };
$('#mgr').onkeydown = (e) => {
  if (e.key === 'Enter' && e.target.id === 'mgr-q') { const r = $('#mgr .mgr-row'); if (r) openRepo(r.dataset.path); }
};
$('#mgr').onclick = (e) => {
  const b = e.target.closest('[data-mgr]');
  if (b) {
    const act = b.dataset.mgr;
    if (act === 'open') return pickAndOpen();
    if (act === 'clone') return cloneRepo();
    if (act === 'manage') return repoManager();
    if (act === 'open-sel') return openRepo(mgrSel);
    if (act === 'reveal') return window.api.reveal(mgrSel);
  }
  const v = e.target.closest('[data-view]');
  if (v && v.dataset.view !== mgrView) {
    mgrView = v.dataset.view;
    document.querySelectorAll('#mgr .mgr-views button').forEach((x) => x.classList.toggle('on', x.dataset.view === mgrView));
    const token = mgrToken;
    return mgrLoad(mgrSel).then((d) => token === mgrToken && !d.missing && mgrDrawView(d, token));
  }
  const h = e.target.closest('.mgr-ghead');
  if (h) {
    const data = rmLoad();
    data.collapsed[h.dataset.gkey] = !data.collapsed[h.dataset.gkey];
    rmSave(data);
    return mgrDrawList();
  }
  const r = e.target.closest('.mgr-row');
  if (r && r.dataset.path !== mgrSel) {
    mgrSel = r.dataset.path;
    document.querySelectorAll('#mgr .mgr-row').forEach((x) => x.classList.toggle('sel', x === r));
    mgrDrawDetail();
  }
};
$('#mgr').ondblclick = (e) => { const r = e.target.closest('.mgr-row'); if (r) openRepo(r.dataset.path); };
$('#mgr').oncontextmenu = (e) => {
  const r = e.target.closest('.mgr-row');
  if (!r) return;
  e.preventDefault();
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Open', action: () => openRepo(r.dataset.path) },
    { label: 'Show in file manager', action: () => window.api.reveal(r.dataset.path) },
    '-',
    { label: 'Manage…', action: () => repoManager() },
  ]);
};
