# PENS

PENS is an operation panel for equipping agent harnesses and managing external
abilities. Import a Bundle once, then install its Skills, native plugin or
protocol configuration into the selected harnesses. Codex, Pi, Claude Code
and Hermes are the compatibility targets.

A **Bundle** is the source package for cross-harness delivery. An **Ability**
gives an agent access to an activity such as playing Minecraft or operating a
digital-human stage. A Bundle can provide an Ability alongside Skills and
host-specific entry points. Agents supply their own reasoning and perception.

## Project status

**Decisions, repository bootstrap, the panel source, and two applications wired
to it.** The 数字人 page opens both applications in their own windows: the Live2D
stage and DivaVidol. Bundle conversion and installation, MSP lifecycle
management, and harness integration await implementation and verification.

- [Design decisions and open questions](docs/DECISIONS.md)
- [Historical research and source provenance](docs/REFERENCES.md)
- [The panel: what it is and what is still missing](docs/UI.md)

## Layout

- `index.html`, `main.cjs`, `package-win.cjs`, `package.json` — the PENS
  panel, at the repository root since [D-009](docs/DECISIONS.md). One
  self-contained HTML launcher plus a minimal Electron runner.
- `preload.cjs` — the whole renderer bridge: four IPC calls, nothing else.
- `app-window.cjs` — the shared child-window behaviour: own session partition,
  own renderer, `sandbox`, no preload, navigation confined to the app's origin.
- `stage-session.cjs`, `stage-window.cjs` — the Live2D stage: process launcher
  and window registration.
- `vidol-session.cjs`, `vidol-window.cjs` — DivaVidol: Next server launcher and
  window registration.
- `apps/stage-app/` — application one: the Live2D character stage.
- `apps/diva-vidol/` — application two: DivaVidol, a port of
  [lobe-vidol](https://github.com/lobehub/lobe-vidol) (Apache-2.0). See its
  [IMPORT.md](apps/diva-vidol/IMPORT.md).
- `docs/` — decisions, provenance, and panel notes.

## Running the panel

```
npm install
npm start            # electron .
npm run package:win  # writes dist/PENS-win32-x64/ and a zip
```

The panel is UI only: no PENS runtime, no PEN package, and no agent integration.
The Electron runner exists to run the current UI; it does not settle the
desktop-shell question.

Two environment notes for a first run:

- If the shell is **elevated**, Electron needs `--no-sandbox`
  (`npx electron --no-sandbox .`).
- If `%APPDATA%` is not writable for the process, add
  `--user-data-dir=<writable directory>`; Chromium keeps its cache there.

DivaVidol needs its dependencies once, in its own directory:

```
cd apps/diva-vidol && npm install --legacy-peer-deps
```

Standard `npm install` fails there: upstream pins `antd ~5.18.3` while current
`@lobehub/icons` requires `antd ^5.23`.

It also needs its own assets (VRM models, scenes, animations, ~246 MB). They are
not in the repository; see
[apps/diva-vidol/IMPORT.md](apps/diva-vidol/IMPORT.md).

**Importing a character:** in the stage settings drawer open 人物 and press
导入 VRM. The file is kept in this machine's browser storage (IndexedDB), never in the
repository, and shows up next to the built-in characters.

## The 数字人 page

Two applications, one mechanism: each is a separate process, and each gets its
own window with its own session partition.

| Entry | Process | Window |
| --- | --- | --- |
| 数字人 | `apps/stage-app/server.mjs` (token-guarded loopback API) | title 数字人, partition `persist:pens-stage` |
| DivaVidol | `next dev` in `apps/diva-vidol` (loopback, random port) | title DivaVidol, partition `persist:pens-vidol` |

Hiding the panel slows neither of them: both windows have
`backgroundThrottling` off and their own renderer process. **停止** in the
panel's running list closes the matching window; quitting the panel stops the
processes it started.

Two local assets are required by the stage and are **not** in the repository,
because neither may be redistributed:

- `apps/stage-app/vendor/live2dcubismcore.min.js` — Live2D Cubism Core, under
  Live2D's own terms. Without it the stage reports an explicit error.
- `apps/stage-app/models/<name>/` — a model directory you own; copy one in, or
  point `PENS_STAGE_MODELS` at a directory of models.

DivaVidol needs a model provider key only for chatting; the interface opens
without one. Its own assets are local-only (see above), and without them the
scene list is empty and no character appears.

The stage wiring is exercised by `npx electron --no-sandbox tools/smoke` (with
`--user-data-dir` in a sandboxed shell).

## Applications

- `apps/stage-app/` — Live2D character stage, imported on 2026-11-21 from
  [vivy-dsh/dsh-stage-app](https://github.com/vivy-dsh/dsh-stage-app) together
  with its commit history. It is a standalone presentation process with a
  token-guarded local HTTP API. See [D-007](docs/DECISIONS.md).
- `apps/diva-vidol/` — DivaVidol, the owner's VRM stage: a fork of
  `lobehub/lobe-vidol` (last upstream commit `fa50051`, Apache-2.0, license kept)
  rewritten into a 3D classroom with a VRM character. Imported from the owner's
  working tree on 2026-11-22; 396 files differ from upstream. It runs as a
  Next.js server the panel starts on demand. See
  [D-013](docs/DECISIONS.md) and [IMPORT.md](apps/diva-vidol/IMPORT.md).

Neither is packaged as a PEN yet, and no PENS runtime loads them.

## Product direction

- Install simple Skills directly in the intended scope. Reuse native plugin
  entry points and generate host-specific configuration where behavior can be
  preserved. Show compatibility gaps before installation.
- Select Skill, native plugin, MCP or MSP support according to the package
  requirements and the target harness. Track each installation so it can be
  removed cleanly from the intended scope.
- Manage an MSP node's runtime independently of each harness attachment.
  Starting or stopping a node and connecting or detaching an agent are
  distinct actions in the panel.

See [D-018](docs/DECISIONS.md#d-018--bundles-adapt-to-the-harness-and-abilities-have-a-runtime-lifecycle)
for the design and proposed validation samples.
