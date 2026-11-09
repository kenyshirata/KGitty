'use strict';
// Credential prompts. Git and ssh ask for user names, passwords, passphrases and host-key confirmations through
// an askpass helper (see main.js); each request arrives here and is answered from a dialog of its own, so it
// can appear on top of a running operation without disturbing the shared #overlay.

const askQueue = [];
let askShowing = null;

window.api.onAskpass((req) => { askQueue.push(req); nextAsk(); });
window.api.onAskpassCancel((id) => {
  const i = askQueue.findIndex((r) => r.id === id);
  if (i >= 0) askQueue.splice(i, 1);
  else if (askShowing === id) closeAsk(true);
});

function describeAsk(prompt) {
  let m = /^Username for '([^']+)'/i.exec(prompt);
  if (m) return { kind: 'user', where: m[1], title: 'Sign in', label: 'Username' };
  m = /^Password for '([^']+)'/i.exec(prompt);
  if (m) {
    const host = m[1].replace(/^(\w+:\/\/)[^@/]*@/, '$1');
    const gh = /github\.com/i.test(host);
    return { kind: 'password', where: m[1], title: 'Sign in', label: 'Password or access token',
      hint: gh ? 'GitHub no longer accepts account passwords — paste a personal access token.' : /gitlab|bitbucket|dev\.azure/i.test(host) ? 'Use an access token if your account has two-factor authentication.' : '' };
  }
  if (/passphrase|PIN\b/i.test(prompt)) return { kind: 'password', title: 'SSH key passphrase', label: 'Passphrase', where: prompt.replace(/:\s*$/, '') };
  if (/password/i.test(prompt)) return { kind: 'password', title: 'SSH password', label: 'Password', where: prompt.replace(/:\s*$/, '') };
  if (/\(yes\/no/i.test(prompt)) return { kind: 'confirm', title: 'Unknown host', label: 'Type “yes” to trust this host, or “no”', where: prompt.replace(/\s*\(yes\/no[^)]*\)\??\s*$/i, '') };
  return { kind: 'text', title: 'Git needs input', label: 'Answer', where: prompt.replace(/:\s*$/, '') };
}

function nextAsk() {
  if (askShowing != null || !askQueue.length) return;
  const req = askQueue.shift();
  askShowing = req.id;
  const d = describeAsk(req.prompt);
  const ov = $('#overlay2');
  ov.innerHTML = `<div class="modal auth"><h3>${esc(d.title)}</h3>
    <p class="hint">${esc(d.where || '')}</p>
    <div class="field"><label>${esc(d.label)}</label><input type="${d.kind === 'password' ? 'password' : 'text'}" id="ask-val" autocomplete="off" spellcheck="false" value="${d.kind === 'confirm' ? 'yes' : ''}"></div>
    ${d.hint ? `<p class="hint">${esc(d.hint)}</p>` : ''}
    ${d.kind === 'password' || d.kind === 'user' ? '<p class="hint">Git hands this to your credential helper, which stores it if one is configured (Preferences → Credentials).</p>' : ''}
    <div class="btns"><button id="ask-cancel">Cancel</button><button class="primary" id="ask-ok">OK</button></div></div>`;
  ov.classList.remove('hidden');
  const input = $('#ask-val');
  input.focus();
  input.select();
  const send = (v) => { window.api.answerAskpass(req.id, v); closeAsk(false); };
  $('#ask-ok').onclick = () => send(input.value);
  $('#ask-cancel').onclick = () => send(null);
  ov.onkeydown = (e) => {
    if (e.key === 'Enter') send(input.value);
    if (e.key === 'Escape') send(null);
  };
}

function closeAsk() {
  const ov = $('#overlay2');
  ov.classList.add('hidden');
  ov.innerHTML = '';
  ov.onkeydown = null;
  askShowing = null;
  nextAsk();
}
