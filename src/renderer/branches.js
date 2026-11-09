'use strict';
// Delete several local and/or remote branches at once.

async function loadBranchInfo() {
  const [refs, mergedLocal, mergedRemote, defaults] = await Promise.all([
    window.api.git(state.repo, ['for-each-ref', '--format=%(refname)%09%(committerdate:unix)%09%(upstream:track)%09%(subject)', 'refs/heads', 'refs/remotes']),
    window.api.git(state.repo, ['branch', '--merged', 'HEAD', '--format=%(refname:short)']),
    window.api.git(state.repo, ['branch', '-r', '--merged', 'HEAD', '--format=%(refname:short)']),
    window.api.git(state.repo, ['for-each-ref', '--format=%(symref:short)', 'refs/remotes/*/HEAD']),
  ]);
  // Never offer the remote default branch, the current branch's upstream, or their local namesakes.
  const guarded = new Set(defaults.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  const cur = state.branches.find((b) => b.current);
  if (cur && cur.upstream) guarded.add(cur.upstream);
  for (const g of [...guarded]) guarded.add(g.split('/').slice(1).join('/'));
  const merged = new Set([...mergedLocal.stdout.split('\n'), ...mergedRemote.stdout.split('\n')].map((s) => s.trim()).filter(Boolean));
  const rows = [];
  for (const line of refs.stdout.split('\n').filter(Boolean)) {
    const [ref, time, track, subject] = line.split('\t');
    const remote = ref.startsWith('refs/remotes/');
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    if (remote && name.endsWith('/HEAD')) continue;
    if (!remote && name === state.head) continue;
    rows.push({ name, remote, time: +time * 1000, track: track || '', subject, protectedRef: guarded.has(name), merged: merged.has(name), gone: /gone/.test(track || '') });
  }
  return rows.sort((a, b) => a.remote - b.remote || a.name.localeCompare(b.name));
}

async function deleteBranchesDialog() {
  let rows;
  try { rows = await loadBranchInfo(); } catch (e) { return notice('Delete branches', e.message); }
  if (!rows.length) return notice('Delete branches', 'There are no other branches to delete.');
  const ov = $('#overlay');
  const picked = new Set();
  let filter = '';
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onchange = ov.oninput = ov.onkeydown = null; };
  const visible = () => rows.filter((r) => !filter || r.name.toLowerCase().includes(filter));

  const rowHtml = (r) => `<label class="bd-row"><input type="checkbox" data-n="${esc(r.name)}" ${picked.has(r.name) ? 'checked' : ''} ${r.protectedRef ? 'disabled' : ''}>
    <span class="bd-name">${esc(r.name)}</span>
    ${r.protectedRef ? '<span class="badge remote" title="Default branch or upstream of the current branch">protected</span>' : ''}${r.merged ? '<span class="badge local">merged</span>' : ''}${r.gone ? '<span class="badge head">gone</span>' : ''}${/ahead/.test(r.track) ? `<span class="badge tag">${esc(trackText(r.track))}</span>` : ''}
    <span class="bd-date">${fmtDate(r.time)}</span></label>`;

  const draw = () => {
    const v = visible();
    const section = (remote, title) => {
      const rs = v.filter((r) => r.remote === remote);
      return rs.length ? `<div class="sb-head">${title} (${rs.length})</div>${rs.map(rowHtml).join('')}` : '';
    };
    const remoteCount = rows.filter((r) => r.remote && picked.has(r.name)).length;
    ov.innerHTML = `<div class="modal wide"><h3>Delete branches</h3>
      <div class="bd-tools"><input type="search" id="bd-filter" placeholder="Filter…" value="${esc(filter)}">
        <button data-bd="merged">Select merged</button><button data-bd="gone">Select gone</button><button data-bd="clear">Clear</button></div>
      <div class="rb-list bd-list">${section(false, 'Local') + section(true, 'Remote') || '<div class="empty">No matches</div>'}</div>
      <div class="rb-foot"><span class="rb-err">${remoteCount ? `${remoteCount} remote branch(es) will be deleted on the server.` : ''}</span>
        <span class="btns"><button id="bd-cancel">Cancel</button><button class="danger" id="bd-go" ${picked.size ? '' : 'disabled'}>Delete ${picked.size || ''} branch${picked.size === 1 ? '' : 'es'}</button></span></div></div>`;
    const f = $('#bd-filter');
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
  };

  ov.classList.remove('hidden');
  draw();
  ov.oninput = (e) => { if (e.target.id === 'bd-filter') { filter = e.target.value.trim().toLowerCase(); draw(); } };
  ov.onchange = (e) => {
    const n = e.target.dataset && e.target.dataset.n;
    if (n == null) return;
    if (e.target.checked) picked.add(n); else picked.delete(n);
    draw();
  };
  ov.onclick = (e) => {
    if (e.target.closest('#bd-cancel')) return close();
    const b = e.target.closest('[data-bd]');
    if (b) {
      const kind = b.dataset.bd;
      if (kind === 'clear') picked.clear();
      else visible().filter((r) => r[kind] && !r.protectedRef).forEach((r) => picked.add(r.name));
      return draw();
    }
    if (e.target.closest('#bd-go')) {
      const chosen = rows.filter((r) => picked.has(r.name));
      close();
      confirmDeleteBranches(chosen);
    }
  };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}

async function confirmDeleteBranches(chosen) {
  const local = chosen.filter((r) => !r.remote), remote = chosen.filter((r) => r.remote);
  const unmerged = local.filter((r) => !r.merged);
  const lines = [`Delete ${local.length} local and ${remote.length} remote branch(es)?`];
  if (unmerged.length) lines.push(`${unmerged.length} local branch(es) are not merged into HEAD and will be force-deleted: ${unmerged.map((r) => r.name).join(', ')}.`);
  if (remote.length) lines.push('Remote branches are deleted on the server and cannot be restored from here.');
  const ok = await modal({
    title: 'Delete branches',
    body: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true }],
  });
  if (!ok) return;
  await run('Delete branches', async () => {
    const failures = [];
    for (const r of local) {
      try { await git(['branch', r.merged ? '-d' : '-D', '--', r.name]); }
      catch (e) { failures.push(`${r.name}: ${e.message.split('\n')[0]}`); }
    }
    const byRemote = {};
    for (const r of remote) {
      const [rm, ...rest] = r.name.split('/');
      (byRemote[rm] = byRemote[rm] || []).push(rest.join('/'));
    }
    for (const [rm, names] of Object.entries(byRemote)) {
      try { await git(['push', rm, '--delete', ...names]); }
      catch (e) { failures.push(`${rm}: ${e.message.split('\n')[0]}`); }
    }
    if (failures.length) throw new Error('Some branches could not be deleted:\n' + failures.join('\n'));
  });
}
