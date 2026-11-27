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

Moved to the repository root on 2026-11-22 by D-009; file contents unchanged.
The four placeholders listed above were removed by D-010, which also wired
数字人 to `apps/stage-app/`.

### D-009 — The panel sits at the repository root

Proposed by the owner on 2026-11-22 (Asia/Shanghai): make the panel repository
the main repository, with `stage-app` as one directory under `apps/`. Tried on
the branch `try/ui-at-root`.

What changed: `index.html`, `main.cjs`, `package-win.cjs`, `package.json` and
`.gitignore` moved from `apps/pens-ui/` to the root using `git mv` (renames
recorded, contents unchanged); the panel notes became `docs/UI.md`; the root
README now documents the layout and how to run the panel.

Why this layout: the panel is the one human-facing surface and the thing a
person starts, so it is the repository's front door; applications are
installable units and stay under `apps/`. `apps/stage-app/` already followed
that rule and is untouched by this move.

What this does not settle:

- The desktop-shell question (D-001, D-005). The Electron runner is still an
  unratified way to run the UI, not a chosen shell.
- The PENS runtime, PEN package format and agent integration still do not exist.
  Nothing here is a package, and the panel does not load `apps/stage-app/`.
- Where a future runtime, SDK or core lives. A root-level panel frees `apps/`
  for applications but does not decide `core/` or `sdk/`.
- Whether the panel should stay at the root once a runtime exists.

## D-010 — The digital human is a separate process behind a child window

Proposed by the owner on 2026-11-22 (Asia/Shanghai): clicking 数字人 must open a
fully independent child window running the real stage application, all
placeholders must go, and the two windows should be as independent as practical
for performance.

Implemented:

- The stage runs as its own Node process, spawned by `stage-session.cjs` on a
  free loopback port with a per-session token and `STAGE_MODELS` pointing at a
  local model directory. The panel talks to it over nothing but that URL.
- Clicking the tile opens a second `BrowserWindow` with its own session
  partition (`persist:pens-stage`), `sandbox` on, `nodeIntegration` off, no
  preload, navigation restricted to the stage origin, and
  `backgroundThrottling` off. Hiding the panel does not slow the stage.
- The renderer bridge is two IPC calls (`stage:open`, `stage:close`) exposed
  through `preload.cjs`. Nothing else of Electron is reachable from the UI.
- The panel keeps no in-app page for the digital human; the placeholder
  applications (语音伙伴, 小游戏, 数独) were removed rather than hidden, so the
  panel lists thirteen entries across three pages.

Why a second window of the same app rather than a second Electron process: a
separate renderer process plus a separate session is the cheapest independence
that still shares one application lifecycle, and it was measured — 61 fps with
the panel visible and 61 fps with it hidden. The remaining shared piece is
Chromium's GPU process; a second Electron process would buy a second GPU process
at the cost of another full runtime and lifecycle, which is not justified before
a measurement shows contention.

What this does not settle:

- Whether the panel should own the stage process forever, or whether the stage
  should become a separately installed PEN. Today the panel owns it and stops it
  on quit; the stage window itself is independent of the panel window.
- Model and Cubism Core distribution. Both are local-only and gitignored, so a
  fresh clone shows the stage's explicit "no model" state rather than a picture.
- The shell decision (D-001, D-005). This is still the Electron runner.

## D-011 — The product is DIVA-OLV; PENS stays the vocabulary

> Superseded by D-017: the DIVA-OLV name was wrong and the product is PENS again.

Proposed by the owner on 2026-11-22 (Asia/Shanghai): 名字需要修改为 DIVA-OLV，备注原项目.

What changed:

- The panel names itself **DIVA-OLV** everywhere a person can see it: window
  title, wordmark, desktop aria-label, app header hint, settings, notes, the
  downloaded drawing file, and the packaged artifact name
  (`dist/DIVA-OLV-win32-x64/`, `DIVA-OLV-Demo-Windows-x64.zip`).
- `package.json` is `diva-olv` / `DIVA-OLV`, description records the origin.
- README opens with the rename and points back to the original name.

What deliberately did not change:

- The repository is still `pens`, and the document vocabulary (`PEN`, `PENS`)
  is unchanged — this decision renames a product, not a project. Existing
  decisions keep their original wording.
- The renderer bridge is still `window.pens`. It is an internal identifier, and
  renaming it would churn the bridge, the panel and the smoke test for no
  visible gain.

Rollback: revert the one commit; no state or data format moved.

## D-012 — DivaVidol is the second application, imported as a snapshot

> Superseded by D-013: the project imported here was the wrong one. The directory
> and the panel entry survived; the contents became the VRM stage fork.

Asked for on 2026-11-22 (Asia/Shanghai): 移植 lobe-vidol，加入数字人板块，取名 DivaVidol.

What was done:

- `apps/diva-vidol/` holds `lobehub/lobe-vidol` `0.30.0` as a **snapshot** of
  its tracked files at `fa50051` (`git archive HEAD`), not a subtree: upstream
  is third-party Apache-2.0 code whose history we have no reason to carry, and
  the snapshot plus `IMPORT.md` records exactly which commit it came from. The
  upstream `LICENSE` stays in place.
- It runs as a Next.js server the panel starts on demand
  (`vidol-session.cjs`): random loopback port, `next dev`, ready when the page
  answers. Window behaviour is shared with the stage through `app-window.cjs`;
  the window has its own partition (`persist:pens-vidol`), sandbox, no preload.
- The 数字人 page now has two entries: 数字人 (stage) and DivaVidol.
- Dependencies are installed once by hand with `--legacy-peer-deps`: upstream
  pins `antd ~5.18.3` while current `@lobehub/icons` peers on `antd ^5.23`. The
  panel refuses with an explicit message if `node_modules/next` is missing
  rather than silently installing a few hundred megabytes.

What this does not settle:

- Whether DivaVidol should become a packaged PEN or stay a development server.
  Today the panel runs `next dev`; a production build (`next build` +
  `next start`) would boot faster but adds a build step to every change.
- Whether the ported UI should keep upstream's branding inside the app. Only
  the entry, window title and directory say DivaVidol.
- Model provider configuration. The app opens without a key; chatting needs
  one, set in the app or via environment variables.

## D-013 — DivaVidol is the owner's VRM stage fork, not an upstream snapshot

Corrected on 2026-11-22 (Asia/Shanghai): 项目好像传错了，…实际上应该传的是这个.

What happened: D-012 imported `lobehub/lobe-vidol` as an unmodified snapshot. That
was the wrong project. The application meant for the 数字人 page is the owner's own
working copy at `Desktop\diva-stage-vrm` — a fork of lobe-vidol rewritten into a 3D
classroom with a VRM character (396 files changed against upstream, +2908/−71998,
PWA and the voice-list runtime removed, VRM stage modules added).

What changed:

- `apps/diva-vidol/` now holds that working tree instead of the upstream snapshot.
  The history keeps the wrong import (it was already pushed; rewriting public
  history was rejected in favour of an explicit removal commit).
- Imported files are the source only: `node_modules`, `.next`, `.npm-cache`,
  `.downloads`, `.perf-tmp`, `shots`, `scratch` and logs are excluded. The three
  asset trees (`public/assets`, `public/environments`, `public/vrma`, ~246 MB) were
  untracked in the source project too and stay untracked here; they are gitignored
  and copied locally on this machine.
- The entry, the window title and the directory keep the name DivaVidol given
  earlier. The source project is called `diva-stage-vrm`; both names refer to the
  same application.
- Dependencies are the owner's installed tree, linked with a junction on this
  machine, so nothing had to be re-downloaded; an independent copy needs
  `npm install --legacy-peer-deps` for the reason recorded in D-012.

What this does not settle:

- Whether the app should run `next dev` (20–25 s cold start) or a production build.
- Whether the 246 MB of VRM assets should get a downloader/`buildLocalAssets`
  step for fresh machines, instead of manual copying.
- Whether the conversation inside the app should stay a keyword placeholder.
## D-014 — Imported VRM characters live in the browser, not in the repository

The 人物 settings page gained an import action (2026-11-22). A chosen `.vrm` file is
stored in IndexedDB (`diva-local-vrm`: `meta` for the list, `blobs` for the file) and
the character's `modelUrl` becomes `local:<id>`, resolved to a blob URL before
`viewer.loadVrm`. Deleting it from the same page returns the stage to the default
character.

Why not write the file into `public/assets/agents/`: the stage is a front-end
application — it runs in an Electron child window and in an ordinary browser — so it
has no API for writing to disk. A Next route handler could write those files, but it
would only work while the dev server runs from the checkout, it would need a
manifest/rescan step, and it would put a user's model inside the repository working
tree. IndexedDB costs no server, survives reload and restart, and keeps imported
avatars out of git, consistent with the asset rule.

Consequences, accepted: imported characters are per-machine (per browser profile);
they carry no thumbnail (a generated initials tile is used); they are treated as
female for touch reactions; and the library is invisible to a packaged release that
starts with a fresh profile.
## D-015 — Character facing is normalised once, by `VRMUtils.rotateVRM0`

VRM 0.x models are authored facing −Z; VRM 1.0 models face +Z. `VRMUtils.rotateVRM0`
closes that gap by rotating a VRM0 scene by 180°, so after it every model faces +Z and
the rest of the stage code (walking, turning, framing) can assume one convention.

`Model.loadVRM` used to set `vrm.scene.rotation.y = Math.PI` unconditionally right
after `rotateVRM0`. For VRM0 that was the same value the helper had just written, so
it was invisible; for VRM1 it turned the model another 180°, which made imported
VRM 1.0 characters stand with their back to the camera and appear to walk backwards
(the navigator moves along the root's yaw, so the visual front was opposite the
movement direction). Fixed 2026-11-22 by dropping the second assignment: a model's
scene rotation is now set only by the spec-aware helper, and the `ModelRoot` shell
exists solely to carry position and yaw.

Lesson: when a library helper already normalises orientation across spec versions,
do not stack a constant correction on top of it — the constant is only correct for
one of the two versions.
## D-016 — Body axes come from bone positions, never from a bone's local axes

The knee joint limiter computed its hinge axis as the hips bone's local X axis
rotated into world space, and the foot IK took "body forward" as the hips bone's
local +Z. Both are only correct for one rig convention. Measured on the two rigs
the stage actually loads:

| model | hips local X in world | hips local Z in world |
| --- | --- | --- |
| 莉莉娅 (VRM 0, VRoid) | (−1, 0, 0) | (0, 0, −1) |
| 汐 (VRM 1) | (1, 0, 0) | (0, 0, 1) |

The rigs differ by 180° about Y, so on the imported VRM 1.0 character a natural
forward knee bend read as hyperextension: `clamped` was 2 every single frame and
the limiter kept snapping her shins back to the 3° extension boundary. Forcing
+60° through the debug knob bent her knee *forward* while the same value bent the
VRM 0 character's knee *backward* — the axis was simply inverted.

Fix (2026-11-22): `updateBodyFrame()` in `libs/emoteController/bodyFrame.ts`
derives the body frame from the world positions of the two upper legs — right
direction = right leg minus left leg, forward = world up × right direction. No
bone rotation is ever read. Both the knee hinge axis and the IK pole vector use
it. For VRM 0 rigs the values are identical to the old ones (their hips local X
happened to equal the anatomical right axis), so built-in characters are
unaffected; for VRM 1.0 rigs the axis flips to match.

The IK pole change is a fix too, not just a port: on VRM 0 rigs the old pole
pointed *backward* (hips local +Z is −Z in world there), i.e. opposite to what its
own comment claimed. It went unnoticed because the IK is skipped whenever the
ankle is already within 0.005 m of its target, which is the usual standing pose.

Lesson: "this bone's local axis is the body axis" is a rig-convention assumption,
not a fact. Derive anatomical directions from geometry (relative bone positions),
which is invariant across exporters, and keep the sign convention anchored to one
reference rig with measurements.

## D-017 — The product name is PENS; the DIVA-OLV rename is reverted

Corrected on 2026-11-27 (Asia/Shanghai): 改一下名字，DIVA-OLV 这个名字不对，就叫做 PENS.

What changed:

- Every human-visible product name is **PENS** again: window title, wordmark,
  desktop aria-label, app header hint, settings and about text, notes, the
  downloaded drawing file, and the packaged artifact name
  (`dist/PENS-win32-x64/`, `PENS-Demo-Windows-x64.zip`).
- `package.json` is `pens` / `PENS`; `description` no longer mentions the
  earlier name.
- README and the panel notes drop the DIVA-OLV rename paragraph, so a reader is
  not told the product is called something it is not.

What deliberately did not change:

- The repository is still `pens`, and the document vocabulary (`PEN`, `PENS`)
  is unchanged.
- The renderer bridge is still `window.pens` and the session partitions are
  still `persist:pens-*`; they are internal identifiers and were already PENS.

History: D-011 introduced DIVA-OLV on 2026-11-22; it is marked superseded here.
Rollback: revert the one commit; no state or data format moved.

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
