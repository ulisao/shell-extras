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

## Project tab

The **Proj** tab shows:

- the newest ODD feature in `odd/tasks/*.md`, with its checked tasks (`3/9`) and a progress bar;
- the `package.json` scripts. Click one to run it with the project's package manager (from the lock file) in a new Windows Terminal tab, or in a new console window when `wt.exe` is missing;
- the listening dev servers (node, bun, deno, python and similar). Click one to open `http://localhost:<port>`;
- the running Docker containers, or `docker not running`.

It refreshes every 10 seconds (`SHELL_EXTRAS_PROJECT_POLL_MS`) while the tab is on screen. Ports are read with `netstat` and `tasklist`, so they show on Windows only.

## System tab

The **Sys** tab shows the clock and date, CPU and RAM use with small bars, and a pomodoro: 25 minutes of focus, then a 5 minute break. Click `▶ start` / `⏸ pause` and `↺ reset`. When a phase ends, Gentle Shell shows a notice, even if another tab is open. CPU and RAM refresh every 2 seconds (`SHELL_EXTRAS_SYSTEM_POLL_MS`) while the tab is on screen.

## Engram tab

The **Mem** tab shows when Engram last saved something: the last successful `mem_save`, `mem_update`, `mem_session_summary` or `mem_capture_passive` call. The time is kept in the shell-extras settings, so it survives restarts.

Click `⟳ recordar ahora` to ask the agent to save a session summary right away. If the agent is busy, the request is queued as a follow-up. The button reads `✓ pedido enviado` for 10 seconds, and clicks during that time are ignored.

## Ulisao

Ulisao, the estudiobaretta.com.ar bot, floats at the bottom of the fullscreen rail as a round ASCII face. It bobs over its shadow, blinks and winks. It is pure decoration: it does not react to clicks, and it animates only while the rail is on screen.

- It needs the gentle-shell `section.anchor: "bottom"` hook from branch `feat/sidebar-bottom-anchor`. Without the hook, it shows as the last rail section.
- `SHELL_EXTRAS_ULISAO=0` hides it.
- `SHELL_EXTRAS_ULISAO_MS` sets the frame time (default 400 ms).

## Spotify tab

The **Music** tab shows the track that is playing, its artists, the device and the progress. Click its controls:

- `⏮` `⏯` `⏭` go back, play or pause, and skip;
- `🔀` toggles shuffle;
- `🔁` cycles repeat: off, then the playlist, then the track;
- `[-]` / `[+]` change the volume by 10%.

Controlling playback needs Spotify Premium.

To connect it once:

1. At <https://developer.spotify.com/dashboard>, create an app and select **Web API**.
2. Add the redirect URI `http://127.0.0.1:8888/callback`.
3. Copy the app's **Client ID**.
4. In Gentle Shell, run `/spotify login <client-id>`. The browser opens Spotify's consent page; accept it.

The login uses OAuth PKCE, so there is no client secret. It only asks for the scopes `user-read-playback-state`, `user-modify-playback-state` and `user-read-currently-playing`.

- The token is saved in `~/.gentle-shell/shell-extras/spotify-token.json`, which is owner-only where the OS supports it, and is refreshed automatically.
- `/spotify logout` deletes the token. `/spotify status` tells whether Spotify is connected.
- `SPOTIFY_CLIENT_ID` can supply the client ID instead.
- `SHELL_EXTRAS_SPOTIFY_PORT` changes the callback port; change the redirect URI in the app to match.
- The player refreshes every 3 seconds (`SHELL_EXTRAS_SPOTIFY_POLL_MS`) while the tab is on screen.

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
