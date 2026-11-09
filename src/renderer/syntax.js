'use strict';
// Syntax highlighting for diffs, built on the vendored highlight.js.

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp', php: 'php', swift: 'swift', lua: 'lua',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell', bat: 'dos', cmd: 'dos',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', sql: 'sql',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', csproj: 'xml', props: 'xml', xaml: 'xml', vue: 'xml',
  css: 'css', scss: 'scss', less: 'less', r: 'r', pl: 'perl', m: 'objectivec', gradle: 'groovy', diff: 'diff',
};

function langFor(path) {
  const base = path.split('/').pop().toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  const lang = EXT_LANG[ext] || ext;
  return lang && window.hljs && hljs.getLanguage(lang) ? lang : null;
}

// Splits highlighted HTML into per-line strings, closing and reopening spans across line breaks.
function splitHighlighted(html) {
  const lines = [];
  const open = [];
  let cur = '';
  for (const tok of html.split(/(<\/?span[^>]*>|\n)/)) {
    if (tok === '\n') {
      lines.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
    } else {
      if (tok.startsWith('<span')) open.push(tok);
      else if (tok === '</span>') open.pop();
      cur += tok;
    }
  }
  lines.push(cur + '</span>'.repeat(open.length));
  return lines;
}

function highlightLines(textLines, lang) {
  if (!lang || !textLines.length) return textLines.map(esc);
  try {
    return splitHighlighted(hljs.highlight(textLines.join('\n'), { language: lang, ignoreIllegals: true }).value);
  } catch {
    return textLines.map(esc);
  }
}

// Highlights the old side (context + removed) and new side (context + added) of a hunk separately so
// multi-line constructs stay intact. Returns html per hunk line, indexed like the hunk array.
function highlightHunk(h, lang) {
  const out = new Array(h.length).fill(null);
  if (!lang) return out;
  const oldL = [], newL = [], oldAt = {}, newAt = {};
  for (let k = 1; k < h.length; k++) {
    const c = h[k][0], text = h[k].slice(1);
    if (c === '\\') continue;
    if (c !== '+') { oldAt[k] = oldL.length; oldL.push(text); }
    if (c !== '-') { newAt[k] = newL.length; newL.push(text); }
  }
  const o = highlightLines(oldL, lang), n = highlightLines(newL, lang);
  for (let k = 1; k < h.length; k++) {
    const c = h[k][0];
    if (c === '\\') continue;
    out[k] = c === '-' ? o[oldAt[k]] : n[newAt[k]];
  }
  return out;
}

/* ---------- intra-line (word) diff ---------- */

const WORD_RE = /\w+|\s+|[^\w\s]/g;

// Character ranges ([start, end)) that differ between two lines, or null when they are too unlike
// for word highlighting to help (it would just light up the whole line).
function wordDiff(a, b) {
  const ta = a.match(WORD_RE) || [], tb = b.match(WORD_RE) || [];
  if (!ta.length || !tb.length || ta.length > 400 || tb.length > 400) return null;
  const n = ta.length, m = tb.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ra = [], rb = [];
  let i = 0, j = 0, pa = 0, pb = 0, same = 0;
  const push = (arr, s, e) => { if (arr.length && arr[arr.length - 1][1] === s) arr[arr.length - 1][1] = e; else arr.push([s, e]); };
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { same += ta[i].length; pa += ta[i].length; pb += tb[j].length; i++; j++; }
    else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) { push(ra, pa, pa + ta[i].length); pa += ta[i++].length; }
    else { push(rb, pb, pb + tb[j].length); pb += tb[j++].length; }
  }
  if (same < Math.max(a.length, b.length) * 0.4) return null;
  return { a: ra, b: rb };
}

// For one hunk, maps hunk-line index -> changed ranges, pairing each run of '-' lines with the '+' run after it.
function hunkWordRanges(h) {
  const out = {};
  let k = 1;
  while (k < h.length) {
    if (h[k][0] !== '-') { k++; continue; }
    const dels = [], adds = [];
    while (k < h.length && h[k][0] === '-') dels.push(k++);
    while (k < h.length && h[k][0] === '+') adds.push(k++);
    for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
      const d = wordDiff(h[dels[p]].slice(1), h[adds[p]].slice(1));
      if (d) { out[dels[p]] = d.a; out[adds[p]] = d.b; }
    }
  }
  return out;
}

// Wraps the given text ranges in <mark> inside (possibly syntax-highlighted) HTML, leaving tags and entities intact.
function markRanges(html, ranges) {
  if (!ranges || !ranges.length) return html;
  let out = '', pos = 0, ri = 0;
  for (const [, tag, entity, text] of html.matchAll(/(<[^>]+>)|(&(?:#\d+|#x[0-9a-f]+|\w+);)|([^<&]+|&)/gi)) {
    if (tag) { out += tag; continue; }
    const chunk = entity || text, len = entity ? 1 : chunk.length;
    if (entity) {
      while (ri < ranges.length && ranges[ri][1] <= pos) ri++;
      out += ri < ranges.length && ranges[ri][0] <= pos ? `<mark class="wd">${chunk}</mark>` : chunk;
    } else {
      let i = 0;
      while (i < len) {
        while (ri < ranges.length && ranges[ri][1] <= pos + i) ri++;
        const r = ranges[ri];
        if (!r || r[0] >= pos + len) { out += chunk.slice(i); break; }
        if (r[0] > pos + i) { const n = r[0] - pos - i; out += chunk.slice(i, i + n); i += n; continue; }
        const n = Math.min(r[1] - pos - i, len - i);
        out += `<mark class="wd">${chunk.slice(i, i + n)}</mark>`;
        i += n;
      }
    }
    pos += len;
  }
  return out;
}
