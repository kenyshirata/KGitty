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

function resolvedText(parts, choices) {
  const out = [];
  let ci = 0;
  for (const p of parts) {
    if (p.type === 'text') { out.push(...p.lines); continue; }
    const c = choices[ci++];
    if (c.kind === 'ours') out.push(...p.ours);
    else if (c.kind === 'theirs') out.push(...p.theirs);
    else if (c.kind === 'both') out.push(...p.ours, ...p.theirs);
    else if (c.kind === 'custom' && c.text !== '') out.push(...c.text.split('\n'));
  }
  return out.join('\n');
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
  state.conflict = { path, parts, sig, exists: r.ok, choices: keep ? prev.choices : blocks.map(() => ({ kind: null, text: '' })) };
  renderConflict();
}

const codeHtml = (lines, lang) => highlightLines(lines, lang).join('\n') || ' ';

const sideHtml = (cls, label, lines, lang) =>
  `<div class="cside ${cls}"><div class="clabel">${esc(label)}</div><pre>${codeHtml(lines, lang)}</pre></div>`;

function contextHtml(raw, first, last, lang) {
  const lines = highlightLines(raw, lang);
  const pre = (ls) => `<pre class="ctxl">${ls.join('\n') || ' '}</pre>`;
  if (lines.length <= 8) return lines.length ? pre(lines) : '';
  let html = '';
  if (!first) html += pre(lines.slice(0, 3));
  html += `<div class="gap">… ${lines.length - (first ? 0 : 3) - (last ? 0 : 3)} unchanged lines …</div>`;
  if (!last) html += pre(lines.slice(-3));
  return html;
}

function renderConflict() {
  const c = state.conflict;
  const right = $('#detail-right');
  const lang = langFor(c.path);
  const blocks = c.parts.filter((p) => p.type === 'conflict');
  const pending = c.choices.filter((x) => !x.kind).length;
  const hasMarkers = blocks.length > 0;
  let ci = 0;
  const body = c.parts.map((p, pi) => {
    if (p.type === 'text') return contextHtml(p.lines, pi === 0, pi === c.parts.length - 1, lang);
    const i = ci++;
    const ch = c.choices[i];
    const btn = (k, label) => `<button data-cres="${i}" data-kind="${k}" class="${ch.kind === k ? 'primary' : ''}">${label}</button>`;
    return `<div class="cblock ${ch.kind ? 'done' : ''}">
      <div class="chead"><span>Conflict ${i + 1} of ${blocks.length}</span><span class="cbtns">${btn('ours', 'Use ours')}${btn('theirs', 'Use theirs')}${btn('both', 'Use both')}${btn('custom', 'Edit…')}</span></div>
      <div class="csides">${sideHtml('ours' + (ch.kind === 'ours' || ch.kind === 'both' ? ' picked' : ''), 'Ours · ' + (p.oursLabel || 'HEAD'), p.ours, lang)}${sideHtml('theirs' + (ch.kind === 'theirs' || ch.kind === 'both' ? ' picked' : ''), 'Theirs · ' + (p.theirsLabel || ''), p.theirs, lang)}</div>
      ${p.base ? `<details class="cbase"><summary>Base</summary><pre>${codeHtml(p.base, lang)}</pre></details>` : ''}
      ${ch.kind === 'custom' ? `<textarea class="ctext" data-ctext="${i}" spellcheck="false">${esc(ch.text)}</textarea>` : ''}
    </div>`;
  }).join('');
  right.innerHTML = `<div class="diff-title"><span>${esc(c.path)} — ${hasMarkers ? `${blocks.length - pending}/${blocks.length} resolved` : 'no conflict markers'}</span>
    <span class="seg"><button data-cact="tool" title="Open in your external merge tool">Merge tool</button><button data-cact="ours">Take ours</button><button data-cact="theirs">Take theirs</button><button data-cact="delete">Delete file</button>${hasMarkers ? '' : '<button data-cact="add" class="primary">Mark resolved</button>'}</span></div>` +
    (hasMarkers ? `<div class="cbar"><button class="primary" data-cact="save" ${pending ? 'disabled' : ''}>Save &amp; mark resolved</button><span>${pending ? `${pending} conflict(s) still need a choice` : 'Ready to save'}</span></div>` : '') +
    `<div class="conflict">${body || '<div class="empty">This file cannot be shown as text (deleted, binary or one-sided change). Use the buttons above.</div>'}</div>`;
}

async function conflictClick(e) {
  const c = state.conflict;
  if (!c) return;
  const res = e.target.closest('[data-cres]');
  if (res) {
    const i = +res.dataset.cres, kind = res.dataset.kind, blk = c.parts.filter((p) => p.type === 'conflict')[i];
    const ch = c.choices[i];
    if (kind === 'custom' && ch.kind !== 'custom') ch.text = (ch.kind === 'theirs' ? blk.theirs : ch.kind === 'both' ? [...blk.ours, ...blk.theirs] : blk.ours).join('\n');
    ch.kind = kind;
    return renderConflict();
  }
  const act = e.target.closest('[data-cact]');
  if (!act) return;
  const path = c.path;
  switch (act.dataset.cact) {
    case 'tool': return openMergeTool([path]);
    case 'ours': return run('Take ours', async () => { await git(['checkout', '--ours', '--', path]); await git(['add', '--', path]); });
    case 'theirs': return run('Take theirs', async () => { await git(['checkout', '--theirs', '--', path]); await git(['add', '--', path]); });
    case 'delete': return run('Delete file', () => git(['rm', '--', path]));
    case 'add': return run('Mark resolved', () => git(['add', '--', path]));
    case 'save':
      return run('Resolve ' + path, async () => {
        await window.api.writeFile(state.repo, path, resolvedText(c.parts, c.choices));
        await git(['add', '--', path]);
      });
  }
}

$('#detail-right').addEventListener('input', (e) => {
  const t = e.target.closest('[data-ctext]');
  if (t && state.conflict) state.conflict.choices[+t.dataset.ctext].text = t.value;
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
