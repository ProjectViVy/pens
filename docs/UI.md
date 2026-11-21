# The PENS panel

The human-facing PENS surface: an Apple-like launcher with a right-hand activity
panel. One self-contained HTML file plus a minimal Electron runner. Since
D-009 these files live at the repository root, next to `apps/`.

| File | Role |
| --- | --- |
| `index.html` | The whole UI: inline CSS and one inline script. No external requests. |
| `main.cjs` | Electron 45.4.1 window, 1280×900 (min 480×420); `contextIsolation` and `sandbox` on, Node integration off, popups and navigation denied, F11 toggles fullscreen, no application menu. |
| `package-win.cjs` | `@electron/packager` build for Windows x64: `dist/PENS-win32-x64/` plus a zip containing only the three app files. |

## What the UI contains

Four pages (常用 / 数字人 / 游戏 / 生产力) and sixteen entries: notes, calendar,
reminders, files, photos, drawing board, clock, calculator, reading, focus,
contacts, settings, digital human, voice companion, mini game, sudoku.

- **Implemented:** notes (autosaved), calendar, reminders, contacts, files,
  photos, drawing board, clock, calculator, reading, focus timer, settings
  (dark mode and desktop tone).
- **Placeholders:** 数字人, 语音伙伴, 小游戏, 数独 render "这个应用还在准备中".
- **Persistence:** only `pens-notes`, `pens-tasks`, `pens-contacts` and
  `pens-sidebar` are written to `localStorage`. Photo and file lists live in
  memory for the current session only.
- **No network:** no `fetch`, `XMLHttpRequest`, WebSocket, or external URL in the
  file. Keep it that way until a PENS runtime provides a real transport.

## Run

```
npm install
npm start            # electron .
npm run package:win  # writes dist/PENS-win32-x64/ and PENS-Demo-Windows-x64.zip
```

## Provenance

Imported on 2026-11-22 (Asia/Shanghai) from the owner's Open Design project
`pens-demo`; its HTML artifact was created 2026-11-11. Authoring directory:
`%APPDATA%\Open Design\namespaces\release-stable-win\data\projects\578dd190-e4b3-44fd-81b0-9e9bd637b134`.
The files first landed in `apps/pens-ui/` and were moved to the repository root
by D-009 without content changes.

- Copied byte-identical: `index.html`, `main.cjs`, `package-win.cjs`.
- Changed: `package.json` (`name` `pens-demo` → `pens-ui`, description).
- Added: this document and `.gitignore`.
- Not imported: `node_modules/`, `dist/` (a 507 MB packaged build),
  `.file-versions/` (eight HTML snapshots), `.od-frames/`, `.od-skills/`, and
  `index.html.artifact.json` (Open Design bookkeeping).

## Boundaries

This is a UI, not a PEN.

- No PENS runtime, manifest, package identity, permissions, lifecycle, or
  agent-facing contract exists here, so nothing here is packaged as a PEN.
- Nothing is wired to `apps/stage-app/`: no character rendering, no wake-up
  child window, no voice pipeline.
- The Electron wrapper only runs the UI. It is not the desktop-shell decision
  described in [D-001](DECISIONS.md) and D-005; the shell choice is still
  unratified.
- The settings screen shows "关于 PENS 1.0" while `package.json` says `0.1.0`.
