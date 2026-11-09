// Applies the saved theme (system / light / dark) as early as possible so the UI never flashes the wrong colours.
(function () {
  var KEY = 'theme';
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function apply(pref) {
    var theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
    document.documentElement.setAttribute('data-theme', theme);
    var dark = document.getElementById('hl-dark'), light = document.getElementById('hl-light');
    if (dark && light) { dark.disabled = theme !== 'dark'; light.disabled = theme !== 'light'; }
    if (window.api && window.api.setThemeSource) window.api.setThemeSource(pref);
  }

  window.getThemePref = stored;
  window.setThemePref = function (pref) {
    try { localStorage.setItem(KEY, pref); } catch (e) { /* ignore */ }
    apply(pref);
  };

  apply(stored());
  document.addEventListener('DOMContentLoaded', function () { apply(stored()); });
  mq.addEventListener('change', function () { if (stored() === 'system') apply('system'); });
})();
