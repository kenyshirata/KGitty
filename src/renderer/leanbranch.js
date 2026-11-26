'use strict';
// The drop-down next to the Branch button: new branch / worktree, and "Lean Branching" — short-lived branches that
// start on the main branch, are kept up to date by rebasing on it and finish by merging into it.

// The branch the others start from: main, or master in older repositories.
const mainBranchName = () => ['main', 'master'].find((n) => state.branches.some((b) => b.name === n)) || null;

async function startLeanBranch(main) {
  const typed = await prompt2('Start branch', window.t('Branch name (from {0})').replace('{0}', main));
  const name = typed && branchNameFrom(typed);
  if (!name) return;
  run('Create branch', async () => { await git(['checkout', '-b', name, main]); await afterCheckout(); });
}

async function finishLeanBranch(main) {
  const cur = state.head;
  if (!cur || cur === main) return;
  if (state.busy) return;
  if (state.op || state.status.some((f) => f.conflict)) return notice('Merge', 'Finish the operation in progress first.');
  if (state.status.length && !(await confirm2('Finish branch', window.t('You have uncommitted changes. They will come along to {0} if they do not clash with the merge. Continue?').replace('{0}', main)))) return;
  if (!(await confirm2('Finish branch', `Merge ${cur} into ${main}?`))) return;
  await run('Merge', async () => {
    await git(['checkout', main]);
    await afterCheckout();
    return gitAllowConflict(['merge', cur]);
  });
  // A clean merge: offer to remove the branch that was just finished.
  if (state.op || state.status.some((f) => f.conflict) || state.head !== main) return;
  if (await confirm2('Delete branch', `Delete the merged branch ${cur}?`, true)) run('Delete branch', () => git(['branch', '-d', cur]));
}

function leanMenu() {
  if (!state.repo) return;
  const main = mainBranchName();
  const cur = state.head;
  const onMain = !cur || cur === main;
  const lean = (key, a, b) => window.t(key).replace('{0}', `'${a}'`).replace('{1}', `'${b}'`);
  const items = [
    { label: 'New Branch…', keys: 'Ctrl+B', run: () => newBranch() },
    { label: 'New Worktree…', run: () => addWorktreeDialog() },
    '-',
    { header: true, label: 'Lean Branching' },
  ];
  if (!main) items.push({ label: 'No main or master branch in this repository', off: true, run: () => {} });
  else {
    items.push(
      { label: lean('Start Branch on {0}…', main, ''), raw: true, run: () => startLeanBranch(main) },
      { label: lean('Sync {0} (Rebase on {1})', cur || '', main), raw: true, off: onMain, run: () => rebaseOnto(main) },
      { label: lean('Finish {0} (Merge into {1})…', cur || '', main), raw: true, off: onMain, run: () => finishLeanBranch(main) },
    );
  }
  toolbarMenu($('#tb-branch-menu'), items);
}

$('#tb-branch-menu').onclick = () => leanMenu();
