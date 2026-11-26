'use strict';
// Merge-conflict resolution. Shares globals ($, esc, state, git, run, ...) with app.js.

const OPS = {
  rebase: { label: 'Rebase', cont: ['-c', 'core.editor=true', 'rebase', '--continue'], abort: ['rebase', '--abort'], skip: ['rebase', '--skip'] },
  merge: { label: 'Merge', cont: ['commit', '--no-edit'], abort: ['merge', '--abort'] },
  'cherry-pick': { label: 'Cherry-pick', cont: ['-c', 'core.editor=true', 'cherry-pick', '--continue'], abort: ['cherry-pick', '--abort'] },
  revert: { label: 'Revert', cont: ['-c', 'core.editor=true', 'revert', '--continue'], abort: ['revert', '--abort'] },
};

async function detectOperation() {
  for (const dir of ['rebase-merge', 'rebase-apply']) if (await window.api.gitPathExists(state.repo, dir)) return 'rebase';
  const heads = { merge: 'MERGE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' };
  for (const [op, ref] of Object.entries(heads)) {
    const r = await window.api.git(state.repo, ['rev-parse', '-q', '--verify', ref]);
    if (r.code === 0) return op;
  }
  return null;
}

// Runs a command that may legitimately stop on conflicts (merge, pull, cherry-pick, ...).
async function gitAllowConflict(args, input) {
  const r = await window.api.git(state.repo, args, input);
  if (r.code === 0) return r.stdout;
  const u = await window.api.git(state.repo, ['ls-files', '-u']);
  if (u.stdout.trim()) {
    state.sel = { type: 'wc' };
    state.file = null;
    return r.stdout;
  }
  throw new Error((r.stderr || r.stdout || 'git failed').trim());
}

function opBanner() {
  const conflicts = state.status.filter((f) => f.conflict).length;
  if (!state.op) return '';
  const o = OPS[state.op];
  return `<div class="banner"><div><b>${o.label} in progress</b><br><small>${conflicts ? `${conflicts} file(s) with conflicts` : 'All conflicts resolved'}</small></div>
    <div class="bbtns"><button data-act="op-continue" class="primary" ${conflicts ? 'disabled' : ''}>Continue</button>${conflicts ? '<button data-act="op-tool" title="Open the conflicted files in your external merge tool">Merge tool</button>' : ''}${o.skip ? '<button data-act="op-skip">Skip</button>' : ''}<button data-act="op-abort" class="danger">Abort</button></div></div>`;
}

async function opAction(kind) {
  const o = OPS[state.op];
  if (!o) return;
  if (kind === 'abort' && !(await confirm2('Abort ' + o.label.toLowerCase(), 'Abort and discard the changes made by this operation?', true))) return;
  if (kind === 'skip') return run('Skip commit', () => gitAllowConflict(o.skip));
  await run(kind === 'abort' ? 'Abort ' + o.label.toLowerCase() : 'Continue ' + o.label.toLowerCase(), () => gitAllowConflict(kind === 'abort' ? o.abort : o.cont));
}

/* ---------- parsing ---------- */

const stripCr = (s) => s.replace(/\r$/, '');

function parseConflicts(text) {
  const lines = text.split('\n');
  const parts = [];
  let cur = [];
  let i = 0;
  while (i < lines.length) {
    const head = stripCr(lines[i]);
    if (/^<{7}( |$)/.test(head)) {
      const ours = [], theirs = [];
      let base = null, where = 'ours', ok = false, j = i + 1, theirsLabel = '';
      for (; j < lines.length; j++) {
        const t = stripCr(lines[j]);
        if (where === 'ours' && /^\|{7}( |$)/.test(t)) { where = 'base'; base = []; continue; }
        if (where !== 'theirs' && /^={7}$/.test(t)) { where = 'theirs'; continue; }
        if (where === 'theirs' && /^>{7}( |$)/.test(t)) { ok = true; theirsLabel = t.slice(8); break; }
        (where === 'ours' ? ours : where === 'base' ? base : theirs).push(lines[j]);
      }
      if (ok) {
        parts.push({ type: 'text', lines: cur });
        parts.push({ type: 'conflict', oursLabel: head.slice(8), theirsLabel, ours, base, theirs });
        cur = [];
        i = j + 1;
        continue;
      }
    }
    cur.push(lines[i]);
    i++;
  }
  parts.push({ type: 'text', lines: cur });
  return parts;
}

/* ---------- choices ---------- */

// Every conflict keeps which lines of each side are taken (the checkboxes), in which order, and, once the
// result was typed by hand, that text. "touched" means the user (or the automatic rules) decided something.
const newChoice = (b) => ({ touched: false, auto: '', ours: b.ours.map(() => false), theirs: b.theirs.map(() => false), order: 'ot', edited: null });

// The lines a conflict turns into, as they will be written to the file (end-of-line characters included).
function blockLines(b, ch, crlf) {
  if (ch.edited !== null) return ch.edited === '' ? [] : ch.edited.split('\n').map((l) => (crlf ? l + '\r' : l));
  const o = b.ours.filter((_, k) => ch.ours[k]), t = b.theirs.filter((_, k) => ch.theirs[k]);
  return ch.order === 'to' ? [...t, ...o] : [...o, ...t];
}

function resolvedText(parts, choices, crlf) {
  const out = [];
  let ci = 0;
  for (const p of parts) {
    if (p.type === 'text') { out.push(...p.lines); continue; }
    out.push(...blockLines(p, choices[ci++], crlf));
  }
  return out.join('\n');
}

// Applies a preset to one conflict: ours, theirs, both (in either order), base, none, or back to undecided.
function applyPreset(b, ch, kind) {
  const all = (n, v) => new Array(n).fill(v);
  if (kind === 'reset') { Object.assign(ch, newChoice(b)); return; }
  ch.touched = true;
  ch.auto = '';
  ch.edited = null;
  ch.order = kind === 'both-rev' ? 'to' : 'ot';
  ch.ours = all(b.ours.length, kind === 'ours' || kind === 'both' || kind === 'both-rev');
  ch.theirs = all(b.theirs.length, kind === 'theirs' || kind === 'both' || kind === 'both-rev');
  if (kind === 'base') ch.edited = (b.base || []).map(stripCr).join('\n');
}

const sameLines = (a, b) => a.length === b.length && a.every((l, k) => stripCr(l) === stripCr(b[k]));

// Conflicts that need no decision are settled up front: both sides identical, or only one side changed from the base.
function autoResolve(b, ch) {
  if (sameLines(b.ours, b.theirs)) { applyPreset(b, ch, 'ours'); ch.auto = 'Both sides are identical'; }
  else if (b.base && sameLines(b.ours, b.base)) { applyPreset(b, ch, 'theirs'); ch.auto = 'Only theirs changed this part'; }
  else if (b.base && sameLines(b.theirs, b.base)) { applyPreset(b, ch, 'ours'); ch.auto = 'Only ours changed this part'; }
}

/* ---------- UI ---------- */

async function showConflict(path) {
  const r = await window.api.readFile(state.repo, path);
  if (!state.file || state.file.path !== path || state.file.area !== 'conflict') return;
  const text = r.ok ? r.text : '';
  const parts = r.ok && !text.includes('\u0000') ? parseConflicts(text) : [{ type: 'text', lines: [] }];
  const blocks = parts.filter((p) => p.type === 'conflict');
  const sig = JSON.stringify(blocks.map((b) => [b.ours, b.theirs]));
  const prev = state.conflict;
  const keep = prev && prev.path === path && prev.sig === sig;
  const choices = keep ? prev.choices : blocks.map((b) => { const ch = newChoice(b); autoResolve(b, ch); return ch; });
  state.conflict = { path, parts, sig, exists: r.ok, choices, crlf: text.includes('\r\n'), expanded: keep ? prev.expanded : new Set(), cur: keep ? prev.cur : 0 };
  renderConflict();
}

const codeHtml = (lines, lang) => highlightLines(lines, lang).join('\n') || ' ';

// Lines changed on both sides are paired up (in order) so the words that differ can be marked.
function conflictMarks(b) {
  const oursSet = new Set(b.ours.map(stripCr)), theirsSet = new Set(b.theirs.map(stripCr));
  const uo = [], ut = [];
  b.ours.forEach((l, k) => { if (!theirsSet.has(stripCr(l))) uo.push(k); });
  b.theirs.forEach((l, k) => { if (!oursSet.has(stripCr(l))) ut.push(k); });
  const mo = {}, mt = {};
  for (let p = 0; p < Math.min(uo.length, ut.length); p++) {
    const d = wordDiff(stripCr(b.ours[uo[p]]), stripCr(b.theirs[ut[p]]));
    if (d) { mo[uo[p]] = d.a; mt[ut[p]] = d.b; }
  }
  return { ours: mo, theirs: mt, oursSet, theirsSet };
}

function sideHtml(i, side, label, b, ch, lang, marks) {
  const lines = b[side];
  const html = highlightLines(lines.map(stripCr), lang);
  const other = side === 'ours' ? marks.theirsSet : marks.oursSet;
  const picked = ch[side];
  const n = picked.filter(Boolean).length;
  const rows = lines.map((l, k) => `<label class="cl${picked[k] ? ' on' : ''}${other.has(stripCr(l)) ? ' common' : ''}"><input type="checkbox" data-cl="${i}" data-side="${side}" data-k="${k}"${picked[k] ? ' checked' : ''}><code>${markRanges(html[k], marks[side][k]) || ' '}</code></label>`).join('');
  return `<div class="cside ${side}">
    <label class="clabel"><input type="checkbox" data-call="${i}" data-side="${side}"${lines.length && n === lines.length ? ' checked' : ''}${lines.length ? '' : ' disabled'}><span data-no-i18n>${esc(label)}</span><small>${n}/${lines.length}</small></label>
    <div class="clines">${rows || `<div class="cempty">${esc(window.t('(no lines)'))}</div>`}</div></div>`;
}

function contextHtml(raw, pi, first, last, lang, expanded) {
  const lines = highlightLines(raw.map(stripCr), lang);
  const pre = (ls) => `<pre class="ctxl">${ls.join('\n') || ' '}</pre>`;
  if (lines.length <= 8) return lines.length ? pre(lines) : '';
  if (expanded.has(pi)) return `<div class="gap" data-expand="${pi}" data-collapse="1">${esc(window.t('Hide unchanged lines'))}</div>${pre(lines)}`;
  let html = '';
  if (!first) html += pre(lines.slice(0, 3));
  html += `<div class="gap" data-expand="${pi}" title="${esc(window.t('Show the unchanged lines'))}">… ${lines.length - (first ? 0 : 3) - (last ? 0 : 3)} unchanged lines …</div>`;
  if (!last) html += pre(lines.slice(-3));
  return html;
}

const conflictPending = (c) => c.choices.filter((x) => !x.touched).length;

function conflictBarHtml(c) {
  const blocks = c.choices.length, pending = conflictPending(c);
  return `<button class="primary" data-cact="save" ${pending ? 'disabled' : ''}>Save &amp; mark resolved</button>
    <span class="cstat">${pending ? `${pending} conflict(s) still need a choice` : 'Ready to save'}</span>
    <span class="cnav"><button data-cact="prev" title="Previous conflict (Alt+Up)">▲</button><button data-cact="next" title="Next conflict (Alt+Down)">▼</button>
    <button data-cact="all-ours" title="Take ours in every conflict that is still undecided">Ours for all pending</button><button data-cact="all-theirs" title="Take theirs in every conflict that is still undecided">Theirs for all pending</button></span>`;
}

function conflictTitleHtml(c) {
  const blocks = c.choices.length, pending = conflictPending(c);
  return `<span>${esc(c.path)} — ${blocks ? `${blocks - pending}/${blocks} resolved` : 'no conflict markers'}</span>`;
}

function renderConflict() {
  const c = state.conflict;
  const right = $('#detail-right');
  const keepScroll = right.scrollTop;
  const lang = langFor(c.path);
  const blocks = c.parts.filter((p) => p.type === 'conflict');
  const hasMarkers = blocks.length > 0;
  let ci = 0;
  const body = c.parts.map((p, pi) => {
    if (p.type === 'text') return contextHtml(p.lines, pi, pi === 0, pi === c.parts.length - 1, lang, c.expanded);
    const i = ci++;
    const ch = c.choices[i];
    const marks = conflictMarks(p);
    const btn = (k, label, tip) => `<button data-cres="${i}" data-kind="${k}" title="${esc(tip)}">${label}</button>`;
    const result = blockLines(p, ch, false).map(stripCr).join('\n');
    return `<div class="cblock ${ch.touched ? 'done' : ''}${i === c.cur ? ' cur' : ''}" data-cblock="${i}">
      <div class="chead"><span>Conflict ${i + 1} of ${blocks.length}${ch.auto ? ` <small class="cauto" title="${esc(window.t('Settled automatically — you can still change it'))}">· ${esc(window.t(ch.auto))}</small>` : ''}</span>
        <span class="cbtns">${btn('ours', 'Use ours', 'Take every line of ours')}${btn('theirs', 'Use theirs', 'Take every line of theirs')}${btn('both', 'Use both', 'Ours first, then theirs')}${btn('both-rev', 'Both (theirs first)', 'Theirs first, then ours')}${p.base ? btn('base', 'Use base', 'Go back to the common ancestor') : ''}${btn('none', 'Use none', 'Drop both sides')}${btn('reset', 'Reset', 'Undo the choices for this conflict')}</span></div>
      <div class="csides">${sideHtml(i, 'ours', 'Ours · ' + (p.oursLabel || 'HEAD'), p, ch, lang, marks)}${sideHtml(i, 'theirs', 'Theirs · ' + (p.theirsLabel || ''), p, ch, lang, marks)}</div>
      ${p.base ? `<details class="cbase"><summary>Base</summary><pre>${codeHtml(p.base.map(stripCr), lang)}</pre></details>` : ''}
      <div class="cresult"><div class="clabel"><span>Result</span><small>${esc(window.t('Tick the lines to keep (from either side), or type the final text here'))}</small></div>
        <textarea class="ctext" data-ctext="${i}" rows="${Math.min(14, Math.max(2, result.split('\n').length))}" spellcheck="false" placeholder="${esc(window.t('Nothing chosen yet'))}">${esc(result)}</textarea></div>
    </div>`;
  }).join('');
  right.innerHTML = `<div class="diff-title"><span class="ctitle">${conflictTitleHtml(c)}</span>
    <span class="seg"><button data-cact="tool" title="Open in your external merge tool">Merge tool</button><button data-cact="ours">Take ours</button><button data-cact="theirs">Take theirs</button><button data-cact="delete">Delete file</button>${hasMarkers ? '' : '<button data-cact="add" class="primary">Mark resolved</button>'}</span></div>` +
    (hasMarkers ? `<div class="cbar">${conflictBarHtml(c)}</div>` : '') +
    `<div class="conflict">${body || '<div class="empty">This file cannot be shown as text (deleted, binary or one-sided change). Use the buttons above.</div>'}</div>`;
  right.scrollTop = keepScroll;
}

// Moves to the next / previous conflict of the file (wrapping around).
function jumpConflict(dir) {
  const c = state.conflict;
  if (!c || !c.choices.length) return;
  const els = [...document.querySelectorAll('#detail-right .cblock')];
  if (!els.length) return;
  const top = $('#detail-right').getBoundingClientRect().top + 40;
  let at = els.findIndex((e) => e.getBoundingClientRect().bottom > top);
  if (at < 0) at = els.length - 1;
  let to = dir > 0 ? at + 1 : at - 1;
  // Already on the block at the top of the view? Then step from it; otherwise the nearest one below / above.
  if (dir > 0 && els[at].getBoundingClientRect().top > top) to = at;
  if (dir < 0 && els[at].getBoundingClientRect().top < top - 4) to = at;
  to = (to + els.length) % els.length;
  c.cur = to;
  els.forEach((e, k) => e.classList.toggle('cur', k === to));
  els[to].scrollIntoView({ block: 'start', behavior: 'smooth' });
}

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || !state.file || state.file.area !== 'conflict' || !state.conflict) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); jumpConflict(e.key === 'ArrowDown' ? 1 : -1); }
});

async function conflictClick(e) {
  const c = state.conflict;
  if (!c) return;
  const gap = e.target.closest('[data-expand]');
  if (gap) {
    const pi = +gap.dataset.expand;
    if (!c.expanded.delete(pi)) c.expanded.add(pi);
    return renderConflict();
  }
  const res = e.target.closest('[data-cres]');
  if (res) {
    const i = +res.dataset.cres, blk = c.parts.filter((p) => p.type === 'conflict')[i];
    applyPreset(blk, c.choices[i], res.dataset.kind);
    c.cur = i;
    return renderConflict();
  }
  const act = e.target.closest('[data-cact]');
  if (!act) return;
  const path = c.path;
  const blocks = c.parts.filter((p) => p.type === 'conflict');
  switch (act.dataset.cact) {
    case 'prev': return jumpConflict(-1);
    case 'next': return jumpConflict(1);
    case 'all-ours':
    case 'all-theirs':
      blocks.forEach((b, i) => { if (!c.choices[i].touched) applyPreset(b, c.choices[i], act.dataset.cact === 'all-ours' ? 'ours' : 'theirs'); });
      return renderConflict();
    case 'tool': return openMergeTool([path]);
    case 'ours': return run('Take ours', async () => { await git(['checkout', '--ours', '--', path]); await git(['add', '--', path]); });
    case 'theirs': return run('Take theirs', async () => { await git(['checkout', '--theirs', '--', path]); await git(['add', '--', path]); });
    case 'delete': return run('Delete file', () => git(['rm', '--', path]));
    case 'add': return run('Mark resolved', () => git(['add', '--', path]));
    case 'save':
      return run('Resolve ' + path, async () => {
        await window.api.writeFile(state.repo, path, resolvedText(c.parts, c.choices, c.crlf));
        await git(['add', '--', path]);
      });
  }
}

// Ticking a line (or a whole side) rebuilds that conflict's result from the ticked lines.
$('#detail-right').addEventListener('change', (e) => {
  const c = state.conflict;
  if (!c || !state.file || state.file.area !== 'conflict') return;
  const one = e.target.closest('[data-cl]');
  const all = e.target.closest('[data-call]');
  if (!one && !all) return;
  const idx = +(one ? one.dataset.cl : all.dataset.call);
  const side = (one || all).dataset.side;
  const ch = c.choices[idx];
  if (one) ch[side][+one.dataset.k] = one.checked;
  else ch[side] = ch[side].map(() => all.checked);
  if (ch.edited !== null) ch.edited = null;
  ch.touched = true;
  ch.auto = '';
  c.cur = idx;
  renderConflict();
});

// Typing in a result box keeps the focus: only the counters around it are refreshed.
$('#detail-right').addEventListener('input', (e) => {
  const t = e.target.closest('[data-ctext]');
  const c = state.conflict;
  if (!t || !c) return;
  const ch = c.choices[+t.dataset.ctext];
  ch.edited = t.value;
  ch.touched = true;
  ch.auto = '';
  t.closest('.cblock').classList.add('done');
  const title = document.querySelector('#detail-right .ctitle');
  if (title) title.innerHTML = conflictTitleHtml(c);
  const bar = document.querySelector('#detail-right .cbar');
  if (bar) bar.innerHTML = conflictBarHtml(c);
});

/* ---------- external merge tool ---------- */

// Hands conflicted files to the merge tool chosen in Preferences (`git mergetool`). Git marks a file as
// resolved when the tool reports success.
async function openMergeTool(paths) {
  const tool = (await window.api.git(state.repo, ['config', '--get', 'merge.tool'])).stdout.trim();
  if (!tool) {
    const v = await modal({ title: 'No merge tool configured', body: '<p>Choose a merge tool (VS Code, Beyond Compare, KDiff3, Meld, …) in Preferences first.</p>',
      buttons: [{ label: 'Close', value: false }, { label: 'Open Preferences', value: 'prefs', primary: true }] });
    if (v === 'prefs') prefsDialog();
    return;
  }
  const targets = paths && paths.length ? paths : state.status.filter((f) => f.conflict).map((f) => f.path);
  await run('Merge tool', async () => {
    for (const p of targets) {
      setStatus(`Merge tool: ${p}…`);
      await git(['-c', 'mergetool.keepBackup=false', '-c', 'mergetool.prompt=false', 'mergetool', '--no-prompt', '--', p], '');
    }
  });
}
