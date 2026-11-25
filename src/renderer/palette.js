'use strict';
// Command palette (Ctrl+P): type to find and run any command, check out a branch or tag, switch to another
// repository or jump to a commit. Matching is fuzzy — "chk dev" finds "Checkout develop".

const PALETTE_SKIP = new Set(['Command palette', 'Close dialog or menu', 'Keyboard shortcuts']);

function paletteItems(q) {
  const items = [];
  const seen = new Set();
  const add = (cat, label, run, extra = {}) => { items.push({ cat, label, run, ...extra }); };
  const hasRepo = !!state.repo;

  for (const s of SHORTCUTS) {
    if (PALETTE_SKIP.has(s.label) || seen.has(s.label) || s.notTyping || (s.repo && !hasRepo)) continue;
    if (s.hidden && !/Filter commits/.test(s.label)) continue;
    seen.add(s.label);
    add('Command', s.label, s.run, { keys: s.show || s.keys });
  }
  add('Command', 'Keyboard shortcuts', () => showShortcuts(), { keys: 'F1' });

  const extra = (label, run, cond = true) => { if (cond && !seen.has(label)) { seen.add(label); add('Command', label, run); } };
  const op = hasRepo && state.op;
  extra('Continue the operation in progress', () => opAction('continue'), op);
  extra('Skip the current commit', () => opAction('skip'), op && OPS[state.op].skip);
  extra('Abort the operation in progress', () => opAction('abort'), op);
  extra('Open conflicted files in the merge tool', () => openMergeTool(), op && state.status.some((f) => f.conflict));
  extra('Start feature…', () => flowStart('feature'), hasRepo && state.flow && state.flow.init);
  extra('Start release…', () => flowStart('release'), hasRepo && state.flow && state.flow.init);
  extra('Start hotfix…', () => flowStart('hotfix'), hasRepo && state.flow && state.flow.init);
  extra('Initialize Git Flow…', () => flowInit(), hasRepo && state.flow && !state.flow.init);
  extra('Add worktree…', () => addWorktreeDialog(), hasRepo);
  extra('Prune worktrees', () => pruneWorktrees(), hasRepo);
  extra('Add submodule…', () => addSubmodule(), hasRepo);
  extra('Update all submodules', () => updateAllSubmodules(), hasRepo && state.submodules.length);
  extra('Git LFS: track a pattern…', () => lfsTrack(), hasRepo && state.lfs.available);
  extra('Git LFS: files…', () => lfsFilesDialog(), hasRepo && state.lfs.available);
  extra('Git LFS: pull', () => lfsPull(), hasRepo && state.lfs.available);
  extra('Open repository in the file manager', () => window.api.reveal(state.repo), hasRepo);
  extra('Copy repository path', () => navigator.clipboard.writeText(state.repo), hasRepo);
  extra('Check for updates', () => checkForUpdates());
  extra('Theme: follow the system', () => setThemePref('system'));
  extra('Theme: light', () => setThemePref('light'));
  extra('Theme: dark', () => setThemePref('dark'));

  if (hasRepo) {
    for (const b of state.branches) {
      if (b.current) continue;
      add('Branch', 'Checkout ' + b.name, () => checkout(b.name));
      add('Branch', `Merge ${b.name} into ${state.head}`, () => run('Merge', () => gitAllowConflict(['merge', b.name])), { hidden: true });
    }
    for (const r of state.remotes) add('Remote', 'Checkout ' + r.name, () => checkoutRemote(r.name));
    for (const t of state.tags) add('Tag', 'Checkout ' + t.name, () => checkout(t.name));
    for (const s of state.stashes) add('Stash', s.msg, () => selectStash(s.ref), { hint: s.ref, data: true });
  }

  const open = new Set(tabs.map((t) => t.repo));
  const repos = new Map();
  for (const r of rmLoad().repos) repos.set(rmNorm(r.path), r.name);
  for (const p of recents()) if (!repos.has(rmNorm(p))) repos.set(rmNorm(p), rmBase(p));
  for (const t of tabs) if (t.repo && !repos.has(rmNorm(t.repo))) repos.set(rmNorm(t.repo), rmBase(t.repo));
  for (const [p, name] of repos) if (rmNorm(p) !== rmNorm(state.repo || '')) add('Repository', 'Open ' + name, () => openRepo(p), { hint: open.has(p) ? 'open tab' : p });

  if (hasRepo && q.length >= 2) {
    const ql = q.toLowerCase();
    let n = 0;
    for (const c of state.commits) {
      if (n >= 400) break;
      if (c.hash.startsWith(ql) || c.subject.toLowerCase().includes(ql) || c.author.toLowerCase().includes(ql)) {
        add('Commit', c.subject, () => { selectLog(); selectCommit(c.hash, true); }, { hint: c.hash.slice(0, 7) + ' · ' + c.author, direct: true, data: true });
        n++;
      }
    }
  }
  return items;
}

// Every word of the query must occur in the text, in order of letters; a plain substring match scores higher.
function paletteScore(q, text) {
  const t = text.toLowerCase();
  let score = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = t.indexOf(w);
    if (at >= 0) { score += 100 - Math.min(at, 60) + (at === 0 || t[at - 1] === ' ' ? 20 : 0); continue; }
    let pos = 0, gaps = 0;
    for (const ch of w) {
      const i = t.indexOf(ch, pos);
      if (i < 0) return -1;
      gaps += i - pos;
      pos = i + 1;
    }
    score += Math.max(1, 40 - gaps);
  }
  return score;
}

function commandPalette() {
  const ov = $('#overlay');
  let query = '';
  let sel = 0;
  let shown = [];
  const all = paletteItems('');

  const close = () => {
    ov.classList.add('hidden');
    ov.innerHTML = '';
    ov.style.alignItems = ov.style.paddingTop = '';
    ov.onclick = ov.oninput = ov.onkeydown = ov.onmousemove = null;
  };
  const choose = (i) => {
    const it = shown[i];
    if (!it) return;
    close();
    setTimeout(() => it.run(), 0);
  };
  const compute = () => {
    const items = query.length >= 2 ? [...all.filter((x) => !x.direct), ...paletteItems(query).filter((x) => x.direct)] : all.filter((x) => !x.hidden);
    if (!query) return items.slice(0, 60);
    return items.map((it) => ({ it, s: it.direct ? 50 : paletteScore(query, it.label + ' ' + it.cat) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it).slice(0, 60);
  };
  const draw = () => {
    shown = compute();
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    $('#pal-list').innerHTML = shown.map((it, i) => `<div class="pal-row ${i === sel ? 'sel' : ''}" data-i="${i}"${it.data ? ' data-no-i18n' : ''}><span class="pal-cat">${esc(it.cat)}</span><span class="pal-label">${esc(it.label)}</span>${it.keys ? `<span class="pal-keys">${it.keys.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : it.hint ? `<span class="pal-hint dim">${esc(it.hint)}</span>` : ''}</div>`).join('') || '<div class="empty">Nothing matches</div>';
    const row = $('#pal-list .pal-row.sel');
    if (row) row.scrollIntoView({ block: 'nearest' });
  };

  ov.innerHTML = '<div class="modal pal"><input type="text" id="pal-q" placeholder="Type a command, branch, repository or commit…" autocomplete="off" spellcheck="false"><div id="pal-list"></div></div>';
  ov.style.alignItems = 'flex-start';
  ov.style.paddingTop = '12vh';
  ov.classList.remove('hidden');
  const input = $('#pal-q');
  input.focus();
  draw();

  ov.oninput = (e) => { if (e.target.id === 'pal-q') { query = e.target.value.trim(); sel = 0; draw(); } };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      draw();
    } else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  };
  ov.onmousemove = (e) => {
    const r = e.target.closest('.pal-row');
    if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; document.querySelectorAll('#pal-list .pal-row').forEach((x) => x.classList.toggle('sel', x === r)); }
  };
  ov.onclick = (e) => {
    const r = e.target.closest('.pal-row');
    if (r) return choose(+r.dataset.i);
    if (e.target === ov) close();
  };
}

$('#repo-title').onclick = () => commandPalette();
