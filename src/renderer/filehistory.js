'use strict';
// Per-file history: commits that touched a file (following renames) with the file's diff for each.

const HISTORY_LIMIT = 500;

async function loadFileHistory(path) {
  const r = await window.api.git(state.repo, ['log', '--follow', '-M', `-n${HISTORY_LIMIT}`, '--name-only', '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--', path]);
  if (r.code !== 0) throw new Error((r.stderr || 'git log failed').trim());
  return r.stdout.split('\x1e').filter((s) => s.trim()).map((rec) => {
    const [head, ...files] = rec.split('\n');
    const [hash, author, at, subject] = head.split('\x1f');
    return { hash, author, time: +at * 1000, subject, path: files.map((f) => f.trim()).find(Boolean) || path };
  });
}

async function showFileHistory(path) {
  let commits;
  try {
    commits = await loadFileHistory(path);
  } catch (e) {
    return notice('File history', e.message);
  }
  if (!commits.length) return notice('File history', `No committed history for ${path}.`);
  const ov = $('#overlay');
  let sel = 0;
  let token = 0;
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; ov.onclick = null; };

  const drawShell = () => {
    ov.innerHTML = `<div class="modal fh">
      <div class="fh-head"><h3>History · ${esc(path)} <small>${commits.length}${commits.length === HISTORY_LIMIT ? '+' : ''} commit(s)</small></h3><button id="fh-close">Close</button></div>
      <div class="fh-body"><div class="fh-list">${commits.map((c, i) => `<div class="fh-row" data-i="${i}"><div class="fh-sub">${esc(c.subject)}</div><div class="fh-meta">${c.hash.slice(0, 7)} · ${esc(c.author)} · ${fmtDate(c.time)}${c.path !== path ? ` · <i>${esc(c.path)}</i>` : ''}</div></div>`).join('')}</div>
      <div class="fh-diff" id="fh-diff"></div></div></div>`;
    ov.classList.remove('hidden');
    $('#fh-close').focus();
  };

  const drawDiff = async () => {
    const my = ++token;
    ov.querySelectorAll('.fh-row').forEach((r) => r.classList.toggle('sel', +r.dataset.i === sel));
    const c = commits[sel];
    const r = await window.api.git(state.repo, ['log', '-1', '-p', '--follow', '-M', '--format=', c.hash, '--', c.path]);
    if (my !== token || !$('#fh-diff')) return;
    const seg = (v, label) => `<button data-view="${v}" class="${diffView === v ? 'primary' : ''}">${label}</button>`;
    $('#fh-diff').innerHTML = `<div class="diff-title"><span>${esc(c.subject)} <small>${c.hash.slice(0, 7)}</small></span>
      <span class="seg"><button data-goto-commit="${c.hash}">Show in log</button><button data-blame="${sel}">Blame here</button>${seg('unified', 'Unified')}${seg('split', 'Side by side')}</span></div>` + renderDiff(r.stdout, null, c.path);
  };

  drawShell();
  ov.onclick = (e) => {
    if (e.target.closest('#fh-close') || e.target === ov) return close();
    const bl = e.target.closest('[data-blame]');
    if (bl) { const c = commits[+bl.dataset.blame]; return showBlame(c.path, c.hash); }
    const go = e.target.closest('[data-goto-commit]');
    if (go) { close(); return selectCommit(go.dataset.gotoCommit, true); }
    const v = e.target.closest('[data-view]');
    if (v) {
      diffView = v.dataset.view;
      try { localStorage.setItem('diffView', diffView); } catch { /* ignore */ }
      return drawDiff();
    }
    const row = e.target.closest('.fh-row');
    if (row) { sel = +row.dataset.i; drawDiff(); }
  };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' && sel < commits.length - 1) { sel++; drawDiff(); ov.querySelector('.fh-row.sel')?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    if (e.key === 'ArrowUp' && sel > 0) { sel--; drawDiff(); ov.querySelector('.fh-row.sel')?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
  };
  drawDiff();
}

$('#detail-left').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.frow');
  if (!row) return;
  e.preventDefault();
  const path = row.dataset.path;
  ctxMenu(e.clientX, e.clientY, [
    { label: 'File history', action: () => showFileHistory(path) },
    { label: 'Blame', action: () => showBlame(path, row.dataset.area === 'commit' && state.sel.type === 'commit' ? state.sel.hash : null) },
    '-',
    { label: 'Reveal in Explorer', action: () => window.api.reveal(state.repo + '/' + path) },
    { label: 'Copy path', action: () => navigator.clipboard.writeText(path) },
  ]);
});
