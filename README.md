# shell-extras

These are personal extras for [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell), packaged as a Pi package.

## File explorer

The file explorer is an IDE-like tree of the repository you are working in. It shows up in the **Files** tab of the **EXTRAS** section of the fullscreen sidebar. EXTRAS has a tab bar on top: click a tab to see only its widgets; the chosen tab is remembered. Click the EXTRAS header to fold the whole section.

- **Tree:** the tree starts at the Git root of the session's cwd, or at the cwd itself outside Git. Folders come first, and `.git` is hidden.
- **Git status colors and badges:**

| Status | Color role | Badge |
|---|---|---|
| untracked (new) | `success` | `U` |
| added (staged new) | `success` | `A` |
| modified | `warning` | `M` |
| renamed | `accent` | `R` |
| deleted (still listed where it was) | `error` | `D` |
| conflicted | `error` | `!` |
| ignored | `dim`, collapsed until opened | — |
| tracked and clean | `text` | — |

- **Folders:** a folder takes the most urgent status of its children and shows a `•`.
- **Icons:** Nerd Font icons per file type. They need a Nerd Font in your terminal.
- **Mouse in the sidebar:**
  - Clicking the header collapses the section.
  - Clicking a folder expands or collapses it.
  - Clicking a file opens a full-screen preview.
  - The wheel scrolls the tree.
- **`/files`:** opens the explorer as a full-screen overlay you can drive from the keyboard.

| Key | Action |
|---|---|
| `↑`/`k`, `↓`/`j` | Move the selection |
| `PgUp`/`PgDn` | Move the selection a page at a time |
| `Home`/`End` | Jump to the first or last entry |
| `→`/`l` | Expand the selected folder |
| `←`/`h` | Collapse the selected folder, or go to its parent |
| `Enter` | Expand or collapse a folder, or preview a file |
| `Esc`/`q` | Leave the preview, or close the overlay |

- **Preview:** the preview shows line numbers. A deleted file is shown from `HEAD`, a binary file shows a short notice instead of its content, and files are read up to 512 KB. Control characters are stripped, so a file can never repaint your terminal.
- **Refresh:** the explorer refreshes after every turn. It also polls every 3 seconds, but only while the sidebar or the overlay is visible.

### Settings (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `SHELL_EXTRAS_ORDER` | `50` | Position of the EXTRAS section among the sidebar sections. The built-in sections are `todo` 100, `jobs` 200, `agents` 300 and Status 400. |
| `SHELL_EXTRAS_FILES_POLL_MS` | `3000` | Polling interval. `0` turns polling off. |

### Requirements

The sidebar section needs a Gentle Shell that supports extension sections, which means the `section: { order }` hook on branch `feat/sidebar-extension-sections`. Older versions ignore the section, but `/files` still works. shell-extras keeps its own choices (active tab, folded section) in `~/.gentle-shell/shell-extras/settings.json`; `SHELL_EXTRAS_HOME` moves that directory.

## Git tab

The **Git** tab shows:

- the current branch, with commits ahead (`↑`) and behind (`↓`) its upstream;
- how many files changed, or `clean`;
- the branch's pull request, with its state;
- the CI checks: passed `✓`, failed `✗` and pending `◌`.

Click the PR row to open the pull request in the browser. The PR comes from `gh pr view`; without the GitHub CLI the row reads `gh unavailable`. Git refreshes every 5 seconds (`SHELL_EXTRAS_GIT_POLL_MS`) and after each agent turn, but only while the tab is on screen; `gh` is asked at most once a minute, or right away when the branch changes.

## Try it

Run the fork's launcher with this package loaded for one session:

```bash
node <path>/gentle-shell/bin/gentle-shell.mjs -e <path>/shell-extras
```

To load it permanently, install it with `pi install <path>/shell-extras`. Local packages load in place, so your edits apply on the next `/reload`.

## Development

```bash
npm install
npm test
npx tsc --noEmit
```
