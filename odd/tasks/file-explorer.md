# File explorer for the Gentle Shell sidebar

This adds an IDE-like file explorer of the current repository to the Gentle Shell fullscreen rail. The explorer lives in this package (`shell-extras`).
The only change to the `gentle-shell` fork is a small generic hook on branch `feat/sidebar-extension-sections`, which lets other packages register rail sections. It is meant to go upstream as a PR.

## Specs

- S1 Hook: another Pi package can show its own section in the fullscreen rail and in the `/gentle:panel` sheet. It opts in with `section: { order }` on a part registered in the shared sidebar state (`Symbol.for("gentle-pi.experimental-sidebar.state")`). With no opt-in part, the built-in rail and sheet output stays byte-identical.
- S2 Explorer: "quiero ver archivos y carpetas del repo en el que estoy laburando, trabaje mucho con ide entonces es algo que quiero tener a mano". It shows the tree of the session's Git root (or cwd outside Git). Folders expand and collapse.
- S3 Status: "distintos colores y/o iconos segun el estado del archivo (nuevo, editado, tracked o untracked en git, etc)". Folders show the most urgent status of their children.
- S4 "tiene que tener todo". User answer: "Sí, ignorados atenuados y colapsados". Ignored paths are listed, dimmed, and collapsed until opened.
- S5 Icons. User answer: "Nerd Font (icono por tipo de archivo)".
- S6 Activation. User answer to "¿Qué querés que pase cuando hacés click (o Enter) sobre un archivo?": "Preview en overlay". A click on a file in the rail opens a preview overlay. Because the rail has no keyboard focus, a command opens a keyboard-navigable explorer overlay, where Enter opens the preview.
- S7 Architecture. User answer: "Hook genérico en el fork + explorador en tu package".

## Tasks

- [ ] T1 S1 — gentle-shell fork: opt-in extension sections in the rail and the panel sheet, plus tests and docs. Route: inline. Commit: —
- [ ] T2 S2-S4 — shell-extras scaffold, and a pure tree and Git status model (porcelain v1 with ignored files, folder aggregation) with tests. Route: inline. Commit: —
- [ ] T3 S2-S5,S7 — rail section: tree rendering, Nerd Font icons, status colors, click to collapse, bounded viewport with the wheel, registration, and refresh. Route: inline. Commit: —
- [ ] T4 S6 — preview overlay, plus a keyboard explorer command with Enter → preview. Route: inline. Commit: —
- [ ] T5 S1-S7 — install the fork and the package locally, verify manually in Gentle Shell, write the README. Route: inline plus the user's manual check. Commit: —

## Log

- L1 (user): "como principal quiero ver archivos y carpetas del repo en el que estoy laburando, trabaje mucho con ide entonces es algo que quiero tener a mano, tiene que tener todo, distintos colores y/o iconos segun el estado del archivo (nuevo, editado, tracked o untracked en git, etc). podemos arrancar por eso de ultima"
- L2 (user answers): architecture "Hook genérico en el fork + explorador en tu package"; click "Preview en overlay"; ignored "Sí, ignorados atenuados y colapsados"; icons "Nerd Font (icono por tipo de archivo)".
- L3 (exploration):
  - The rail keys are hardcoded in `lib/shell-sidebar-layout.ts:344`, and `SHEET_ORDER` in `lib/shell-panel.ts:125`.
  - The parts registry is `state.parts`, on the terminal under `Symbol.for("gentle-pi.experimental-sidebar.state")`, so a separate package can reach it.
  - The rail has no keyboard focus; only mouse goes to the parts.
  - Visual settings reject unknown keys, so this package persists its own toggles.
  - The Changes section uses `git status --porcelain=v1 --untracked-files=all -z`, without `--ignored`.
- L4 (decisions):
  - Built-in orders are todo 100, jobs 200, agents 300, footer 400.
  - The explorer defaults to order 50 (top of the rail, "como principal"), and it is configurable.
  - The package does not import gentle-pi internals. It talks to the hook only through the shared state contract.
