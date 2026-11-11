# Sidebar widgets for Gentle Shell

This adds tabbed widgets to the Gentle Shell fullscreen rail: Git, project, system, Spotify, and Engram. It also adds an animated Ulisao icon pinned to the bottom of the rail.
The widgets live in `shell-extras`, on branch `feat/sidebar-widgets`, which starts from `feat/file-explorer`. The `gentle-shell` fork only gets a generic bottom-anchor hook, on branch `feat/sidebar-bottom-anchor`, which starts from `feat/sidebar-extension-sections`.

## Specs

- S1 Ulisao: "quisiera que abajo aparezca flotando el circulito de ulisao, el bot en estudiobaretta.com.ar". User: "solo quiero el icono flotando abajo, nada mas, es pura ui". On how it looks, the user said: "no se puede renderizar para que se mueva? de ultima armalo con ascii". So it is an animated ASCII circle, pinned to the bottom of the rail, with no behavior.
- S2 Spotify: "algo que me conecte con spotify para no tener que moverme entre programas". User: "tengo premium, vamos con los controles totales". It uses the Spotify Web API with OAuth PKCE. It shows the current track, artist, and progress, and has controls for previous, play/pause, next, shuffle, repeat, and volume.
- S3 Tabs: "armate pestañas arriba, y accedes a una pestaña para ver las cosas dentro de ella y ahi se encontraria cada cosa". The rail shows a tab bar at the top. A click on a tab shows only that tab's widgets.
- S4 Ideas the user accepted ("me gustaron todas las ideas"):
  - Git: current branch, commits ahead and behind, and the PR and CI state via `gh`.
  - Project scripts from `package.json`, launched with a click, plus listening ports and dev servers.
  - Progress of the active ODD feature from `odd/tasks`.
  - Pomodoro or clock, plus CPU and RAM.
  - Running Docker containers.
- S5 Engram: "algo que muestre la ultima vez que engram guardo informacion, y un boton que diga algo como "recordar ahora" y ahi guarde la info, de manera manual". Answer: "Le pide al agente que guarde un resumen de la sesión".

## Tasks

- [x] T1 S1 — gentle-shell fork: an opt-in `section.anchor: "bottom"` that pins a section to the bottom of the rail. Includes tests and docs. Route: inline. Commit: gentle-shell 35ea7c0b0
- [x] T2 S3 — shell-extras: the tab container section (tab bar, click to switch, active tab persisted). The explorer moves into the "Files" tab. Route: inline. Commit: ec9194e
- [x] T3 S4 — Git tab: branch, ahead/behind, PR and CI. Route: inline. Commit: b86228b
- [x] T4 S4 — Project tab: scripts launcher, listening ports, Docker containers, ODD progress. Route: inline. Commit: ca1e7e7
- [x] T5 S4 — System tab: clock, pomodoro, CPU and RAM. Route: inline (the worker was unavailable). Commit: f272d65
- [x] T6 S2 — Spotify tab: PKCE login command, token storage, now playing, controls. Risk: item 2 (credentials), so it gets its own commit and an independent verify. Route: inline plus gentle-ai-verify. Commit: f8c0893, fix 2701e1e
- [x] T7 S5 — Engram tab: last save time and a "recordar ahora" button. Route: inline. Commit: e45182e
- [x] T8 S1 — Ulisao animated ASCII icon pinned to the bottom (uses T1). Route: inline. Commit: eb1b8a8
- [ ] T9 S1-S5 — README and the user's live check. Route: inline plus the user. Commit: README in each feature commit; Try it in the closing commit. Pending: the user's live check and the first `/spotify login`.

## Log

- L1 (user): "segui con lo de la sidebar, que otras funcionalidades podemos agregarle? quisiera que abajo aparezca flotando el circulito de ulisao, el bot en estudiobaretta.com.ar, tambien algo que me conecte con spotify para no tener que moverme entre programas"
- L2 (user): "1- ulisao es mio si,pero solo quiero el icono flotando abajo, nada mas, es pura ui. 2- tengo premium, vamos con los controles totales 3- fijate si con el parche funciona 4- me gustaron todas las ideas y se me ocurrio una mas: algo que muestre la ultima vez que engram guardo informacion, y un boton que diga algo como "recordar ahora" y ahi guarde la info, de manera manual"
- L3 (user answers):
  - icon: "no se puede renderizar para que se mueva? de ultima armalo con ascii"
  - recordar ahora: "Le pide al agente que guarde un resumen de la sesión"
  - sections: "armate pestañas arriba, y accedes a una pestaña para ver las cosas dentro de ella y ahi se encontraria cada cosa"
- L4 (evidence, patch): pi-ai@1.5.0 hardcodes `claudeCodeVersion = "2.1.280"`.
  - The patch changes it to "2.1.322" in pi-ai `dist/api/anthropic-messages.js` and in pi-coding-agent `dist/bundle/chunks/anthropic-messages-BWGCKOF4.js`. Backups are saved as `*.bak-2.1.280`.
  - With the patch, `gentle-shell -p --model claude-fable-5-2` answered "ok".
- L5 (exploration):
  - The rail has no bottom anchoring. Sections are stacked in one ScrollView, and their height comes from their content (`gentle-shell/lib/shell-sidebar-layout.ts` ~300-345).
  - Parts register through `state.parts` with `section.order`. `render(width)` returns lines, and `handleMouse` gets part-local x/y.
  - `pi.sendUserMessage` needs `deliverAs` while the agent is streaming.
- L6 (evidence):
  - T1 RED was observed: three tests failed before the anchor existed. Afterwards `shell-sidebar-layout` and `shell-panel` pass 100/100.
  - T2 and T3 RED were observed only as a missing module, because the tests were written first. The suite passes 67/67, and `tsc` is clean.
  - Design: a single "shell-extras.tabs" section (order 50) holds the tabs. Each tab is registered by `registerTabWidget` (`lib/widget-extension.ts`). State lives in `~/.gentle-shell/shell-extras/settings.json`.
- L7 (evidence): T4 passes 76/76 and `tsc` is clean. The context backstop fired at about 150k tokens, so T5, T7 and T8 go to a worker, and T6 to a worker followed by verify.
- L8 (evidence):
  - The gentle-ai-worker failed with "Writer repository preparation was unavailable", because the session cwd `Repositorios` is not a Git repository. T5–T8 were done inline.
  - T5 and T6 RED were not observed as failing assertions, because the implementation was written together with the tests.
  - T7 used `tool_execution_end` (`event.toolName`, `event.isError`) and `pi.sendUserMessage(text, { deliverAs: "followUp" })`; `tsc` validated both.
  - T8's RED was a missing module.
  - The T6 verify passed S2 with findings:
    - Medium: any refresh failure cleared the tokens.
    - Low: a logout during a refresh was undone.
    - Low: an invalid port hung the login.
    - All three got RED tests (two failed, one hung) and were fixed in 2701e1e.
    - Advisory, not changed: the `user-read-currently-playing` scope is redundant, and a 401 or 429 gets no backoff.
  - The final suite passes 113/113, and `tsc` is clean. A real Spotify login is unverified because it needs the user's app client ID.
