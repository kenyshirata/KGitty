# KGitty

A desktop Git client built with Electron, with an interface modelled on [Fork](https://git-fork.com). It runs the `git` you already have installed, so it behaves exactly like the command line — it just makes the history, the staging area and the less friendly commands easy to see and use.

> Status: personal project, version 0.1.0. Developed and tested on Windows; the code has no Windows-only parts except the installer configuration.

## Requirements

- [Git](https://git-scm.com) on your `PATH`
- [Git LFS](https://git-lfs.com) (optional, only for the LFS features)
- [Node.js](https://nodejs.org) 18 or newer, to run from source

## Running from source

```bash
npm install
npm start                  # opens KGitty
npm start -- path/to/repo  # opens a repository straight away
```

## Building the Windows installer

```bash
npm run dist   # dist/KGitty-Setup-<version>.exe (NSIS, x64, per-user)
npm run pack   # unpacked app only, in dist/win-unpacked
```

The installer is not code-signed, so Windows SmartScreen may warn on first run.

## Features

**History**
- Commit graph with lanes, branch/tag badges, author avatars (initials, optional Gravatar) and a filter box
- Commit details with a changed-file list, as a tree or a flat list, plus a file-tree view of the commit
- File history (`--follow`) and line-by-line blame
- Reflog panel
- Tabs for several repositories, and a repository manager with groups, folder scanning and live branch/status info

**Working copy**
- Staged and unstaged areas on their own screen, with stage/unstage/discard by file, hunk or single line
- Commit message split into subject and description, amend, and `Ctrl+Enter` to commit
- Unified and side-by-side diffs with syntax highlighting and word-level change highlighting
- Image diffs: side by side, swipe, onion skin and difference
- Git LFS: tracked patterns, file browser, badges and readable pointer diffs

**Branches and history editing**
- Checkout, merge, rebase onto a branch, rename, delete (also several at once, with protected branches)
- Interactive rebase (pick, reword, edit, squash, fixup, drop, reorder) with squash-message editing
- Push, force push with lease, stash dialog, tags
- Undo and redo for destructive operations
- Git Flow (feature, release and hotfix) implemented with plain git, using the same `gitflow.*` configuration as git-flow-avh

**Conflicts**
- Merge-conflict resolver with syntax highlighting, per-block choices (ours, theirs, both, custom edit)
- Hand conflicted files to an external merge tool (VS Code, Beyond Compare, KDiff3, Meld, P4Merge, WinMerge or a custom command)

**Everything else**
- Clone, submodules and worktrees
- Sign-in dialog for HTTPS and SSH passwords, tokens and passphrases (stored by your Git credential helper)
- Preferences: identity (global or per repository), commit signing, credential helper, merge tool
- Appearance settings: ten themes (system, light, dark, Dracula, Nord, One Dark, Monokai, Solarized Dark/Light, high contrast), accent colour, interface zoom, code font and size with ligatures, row density, and configurable commit-list columns and date format
- Resizable panels that remember their size
- Command palette (`Ctrl+P`) and keyboard shortcuts for nearly everything (`F1` lists them)

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | Command palette |
| `F1` | List all shortcuts |
| `Ctrl+O` / `Ctrl+Shift+O` | Open / clone a repository |
| `Ctrl+Shift+M` | Repository manager |
| `Ctrl+1` / `Ctrl+2` | All Commits / Local Changes |
| `Alt+1`…`Alt+9`, `Ctrl+Tab` | Switch tab |
| `Ctrl+Shift+F` / `L` / `P` | Fetch / Pull / Push |
| `Ctrl+B` | New branch |
| `Ctrl+Shift+S` | Stash |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo the last destructive operation |
| `Ctrl+,` | Preferences |
| `Ctrl+Alt+A` | Appearance settings |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+Alt+0` | Zoom in / out / reset |

## Project layout

```
src/main.js         Electron main process: runs git, askpass server, file access
src/preload.js      Bridge between the main process and the window
src/renderer/       The interface: plain scripts, no build step or framework
build/              Icons and the packaging hook
```

The interface is plain JavaScript split by feature (`gitflow.js`, `imagediff.js`, `repomgr.js`, …); the scripts share globals and are loaded in order by `src/renderer/index.html`.

## Notes

- Network operations never prompt in a terminal. Git asks for credentials through a small helper that opens KGitty's own dialog; to remember them, pick a credential helper in Preferences.
- Syntax highlighting uses [highlight.js](https://highlightjs.org) (BSD-3-Clause), bundled in `src/renderer/vendor/` with its licence.
