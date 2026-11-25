'use strict';
// Preferences, in tabs: General (language), Commit (signing), Git (identity, credentials), Integration (merge tool)
// and Updates. Every tab stays in the page while the dialog is open, so Save writes all of them at once.

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

const PREF_TABS = [['general', 'General'], ['commit', 'Commit'], ['git', 'Git'], ['integration', 'Integration'], ['updates', 'Updates']];
let prefTab = 'general';

async function prefsDialog(tab) {
  if (PREF_TABS.some(([k]) => k === tab)) prefTab = tab;
  const ov = $('#overlay');
  const canLocal = !!state.repo;
  let scope = '--global';
  const helperOrig = await cfgGet('--global', 'credential.helper');
  let helper = helperOrig;
  const appVersion = await window.api.appVersion();
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
  let go = gitOpts();
  const draw = () => {
    const d = p;
    const known = HELPERS.some(([v]) => v === helper);
    const eff = p.effective;
    const panel = (k) => `class="pf-panel${prefTab === k ? '' : ' hidden'}" data-panel="${k}"`;
    ov.innerHTML = `<div class="modal wide pf"><h3>Preferences</h3>
      <div class="pf-tabs">${PREF_TABS.map(([k, l]) => `<button class="pf-tab${prefTab === k ? ' on' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="pf-body">
      <div ${panel('general')}>
      <div class="pf-sec"><div class="sb-head">Language</div>
        <div class="field"><select id="pf-lang">${[['', 'Automatic (system language)'], ...kgLanguages()].map(([v, l]) => `<option value="${v}" ${kgLanguagePref() === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <p class="hint">Choose the language of the interface. It changes immediately.</p></div>
      <div class="pf-sec pf-opts"><div class="sb-head">Behaviour</div>
        <label class="cl-opt"><input type="checkbox" id="go-autoFetch" ${go.autoFetch ? 'checked' : ''}> Fetch remotes automatically</label>
        <label class="cl-opt"><input type="checkbox" id="go-fetchTags" ${go.fetchTags ? 'checked' : ''}> Always include tags into fetch</label>
        <label class="cl-opt"><input type="checkbox" id="go-tabDirty" ${go.tabDirty ? 'checked' : ''}> Tab indicator for uncommitted changes</label>
        <label class="cl-opt"><input type="checkbox" id="go-submodulesOnCheckout" ${go.submodulesOnCheckout ? 'checked' : ''}> Update submodules automatically on checkout</label>
        <div class="pf-inline"><label for="go-branchSpace">Space character in branch names:</label><select id="go-branchSpace">${['-', '_'].map((c) => `<option value="${c}" ${go.branchSpace === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <label class="cl-opt"><input type="checkbox" id="go-pushOnCommit" ${go.pushOnCommit ? 'checked' : ''}> Push automatically on commit</label>
        <label class="cl-opt"><input type="checkbox" id="go-compactLabels" ${go.compactLabels ? 'checked' : ''}> Compact branch labels</label>
        <p class="hint">Automatic fetch runs every 10 minutes for the open repository and never asks for a password.</p>
      </div>
      </div>
      <div ${panel('git')}>
      <div class="pf-sec"><div class="sb-head">Identity</div>
        <p class="hint">Name and e-mail recorded in the commits you make.</p>
        <div class="pf-ident"><div class="pf-avatar" id="pf-avatar"></div>
        <div class="pf-ident-fields">
        <div class="field"><label>Apply to</label><select id="pf-scope"><option value="--global" ${scope === '--global' ? 'selected' : ''}>All repositories (global)</option>${canLocal ? `<option value="--local" ${scope === '--local' ? 'selected' : ''}>Only this repository</option>` : ''}</select></div>
        <div class="pf-two"><div class="field"><label>Name</label><input type="text" id="pf-name" value="${esc(d.name)}" placeholder="${esc(eff ? eff.name : 'Your Name')}"></div>
        <div class="field"><label>E-mail</label><input type="text" id="pf-email" value="${esc(d.email)}" placeholder="${esc(eff ? eff.email : 'you@example.com')}"></div></div>
        <p class="hint">Change the avatar at <a href="https://gravatar.com" target="_blank">gravatar.com</a></p>
        ${scope === '--local' ? '<p class="hint">Leave a field empty to use the global value.</p>' : ''}
        </div></div>
      </div>
      <div class="pf-sec"><div class="sb-head">Credentials</div>
        <div class="field"><label>Where Git remembers passwords and tokens (global)</label><select id="pf-helper">${HELPERS.map(([v, l]) => `<option value="${esc(v)}" ${v === helper ? 'selected' : ''}>${esc(l)}</option>`).join('')}${known ? '' : `<option value="${esc(helper)}" selected>Custom: ${esc(helper)}</option>`}</select></div>
        <p class="hint">${effHelpers.length ? 'In effect now: ' + esc(effHelpers.join(', ')) : 'No credential helper is configured, so passwords are asked again on every operation.'}</p>
        <label class="cl-opt"><input type="checkbox" id="pf-gcm" ${gcmWindow ? 'checked' : ''}> Let Git Credential Manager open its own sign-in window (browser login for GitHub, GitLab…) instead of asking here</label>
      </div>
      </div>
      <div ${panel('commit')}>
      <div class="pf-sec"><div class="sb-head">Commit signing</div>
        <label class="cl-opt"><input type="checkbox" id="pf-sign" ${d.gpgsign ? 'checked' : ''}> Sign every commit</label>
        <div class="pf-two"><div class="field"><label>Format</label><select id="pf-fmt">${['openpgp', 'ssh', 'x509'].map((f) => `<option ${d.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label>Signing key</label><input type="text" id="pf-key" value="${esc(d.signkey)}" placeholder="key id, or path to a public SSH key"></div></div>
      </div>
      </div>
      <div ${panel('integration')}>
      <div class="pf-sec"><div class="sb-head">Merge tool</div>
        <div class="pf-two"><div class="field"><label>Tool for resolving conflicts</label><select id="pf-mt">${MERGE_TOOLS.map(([v, l]) => `<option value="${v}" ${v === mt ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Executable (optional)</label><input type="text" id="pf-mtpath" value="${esc(mtPath)}" placeholder="full path if the tool is not on PATH"></div></div>
        <div class="field"><label>Custom command</label><input type="text" id="pf-mtcmd" value="${esc(mtCmd)}" placeholder='"C:/tools/merge.exe" "$LOCAL" "$BASE" "$REMOTE" -o "$MERGED"'></div>
        <p class="hint">Used by the Merge tool button on a conflicted file. The custom command may use $LOCAL, $BASE, $REMOTE and $MERGED.</p>
      </div>
      </div>
      <div ${panel('updates')}>
      <div class="pf-sec"><div class="sb-head">Updates</div>
        <p class="hint">KGitty ${esc(appVersion)} · <span id="upd-line">${esc(updateLine(updState))}</span></p>
        <label class="cl-opt"><input type="checkbox" id="pf-upd-auto" ${updateOpts().auto ? 'checked' : ''}> Check for updates automatically</label>
        <button id="pf-upd-check">Check now</button>
      </div>
      </div>
      </div>
      <div class="btns"><button id="pf-cancel">Cancel</button><button class="primary" id="pf-save">Save</button></div></div>`;
  };
  ov.classList.remove('hidden');
  // The Gravatar photo of the e-mail being edited (or the effective one when the field is empty), initials otherwise.
  let avTimer = null, avSeq = 0;
  const drawAvatar = async () => {
    const box = $('#pf-avatar');
    if (!box) return;
    const name = $('#pf-name').value.trim() || $('#pf-name').placeholder;
    const email = $('#pf-email').value.trim() || (p.effective ? p.effective.email : '');
    const seq = ++avSeq;
    if (email) await prepareGravatars([{ email }]);
    if (seq !== avSeq || !$('#pf-avatar')) return;
    box.innerHTML = avatarHtml(name || '?', email, 72, true);
  };
  ov.oninput = (e) => {
    if (e.target.id !== 'pf-name' && e.target.id !== 'pf-email') return;
    clearTimeout(avTimer);
    avTimer = setTimeout(drawAvatar, 400);
  };
  draw();
  drawAvatar();
  const focusTab = () => { const f = ov.querySelector('.pf-panel:not(.hidden) input[type=text], .pf-panel:not(.hidden) select'); (f || ov.querySelector('.pf-tab.on')).focus(); };
  focusTab();

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
      setGitOpts({
        ...Object.fromEntries(['autoFetch', 'fetchTags', 'tabDirty', 'submodulesOnCheckout', 'pushOnCommit', 'compactLabels'].map((k) => [k, $('#go-' + k).checked])),
        branchSpace: $('#go-branchSpace').value,
      });
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
    go = { ...Object.fromEntries(Object.keys(GIT_OPTS_DEFAULT).filter((k) => k !== 'branchSpace').map((k) => [k, $('#go-' + k).checked])), branchSpace: $('#go-branchSpace').value };
    scope = e.target.value;
    p = await loadPrefs(scope);
    helper = keep;
    draw();
    drawAvatar();
    $('#pf-gcm').checked = gcm;
  };
  ov.onclick = (e) => {
    const t = e.target.closest('.pf-tab');
    if (t) {
      prefTab = t.dataset.tab;
      ov.querySelectorAll('.pf-tab').forEach((b) => b.classList.toggle('on', b === t));
      ov.querySelectorAll('.pf-panel').forEach((x) => x.classList.toggle('hidden', x.dataset.panel !== prefTab));
      return focusTab();
    }
    if (e.target.closest('#pf-upd-check')) checkForUpdates();
    else if (e.target.closest('#pf-cancel')) close();
    else if (e.target.closest('#pf-save')) save();
  };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') save();
  };
}


const IDENTITY_ERR = /Author identity unknown|Please tell me who you are|empty ident name|unable to auto-detect email/i;
const AUTH_ERR = /Authentication failed|unable to read askpass response|terminal prompts disabled|could not read (Username|Password)|Permission denied \(publickey|HTTP Basic: Access denied|returned error: 403|Invalid username or token/i;
function errorHint(msg) {
  if (IDENTITY_ERR.test(msg)) return { text: 'Git does not know who you are. Set your name and e-mail in Preferences, then try again.', action: 'Set identity…', tab: 'git' };
  if (AUTH_ERR.test(msg)) return { text: 'Sign-in was refused or cancelled. Check the credentials (GitHub needs a personal access token, not a password) and the credential helper in Preferences.', action: 'Open Preferences', tab: 'git' };
  return null;
}
