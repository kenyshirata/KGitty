'use strict';
// Undo / redo for destructive operations. Before such an operation runs, the repository's refs and uncommitted
// work are captured (branch tips, HEAD, `git stash create` for the working copy, existing stashes); undoing
// restores that snapshot. Untracked files are not part of the snapshot.

const UNDOABLE = /^(Reset|Discard|Merge|Pull|Cherry-pick|Revert|Rebase onto|Interactive rebase|Delete branch|Delete branches|Drop stash|Amend commit)/;
const UNDO_LIMIT = 20;

async function captureUndo(label) {
  const r = (args) => window.api.git(state.repo, args);
  const [head, refs, wip, stashes] = await Promise.all([
    r(['rev-parse', '-q', '--verify', 'HEAD']),
    r(['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads']),
    r(['stash', 'create']),
    r(['stash', 'list', '--format=%H%x09%s']),
  ]);
  const tips = {};
  refs.stdout.split('\n').filter(Boolean).forEach((l) => { const [n, h] = l.split('\t'); tips[n] = h; });
  return {
    label,
    time: Date.now(),
    branch: state.head,
    head: head.code === 0 ? head.stdout.trim() : null,
    tips,
    wip: wip.stdout.trim() || null,
    stashes: stashes.stdout.split('\n').filter(Boolean).map((l) => { const [hash, ...m] = l.split('\t'); return { hash, msg: m.join('\t') }; }),
  };
}

function pushUndo(entry) {
  state.undo.push(entry);
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  state.redo = [];
}

function updateUndoUi() {
  const u = state.undo[state.undo.length - 1], r = state.redo[state.redo.length - 1];
  const bu = $('#tb-undo'), br = $('#tb-redo');
  bu.disabled = !u;
  br.disabled = !r;
  bu.title = u ? `Undo ${u.label} (Ctrl+Z)` : 'Nothing to undo';
  br.title = r ? `Redo ${r.label} (Ctrl+Shift+Z)` : 'Nothing to redo';
}

const shortSha = (h) => (h ? h.slice(0, 7) : 'none');

// Describes what restoring `entry` will change, relative to the repository as it is now.
async function undoPlan(entry) {
  const now = await captureUndo('now');
  const lines = [];
  for (const [name, hash] of Object.entries(entry.tips)) {
    if (!(name in now.tips)) lines.push(`Recreate branch ${name} at ${shortSha(hash)}`);
    else if (now.tips[name] !== hash) lines.push(`Move branch ${name}: ${shortSha(now.tips[name])} → ${shortSha(hash)}`);
  }
  if (entry.exact) for (const name of Object.keys(now.tips)) if (!(name in entry.tips) && name !== now.branch) lines.push(`Delete branch ${name}`);
  if (entry.head && entry.head !== now.head && !entry.branch) lines.push(`Detach HEAD at ${shortSha(entry.head)}`);
  if (entry.branch && entry.branch !== now.branch) lines.push(`Switch to branch ${entry.branch}`);
  const missing = entry.stashes.filter((s) => !now.stashes.some((n) => n.hash === s.hash));
  missing.forEach((s) => lines.push(`Restore stash "${s.msg}"`));
  if (entry.wip) lines.push('Restore the uncommitted changes you had before');
  return { lines, now };
}

async function restoreSnapshot(entry) {
  const failures = [];
  const attempt = async (fn) => { try { await fn(); } catch (e) { failures.push(e.message.split('\n')[0]); } };
  if (state.op) await window.api.git(state.repo, OPS[state.op].abort);
  const cur = (await window.api.git(state.repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  const existing = await window.api.git(state.repo, ['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads']);
  const have = {};
  existing.stdout.split('\n').filter(Boolean).forEach((l) => { const [n, h] = l.split('\t'); have[n] = h; });

  for (const [name, hash] of Object.entries(entry.tips)) {
    if (name === cur || have[name] === hash) continue;
    await attempt(() => git(['branch', '-f', name, hash]));
  }
  if (entry.exact) {
    for (const name of Object.keys(have)) if (!(name in entry.tips) && name !== cur) await attempt(() => git(['branch', '-D', '--', name]));
  }
  if (entry.head) {
    if (entry.branch && entry.branch === cur) await attempt(() => git(['reset', '--hard', entry.head]));
    else if (entry.branch && entry.branch in entry.tips) await attempt(() => git(['checkout', '-f', entry.branch]));
    else if (!entry.branch) await attempt(() => git(['checkout', '-f', '--detach', entry.head]));
  }
  if (entry.wip) {
    try { await git(['stash', 'apply', '--index', entry.wip]); } catch { await attempt(() => git(['stash', 'apply', entry.wip])); }
  }
  const stashes = await window.api.git(state.repo, ['stash', 'list', '--format=%H']);
  const present = new Set(stashes.stdout.split('\n').filter(Boolean));
  for (const s of [...entry.stashes].reverse()) {
    if (!present.has(s.hash)) await attempt(() => git(['stash', 'store', '-m', s.msg, s.hash]));
  }
  if (failures.length) throw new Error('Some parts could not be restored:\n' + failures.join('\n'));
}

async function applyUndo(from, to, verb) {
  if (state.busy) return;
  const entry = from[from.length - 1];
  if (!entry) return;
  let plan;
  try { plan = await undoPlan(entry); } catch (e) { return notice(verb, e.message); }
  const body = plan.lines.length
    ? `<ul class="undo-list">${plan.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '<p>The refs already match that state; only uncommitted changes may differ.</p>';
  const ok = await modal({
    title: `${verb} “${entry.label}”?`,
    body: `${body}<p class="hint">Uncommitted changes you made since then are discarded${verb === 'Undo' ? ' (Redo brings them back)' : ''}. Untracked files are never touched.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: verb, value: true, danger: true }],
  });
  if (!ok) return;
  from.pop();
  to.push(plan.now);
  plan.now.label = entry.label;
  plan.now.exact = to === state.redo; // a redo snapshot also removes branches that did not exist when it was taken
  const keepRedo = state.redo, keepUndo = state.undo;
  const res = await runRaw(`${verb} ${entry.label}`, () => restoreSnapshot(entry));
  state.undo = keepUndo;
  state.redo = keepRedo;
  if (res === false) { to.pop(); from.push(entry); }
  updateUndoUi();
}

const undoLast = () => applyUndo(state.undo, state.redo, 'Undo');
const redoLast = () => applyUndo(state.redo, state.undo, 'Redo');

$('#tb-undo').onclick = undoLast;
$('#tb-redo').onclick = redoLast;
