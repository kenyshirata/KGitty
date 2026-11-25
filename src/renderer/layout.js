'use strict';
// Resizable panels: drag the borders of the sidebar, of the commit list and of the changed-files column.
// Sizes are remembered; double-click a border to put it back to its default.

let layoutSizes = {};
try { layoutSizes = JSON.parse(localStorage.getItem('layout')) || {}; } catch { /* ignore */ }

const saveLayoutSizes = () => lsSet('layout', JSON.stringify(layoutSizes));

function applyLayoutSizes() {
  const st = document.documentElement.style;
  const set = (name, v) => (v ? st.setProperty(name, v + 'px') : st.removeProperty(name));
  set('--sidebar-w', layoutSizes.side);
  set('--dl-w', layoutSizes.left);
  set('--dlwc-w', layoutSizes.leftWc);
  set('--wc-top', layoutSizes.wcTop);
  const list = $('#commit-list');
  if (list) list.style.flex = layoutSizes.list ? `0 1 ${layoutSizes.list}px` : '';
}

function resetLayoutSizes() {
  layoutSizes = {};
  saveLayoutSizes();
  applyLayoutSizes();
}

function makeSplitter(el, onMove, resetKeys) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.classList.add('drag');
    document.body.classList.add('resizing');
    document.body.style.cursor = el.classList.contains('h') ? 'row-resize' : 'col-resize';
    const move = (ev) => { onMove(ev); applyLayoutSizes(); };
    const up = () => {
      el.classList.remove('drag');
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveLayoutSizes();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  el.addEventListener('dblclick', () => {
    const keys = typeof resetKeys === 'function' ? resetKeys() : resetKeys;
    keys.forEach((k) => delete layoutSizes[k]);
    saveLayoutSizes();
    applyLayoutSizes();
  });
}

const clampPx = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));

// Border between Unstaged and Staged in Local Changes; the element is rebuilt with the list, so it is wired each time.
function makeWcSplitter(el) {
  if (!el) return;
  makeSplitter(el, (ev) => {
    const top = $('#detail-left .wc-unstaged').getBoundingClientRect().top;
    const bottom = $('#detail-left').getBoundingClientRect().bottom;
    layoutSizes.wcTop = clampPx(ev.clientY - top, 70, bottom - top - 70);
  }, ['wcTop']);
}

makeSplitter($('#sp-side'), (ev) => {
  const body = $('.body').getBoundingClientRect();
  layoutSizes.side = clampPx(ev.clientX - body.left, 160, Math.min(560, body.width - 420));
}, ['side']);

makeSplitter($('#sp-detail'), (ev) => {
  const d = $('.detail').getBoundingClientRect();
  const key = $('#detail-left').classList.contains('wc') ? 'leftWc' : 'left';
  layoutSizes[key] = clampPx(ev.clientX - d.left, 220, d.width - 260);
}, () => [$('#detail-left').classList.contains('wc') ? 'leftWc' : 'left']);

makeSplitter($('#sp-main'), (ev) => {
  const m = $('#main').getBoundingClientRect();
  const top = $('#commit-list').getBoundingClientRect().top;
  layoutSizes.list = clampPx(ev.clientY - top, 100, m.bottom - top - 160);
}, ['list']);

applyLayoutSizes();
