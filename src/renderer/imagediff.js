'use strict';
// Image diffs: before/after previews for changed image files, shown side by side, as a swipe, as an onion skin
// or as a difference blend. The two versions are read straight from Git (or the working copy) as base64.

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|svg|ico|avif)$/i;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };

let imgMode = 'side';
try { const m = localStorage.getItem('imgMode'); if (['side', 'swipe', 'onion', 'diff'].includes(m)) imgMode = m; } catch { /* ignore */ }
let imgState = null;

const imgSide = async (spec, rel) => {
  const r = spec ? await window.api.gitBlob(state.repo, spec) : await window.api.readFileB64(state.repo, rel);
  return r.ok ? r : null;
};

function loadImage(side, path) {
  if (!side) return Promise.resolve(null);
  const mime = IMAGE_MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
  const src = `data:${mime};base64,${side.b64}`;
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ src, w: im.naturalWidth || 1, h: im.naturalHeight || 1, size: side.size });
    im.onerror = () => resolve({ src, w: 0, h: 0, size: side.size, broken: true });
    im.src = src;
  });
}

async function showImageDiff(path, area) {
  let before = null, after = null;
  if (area === 'commit') {
    const c = state.commits.find((x) => x.hash === state.sel.hash);
    [before, after] = await Promise.all([c.parents.length ? imgSide(`${c.parents[0]}:${path}`) : null, imgSide(`${c.hash}:${path}`)]);
  } else if (area === 'staged') {
    [before, after] = await Promise.all([imgSide(`HEAD:${path}`), imgSide(`:${path}`)]);
  } else {
    [before, after] = await Promise.all([imgSide(`:${path}`), imgSide(null, path)]);
  }
  const [b, a] = await Promise.all([loadImage(before, path), loadImage(after, path)]);
  if (!state.file || state.file.path !== path || state.file.area !== area) return;
  imgState = { path, b, a, swipe: 50, onion: 50 };
  drawImageDiff();
}

const imgInfo = (im) => (im ? (im.broken ? 'cannot be decoded · ' : `${im.w} × ${im.h} px · `) + humanSize(im.size) : '');

function drawImageDiff() {
  const { path, b, a } = imgState;
  const kind = !b ? 'Added' : !a ? 'Deleted' : 'Modified';
  const modes = [['side', 'Side by side'], ['swipe', 'Swipe'], ['onion', 'Onion skin'], ['diff', 'Difference']];
  const both = b && a && !b.broken && !a.broken;
  const mode = both ? imgMode : 'side';
  const seg = both ? `<span class="seg">${modes.map(([v, l]) => `<button data-imode="${v}" class="${mode === v ? 'primary' : ''}">${l}</button>`).join('')}</span>` : '';
  let body;
  if (mode === 'side') {
    const pane = (label, im) => `<div class="img-pane"><div class="img-cap">${label}<span class="dim"> ${esc(imgInfo(im))}</span></div><div class="img-box checker">${im ? (im.broken ? '<div class="empty">Cannot be previewed</div>' : `<img src="${im.src}" alt="">`) : '<div class="empty">—</div>'}</div></div>`;
    body = `<div class="img-two">${pane('Before', b)}${pane('After', a)}</div>`;
  } else {
    const W = Math.max(b.w, a.w), H = Math.max(b.h, a.h);
    const layer = (im, style, top) => `<img ${top ? 'data-layer="top"' : ''} src="${im.src}" alt="" style="width:${(im.w / W) * 100}%;${style}">`;
    let stack, ctl;
    if (mode === 'swipe') {
      stack = layer(a, '') + layer(b, `clip-path:inset(0 ${100 - imgState.swipe}% 0 0)`, true);
      ctl = `<input type="range" min="0" max="100" value="${imgState.swipe}" data-irange="swipe"><span class="dim">Before ◂ ▸ After</span>`;
    } else if (mode === 'onion') {
      stack = layer(a, '') + layer(b, `opacity:${(100 - imgState.onion) / 100}`, true);
      ctl = `<input type="range" min="0" max="100" value="${imgState.onion}" data-irange="onion"><span class="dim">Before ◂ ▸ After</span>`;
    } else {
      stack = layer(b, '') + layer(a, 'mix-blend-mode:difference');
      ctl = '<span class="dim">Identical pixels are black; brighter pixels changed more.</span>';
    }
    body = `<div class="img-over"><div class="img-ctl">${ctl}</div><div class="img-box ${mode === 'diff' ? 'dark' : 'checker'}"><div class="img-stack" style="max-width:${W}px;aspect-ratio:${W}/${H}">${stack}</div></div></div>`;
  }
  $('#detail-right').innerHTML = `<div class="diff-title"><span>${esc(path)} <span class="lfs-badge" style="background:var(--dim)">${kind}</span></span>${seg}</div><div class="img-diff">${body}${mode !== 'side' ? `<div class="img-meta dim">Before: ${esc(imgInfo(b))} &nbsp;·&nbsp; After: ${esc(imgInfo(a))}</div>` : ''}</div>`;
}

$('#detail-right').addEventListener('click', (e) => {
  const m = e.target.closest('[data-imode]');
  if (!m || !imgState) return;
  imgMode = m.dataset.imode;
  try { localStorage.setItem('imgMode', imgMode); } catch { /* ignore */ }
  drawImageDiff();
});

$('#detail-right').addEventListener('input', (e) => {
  const r = e.target.closest('[data-irange]');
  if (!r || !imgState) return;
  const v = +r.value;
  const top = $('#detail-right').querySelector('[data-layer=top]');
  if (r.dataset.irange === 'swipe') { imgState.swipe = v; top.style.clipPath = `inset(0 ${100 - v}% 0 0)`; }
  else { imgState.onion = v; top.style.opacity = (100 - v) / 100; }
});
