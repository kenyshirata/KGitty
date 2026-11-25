// Applies the saved look (theme, accent colour, code font, row density) as early as possible so the UI never
// flashes the wrong colours. Loaded in <head>; the settings dialog lives in appearance.js.
(function () {
  var KEY = 'theme', AKEY = 'appearance';
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var root = document.documentElement;

  // Extra themes override a handful of CSS variables on top of the plain light or dark theme they are based on.
  var PALETTES = {
    dracula: { label: 'Dracula', base: 'dark', vars: { bg: '#282a36', bg2: '#21222c', bg3: '#343746', border: '#44475a', fg: '#f8f8f2', 'fg-strong': '#ffffff', dim: '#9aa0c3', accent: '#bd93f9', 'accent-bg': '#463a6e', 'on-accent': '#1e1f29', 'btn-hover': '#424559', 'hunk-bg': '#2f3350', 'hunk-fg': '#bd93f9', scroll: '#4a4d63', 'x-hover': '#5b5f7a' } },
    nord: { label: 'Nord', base: 'dark', vars: { bg: '#2e3440', bg2: '#272c36', bg3: '#3b4252', border: '#434c5e', fg: '#d8dee9', 'fg-strong': '#eceff4', dim: '#8f9bb3', accent: '#88c0d0', 'accent-bg': '#3f5a6a', 'on-accent': '#2e3440', 'btn-hover': '#434c5e', 'hunk-bg': '#2f3d4f', 'hunk-fg': '#88c0d0', scroll: '#4c566a', 'x-hover': '#5e6a82' } },
    onedark: { label: 'One Dark', base: 'dark', vars: { bg: '#282c34', bg2: '#21252b', bg3: '#2c313a', border: '#3e4451', fg: '#abb2bf', 'fg-strong': '#e6e9ef', dim: '#7f8896', accent: '#61afef', 'accent-bg': '#2c4a6b', 'on-accent': '#1b1f27', 'btn-hover': '#3a404c', 'hunk-bg': '#2a3548', 'hunk-fg': '#61afef', scroll: '#4b5263', 'x-hover': '#5c6370' } },
    monokai: { label: 'Monokai', base: 'dark', vars: { bg: '#272822', bg2: '#1f201b', bg3: '#33342c', border: '#49483e', fg: '#f8f8f2', 'fg-strong': '#ffffff', dim: '#9d9c8c', accent: '#a6e22e', 'accent-bg': '#43561d', 'on-accent': '#1b1c17', 'btn-hover': '#42433a', 'hunk-bg': '#2f3524', 'hunk-fg': '#a6e22e', scroll: '#55564a', 'x-hover': '#6b6c5e' } },
    solarizeddark: { label: 'Solarized Dark', base: 'dark', vars: { bg: '#002b36', bg2: '#073642', bg3: '#0d4351', border: '#1b505d', fg: '#93a1a1', 'fg-strong': '#eee8d5', dim: '#6f8a90', accent: '#268bd2', 'accent-bg': '#0b4f6e', 'on-accent': '#fdf6e3', 'btn-hover': '#14505f', 'hunk-bg': '#0a3a4a', 'hunk-fg': '#4aa5e0', scroll: '#1e5866', 'x-hover': '#2a6b7a' } },
    solarizedlight: { label: 'Solarized Light', base: 'light', vars: { bg: '#fdf6e3', bg2: '#f3ecd6', bg3: '#eae3cb', border: '#d9d2ba', fg: '#586e75', 'fg-strong': '#073642', dim: '#8a9a9a', accent: '#268bd2', 'accent-bg': '#cfe3ee', 'btn-hover': '#e0d9c1', 'hunk-bg': '#e4eef0', 'hunk-fg': '#1f6fa8', scroll: '#cfc8b0', 'x-hover': '#c4bda5' } },
    highcontrast: { label: 'High contrast', base: 'dark', vars: { bg: '#000000', bg2: '#0b0b0b', bg3: '#1c1c1c', border: '#8b949e', fg: '#ffffff', 'fg-strong': '#ffffff', dim: '#d0d7de', accent: '#71b7ff', 'accent-bg': '#0b3a75', 'on-accent': '#000000', 'btn-hover': '#2b2b2b', 'hunk-bg': '#0b2a4a', 'hunk-fg': '#9ccfff', scroll: '#6e7681', 'x-hover': '#8b949e', comment: '#c9d1d9' } },
  };

  var DEFAULTS = { accent: '', codeFont: '', codeSize: 12, ligatures: true, density: 'normal', dateFmt: 'absolute', columns: ['author', 'date', 'sha'], showRefs: true, zoom: 1, toolbarIcons: 'lines' };
  var DENSITY = { compact: 22, normal: 26, comfortable: 32 };
  var DEFAULT_CODE_FONT = 'Consolas, "Cascadia Mono", monospace';

  var applied = [];

  function stored() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function appearance() {
    var a = {};
    try { a = JSON.parse(localStorage.getItem(AKEY)) || {}; } catch (e) { /* ignore */ }
    var out = {};
    for (var k in DEFAULTS) out[k] = a[k] !== undefined ? a[k] : DEFAULTS[k];
    if (!Array.isArray(out.columns)) out.columns = DEFAULTS.columns.slice();
    return out;
  }

  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0;
    var n = parseInt(m[1], 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function setVar(name, value) { root.style.setProperty(name, value); applied.push(name); }

  function render() {
    var pref = stored(), pal = PALETTES[pref], ap = appearance();
    var base = pal ? pal.base : pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
    root.setAttribute('data-theme', base);
    applied.forEach(function (n) { root.style.removeProperty(n); });
    applied = [];
    if (pal) for (var k in pal.vars) setVar('--' + k, pal.vars[k]);
    if (ap.accent) {
      setVar('--accent', ap.accent);
      setVar('--accent-bg', 'color-mix(in srgb, ' + ap.accent + ' 38%, var(--bg))');
      setVar('--on-accent', luminance(ap.accent) > 0.45 ? '#111111' : '#ffffff');
    }
    var size = Math.min(20, Math.max(9, +ap.codeSize || 12));
    setVar('--code-font', ap.codeFont ? '"' + String(ap.codeFont).replace(/"/g, '') + '", ' + DEFAULT_CODE_FONT : DEFAULT_CODE_FONT);
    setVar('--code-size', size + 'px');
    var row = DENSITY[ap.density] || DENSITY.normal;
    setVar('--row', row + 'px');
    window.kgRow = row;
    root.style.fontVariantLigatures = ap.ligatures ? 'normal' : 'none';
    applied.push('font-variant-ligatures');
    var dark = document.getElementById('hl-dark'), light = document.getElementById('hl-light');
    if (dark && light) { dark.disabled = base !== 'dark'; light.disabled = base !== 'light'; }
    if (window.api && window.api.setThemeSource) window.api.setThemeSource(pal ? base : pref);
  }

  window.getThemePref = stored;
  window.setThemePref = function (pref) {
    try { localStorage.setItem(KEY, pref); } catch (e) { /* ignore */ }
    render();
  };
  window.kgGetAppearance = appearance;
  window.kgSetAppearance = function (patch) {
    var a = appearance();
    for (var k in patch) a[k] = patch[k];
    try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch (e) { /* ignore */ }
    render();
  };
  window.kgResetAppearance = function () {
    try { localStorage.removeItem(AKEY); } catch (e) { /* ignore */ }
    render();
  };
  window.KG_DEFAULT_CODE_FONT = DEFAULT_CODE_FONT;
  window.KG_DENSITY = DENSITY;
  // Swatches for the theme picker: [id, label, background, panel, text, accent]
  window.KG_THEMES = [
    ['system', 'System', '#1e1f22', '#ffffff', '#d7d9dd', '#4a8cf0'],
    ['light', 'Light', '#ffffff', '#f3f4f6', '#1f2328', '#0969da'],
    ['dark', 'Dark', '#1e1f22', '#25272b', '#d7d9dd', '#4a8cf0'],
  ].concat(Object.keys(PALETTES).map(function (id) { var v = PALETTES[id].vars; return [id, PALETTES[id].label, v.bg, v.bg2, v.fg, v.accent]; }));

  render();
  document.addEventListener('DOMContentLoaded', render);
  mq.addEventListener('change', function () { if (stored() === 'system') render(); });
})();
