'use strict';
// Reflog panel: browse where HEAD (or a branch) has been, and recover commits that are no longer on any branch.

const REFLOG_LIMIT = 500;

async function loadReflog(ref) {
  const r = await window.api.git(state.repo, ['reflog', 'show', `-n${REFLOG_LIMIT}`, '--format=%H%x1f%gd%x1f%gs%x1f%at%x1f%s%x1e', ref]);
  if (r.code !== 0) throw new Error((r.stderr || 'git reflog failed').trim());
  return r.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [hash, selector, action, at, subject] = rec.split('\x1f');
    return { hash, selector, action, time: +at * 1000, subject };
  });
}

async function showReflog() {
  const ov = $('#overlay');
  let ref = 'HEAD';
  let entries = [];
  let sel = 0;
  let token = 0;
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; ov.onclick = null; ov.onchange = null; };

  const load = async () => {
    try { entries = await loadReflog(ref); } catch (e) { entries = []; setStatus(e.message.split('\n')[0], true); }
    sel = 0;
    draw();
  };

  const draw = () => {
    const refs = ['HEAD', ...state.branches.map((b) => b.name)];
    ov.innerHTML = `<div class="modal fh">
      <div class="fh-head"><h3>Reflog <small>${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</small></h3>
        <span class="fh-btns"><select id="rl-ref">${refs.map((r) => `<option ${r === ref ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select><button id="fh-close">Close</button></span></div>
      <div class="fh-body"><div class="fh-list">${entries.map((c, i) => `<div class="fh-row ${i === sel ? 'sel' : ''}" data-i="${i}"><div class="fh-sub">${esc(c.action)}</div>
        <div class="fh-meta">${esc(c.selector)} · ${c.hash.slice(0, 7)} · ${esc(c.subject)} · ${new Date(c.time).toLocaleString()}</div></div>`).join('') || '<div class="empty">Empty reflog</div>'}</div>
        <div class="fh-diff" id="rl-detail"></div></div></div>`;
    ov.classList.remove('hidden');
    $('#fh-close').focus();
    if (entries.length) drawDetail();
  };

  const drawDetail = async () => {
    const my = ++token;
    ov.querySelectorAll('.fh-row').forEach((r) => r.classList.toggle('sel', +r.dataset.i === sel));
    const c = entries[sel];
    const r = await window.api.git(state.repo, ['show', '--stat', '--format=commit %H%nAuthor: %an <%ae>%nDate:   %aD%n%n%B', c.hash]);
    if (my !== token || !$('#rl-detail')) return;
    const inLog = state.commits.some((x) => x.hash === c.hash);
    const reachable = (await window.api.git(state.repo, ['merge-base', '--is-ancestor', c.hash, 'HEAD'])).code === 0;
    if (my !== token || !$('#rl-detail')) return;
    const b = (act, label, cls = '') => `<button data-rl="${act}" class="${cls}">${label}</button>`;
    $('#rl-detail').innerHTML = `<div class="diff-title"><span>${esc(c.selector)} <small>${c.hash.slice(0, 7)}${reachable ? '' : ' · not reachable from HEAD'}</small></span></div>
      <div class="rl-actions">${b('checkout', 'Checkout')}${b('branch', 'New branch here…')}${b('cherry', 'Cherry-pick')}
        ${state.head ? b('soft', `Reset ${esc(state.head)} (soft)`) + b('mixed', 'mixed') + b('hard', 'hard', 'danger') : ''}
        ${inLog ? b('log', 'Show in log') : ''}</div>
      <pre class="rl-show">${esc(r.stdout)}</pre>`;
  };

  const act = async (kind) => {
    const c = entries[sel];
    const short = c.hash.slice(0, 7);
    if (kind === 'hard' && !(await confirmOver(`Hard reset ${state.head} to ${short}? Uncommitted changes will be lost.`))) return;
    close();
    if (kind === 'checkout') return checkout(c.hash);
    if (kind === 'branch') return newBranch(c.hash);
    if (kind === 'cherry') return run('Cherry-pick', () => gitAllowConflict(['cherry-pick', c.hash]));
    if (kind === 'log') return selectCommit(c.hash, true);
    return run('Reset', () => git(['reset', '--' + kind, c.hash]));
  };

  // The reflog panel uses the shared overlay, so confirmation is asked in place and then the panel is restored.
  const confirmOver = async (msg) => {
    const keep = ov.innerHTML;
    const ok = await confirm2('Hard reset', msg, true);
    if (!ok) { ov.innerHTML = keep; ov.classList.remove('hidden'); drawDetail(); }
    return ok;
  };

  ov.onclick = (e) => {
    if (e.target.closest('#fh-close') || e.target === ov) return close();
    const a = e.target.closest('[data-rl]');
    if (a) return act(a.dataset.rl);
    const row = e.target.closest('.fh-row');
    if (row) { sel = +row.dataset.i; drawDetail(); }
  };
  ov.onchange = (e) => { if (e.target.id === 'rl-ref') { ref = e.target.value; load(); } };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') return close();
    if (e.target.tagName === 'SELECT') return;
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (d && entries[sel + d]) { sel += d; drawDetail(); ov.querySelector('.fh-row.sel')?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
  };
  load();
}
