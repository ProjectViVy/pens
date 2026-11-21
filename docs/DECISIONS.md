# PENS founding decisions

Date: 2026-09-29 (Asia/Shanghai); updated 2026-11-21.
Source: the project owner's discussion and repository initialization request.

This is the current decision record for PENS. **Confirmed** means explicitly
stated by the owner. **Proposed** means a recommendation discussed but not
explicitly approved. Neither status means an implementation exists.

## Confirmed product decisions

### D-001 — Independent application environment

PENS gives agents access to human activities through external applications.
The owner's product analogy is an agent's phone operating system or game
console. A PEN is an application; PENS is the environment that makes such
applications available to agents.

The product is intended to serve different agents, rather than be a
VIVY-specific subsystem. VIVY may consume PENS, but must not be a prerequisite
for using it. Hermes, OpenClaw, Codex, Claude, Grok, and other agent products
were discussed as possible consumers. This list expresses intended reach,
not verified compatibility or available integration APIs.

### D-002 — Supplementary life capabilities are external

The primary scope is non-coding applications that let an agent participate
in human life: playing games, watching films, and joining social spaces such
as QQ or WeChat groups.

These applications can be large, noisy, or operationally complex. Embedding
each one into an agent can increase dependencies and maintenance burden or
interfere with its harness. PENS aims to place that complexity behind a
reusable application boundary. Whether interference is actually reduced must
be measured; moving code outside the core alone does not establish it.

### D-003 — World perception remains an agent-core capability

World perception, including image and video input and understanding, belongs
to the agent core. PENS supplies interfaces to activities and environments.

For example, a film application can provide playback, media access, position,
and interaction with the player. A game application can provide connection
and game-specific actions. The agent retains its own perception, reasoning,
and decisions about the supplied observations.

This distinction supersedes any reading of the historical DIVA proposal that
would make basic world perception depend on installing a PEN. The precise
boundary between device capture, transport, processing, and core perception
still requires an interface design.

### D-004 — Applications are distributed as packages

A PEN must exist as a package. The owner described one function as one
package and explicitly raised the possibility of an application store.
Package format, installation, update rules, distribution, and store operation
have not been chosen.

A proposed interpretation is one coherent application per package, with its
related actions and events together. Granularity remains to be validated;
the discussion did not require one package per low-level tool operation.

### D-005 — Simple main panel

The primary human-facing surface should be a simple main panel, with the
visual simplicity of an Apple desktop. This is a product direction, not a
choice of desktop framework or a requirement to reproduce a particular UI.

### D-006 — Hermes and Codex are the first validation consumers

The owner explicitly selected Hermes and Codex for the initial test instead
of starting with VIVY. This should expose assumptions that accidentally tie
PENS to the author's own agent framework.

The exact Hermes distribution/version and Codex surface/version must be
pinned during the integration investigation. No integration test has run.
VIVY remains a later prospective consumer; no rollout schedule is assigned.

### D-007 — The stage application moves into PENS

Confirmed on 2026-11-21 (Asia/Shanghai): the owner moved the Live2D character
stage out of the agent repository. Its source was imported from
`vivy-dsh/dsh-stage-app` (commit `828bf5c3`) into `apps/stage-app/` with its
commit history. The DIVA repository will reference the PENS checkout instead
of keeping its own copy, and this machine will stop keeping
`dsh-live2d`-type resources. The second and third parts are stated direction,
not done work.

What is true after the import:

- The imported tree is identical to the source commit (39 tracked files, same
  blob hashes). The source repository still exists and remains provenance for
  its own history.
- The application is **not** packaged as a PEN: no manifest, identity,
  permissions, lifecycle, or agent-facing contract has been defined. Its
  existing token-guarded local HTTP API is its only interface.
- Proprietary assets stay out of the repository, as before: Live2D Cubism Core
  (`apps/stage-app/vendor/live2dcubismcore.min.js`), the Hiyori sample model
  (`apps/stage-app/demo/Hiyori/`), and character models are supplied locally.
- No PENS runtime, SDK, or agent integration exists, so nothing here validates
  the Hermes/Codex proof.

Still open here: the layout for future applications (`apps/<name>/` is the
current, reversible choice), the PEN manifest format, and how a consumer
references a PENS checkout.

### D-008 — The PENS desktop surface enters the repository

The owner supplied the PENS UI on 2026-11-22 (Asia/Shanghai) and asked for it to
be integrated into PENS and pushed. Source: the Open Design project `pens-demo`,
whose HTML artifact was created 2026-11-11, copied into `apps/pens-ui/`.

What is true after the import:

- `index.html`, `main.cjs` and `package-win.cjs` are byte-identical to the
  export. `package.json` changed only in `name` (`pens-demo` → `pens-ui`) and
  description; a README and `.gitignore` were added.
- The UI is one self-contained file: four pages (常用 / 数字人 / 游戏 / 生产力),
  sixteen entries, search and install dialogs, and `localStorage`-only state.
  It makes no network requests. Twelve entries are implemented in the UI;
  数字人, 语音伙伴, 小游戏 and 数独 are placeholders.
- `main.cjs` is a minimal Electron 45.4.1 window with `contextIsolation`,
  `sandbox`, no Node integration, and denied navigation/popups. It is a run
  harness, **not** the desktop-shell decision: the shell choice is still open.
- Nothing is a PEN: no manifest, identity, permissions, lifecycle, or
  agent-facing contract. Nothing is wired to `apps/stage-app/`, and the
  Hermes/Codex proof is untouched.
- Distribution is out of scope. `node_modules/`, `dist/` (a 507 MB packaged
  build) and the Open Design caches (`.file-versions/`, `.od-frames/`,
  `.od-skills/`, `index.html.artifact.json`) were not imported.

## Proposed technical direction

These recommendations are retained for the next design discussion. They are
not frozen protocol or implementation decisions.

| Proposal | Reason and remaining condition |
| --- | --- |
| Go for the PENS core service | Manage processes, connections, package lifecycle, permissions, and state; confirm against the two initial integrations |
| TypeScript for the main panel | Build the simple application surface; frontend framework and desktop packaging are open |
| Language-neutral PEN packages | Let each application use its domain ecosystem; define the actual runtime and transport contract first |
| Independent service with public agent interfaces | Demonstrate use without importing VIVY internals; public interface is not yet designed |
| Reuse compatible existing protocols where sufficient | MCP is a candidate integration mechanism, not a chosen complete application-runtime contract |
| Separate installation from activation and context exposure | Avoid injecting every installed tool and every background event into the agent; event and attention policy require validation |
| Retain application state across agent connections where appropriate | Define ownership and recovery per application; do not assume another agent inherits credentials or authorization |

The phrase "advanced harness" is a hypothesis about PENS's value. Whether it
provides harness-adjacent execution services should follow concrete needs.
The discussion did not authorize a second general agent loop, model provider
stack, personality system, or memory system inside PENS.

## Proposed first proof

Use one real PEN package with Hermes and Codex in separate test runs. The
application's business code should be identical; host integration adapters
may differ. The first application for this proof has not been selected.
Minecraft was an assistant-proposed candidate, and Browser PEN was a historical
DIVA proposal; neither is an approved PENS starting point. D-007 imported the
stage application as repository code, but it is not a packaged PEN and has not
been used in either host.

| Check | Evidence needed |
| --- | --- |
| Independence | Start PENS and the application without VIVY |
| Portability | Both agents use the same package version without business-code changes |
| Complete interaction | Read state, perform actions, receive results, and stop activity |
| Continuity | Disconnect/reconnect behavior matches the application's declared state and authorization rules |
| Interference | Observe context/tool exposure, event volume, model calls, and handling of background activity |
| Failure behavior | Make application exits, timeouts, cancellation, and denied actions visible to both hosts |

Start by validating each host separately. Concurrent control of one shared
application instance is a separate proposed experiment because it needs
control ownership and conflict behavior.

Calling one tool successfully is evidence for that call only. Streaming,
unsolicited events, wake-up, multimedia input, and recovery must be reported
per host as verified, unsupported, or untested. PENS cannot confer a host
capability that the host does not expose.

## Open decisions before implementation

1. Select and pin the actual Hermes and Codex clients and their integration paths.
2. Select the first complete application scenario and initial operating system.
3. Confirm the host language, panel framework, and process/runtime boundary.
4. Define the smallest package, identity, permissions, lifecycle, observation,
   action, and event contracts needed by that scenario.
5. Define state ownership, secret handling, cancellation, and reconnect behavior
   across the application, PENS, and each agent host.
6. Determine whether a desktop shell is necessary for the initial product.
7. Revisit store and distribution design after package use is demonstrated.

## Relationship to the historical DIVA research

The 2026-08-23 DIVA package remains a research source, with its original
proposal status and DIVA-specific assumptions. This conversation establishes
PENS as an independent, cross-agent product and clarifies core perception.
Neuro-Link, Mirror, Workbench, and Companion Node are useful historical
concepts, but their complete delivery is not automatically part of PENS v1.
See [source provenance](REFERENCES.md).
