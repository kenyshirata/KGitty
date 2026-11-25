'use strict';
// Appearance settings: theme, accent colour, interface zoom, code font, row density and the columns of the commit
// list. Every change applies immediately and is remembered. The values themselves live in theme.js.

const ACCENTS = ['#4a8cf0', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6'];
const LOG_COLUMN_NAMES = { author: 'Author', date: 'Date', sha: 'Hash' };
const CODE_FONTS = ['Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Consolas', 'Courier New', 'Lucida Console', 'Menlo', 'Monaco', 'SF Mono'];

function setAppearance(patch) {
  kgSetAppearance(patch);
  ROW = window.kgRow;
  if ('zoom' in patch) window.api.setZoom(patch.zoom);
  if (state.repo) renderList();
}

function zoomBy(delta) {
  const z = Math.min(2, Math.max(0.6, Math.round((kgGetAppearance().zoom + delta) * 10) / 10));
  setAppearance({ zoom: z });
  if (state.repo) setStatus('Zoom ' + Math.round(z * 100) + '%');
}

window.api.setZoom(kgGetAppearance().zoom);

// The appearance controls, shared by the Appearance dialog (View › Appearance…) and the Appearance tab of
// Preferences. appearanceHtml() builds them; wireAppearance() makes them work inside `root` and calls
// `afterReset` once "Reset appearance" has run, so the caller can draw them again.
function appearanceHtml() {
  const ap0 = kgGetAppearance();
  return `<div class="ap-sec"><div class="sb-head">Theme</div><div class="ap-themes" data-ap="themes"></div></div>
    <div class="ap-sec"><div class="sb-head">Accent colour</div><div class="ap-accent" data-ap="accent"></div></div>
    <div class="ap-sec"><div class="sb-head">Text and density</div>
      <div class="ap-grid">
        <label>Interface zoom</label><span class="ap-range"><input type="range" id="ap-zoom" min="60" max="200" step="10" value="${Math.round(ap0.zoom * 100)}"><b id="ap-zoomv">${Math.round(ap0.zoom * 100)}%</b></span>
        <label>Code font</label><input type="text" id="ap-font" list="ap-fonts" value="${esc(ap0.codeFont)}" placeholder="Default (Consolas)" spellcheck="false"><datalist id="ap-fonts">${CODE_FONTS.map((f) => `<option value="${f}">`).join('')}</datalist>
        <label>Code size</label><span class="ap-range"><input type="number" id="ap-size" min="9" max="20" value="${ap0.codeSize}" style="width:70px"> px <label class="cl-opt" style="margin:0 0 0 14px"><input type="checkbox" id="ap-liga" ${ap0.ligatures ? 'checked' : ''}> Font ligatures</label></span>
        <label>Row density</label><select id="ap-density">${[['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']].map(([v, l]) => `<option value="${v}" ${ap0.density === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <pre class="ap-prev">const same = (a, b) => a !== b &amp;&amp; a &gt;= b; // =&gt; != &gt;=  0O 1lI</pre>
      <p class="hint">The font has to be installed on this computer; if it is not, the default is used.</p>
    </div>
    <div class="ap-sec"><div class="sb-head">Commit list</div>
      <div class="ap-grid">
        <label>Columns</label><div class="ap-cols" data-ap="cols"></div>
        <label>Date format</label><select id="ap-datefmt"><option value="absolute" ${ap0.dateFmt === 'absolute' ? 'selected' : ''}>Absolute (06 Oct 2026)</option><option value="relative" ${ap0.dateFmt === 'relative' ? 'selected' : ''}>Relative (3 days ago)</option></select>
        <label>Show</label><span><label class="cl-opt" style="display:inline;margin-right:16px"><input type="checkbox" id="ap-refs" ${ap0.showRefs ? 'checked' : ''}> Branch and tag badges</label><label class="cl-opt" style="display:inline;margin-right:16px"><input type="checkbox" id="ap-avatars" ${avOpts.show ? 'checked' : ''}> Author avatars</label><label class="cl-opt" style="display:inline" title="Sends a SHA-256 hash of each author's e-mail address to gravatar.com"><input type="checkbox" id="ap-gravatar" ${avOpts.gravatar ? 'checked' : ''}> Photos from Gravatar</label></span>
      </div>
    </div>
    <div class="ap-sec"><div class="sb-head">Panels</div>
      <p class="hint">Drag the borders between the sidebar, the commit list and the file list to resize them; double-click a border to reset it.</p>
      <button id="ap-layout">Reset panel sizes</button> <button id="ap-reset" class="danger">Reset appearance</button></div>`;
}

function wireAppearance(root, afterReset) {
  const part = (k) => root.querySelector(`[data-ap="${k}"]`);

  const themesHtml = () => {
    const cur = getThemePref();
    return KG_THEMES.map(([id, label, bg, panel, fg, accent]) =>
      `<button class="ap-theme ${id === cur ? 'sel' : ''}" data-theme="${id}" style="--b:${id === 'system' ? 'linear-gradient(90deg,#ffffff 50%,#1e1f22 50%)' : bg};--p:${panel};--f:${fg};--a:${accent}">
        <span class="ap-sw"><i></i><i></i><i></i></span><span>${esc(label)}</span></button>`).join('');
  };

  const accentHtml = () => {
    const cur = kgGetAppearance().accent;
    return `<button class="ap-def ${cur ? '' : 'sel'}" data-accent="">Theme default</button>` +
      ACCENTS.map((c) => `<button class="ap-dot ${cur.toLowerCase() === c ? 'sel' : ''}" data-accent="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      `<label class="ap-custom" title="Pick any colour"><input type="color" id="ap-color" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#4a8cf0'}"> Custom</label>`;
  };

  const columnsHtml = () => {
    const vis = kgGetAppearance().columns.filter((k) => LOG_COLUMN_NAMES[k]);
    const hidden = Object.keys(LOG_COLUMN_NAMES).filter((k) => !vis.includes(k));
    return [...vis.map((k, i) => `<div class="ap-col"><label><input type="checkbox" data-col="${k}" checked> ${LOG_COLUMN_NAMES[k]}</label>
        <span><button data-move="${k}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move left">▲</button><button data-move="${k}" data-d="1" ${i === vis.length - 1 ? 'disabled' : ''} title="Move right">▼</button></span></div>`),
      ...hidden.map((k) => `<div class="ap-col dim"><label><input type="checkbox" data-col="${k}"> ${LOG_COLUMN_NAMES[k]}</label></div>`)].join('');
  };

  const redrawParts = () => {
    part('themes').innerHTML = themesHtml();
    part('accent').innerHTML = accentHtml();
    part('cols').innerHTML = columnsHtml();
  };
  redrawParts();

  root.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'ap-zoom') root.querySelector('#ap-zoomv').textContent = e.target.value + '%';
    else if (id === 'ap-font') setAppearance({ codeFont: e.target.value.trim() });
    else if (id === 'ap-size') { const n = +e.target.value; if (n >= 9 && n <= 20) setAppearance({ codeSize: n }); }
    else if (id === 'ap-color') { setAppearance({ accent: e.target.value }); part('accent').innerHTML = accentHtml(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'ap-zoom') setAppearance({ zoom: +t.value / 100 });
    else if (t.id === 'ap-liga') setAppearance({ ligatures: t.checked });
    else if (t.id === 'ap-density') setAppearance({ density: t.value });
    else if (t.id === 'ap-datefmt') setAppearance({ dateFmt: t.value });
    else if (t.id === 'ap-refs') setAppearance({ showRefs: t.checked });
    else if (t.id === 'ap-avatars') { if (t.checked !== avOpts.show) toggleAvatars(); }
    else if (t.id === 'ap-gravatar') { if (t.checked !== avOpts.gravatar) setGravatar(t.checked); }
    else if (t.dataset.col) {
      const cols = kgGetAppearance().columns.filter((k) => LOG_COLUMN_NAMES[k]);
      setAppearance({ columns: t.checked ? [...cols, t.dataset.col] : cols.filter((k) => k !== t.dataset.col) });
      part('cols').innerHTML = columnsHtml();
    }
  });
  root.addEventListener('click', (e) => {
    const th = e.target.closest('.ap-theme[data-theme]');
    if (th) { setThemePref(th.dataset.theme); return redrawParts(); }
    const ac = e.target.closest('button[data-accent]');
    if (ac) { setAppearance({ accent: ac.dataset.accent }); part('accent').innerHTML = accentHtml(); return; }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const cols = kgGetAppearance().columns.filter((k) => LOG_COLUMN_NAMES[k]);
      const i = cols.indexOf(mv.dataset.move), j = i + +mv.dataset.d;
      if (i >= 0 && j >= 0 && j < cols.length) { [cols[i], cols[j]] = [cols[j], cols[i]]; setAppearance({ columns: cols }); part('cols').innerHTML = columnsHtml(); }
      return;
    }
    if (e.target.closest('#ap-layout')) return resetLayoutSizes();
    if (e.target.closest('#ap-reset')) {
      kgResetAppearance();
      setThemePref('system');
      ROW = window.kgRow;
      window.api.setZoom(1);
      resetLayoutSizes();
      if (state.repo) renderList();
      afterReset();
    }
  });
}

function appearanceDialog() {
  const ov = $('#overlay');
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onkeydown = null; };
  ov.innerHTML = `<div class="modal wide ap"><h3>Appearance <small class="dim">changes apply immediately</small></h3>
    <div id="ap-root">${appearanceHtml()}</div>
    <div class="btns"><button class="primary" id="ap-close">Close</button></div></div>`;
  ov.classList.remove('hidden');
  wireAppearance($('#ap-root'), () => { close(); appearanceDialog(); });
  ov.onclick = (e) => { if (e.target.closest('#ap-close') || e.target === ov) close(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}
