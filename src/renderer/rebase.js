'use strict';
// Interactive rebase: a todo-list dialog (reorder, change action, reword) that drives `git rebase -i`.

const REBASE_ACTIONS = [
  ['pick', 'Pick'], ['reword', 'Reword'], ['edit', 'Edit'], ['squash', 'Squash'], ['fixup', 'Fixup'], ['drop', 'Drop'],
];

const notice = (title, msg) => modal({ title, body: `<p>${esc(msg)}</p>`, buttons: [{ label: 'OK', value: true, primary: true }] });

// base = commit the rebase is replayed onto (null = from the root). includeSelf starts the list at `commit`.
async function interactiveRebase(commit, includeSelf) {
  if (state.busy) return;
  if (state.status.some((f) => f.conflict) || state.op) return notice('Rebase', 'Finish the operation in progress first.');
  const anc = await window.api.git(state.repo, ['merge-base', '--is-ancestor', commit.hash, 'HEAD']);
  if (anc.code !== 0) return notice('Rebase', 'This commit is not an ancestor of the current HEAD.');
  const base = includeSelf ? commit.parents[0] || null : commit.hash;
  const range = base ? `${base}..HEAD` : 'HEAD';
  const log = await window.api.git(state.repo, ['log', '--reverse', '--no-merges', '--pretty=format:%H%x1f%B%x1e', range]);
  const items = log.stdout.split('\x1e').map((s) => s.replace(/^\n+/, '')).filter(Boolean).map((rec) => {
    const [hash, msg] = rec.split('\x1f');
    const message = (msg || '').trim();
    return { hash, subject: message.split('\n')[0], message, action: 'pick' };
  });
  if (!items.length) return notice('Rebase', 'There are no commits to rebase.');
  const merges = +(await window.api.git(state.repo, ['rev-list', '--merges', '--count', range])).stdout.trim() || 0;
  const todo = await rebaseDialog(items, merges, base);
  if (!todo) return;
  await run('Interactive rebase', async () => {
    const r = await window.api.rebaseInteractive(state.repo, base, todo.map((t) => ({ hash: t.hash, action: t.action, message: t.message, finalMessage: t.finalMessage })));
    if (r.code !== 0) {
      const u = await window.api.git(state.repo, ['ls-files', '-u']);
      if (!u.stdout.trim()) throw new Error((r.stderr || r.stdout || 'git rebase failed').trim());
    }
    if (await detectOperation()) { state.sel = { type: 'wc' }; state.file = null; }
  });
}

function rebaseDialog(items, merges, base) {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    let drag = -1;
    const kept = () => items.filter((t) => t.action !== 'drop');
    const problem = () => {
      const k = kept();
      if (!k.length) return 'Every commit is dropped.';
      if (k[0].action === 'squash' || k[0].action === 'fixup') return 'The first commit cannot be squash or fixup.';
      const bad = items.find((t) => t.action === 'reword' && !t.message.trim());
      if (bad) return 'A reworded commit needs a message.';
      return squashGroups().some((g) => g.entry && !g.entry.text.trim()) ? 'A squashed commit needs a message.' : '';
    };

    // Groups of a kept commit plus the squash/fixup commits folded into it. A group with at least one
    // squash gets an editable combined message; edits are dropped when the group's members change.
    const sq = {};
    const squashGroups = () => {
      const out = [];
      let cur = null;
      items.forEach((t, i) => {
        if (t.action === 'drop') return;
        if (t.action === 'squash' || t.action === 'fixup') { if (cur) cur.members.push(i); return; }
        cur = { head: i, members: [] };
        out.push(cur);
      });
      return out.filter((g) => g.members.some((i) => items[i].action === 'squash')).map((g) => {
        const key = [g.head, ...g.members].map((i) => items[i].hash).join();
        const headHash = items[g.head].hash;
        if (sq[headHash] && sq[headHash].key !== key) delete sq[headHash];
        const text = [items[g.head].message, ...g.members.filter((i) => items[i].action === 'squash').map((i) => items[i].message)].join('\n\n');
        return { ...g, key, headHash, last: g.members[g.members.length - 1], entry: sq[headHash], text };
      });
    };
    const close = (v) => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; resolve(v); };

    const draw = () => {
      const err = problem();
      const byLast = {};
      squashGroups().forEach((g) => { byLast[g.last] = g; });
      const sqBox = (i) => {
        const g = byLast[i];
        if (!g) return '';
        return `<div class="rb-sq"><label>Message for the combined commit (${esc(items[g.head].hash.slice(0, 7))} + squashed)</label><textarea data-sq="${g.headHash}" data-key="${esc(g.key)}" spellcheck="false">${esc(g.entry ? g.entry.text : g.text)}</textarea></div>`;
      };
      ov.innerHTML = `<div class="modal wide"><h3>Interactive rebase</h3>
        <p class="hint">Oldest commit first. Drag rows (or use ▲▼) to reorder, and pick an action for each commit.${merges ? ` ${merges} merge commit(s) in this range will be flattened.` : ''}</p>
        <div class="rb-list">${items.map((t, i) => `<div class="rb-row ${t.action}" draggable="true" data-i="${i}">
          <span class="rb-grip" title="Drag to reorder">≡</span>
          <select data-act="${i}">${REBASE_ACTIONS.map(([v, l]) => `<option value="${v}" ${t.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="rb-sha">${t.hash.slice(0, 7)}</span>
          ${t.action === 'reword' ? `<input type="text" class="rb-msg" data-msg="${i}" value="${esc(t.message.split('\n')[0])}">` : `<span class="rb-sub">${esc(t.subject)}</span>`}
          <span class="rb-mv"><button data-mv="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button><button data-mv="${i}" data-d="1" ${i === items.length - 1 ? 'disabled' : ''}>▼</button></span>
        </div>${sqBox(i)}`).join('')}</div>
        <div class="rb-foot"><span class="rb-err">${esc(err)}</span><span class="btns"><button id="rb-cancel">Cancel</button><button class="primary" id="rb-go" ${err ? 'disabled' : ''}>Start rebase</button></span></div></div>`;
    };

    const reorder = (from, to) => {
      if (from === to || from < 0 || to < 0 || to >= items.length) return;
      items.splice(to, 0, items.splice(from, 1)[0]);
      draw();
    };

    ov.classList.remove('hidden');
    draw();
    ov.onclick = (e) => {
      if (e.target.closest('#rb-cancel')) return close(null);
      if (e.target.closest('#rb-go')) {
        items.forEach((t) => delete t.finalMessage);
        squashGroups().forEach((g) => { if (g.entry) items[g.last].finalMessage = g.entry.text.trim(); });
        return close(items);
      }
      const mv = e.target.closest('[data-mv]');
      if (mv) reorder(+mv.dataset.mv, +mv.dataset.mv + +mv.dataset.d);
    };
    ov.onchange = (e) => {
      const s = e.target.closest('[data-act]');
      if (s) { items[+s.dataset.act].action = s.value; draw(); }
    };
    ov.oninput = (e) => {
      const q = e.target.closest('[data-sq]');
      const m = e.target.closest('[data-msg]');
      if (q) sq[q.dataset.sq] = { key: q.dataset.key, text: q.value };
      else if (m) {
        const t = items[+m.dataset.msg];
        const rest = t.message.split('\n').slice(1).join('\n');
        t.message = m.value + (rest ? '\n' + rest : '');
      } else return;
      const err = problem();
      $('.rb-err').textContent = err;
      $('#rb-go').disabled = !!err;
    };
    ov.ondragstart = (e) => { const r = e.target.closest('.rb-row'); if (r) { drag = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; } };
    ov.ondragover = (e) => { if (drag >= 0 && e.target.closest('.rb-row')) e.preventDefault(); };
    ov.ondrop = (e) => {
      const r = e.target.closest('.rb-row');
      if (r && drag >= 0) { e.preventDefault(); const from = drag; drag = -1; reorder(from, +r.dataset.i); }
    };
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
  });
}

// Plain `git rebase <target>`: replays the current branch on top of a branch, tag or commit.
async function rebaseOnto(target, label = target) {
  if (state.busy) return;
  if (!state.head) return notice('Rebase', 'Check out a branch first (HEAD is detached).');
  if (state.op || state.status.some((f) => f.conflict)) return notice('Rebase', 'Finish the operation in progress first.');
  if (target === state.head) return notice('Rebase', 'A branch cannot be rebased onto itself.');
  const ok = await confirm2('Rebase', `Rebase ${state.head} onto ${label}? The commits of ${state.head} are rewritten.`);
  if (!ok) return;
  await run(`Rebase onto ${label}`, async () => {
    const out = await gitAllowConflict(['rebase', '--autostash', target]);
    if (await detectOperation()) { state.sel = { type: 'wc' }; state.file = null; }
    return out;
  });
}
