'use strict';
// Git Flow, implemented with plain git commands (no git-flow extension needed). The configuration uses the same
// gitflow.* keys as git-flow-avh, so repositories already set up with the command line tool just work.

const FLOW_TYPES = ['feature', 'release', 'hotfix'];

async function loadFlow() {
  const r = await window.api.git(state.repo, ['config', '--get-regexp', '^gitflow\\.']);
  const c = {};
  for (const l of r.stdout.split('\n').filter(Boolean)) {
    const i = l.indexOf(' ');
    c[l.slice(0, i)] = l.slice(i + 1);
  }
  const main = c['gitflow.branch.master'], develop = c['gitflow.branch.develop'];
  state.flow = main && develop
    ? { init: true, main, develop, prefix: { feature: c['gitflow.prefix.feature'] || 'feature/', release: c['gitflow.prefix.release'] || 'release/', hotfix: c['gitflow.prefix.hotfix'] || 'hotfix/' }, tagPrefix: c['gitflow.prefix.versiontag'] || '' }
    : { init: false };
}

const flowBranches = (type) => state.branches.filter((b) => b.name.startsWith(state.flow.prefix[type]));
const flowTypeOf = (name) => state.flow && state.flow.init && FLOW_TYPES.find((t) => name.startsWith(state.flow.prefix[t]));

function flowSection() {
  const f = state.flow;
  if (!f) return '';
  if (!f.init) return '<div class="sb-head">Git Flow</div><div class="sb-item dim" data-act="flow-init" title="Set up main / develop branches and the feature, release and hotfix prefixes">Initialize Git Flow…</div>';
  const items = FLOW_TYPES.flatMap((t) => flowBranches(t).map((b) =>
    `<div class="sb-item ${b.current ? 'current' : ''}" data-kind="flow" data-name="${esc(b.name)}" title="${esc(b.name)}">${b.current ? '● ' : ''}<span class="flow-type">${t}</span> ${esc(b.name.slice(f.prefix[t].length))}</div>`));
  return `<div class="sb-head">Git Flow<span class="sb-tools"><button class="sb-tool" data-act="flow-start" title="Start a feature, release or hotfix">＋</button></span></div>${items.join('') || '<div class="sb-item dim">No active flow branches</div>'}`;
}

/* ---------- initialize ---------- */

async function flowInit() {
  const names = state.branches.map((b) => b.name);
  const main = ['main', 'master'].find((n) => names.includes(n)) || state.head || 'main';
  const v = await modal({
    title: 'Initialize Git Flow',
    body: '<p class="hint">Production releases live on the main branch; the next release is prepared on the development branch.</p>',
    fields: [
      { label: 'Production branch', value: main },
      { label: 'Development branch', value: 'develop' },
      { label: 'Feature prefix', value: 'feature/' },
      { label: 'Release prefix', value: 'release/' },
      { label: 'Hotfix prefix', value: 'hotfix/' },
      { label: 'Version tag prefix (optional)', value: '' },
    ],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Initialize', value: true, primary: true }],
  });
  if (!v) return;
  const [m, d, pf, pr, ph, pt] = v;
  if (!m || !d || m === d) return notice('Git Flow', 'Choose two different branch names.');
  if (!names.includes(m)) return notice('Git Flow', `The production branch “${m}” does not exist yet. Make a first commit on it, or pick an existing branch.`);
  await run('Initialize Git Flow', async () => {
    if (!names.includes(d)) await git(['branch', d, m]);
    for (const [k, val] of [['branch.master', m], ['branch.develop', d], ['prefix.feature', pf || 'feature/'], ['prefix.release', pr || 'release/'], ['prefix.hotfix', ph || 'hotfix/'], ['prefix.versiontag', pt]]) {
      if (val) await git(['config', 'gitflow.' + k, val]);
      else await window.api.git(state.repo, ['config', '--unset-all', 'gitflow.' + k]);
    }
  });
}

/* ---------- start ---------- */

function flowStartMenu(e) {
  const r = e.target.getBoundingClientRect();
  ctxMenu(r.left, r.bottom + 4, FLOW_TYPES.map((t) => ({ label: `Start ${t}…`, action: () => flowStart(t) })));
}

async function flowStart(type) {
  const f = state.flow;
  const base = type === 'hotfix' ? f.main : f.develop;
  const typed = await prompt2(`Start ${type}`, type === 'feature' ? 'Feature name' : 'Version (for example 1.2.0)');
  const name = typed && branchNameFrom(typed);
  if (!name) return;
  if (/[\s~^:?*\[\\]|\.\.|\/\/|\.lock$/.test(name)) return notice('Git Flow', 'That is not a valid branch name.');
  const branch = f.prefix[type] + name;
  if (state.branches.some((b) => b.name === branch)) return notice('Git Flow', `${branch} already exists.`);
  if (!state.branches.some((b) => b.name === base)) return notice('Git Flow', `The ${type === 'hotfix' ? 'production' : 'development'} branch “${base}” does not exist.`);
  await run(`Start ${type} ${name}`, () => git(['checkout', '-b', branch, base]));
}

/* ---------- finish ---------- */

function flowFinishDialog(type, name) {
  const f = state.flow;
  return new Promise((resolve) => {
    const ov = $('#overlay');
    const tagged = type !== 'feature';
    const target = tagged ? `${f.main} / ${f.develop}` : f.develop;
    ov.innerHTML = `<div class="modal"><h3>Finish ${type} ${esc(name)}</h3>
      <p class="hint">Merges into ${esc(target)}${tagged ? ', tags the release' : ''}.</p>
      ${tagged ? `<div class="field"><label>Tag</label><input type="text" id="ff-tag" value="${esc(f.tagPrefix + name)}"></div>
      <div class="field"><label>Tag message</label><input type="text" id="ff-msg" value="${esc((type === 'release' ? 'Release ' : 'Hotfix ') + name)}"></div>` : '<label class="cl-opt"><input type="checkbox" id="ff-squash"> Squash all commits into one</label>'}
      <label class="cl-opt"><input type="checkbox" id="ff-del" checked> Delete the ${type} branch afterwards</label>
      <label class="cl-opt"><input type="checkbox" id="ff-push"> Push ${esc(target)}${tagged ? ' and the tag' : ''} when done</label>
      <div class="btns"><button id="ff-cancel">Cancel</button><button class="primary" id="ff-ok">Finish</button></div></div>`;
    ov.classList.remove('hidden');
    const close = (v) => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; resolve(v); };
    $('#ff-cancel').onclick = () => close(null);
    const ok = () => {
      const tag = tagged ? $('#ff-tag').value.trim() : '';
      if (tagged && !tag) return;
      close({ tag, msg: tagged ? $('#ff-msg').value.trim() || tag : '', del: $('#ff-del').checked, push: $('#ff-push').checked, squash: !tagged && $('#ff-squash').checked });
    };
    $('#ff-ok').onclick = ok;
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') ok(); };
    (tagged ? $('#ff-tag') : $('#ff-del')).focus();
  });
}

const hasUnmerged = async () => !!(await window.api.git(state.repo, ['ls-files', '-u'])).stdout.trim();

async function flowFinish(branch) {
  const f = state.flow;
  const type = flowTypeOf(branch);
  if (!type) return;
  const name = branch.slice(f.prefix[type].length);
  if (state.status.some((x) => !x.untracked)) return notice('Git Flow', 'Commit, stash or discard your local changes before finishing a ' + type + '.');
  for (const need of type === 'feature' ? [f.develop] : [f.main, f.develop]) {
    if (!state.branches.some((b) => b.name === need)) return notice('Git Flow', `The branch “${need}” does not exist.`);
  }
  const o = await flowFinishDialog(type, name);
  if (!o) return;
  let stoppedAt = null;
  const merge = async (into, args, remaining) => {
    await git(['checkout', into]);
    await gitAllowConflict(['merge', ...args]);
    if (await hasUnmerged()) { stoppedAt = { into, remaining }; return false; }
    return true;
  };
  await run(`Finish ${type} ${name}`, async () => {
    if (type === 'feature') {
      if (o.squash) {
        await git(['checkout', f.develop]);
        await gitAllowConflict(['merge', '--squash', branch]);
        if (await hasUnmerged()) { stoppedAt = { into: f.develop, remaining: [`commit the squashed changes`, o.del && `delete ${branch}`] }; return; }
        await git(['commit', '-m', `Merge feature ${name}`]);
      } else if (!(await merge(f.develop, ['--no-ff', '-m', `Merge branch '${branch}' into ${f.develop}`, branch], [o.del && `delete ${branch}`]))) return;
      if (o.del) await git(['branch', '-D', branch]);
      if (o.push) await git(['push', 'origin', f.develop]);
      return;
    }
    if (!(await merge(f.main, ['--no-ff', '-m', `Merge branch '${branch}'`, branch], [`tag ${o.tag}`, `merge ${branch} into ${f.develop}`, o.del && `delete ${branch}`]))) return;
    await git(['tag', '-a', o.tag, '-m', o.msg]);
    if (!(await merge(f.develop, ['--no-ff', '-m', `Merge branch '${branch}' into ${f.develop}`, branch], [o.del && `delete ${branch}`]))) return;
    if (o.del) await git(['branch', '-D', branch]);
    if (o.push) await git(['push', 'origin', f.main, f.develop, o.tag]);
  });
  if (stoppedAt) {
    await notice('Git Flow — conflicts',
      `Merging into ${stoppedAt.into} stopped on conflicts. Resolve them and continue the merge from the banner${stoppedAt.remaining.filter(Boolean).length ? '. Then finish by hand: ' + stoppedAt.remaining.filter(Boolean).join(', ') : ''}.`);
  }
}

/* ---------- menus ---------- */

function flowMenu(e, name) {
  e.preventDefault();
  const b = state.branches.find((x) => x.name === name);
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Finish…', action: () => flowFinish(name) },
    !(b && b.current) && { label: 'Checkout', action: () => checkout(name) },
    b && !b.upstream && { label: 'Publish (push to origin)', action: () => run('Publish ' + name, () => git(['push', '-u', 'origin', name])) },
    '-',
    !(b && b.current) && { label: 'Delete…', action: async () => { if (await confirm2('Delete branch', `Delete ${name} without finishing it?`, true)) run('Delete branch', () => git(['branch', '-D', name])); } },
  ].filter(Boolean));
}
