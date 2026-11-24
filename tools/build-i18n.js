// Builds src/renderer/lang/<code>.js from the translation tables in i18n/*.tsv.
// Each row: the English text, then one translation per language in the order of LANGS below.
// Placeholders such as {0} must appear in every translation of a row; {0:t} in the English text marks a
// placeholder whose value is itself interface text. Run it with `npm run i18n`.
const fs = require('fs');
const path = require('path');

const LANGS = [
  ['pt-BR', 'Português (Brasil)'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['ru', 'Русский'],
  ['zh-CN', '简体中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
];

const root = path.join(__dirname, '..');
const dir = path.join(root, 'i18n');
const outDir = path.join(root, 'src', 'renderer', 'lang');
const tables = LANGS.map(() => ({}));
const seen = new Map();
const problems = [];

const slots = (s) => [...new Set([...s.matchAll(/\{(\d)(?::t)?\}/g)].map((m) => m[1]))].sort().join(',');

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
  fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cols = line.split('\t');
    const where = `${file}:${i + 1}`;
    if (cols.length !== LANGS.length + 1) return problems.push(`${where}: expected ${LANGS.length + 1} columns, found ${cols.length} (${cols[0]})`);
    const key = cols[0];
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.cols.slice(1).join('\t') !== cols.slice(1).join('\t')) problems.push(`${where}: "${key}" is already defined in ${prev.where} with other translations (first one kept)`);
      return;
    }
    seen.set(key, { where, cols });
    cols.slice(1).forEach((v, n) => {
      if (!v.trim()) return problems.push(`${where}: empty ${LANGS[n][0]} translation for "${key}"`);
      if (slots(key) !== slots(v)) problems.push(`${where}: ${LANGS[n][0]} placeholders differ for "${key}"`);
      tables[n][key] = v;
    });
  });
}

fs.mkdirSync(outDir, { recursive: true });
LANGS.forEach(([code, name], n) => {
  const body = Object.keys(tables[n]).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(tables[n][k])},`).join('\n');
  fs.writeFileSync(path.join(outDir, code + '.js'), `// Generated from i18n/*.tsv by tools/build-i18n.js — edit the tables, not this file.\nkgLang(${JSON.stringify(code)}, ${JSON.stringify(name)}, {\n${body}\n});\n`);
});

console.log(`${seen.size} phrases × ${LANGS.length} languages`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
