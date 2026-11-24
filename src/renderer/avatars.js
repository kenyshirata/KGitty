'use strict';
// Author avatars: the author's Gravatar photo when there is one, coloured initials otherwise. Gravatar is on by
// default and can be turned off (it sends a SHA-256 hash of each author's e-mail address to gravatar.com).

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const avOpts = { show: lsGet('avatars') !== '0', gravatar: lsGet('gravatar') !== '0' };
const gravCache = new Map(); // e-mail -> sha256 hex

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function prepareGravatars(commits) {
  if (!avOpts.gravatar || !crypto.subtle) return;
  const emails = [...new Set(commits.map((c) => c.email).filter(Boolean))].filter((e) => !gravCache.has(e));
  await Promise.all(emails.map(async (e) => gravCache.set(e, await sha256Hex(e.trim().toLowerCase()))));
}

const avatarHue = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const initials = (name) => (name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();

function avatarHtml(name, email, size = 22, force = false) {
  if (!avOpts.show && !force) return '';
  const hash = avOpts.gravatar && email ? gravCache.get(email) : null;
  const img = hash ? `<img class="av-img" alt="" loading="lazy" src="https://gravatar.com/avatar/${hash}?s=${size * 2}&d=404">` : '';
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:hsl(${avatarHue(name)} 45% 40%)">${esc(initials(name))}${img}</span>`;
}

// A missing Gravatar answers 404: drop the image and the initials underneath show through.
document.addEventListener('error', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('av-img')) e.target.remove();
}, true);

function rerenderAvatars() {
  if (!state.repo) return;
  renderList();
  renderDetail();
}

function toggleAvatars() {
  avOpts.show = !avOpts.show;
  lsSet('avatars', avOpts.show ? '1' : '0');
  rerenderAvatars();
}

async function setGravatar(on) {
  avOpts.gravatar = on;
  lsSet('gravatar', on ? '1' : '0');
  if (on) await prepareGravatars(state.commits);
  rerenderAvatars();
  if (typeof mgrRefreshDetail === 'function') mgrRefreshDetail();
}

async function toggleGravatar() {
  if (!avOpts.gravatar) {
    const ok = await confirm2('Load photos from Gravatar',
      'To show author photos, KGitty sends a SHA-256 hash of each author\'s e-mail address to gravatar.com. Nothing else leaves your machine. Enable it?');
    if (!ok) return;
  }
  return setGravatar(!avOpts.gravatar);
}
