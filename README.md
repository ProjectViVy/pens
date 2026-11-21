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
source.** No PENS runtime, application package format, SDK, desktop shell, or
agent integration has been implemented or tested here.

- [Founding decisions and open questions](docs/DECISIONS.md)
- [Historical research and source provenance](docs/REFERENCES.md)
- [The panel: what it is and what is still missing](docs/UI.md)

## Layout

- `index.html`, `main.cjs`, `package-win.cjs`, `package.json` — the PENS panel,
  at the repository root since [D-009](docs/DECISIONS.md). One self-contained
  HTML launcher plus a minimal Electron runner.
- `apps/stage-app/` — an application: the Live2D character stage.
- `apps/<name>/` — home for further applications; the location is reversible.
- `docs/` — decisions, provenance, and panel notes.

## Running the panel

```
npm install
npm start            # electron .
npm run package:win  # writes dist/PENS-win32-x64/ and a zip
```

The panel is UI only: no PENS runtime, no PEN package, no agent integration, and
nothing wired to `apps/stage-app/`. The Electron runner exists to run the
current UI; it does not settle the desktop-shell question.

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
