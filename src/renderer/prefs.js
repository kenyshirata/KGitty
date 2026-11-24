'use strict';
// Preferences: commit identity (global or per repository), commit signing and the credential helper.

let gcmWindow = false;
try { gcmWindow = localStorage.getItem('gcmWindow') === '1'; } catch { /* ignore */ }
window.api.setAuthOpts({ gcmWindow });

const cfgCwd = () => state.repo || null;

async function cfgGet(scope, key) {
  const r = await window.api.git(cfgCwd(), ['config', scope, '--get', key]);
  return r.code === 0 ? r.stdout.replace(/\r?\n$/, '') : '';
}

async function cfgSet(scope, key, value) {
  const r = await window.api.git(cfgCwd(), value ? ['config', scope, key, value] : ['config', scope, '--unset-all', key]);
  if (r.code !== 0 && r.code !== 5) throw new Error((r.stderr || 'git config failed').trim()); // 5 = key was not set
}

const MERGE_TOOLS = [
  ['', 'None'],
  ['vscode', 'Visual Studio Code'],
  ['bc', 'Beyond Compare'],
  ['kdiff3', 'KDiff3'],
  ['meld', 'Meld'],
  ['p4merge', 'P4Merge'],
  ['winmerge', 'WinMerge'],
  ['kgitty', 'Custom command'],
];

const HELPERS = [
  ['', 'Default (whatever Git is configured with)'],
  ['manager', 'Git Credential Manager (recommended on Windows)'],
  ['store', 'Store in a plain-text file (~/.git-credentials)'],
  ['cache --timeout=900', 'Keep in memory for 15 minutes'],
];

async function loadPrefs(scope) {
  const [name, email, signkey, gpgsign, format] = await Promise.all(
    ['user.name', 'user.email', 'user.signingkey', 'commit.gpgsign', 'gpg.format'].map((k) => cfgGet(scope, k)));
  const effective = scope === '--local'
    ? { name: await cfgGet('--global', 'user.name'), email: await cfgGet('--global', 'user.email') }
    : null;
  return { name, email, signkey, gpgsign: gpgsign === 'true', format: format || 'openpgp', effective };
}

async function prefsDialog() {
  const ov = $('#overlay');
  const canLocal = !!state.repo;
  let scope = '--global';
  const helperOrig = await cfgGet('--global', 'credential.helper');
  let helper = helperOrig;
  const appVersion = await window.api.appVersion();
  const updInfo = await window.api.updateState();
  let hasToken = updInfo.hasToken;
  const effHelpers = (await window.api.git(cfgCwd(), ['config', '--get-all', 'credential.helper'])).stdout.split('\n').filter(Boolean);
  const mt = await cfgGet('--global', 'merge.tool');
  const mtPath = mt ? await cfgGet('--global', `mergetool.${mt}.path`) : '';
  const mtCmd = await cfgGet('--global', 'mergetool.kgitty.cmd');
  let p = await loadPrefs(scope);

  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.oninput = ov.onkeydown = ov.onchange = null; };
  const read = () => ({
    name: $('#pf-name').value.trim(), email: $('#pf-email').value.trim(), signkey: $('#pf-key').value.trim(),
    gpgsign: $('#pf-sign').checked, format: $('#pf-fmt').value,
  });
  const draw = () => {
    const d = p;
    const known = HELPERS.some(([v]) => v === helper);
    const eff = p.effective;
    ov.innerHTML = `<div class="modal wide pf"><h3>Preferences</h3>
      <div class="pf-sec"><div class="sb-head">Language</div>
        <div class="field"><select id="pf-lang">${[['', 'Automatic (system language)'], ...kgLanguages()].map(([v, l]) => `<option value="${v}" ${kgLanguagePref() === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <p class="hint">Choose the language of the interface. It changes immediately.</p></div>
      <div class="pf-sec"><div class="sb-head">Identity</div>
        <p class="hint">Name and e-mail recorded in the commits you make.</p>
        <div class="field"><label>Apply to</label><select id="pf-scope"><option value="--global" ${scope === '--global' ? 'selected' : ''}>All repositories (global)</option>${canLocal ? `<option value="--local" ${scope === '--local' ? 'selected' : ''}>Only this repository</option>` : ''}</select></div>
        <div class="pf-two"><div class="field"><label>Name</label><input type="text" id="pf-name" value="${esc(d.name)}" placeholder="${esc(eff ? eff.name : 'Your Name')}"></div>
        <div class="field"><label>E-mail</label><input type="text" id="pf-email" value="${esc(d.email)}" placeholder="${esc(eff ? eff.email : 'you@example.com')}"></div></div>
        ${scope === '--local' ? '<p class="hint">Leave a field empty to use the global value.</p>' : ''}
      </div>
      <div class="pf-sec"><div class="sb-head">Commit signing</div>
        <label class="cl-opt"><input type="checkbox" id="pf-sign" ${d.gpgsign ? 'checked' : ''}> Sign every commit</label>
        <div class="pf-two"><div class="field"><label>Format</label><select id="pf-fmt">${['openpgp', 'ssh', 'x509'].map((f) => `<option ${d.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label>Signing key</label><input type="text" id="pf-key" value="${esc(d.signkey)}" placeholder="key id, or path to a public SSH key"></div></div>
      </div>
      <div class="pf-sec"><div class="sb-head">Credentials</div>
        <div class="field"><label>Where Git remembers passwords and tokens (global)</label><select id="pf-helper">${HELPERS.map(([v, l]) => `<option value="${esc(v)}" ${v === helper ? 'selected' : ''}>${esc(l)}</option>`).join('')}${known ? '' : `<option value="${esc(helper)}" selected>Custom: ${esc(helper)}</option>`}</select></div>
        <p class="hint">${effHelpers.length ? 'In effect now: ' + esc(effHelpers.join(', ')) : 'No credential helper is configured, so passwords are asked again on every operation.'}</p>
        <label class="cl-opt"><input type="checkbox" id="pf-gcm" ${gcmWindow ? 'checked' : ''}> Let Git Credential Manager open its own sign-in window (browser login for GitHub, GitLab…) instead of asking here</label>
      </div>
      <div class="pf-sec"><div class="sb-head">Merge tool</div>
        <div class="pf-two"><div class="field"><label>Tool for resolving conflicts</label><select id="pf-mt">${MERGE_TOOLS.map(([v, l]) => `<option value="${v}" ${v === mt ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Executable (optional)</label><input type="text" id="pf-mtpath" value="${esc(mtPath)}" placeholder="full path if the tool is not on PATH"></div></div>
        <div class="field"><label>Custom command</label><input type="text" id="pf-mtcmd" value="${esc(mtCmd)}" placeholder='"C:/tools/merge.exe" "$LOCAL" "$BASE" "$REMOTE" -o "$MERGED"'></div>
        <p class="hint">Used by the Merge tool button on a conflicted file. The custom command may use $LOCAL, $BASE, $REMOTE and $MERGED.</p>
      </div>
      <div class="pf-sec"><div class="sb-head">Updates</div>
        <p class="hint">KGitty ${esc(appVersion)} · <span id="upd-line">${esc(updateLine(updState))}</span></p>
        <label class="cl-opt"><input type="checkbox" id="pf-upd-auto" ${updateOpts().auto ? 'checked' : ''}> Check for updates automatically</label>
        <div class="field"><label>Access token (only needed while the GitHub repository is private)</label><input type="password" id="pf-upd-token" autocomplete="off" placeholder="${hasToken ? 'A token is saved — type to replace it' : 'Optional'}"></div>
        <button id="pf-upd-check">Check now</button> <button id="pf-upd-clear" ${hasToken ? '' : 'class="hidden"'}>Remove saved token</button>
      </div>
      <div class="btns"><button id="pf-cancel">Cancel</button><button class="primary" id="pf-save">Save</button></div></div>`;
  };
  ov.classList.remove('hidden');
  draw();
  $('#pf-name').focus();

  const save = async () => {
    const v = read();
    try {
      await cfgSet(scope, 'user.name', v.name);
      await cfgSet(scope, 'user.email', v.email);
      await cfgSet(scope, 'user.signingkey', v.signkey);
      await cfgSet(scope, 'commit.gpgsign', v.gpgsign ? 'true' : '');
      await cfgSet(scope, 'gpg.format', v.format === 'openpgp' ? '' : v.format);
      const tool = $('#pf-mt').value;
      await cfgSet('--global', 'merge.tool', tool);
      if (tool) {
        await cfgSet('--global', `mergetool.${tool}.path`, tool === 'kgitty' ? '' : $('#pf-mtpath').value.trim());
        if (tool === 'kgitty') {
          await cfgSet('--global', 'mergetool.kgitty.cmd', $('#pf-mtcmd').value.trim());
          await cfgSet('--global', 'mergetool.kgitty.trustExitCode', 'true');
        }
      }
      const h = $('#pf-helper').value;
      if (h !== helperOrig) { await cfgSet('--global', 'credential.helper', h); }
      const upd = { auto: $('#pf-upd-auto').checked };
      try { localStorage.setItem('updateOpts', JSON.stringify(upd)); } catch { /* ignore */ }
      await window.api.setUpdateOpts(upd);
      const tok = $('#pf-upd-token').value.trim();
      if (tok) { const res = await window.api.setUpdateToken(tok); if (!res.ok) throw new Error(res.error); }
      gcmWindow = $('#pf-gcm').checked;
      try { localStorage.setItem('gcmWindow', gcmWindow ? '1' : '0'); } catch { /* ignore */ }
      await window.api.setAuthOpts({ gcmWindow });
    } catch (e) {
      return notice('Preferences', e.message);
    }
    close();
    setStatus('Preferences saved');
  };
  ov.onchange = async (e) => {
    if (e.target.id === 'pf-lang') return kgSetLanguage(e.target.value);
    if (e.target.id !== 'pf-scope') return;
    const keep = $('#pf-helper').value, gcm = $('#pf-gcm').checked;
    scope = e.target.value;
    p = await loadPrefs(scope);
    helper = keep;
    draw();
    $('#pf-gcm').checked = gcm;
  };
  ov.onclick = (e) => {
    if (e.target.closest('#pf-upd-check')) checkForUpdates();
    else if (e.target.closest('#pf-upd-clear')) { window.api.setUpdateToken('').then(() => { hasToken = false; $('#pf-upd-clear').classList.add('hidden'); $('#pf-upd-token').placeholder = 'Optional'; }); }
    else if (e.target.closest('#pf-cancel')) close();
    else if (e.target.closest('#pf-save')) save();
  };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') save();
  };
}

$('#tb-prefs').onclick = prefsDialog;

const IDENTITY_ERR = /Author identity unknown|Please tell me who you are|empty ident name|unable to auto-detect email/i;
const AUTH_ERR = /Authentication failed|unable to read askpass response|terminal prompts disabled|could not read (Username|Password)|Permission denied \(publickey|HTTP Basic: Access denied|returned error: 403|Invalid username or token/i;
function errorHint(msg) {
  if (IDENTITY_ERR.test(msg)) return { text: 'Git does not know who you are. Set your name and e-mail in Preferences, then try again.', action: 'Set identity…' };
  if (AUTH_ERR.test(msg)) return { text: 'Sign-in was refused or cancelled. Check the credentials (GitHub needs a personal access token, not a password) and the credential helper in Preferences.', action: 'Open Preferences' };
  return null;
}
