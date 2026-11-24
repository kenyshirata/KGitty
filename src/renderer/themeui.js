'use strict';
// Theme picker: a menu on the toolbar (and welcome screen) plus a shortcut to cycle through the themes.

const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

function themeMenu(e) {
  const cur = getThemePref();
  const r = e.currentTarget.getBoundingClientRect();
  const tick = (on) => (on ? '✓ ' : '\u00a0\u00a0\u00a0 ');
  ctxMenu(r.left, r.bottom + 4, [
    ...KG_THEMES.slice(0, 3).map(([v, label]) => ({ label: tick(v === cur) + label, action: () => setThemePref(v) })),
    '-',
    ...KG_THEMES.slice(3).map(([v, label]) => ({ label: tick(v === cur) + label, action: () => setThemePref(v) })),
    '-',
    { label: '    Appearance…', action: appearanceDialog },
    '-',
    { label: tick(avOpts.show) + 'Show author avatars', action: toggleAvatars },
    { label: tick(avOpts.gravatar) + 'Load photos from Gravatar', action: toggleGravatar },
  ]);
}

function cycleTheme() {
  const i = THEMES.findIndex(([v]) => v === getThemePref());
  const [v, label] = THEMES[(i + 1) % THEMES.length];
  setThemePref(v);
  if (state.repo) setStatus('Theme: ' + label);
}

$('#tb-theme').onclick = themeMenu;
$('#btn-theme').onclick = themeMenu;
