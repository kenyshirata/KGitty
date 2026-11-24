'use strict';
// Line-by-line blame view, with syntax highlighting and navigation to earlier versions of a line.

const BLAME_HIGHLIGHT_MAX = 5000;
const NOT_COMMITTED = '0'.repeat(40);

async function loadBlame(path, rev) {
  const r = await window.api.git(state.repo, ['blame', '--porcelain', ...(rev ? [rev] : []), '--', path]);
  if (r.code !== 0) throw new Error((r.stderr || 'git blame failed').trim());
  const infos = {}, lines = [];
  const L = r.stdout.split('\n');
  let i = 0;
  while (i < L.length) {
    const m = /^([0-9a-f]{40}) \d+ \d+/.exec(L[i]);
    if (!m) { i++; continue; }
    const sha = m[1];
    const info = infos[sha] || (infos[sha] = { sha });
    for (i++; i < L.length && !L[i].startsWith('\t'); i++) {
      const sp = L[i].indexOf(' ');
      const k = sp < 0 ? L[i] : L[i].slice(0, sp), v = sp < 0 ? '' : L[i].slice(sp + 1);
      if (k === 'author') info.author = v;
      else if (k === 'author-time') info.time = +v * 1000;
      else if (k === 'summary') info.summary = v;
      else if (k === 'previous') { const [ps, ...pf] = v.split(' '); info.previous = { sha: ps, file: pf.join(' ') }; }
    }
    lines.push({ sha, text: (L[i] || '\t').slice(1) });
    i++;
  }
  return { infos, lines };
}

const blameColor = (sha) => (sha === NOT_COMMITTED ? '#8b8f96' : `hsl(${parseInt(sha.slice(0, 6), 16) % 360} 55% 55%)`);

async function showBlame(path, rev = null, stack = []) {
  let data;
  try {
    data = await loadBlame(path, rev);
  } catch (e) {
    return notice('Blame', e.message);
  }
  const { infos, lines } = data;
  const ov = $('#overlay');
  const lang = langFor(path);
  const code = lines.length <= BLAME_HIGHLIGHT_MAX ? highlightLines(lines.map((l) => l.text), lang) : lines.map((l) => esc(l.text));
  let sel = null;
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; ov.onclick = null; };

  const rows = lines.map((l, idx) => {
    const info = infos[l.sha];
    const first = idx === 0 || lines[idx - 1].sha !== l.sha;
    const gutter = first
      ? `<span class="bh"${l.sha === NOT_COMMITTED ? ' data-i18n' : ''}>${l.sha === NOT_COMMITTED ? 'local' : l.sha.slice(0, 7)}</span><span class="ba"${l.sha === NOT_COMMITTED ? ' data-i18n' : ''}>${esc(l.sha === NOT_COMMITTED ? 'Not committed' : info.author || '')}</span><span class="bd">${info.time ? fmtDate(info.time) : ''}</span>`
      : '';
    return `<tr data-sha="${l.sha}" class="${first ? 'first' : ''}"><td class="bg" style="border-left-color:${blameColor(l.sha)}">${gutter}</td><td class="bn">${idx + 1}</td><td class="bc">${code[idx] || ' '}</td></tr>`;
  }).join('');

  ov.innerHTML = `<div class="modal fh">
    <div class="fh-head"><h3>Blame · ${esc(path)}${rev ? ` <small>@ ${rev.slice(0, 7)}</small>` : ''}</h3>
      <span class="fh-btns">${stack.length ? '<button id="bl-back">← Back</button>' : ''}<button id="fh-close">Close</button></span></div>
    <div class="bl-info" id="bl-info"><span class="dim">Click a line to see the commit that last changed it.</span></div>
    <div class="fh-body bl-body"><table class="blame">${rows}</table></div></div>`;
  ov.classList.remove('hidden');
  $('#fh-close').focus();

  const select = (sha) => {
    sel = sha;
    ov.querySelectorAll('.blame tr').forEach((r) => r.classList.toggle('hl', r.dataset.sha === sha));
    const info = infos[sha];
    const uncommitted = sha === NOT_COMMITTED;
    $('#bl-info').innerHTML = `<span><b>${esc(uncommitted ? 'Not committed yet' : info.summary || '')}</b>
      <span class="dim"> ${uncommitted ? '' : `${sha.slice(0, 7)} · ${esc(info.author || '')} · ${info.time ? new Date(info.time).toLocaleString(kgLocale()) : ''}`}</span></span>
      <span class="fh-btns">${uncommitted ? '' : '<button data-bl="log">Show in log</button>'}${info.previous ? '<button data-bl="prev">Blame previous version</button>' : ''}</span>`;
  };

  ov.onclick = (e) => {
    if (e.target.closest('#fh-close') || e.target === ov) return close();
    if (e.target.closest('#bl-back')) { const prev = stack[stack.length - 1]; return showBlame(prev.path, prev.rev, stack.slice(0, -1)); }
    const act = e.target.closest('[data-bl]');
    if (act && sel) {
      if (act.dataset.bl === 'log') { close(); return selectCommit(sel, true); }
      const p = infos[sel].previous;
      if (p) return showBlame(p.file, p.sha, [...stack, { path, rev }]);
    }
    const row = e.target.closest('.blame tr');
    if (row) select(row.dataset.sha);
  };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}
