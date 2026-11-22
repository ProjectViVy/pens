# The DIVA-OLV panel

The human-facing surface: an Apple-like launcher with a right-hand activity
panel. One self-contained HTML file plus a minimal Electron runner. Since
D-009 these files live at the repository root; since D-010 the 数字人 page opens
its applications in their own windows; the product was renamed from PENS to
DIVA-OLV by D-011.

| File | Role |
| --- | --- |
| `index.html` | The whole UI: inline CSS and one inline script. No external requests of its own. |
| `main.cjs` | Electron 45.4.1 window, 1280×900 (min 480×420); `contextIsolation` and `sandbox` on, Node integration off, popups and navigation denied, F11 toggles fullscreen, no application menu. Registers the application IPC. |
| `preload.cjs` | The only bridge: `openStage` / `closeStage` / `openVidol` / `closeVidol`, nothing else. |
| `app-window.cjs` | Shared child-window behaviour: own session partition, own renderer, sandbox, no preload, app-origin navigation only, `backgroundThrottling` off, fixed title. |
| `stage-session.cjs` | Starts `apps/stage-app/server.mjs` as its own process on a free loopback port with a per-session token. |
| `stage-window.cjs` | Registers the 数字人 window on top of `app-window.cjs`. |
| `vidol-session.cjs` | Starts DivaVidol (`next dev` in `apps/diva-vidol`, the VRM stage fork) on a free loopback port; explicit error if dependencies are missing. |
| `vidol-window.cjs` | Registers the DivaVidol window. `package-win.cjs` is the `@electron/packager` build for Windows x64: `dist/DIVA-OLV-win32-x64/` plus a zip. Models, Cubism Core, `node_modules` and `.next` are excluded. |

## What the UI contains

Three pages (常用 / 数字人 / 生产力) and fourteen entries: notes, calendar,
photos, clock, digital human, DivaVidol, files, reminders, focus, calculator,
drawing board, reading, contacts, settings.

- **Implemented:** notes (autosaved), calendar, reminders, contacts, files,
  photos, drawing board, clock, calculator, reading, focus timer, settings
  (dark mode and desktop tone).
- **Real applications:** 数字人 and DivaVidol each start a separate process and
  open in their own window ([D-010](DECISIONS.md), [D-012](DECISIONS.md)); the
  panel itself renders no character and no chat.
- **Removed placeholders:** 语音伙伴, 小游戏 and 数独 are gone rather than
  hidden, and so is the 游戏 page they lived on.
- **Persistence:** only `pens-notes`, `pens-tasks`, `pens-contacts` and
  `pens-sidebar` are written to `localStorage`. Photo and file lists live in
  memory for the current session only. (Storage keys keep their original names;
  renaming them would drop existing notes.)
- **No network in the panel:** no `fetch`, `XMLHttpRequest`, WebSocket, or
  external URL in `index.html`. The applications have their own clients; that
  code never loads in the panel's window.

## Run

```
npm install
npm start            # electron .
npm run package:win  # writes dist/DIVA-OLV-win32-x64/ and a zip
```

An elevated shell needs `--no-sandbox`; a process without a writable `%APPDATA%`
needs `--user-data-dir=<writable path>`.

DivaVidol needs its own dependencies once:
`cd apps/diva-vidol && npm install --legacy-peer-deps`.

## The 数字人 page

Both entries work the same way: start a process, then open a window on it.

- **数字人** — `stage-session.cjs` starts the stage process, then a window titled
  数字人 loads `http://127.0.0.1:<port>/`.
- **DivaVidol** — `vidol-session.cjs` runs `next dev` in `apps/diva-vidol` (3D classroom + VRM character)
  (first launch compiles, so it takes a while; the panel toasts before and
  after), then a window titled DivaVidol loads it.
- Both windows are independent of the panel: separate renderer, separate
  session partition, no Node, no preload, throttling off. Measured with the
  smoke test for the stage: 61 fps while the panel is visible and 61 fps while
  it is hidden.
- **停止** in the panel's 正在运行 list closes the matching window. Quitting the
  panel stops the processes it started.
- Missing model or Cubism Core is shown by the stage page itself, not by the
  panel. Both assets are local-only and gitignored.

## Verification

`tools/smoke/` is a small Electron app directory. Run it with the flags this
environment needs (an elevated shell needs `--no-sandbox`; a shell without a
writable `%APPDATA%` needs `--user-data-dir`):

```
npx electron --no-sandbox --user-data-dir=<writable dir> tools/smoke
```

It clicks the 数字人 tile, asserts a second window with title 数字人, that its
renderer has no `require`/`process`, that a canvas exists, measures frames with
the panel visible and hidden, then clicks 停止 and asserts the window is gone.
It writes `smoke.log` and two PNGs to `$PENS_SMOKE_OUT`.

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
- Changed by D-010: the placeholder entries, their page, their empty-state
  branch, and the digital-human tile's in-app page; added the child-window
  wiring.
- Changed by D-011: every visible product name became DIVA-OLV.
- Changed by D-012: the 数字人 page gained DivaVidol; both applications share
  `app-window.cjs`.

## Boundaries

This is a UI with two wired applications, not a PENS runtime.

- No PENS runtime, manifest, package identity, permissions, lifecycle, or
  agent-facing contract exists here, so nothing here is packaged as a PEN.
- The only wiring to an application is the window launcher: no wake-up
  pipeline, no voice input, and no agent control of either application from
  the panel.
- The Electron wrapper only runs the UI. It is not the desktop-shell decision
  described in [D-001](DECISIONS.md) and D-005; the shell choice is still
  unratified.
- The settings screen shows "关于 DIVA-OLV 1.0" while `package.json` says
  `0.2.0`.
