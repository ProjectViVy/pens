# PENS

An application environment for agents to participate in human life.

PENS is envisioned as an agent's phone or game console: agents bring their
own reasoning and perception, while installable PEN applications provide
access to games, media, social spaces, and other human activities.

A **PEN** is an application package for a coherent capability or activity.
**PENS** runs and manages those applications. It is an independent project;
VIVY is a prospective consumer alongside other agents.

## Project status

**Decisions, repository bootstrap, the panel source, and the first application
source wired to it.** The panel opens the digital human in its own window,
running the stage application. No PENS runtime, application package format, SDK,
desktop shell, or agent integration has been implemented or tested here.

- [Founding decisions and open questions](docs/DECISIONS.md)
- [Historical research and source provenance](docs/REFERENCES.md)
- [The panel: what it is and what is still missing](docs/UI.md)

## Layout

- `index.html`, `main.cjs`, `package-win.cjs`, `package.json` — the PENS panel,
  at the repository root since [D-009](docs/DECISIONS.md). One self-contained
  HTML launcher plus a minimal Electron runner.
- `preload.cjs`, `stage-session.cjs`, `stage-window.cjs` — the only bridge to an
  application: two IPC calls, one process launcher, one window
  ([D-010](docs/DECISIONS.md)).
- `apps/stage-app/` — an application: the Live2D character stage.
- `apps/<name>/` — home for further applications; the location is reversible.
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

## The digital human

`apps/stage-app/` is a separate Node process with a token-guarded loopback API.
The panel does not render it and does not import it: clicking **数字人** starts
that process if needed and opens a second `BrowserWindow` pointed at it. The
window has its own session partition, its own renderer process,
`nodeIntegration` off, `sandbox` on, and `backgroundThrottling` off, so hiding
the panel does not slow the stage.

Two local assets are required and are **not** in the repository, because neither
may be redistributed:

- `apps/stage-app/vendor/live2dcubismcore.min.js` — Live2D Cubism Core, under
  Live2D's own terms. Without it the stage reports an explicit error.
- `apps/stage-app/models/<name>/` — a model directory you own; copy one in, or
  point `PENS_STAGE_MODELS` at a directory of models.

The wiring is exercised by `npx electron --no-sandbox tools/smoke` (with
`--user-data-dir` in a sandboxed shell): it clicks the tile, asserts the second
window, measures frames with the panel hidden, and closes it through the panel
again.

## Applications

- `apps/stage-app/` — Live2D character stage, imported on 2026-11-21 from
  [vivy-dsh/dsh-stage-app](https://github.com/vivy-dsh/dsh-stage-app) together
  with its commit history. It is a standalone presentation process with a
  token-guarded local HTTP API. It is not packaged as a PEN yet, and no PENS
  runtime loads it. See [D-007](docs/DECISIONS.md).

## Product direction

- Keep complex, supplementary life applications outside the agent core.
- Preserve world perception, including image and video understanding, as an
  agent-core capability.
- Package applications independently and make them usable by different agents.
- Provide a simple main panel for people to manage applications and see state.
- Validate first with **Hermes and Codex** using the same application package.

Go for the PENS service and TypeScript for the panel are the current technical
recommendation, subject to integration validation. PEN packages should not be
restricted to the host's implementation language. A future application store
is a product possibility, not an implemented or scheduled feature.
