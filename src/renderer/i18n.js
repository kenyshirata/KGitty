// Interface translation. The app is written in English; this layer swaps every piece of interface text for its
// translation (src/renderer/lang/*.js, generated from i18n/translations.tsv) as it appears on screen, so no
// feature needs to know about languages. Text that comes from the repository — commit messages, branch and file
// names, diffs, git's own output — is never translated.
//
// A table maps an English phrase to its translation. A phrase may contain placeholders, {0}, {1}, … ; {0:t}
// marks a placeholder whose value is itself interface text (for example "Commit" in "{0} — done").
(function () {
  'use strict';

  var LANGS = {};
  var cur = null; // active language object, null = English
  var curCode = 'en';
  var cache = new Map();
  var textMap = new WeakMap(); // text node -> { orig, out }
  var attrMap = new WeakMap(); // element -> { attribute: { orig, out } }
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  var KEY = 'lang';

  // Parts of the screen that show repository data, never translated (including everything inside them).
  var DEEP = 'script,style,[data-no-i18n],.crow,pre,code,textarea,kbd,table.split,table.blame,table.codeview,.cbody,.ci-subject,.cinfo .subject,.fh-row,.rb-sub,.bd-name,.rm-name,.rm-path,.tname,#repo-title,.frow .name,.drow .dname,.drow .name,.badge,.ci-sha,#tabs';
  // Elements whose own text is repository data (but whose child elements are interface text).
  var SHALLOW = '.sb-item[data-kind]';

  var skipped = function (el) { return !!el && (el.closest(DEEP) || el.matches(SHALLOW)); };

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function compile(table) {
    var exact = new Map(), templates = [];
    Object.keys(table).forEach(function (k) {
      var v = table[k];
      if (!/\{\d(:t)?\}/.test(k)) { exact.set(k, v); return; }
      var flags = {}, literal = 0, src = '^';
      k.split(/(\{\d(?::t)?\})/).forEach(function (part) {
        var m = /^\{(\d)(:t)?\}$/.exec(part);
        if (m) { src += '(.+?)'; if (m[2]) flags[m[1]] = true; } else { src += escRe(part); literal += part.length; }
      });
      templates.push({ re: new RegExp(src + '$'), out: v, flags: flags, literal: literal });
    });
    templates.sort(function (a, b) { return b.literal - a.literal; });
    return { exact: exact, templates: templates };
  }

  function tr(core, depth) {
    var hit = cur.exact.get(core);
    if (hit !== undefined) return hit;
    if (depth > 3 || !/[A-Za-z]{2}/.test(core)) return core;
    for (var i = 0; i < cur.templates.length; i++) {
      var t = cur.templates[i], m = t.re.exec(core);
      if (m) return t.out.replace(/\{(\d)\}/g, function (_, n) { var v = m[+n + 1]; return t.flags[n] ? tr(v, depth + 1) : v; });
    }
    return core;
  }

  function translate(text) {
    if (!cur) return text;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    var core = m[2].replace(/\s+/g, ' ');
    if (!core) return text;
    var out = cache.get(core);
    if (out === undefined) {
      out = tr(core, 0);
      if (cache.size > 6000) cache.clear();
      cache.set(core, out);
    }
    return out === core ? text : m[1] + out + m[3];
  }

  function applyText(node) {
    var e = textMap.get(node);
    var orig = e && node.data === e.out ? e.orig : node.data;
    var out = translate(orig);
    if (out === orig) { if (e) { if (node.data !== orig) node.data = orig; textMap.delete(node); } return; }
    if (node.data !== out) node.data = out;
    textMap.set(node, { orig: orig, out: out });
  }

  function applyAttr(el, name) {
    if (!el.hasAttribute(name)) return;
    var rec = attrMap.get(el);
    if (!rec) { rec = {}; attrMap.set(el, rec); }
    var e = rec[name], now = el.getAttribute(name);
    var orig = e && now === e.out ? e.orig : now;
    var out = translate(orig);
    if (out === orig) { if (e) { if (now !== orig) el.setAttribute(name, orig); delete rec[name]; } return; }
    if (now !== out) el.setAttribute(name, out);
    rec[name] = { orig: orig, out: out };
  }

  function applyElementAttrs(el) { for (var i = 0; i < ATTRS.length; i++) applyAttr(el, ATTRS[i]); }

  // Translates (or restores) a whole subtree. Parts showing repository data are skipped.
  function applyTree(root) {
    if (root.nodeType === 3) { if (!skipped(root.parentElement)) applyText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.tagName === 'TEXTAREA') applyElementAttrs(root);
    if (!root.closest(DEEP)) {
      var w = document.createTreeWalker(root, 5, { acceptNode: function (n) {
        if (n.nodeType === 1) { if (!n.matches(DEEP)) return 1; if (n.tagName === 'TEXTAREA') applyElementAttrs(n); return 2; } // 2 = reject the subtree
        return n.parentElement && n.parentElement.matches(SHALLOW) ? 3 : 1;
      } });
      if (root.matches && !root.matches(DEEP)) applyElementAttrs(root);
      for (var n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) applyText(n); else applyElementAttrs(n); }
    }
    // Interface text inside a data area (for example "Not committed" in the blame table) opts back in.
    var opt = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
    for (var i = 0; i < opt.length; i++) for (var c = opt[i].firstChild; c; c = c.nextSibling) if (c.nodeType === 3) applyText(c);
  }

  var observer = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) applyTree(m.addedNodes[j]); }
      else if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) applyText(m.target); }
      else if (m.type === 'attributes') { if (m.target.tagName === 'TEXTAREA' || !skipped(m.target)) applyAttr(m.target, m.attributeName); }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  function retranslateAll() {
    cache.clear();
    // Restore English first so a switch between two languages always starts from the original text.
    var w = document.createTreeWalker(document.documentElement, 5);
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) { var e = textMap.get(n); if (e) { if (n.data === e.out) n.data = e.orig; textMap.delete(n); } }
      else { var rec = attrMap.get(n); if (rec) { for (var a in rec) if (n.getAttribute(a) === rec[a].out) n.setAttribute(a, rec[a].orig); attrMap.delete(n); } }
    }
    if (cur) applyTree(document.documentElement);
  }

  function systemLang() {
    var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < prefs.length; i++) {
      var p = String(prefs[i]).toLowerCase();
      var codes = Object.keys(LANGS);
      for (var j = 0; j < codes.length; j++) if (codes[j].toLowerCase() === p) return codes[j];
      for (var k = 0; k < codes.length; k++) if (codes[k].toLowerCase().split('-')[0] === p.split('-')[0]) return codes[k];
      if (p.split('-')[0] === 'en') return 'en';
    }
    return 'en';
  }

  function activate(pref) {
    var code = pref || systemLang();
    var lang = code === 'en' ? null : LANGS[code];
    if (code !== 'en' && !lang) code = 'en';
    if (lang && !lang.compiled) lang.compiled = compile(lang.table);
    cur = lang ? lang.compiled : null;
    curCode = code;
    document.documentElement.lang = code;
    retranslateAll();
  }

  function stored() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  window.kgLang = function (code, name, table) { LANGS[code] = { name: name, table: table }; };
  window.kgLanguages = function () { return [['en', 'English']].concat(Object.keys(LANGS).map(function (c) { return [c, LANGS[c].name]; })); };
  window.kgLanguagePref = stored; // '' = follow the system
  window.kgCurrentLang = function () { return curCode; };
  window.kgLocale = function () { return curCode === 'en' ? 'en-US' : curCode; };
  window.kgSetLanguage = function (pref) {
    try { if (pref) localStorage.setItem(KEY, pref); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    activate(pref);
  };
  window.t = translate;

  // The language files are loaded after this script and before the page is built.
  document.addEventListener('DOMContentLoaded', function () { activate(stored()); });
  window.addEventListener('languagechange', function () { if (!stored()) activate(''); });
})();
