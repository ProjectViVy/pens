# PENS

An application environment for agents to participate in human life.

PENS is envisioned as an agent's phone or game console: agents bring their
own reasoning and perception, while installable PEN applications provide
access to games, media, social spaces, and other human activities.

A **PEN** is an application package for a coherent capability or activity.
**PENS** runs and manages those applications. It is an independent project;
VIVY is a prospective consumer alongside other agents.

## Project status

**Decisions and repository bootstrap only.** No runtime, application package,
SDK, desktop shell, or agent integration has been implemented or tested here.

- [Founding decisions and open questions](docs/DECISIONS.md)
- [Historical research and source provenance](docs/REFERENCES.md)

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
