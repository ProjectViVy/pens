# The PENS panel

The human-facing PENS surface: an Apple-like launcher with a right-hand activity
panel. One self-contained HTML file plus a minimal Electron runner. Since
D-009 these files live at the repository root, next to `apps/`; since D-010 the
panel can open the digital human in its own window.

| File | Role |
| --- | --- |
| `index.html` | The whole UI: inline CSS and one inline script. No external requests of its own. |
| `main.cjs` | Electron 45.4.1 window, 1280×900 (min 480×420); `contextIsolation` and `sandbox` on, Node integration off, popups and navigation denied, F11 toggles fullscreen, no application menu. Registers the two stage IPC calls. |
| `preload.cjs` | The only bridge: `window.pens.openStage()` / `closeStage()`, nothing else. |
| `stage-session.cjs` | Starts `apps/stage-app/server.mjs` as its own process on a free loopback port, with a per-session token; reuses the process while it is alive. |
| `stage-window.cjs` | The digital-human `BrowserWindow`: own session partition, `sandbox`, no preload, `backgroundThrottling` off, stage-origin navigation only. |
| `package-win.cjs` | `@electron/packager` build for Windows x64: `dist/PENS-win32-x64/` plus a zip. Models, Cubism Core and `.cache/` are excluded. |

## What the UI contains

Three pages (常用 / 数字人 / 生产力) and thirteen entries: notes, calendar,
photos, clock, digital human, files, reminders, focus, calculator, drawing
board, reading, contacts, settings.

- **Implemented:** notes (autosaved), calendar, reminders, contacts, files,
  photos, drawing board, clock, calculator, reading, focus timer, settings
  (dark mode and desktop tone).
- **Real application:** 数字人 opens the stage application in a separate window
  ([D-010](DECISIONS.md)); the panel itself renders no character.
- **Removed placeholders:** 语音伙伴, 小游戏 and 数独 are gone rather than
  hidden. The 游戏 page they lived on is gone too.
- **Persistence:** only `pens-notes`, `pens-tasks`, `pens-contacts` and
  `pens-sidebar` are written to `localStorage`. Photo and file lists live in
  memory for the current session only.
- **No network in the panel:** no `fetch`, `XMLHttpRequest`, WebSocket, or
  external URL in `index.html`. The stage page has its own loopback HTTP client;
  that code is never loaded in the panel's window.

## Run

```
npm install
npm start            # electron .
npm run package:win  # writes dist/PENS-win32-x64/ and PENS-Demo-Windows-x64.zip
```

An elevated shell needs `--no-sandbox`; a process without a writable `%APPDATA%`
needs `--user-data-dir=<writable path>`.

## The digital human window

- Click **数字人**: `stage-session.cjs` starts the stage process (if it is not
  already alive), then a second window loads `http://127.0.0.1:<port>/`.
- The window is independent of the panel window: separate renderer process,
  separate session partition, no Node, no preload, throttling off. Measured with
  the smoke test: 61 fps while the panel is visible and 61 fps while it is
  hidden.
- **停止** in the panel's 正在运行 list closes that window (`stage:close`).
  Quitting the panel stops the stage process it started.
- Missing model or Cubism Core is shown by the stage page itself, not by the
  panel. Both assets are local-only and gitignored
  (see the repository README).

## Verification

`tools/smoke/` is a small Electron app directory. Run it with the flags this
environment needs (an elevated shell needs `--no-sandbox`; a shell without a
writable `%APPDATA%` needs `--user-data-dir`):

```
npx electron --no-sandbox --user-data-dir=<writable dir> tools/smoke
```

It clicks the tile, asserts that a second window with title 数字人 appeared, that
its renderer has no `require`/`process`, that a canvas exists, measures frames
with the panel visible and hidden, then clicks 停止 and asserts the window is
gone. It writes `smoke.log` and two PNGs to `$PENS_SMOKE_OUT`.

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
- Changed by D-010: the three placeholder entries, their page, their empty-state
  branch, and the digital-human tile's in-app page; added the child-window
  wiring described above.

## Boundaries

This is a UI with one wired application, not a PENS runtime.

- No PENS runtime, manifest, package identity, permissions, lifecycle, or
  agent-facing contract exists here, so nothing here is packaged as a PEN.
- The only wiring to an application is the stage window; there is no wake-up
  pipeline, no voice input, and no agent control of the stage from the panel.
- The Electron wrapper only runs the UI. It is not the desktop-shell decision
  described in [D-001](DECISIONS.md) and D-005; the shell choice is still
  unratified.
- The settings screen shows "关于 PENS 1.0" while `package.json` says `0.1.0`.
