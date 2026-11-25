'use strict';
// Icon packs for the toolbar buttons, chosen in Appearance ("Toolbar icons"). Every pack draws the same 15 icons;
// some are drawn here on a 20 × 20 grid, others come from open-source icon sets (toolbarsets.js); the choice is stored with the other appearance settings (theme.js) and applies immediately.

const TB_BUTTONS = {
  'tb-tabsview': 'tabs', 'tb-open': 'open', 'tb-clone': 'clone', 'tb-fetch': 'fetch', 'tb-pull': 'pull', 'tb-push': 'push',
  'tb-stash': 'stash', 'tb-undo': 'undo', 'tb-redo': 'redo', 'tb-reflog': 'reflog', 'tb-branch': 'branch',
  'tb-openin': 'openin', 'tb-console': 'console', 'tb-theme': 'theme', 'tb-ws': 'ws',
};

// Outline drawings (the "Lines" pack); "Colourful" reuses them.
const TB_LINES = {
  tabs: '<rect x="2.75" y="3.5" width="14.5" height="13" rx="1.5"/><path d="M7.5 3.5v13M4.5 7h1.25M4.5 9.5h1.25M4.5 12h1.25"/>',
  open: '<path d="M2.75 6V4.75c0-.83.67-1.5 1.5-1.5h3.5l1.75 2h6.25c.83 0 1.5.67 1.5 1.5V8"/><path d="M2.75 15.5 4.6 8.9c.18-.6.73-1.03 1.36-1.03h11.1c.66 0 1.13.64.94 1.27l-1.7 5.6c-.18.6-.73 1.01-1.36 1.01H3.75z"/>',
  clone: '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.75c0-.83-.67-1.5-1.5-1.5H4.75c-.83 0-1.5.67-1.5 1.5V12c0 .83.67 1.5 1.5 1.5H6.5"/>',
  fetch: '<path d="M15.5 9.5a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.5 2.75v3.25h-3.25"/>',
  pull: '<path d="M10 3v10M5.75 8.75 10 13l4.25-4.25M4 16.75h12"/>',
  push: '<path d="M10 14V4M5.75 8.25 10 4l4.25 4.25M4 16.75h12"/>',
  stash: '<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 10h14M8 6.5h4M8 13.5h4"/>',
  undo: '<path d="M7 5 3.5 8.5 7 12"/><path d="M3.75 8.5H12a4.25 4.25 0 0 1 0 8.5H9"/>',
  redo: '<path d="m13 5 3.5 3.5L13 12"/><path d="M16.25 8.5H8a4.25 4.25 0 0 0 0 8.5h3"/>',
  reflog: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.75 1.75"/>',
  branch: '<circle cx="6" cy="4.5" r="2"/><circle cx="6" cy="15.5" r="2"/><circle cx="14.5" cy="7" r="2"/><path d="M6 6.5v7M14.5 9c0 3-2.5 3.75-8.5 4.5"/><path d="M16.5 14.5h-4M14.5 12.5v4"/>',
  openin: '<path d="M11 3.5h5.5V9M16.25 3.75 9.5 10.5"/><path d="M14.5 12v3.25c0 .83-.67 1.5-1.5 1.5H4.75c-.83 0-1.5-.67-1.5-1.5V7c0-.83.67-1.5 1.5-1.5H8"/>',
  console: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="m5.75 8 2.5 2-2.5 2M10.5 12.5h3.75"/>',
  theme: '<circle cx="10" cy="10" r="7"/><path d="M10 3v14a7 7 0 0 0 0-14z" fill="currentColor"/>',
  ws: '<rect x="2.5" y="5.5" width="11" height="9" rx="1.25"/><path d="M6.5 5.5V4.25c0-.69.56-1.25 1.25-1.25h8c.69 0 1.25.56 1.25 1.25v7.5c0 .69-.56 1.25-1.25 1.25H13.5"/>',
};

// Filled drawings ("Solid"); details are cut out with the toolbar background colour.
const CUT = 'var(--bg2)';
const TB_SOLID = {
  tabs: `<rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="currentColor" stroke="none"/><path d="M7.5 4v12" stroke="${CUT}" stroke-width="1.6"/><path d="M4.4 7h1.2M4.4 9.5h1.2M4.4 12h1.2" stroke="${CUT}" stroke-width="1.4"/>`,
  open: `<path d="M2.5 5c0-.97.78-1.75 1.75-1.75h3.6l1.75 2h6.15c.97 0 1.75.78 1.75 1.75v8c0 .97-.78 1.75-1.75 1.75H4.25c-.97 0-1.75-.78-1.75-1.75z" fill="currentColor" stroke="none"/><path d="M2.75 8.25h14.5" stroke="${CUT}" stroke-width="1.4"/>`,
  clone: '<path d="M13.5 5.5V4.75c0-.83-.67-1.5-1.5-1.5H4.75c-.83 0-1.5.67-1.5 1.5V12c0 .83.67 1.5 1.5 1.5h.75" stroke-width="1.8"/><rect x="6" y="6" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  fetch: `<circle cx="10" cy="10" r="7.5" fill="currentColor" stroke="none"/><path d="M13.25 9.75a3.25 3.25 0 1 1-.95-2.3" stroke="${CUT}" stroke-width="1.6"/><path d="M12.75 5.5v2.25H10.5" stroke="${CUT}" stroke-width="1.6"/>`,
  pull: `<circle cx="10" cy="10" r="7.5" fill="currentColor" stroke="none"/><path d="M10 5.75v7.5M7 10.5l3 3 3-3" stroke="${CUT}" stroke-width="1.8"/>`,
  push: `<circle cx="10" cy="10" r="7.5" fill="currentColor" stroke="none"/><path d="M10 14.25v-7.5M7 9.5l3-3 3 3" stroke="${CUT}" stroke-width="1.8"/>`,
  stash: `<rect x="2.5" y="3" width="15" height="14" rx="2" fill="currentColor" stroke="none"/><path d="M2.5 10h15" stroke="${CUT}" stroke-width="1.5"/><path d="M8 6.5h4M8 13.5h4" stroke="${CUT}" stroke-width="1.6"/>`,
  undo: '<path d="M7 4.5 3 8.5l4 4" stroke-width="2.4"/><path d="M3.5 8.5H12a4.25 4.25 0 0 1 0 8.5H9" stroke-width="2.4"/>',
  redo: '<path d="m13 4.5 4 4-4 4" stroke-width="2.4"/><path d="M16.5 8.5H8a4.25 4.25 0 0 0 0 8.5h3" stroke-width="2.4"/>',
  reflog: `<circle cx="10" cy="10" r="7.5" fill="currentColor" stroke="none"/><path d="M10 6v4.25l2.75 1.75" stroke="${CUT}" stroke-width="1.7"/>`,
  branch: '<path d="M6 6.5v7M14.5 9c0 3-2.5 3.75-8.5 4.5" stroke-width="2.2"/><g fill="currentColor" stroke="none"><circle cx="6" cy="4.5" r="2.6"/><circle cx="6" cy="15.5" r="2.6"/><circle cx="14.5" cy="7" r="2.6"/></g>',
  openin: `<rect x="2.75" y="5.25" width="11.75" height="11.75" rx="2" fill="currentColor" stroke="none"/><path d="M11 3h6v6" stroke-width="2"/><path d="M16.75 3.25 9 11" stroke="${CUT}" stroke-width="3.2"/><path d="M16.75 3.25 9 11" stroke-width="1.8"/>`,
  console: `<rect x="2" y="3.5" width="16" height="13" rx="2" fill="currentColor" stroke="none"/><path d="m5.75 8 2.5 2-2.5 2M10.5 12.5h3.75" stroke="${CUT}" stroke-width="1.6"/>`,
  theme: `<circle cx="10" cy="10" r="7.5" fill="currentColor" stroke="none"/><path d="M10 4.5a5.5 5.5 0 0 0 0 11z" fill="${CUT}" stroke="none"/>`,
  ws: '<rect x="6" y="2.75" width="11.5" height="9.5" rx="1.5" stroke-width="1.8"/><rect x="2.5" y="6" width="11.5" height="9.5" rx="1.5" fill="currentColor" stroke="none"/>',
};

const TB_COLORS = {
  tabs: '#8b9cf6', open: '#f5b942', clone: '#60a5fa', fetch: '#38bdf8', pull: '#4ade80', push: '#fb923c', stash: '#c084fc',
  undo: '#f87171', redo: '#f87171', reflog: '#fbbf24', branch: '#34d399', openin: '#60a5fa', console: '#a3e635', theme: '#f472b6', ws: '#93c5fd',
};

const TB_GLYPHS = {
  tabs: '▥', open: '📂', clone: '⎘', fetch: '⟳', pull: '⇣', push: '⇡', stash: '▤', undo: '↶', redo: '↷', reflog: '⟲',
  branch: '⑂', openin: '↗', console: '>_', theme: '◐', ws: '▣',
};

const tbSvg = (body, width = 1.5) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// id -> [label, draw(key) -> { html, color }]
const TB_PACKS = {
  lines: ['Lines', (k) => ({ html: tbSvg(TB_LINES[k]) })],
  octicons: ['GitHub (Octicons)', (k) => ({ html: TB_SETS.octicons[k] })],
  phosphorFill: ['Phosphor', (k) => ({ html: TB_SETS.phosphorFill[k] })],
  phosphorDuo: ['Phosphor duotone', (k) => ({ html: TB_SETS.phosphorDuo[k] })],
  material: ['Material', (k) => ({ html: TB_SETS.material[k] })],
  tabler: ['Tabler', (k) => ({ html: TB_SETS.tabler[k] })],
  solid: ['Solid', (k) => ({ html: tbSvg(TB_SOLID[k]) })],
  colorful: ['Colourful', (k) => ({ html: tbSvg(TB_LINES[k], 1.7), color: TB_COLORS[k] })],
  classic: ['Classic', (k) => ({ html: `<span class="tb-glyph">${esc(TB_GLYPHS[k])}</span>` })],
};

const toolbarPack = () => (TB_PACKS[kgGetAppearance().toolbarIcons] ? kgGetAppearance().toolbarIcons : 'lines');

function applyToolbarIcons() {
  const draw = TB_PACKS[toolbarPack()][1];
  for (const [id, key] of Object.entries(TB_BUTTONS)) {
    const ico = document.querySelector(`#${id} .tb-ico`);
    if (!ico) continue;
    const { html, color } = draw(key);
    ico.innerHTML = html;
    ico.style.color = color || '';
  }
}

// A small preview of a pack for the Appearance settings.
function toolbarPackPreview(id) {
  const draw = TB_PACKS[id][1];
  return ['fetch', 'pull', 'push', 'stash', 'branch'].map((k) => {
    const { html, color } = draw(k);
    return `<span class="tbp-ico"${color ? ` style="color:${color}"` : ''}>${html}</span>`;
  }).join('');
}

applyToolbarIcons();
