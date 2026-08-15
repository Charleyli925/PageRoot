# ADR 0022: Edit uses one bounded ECharts isolated-capture handoff

- Status: Accepted
- Date: 2026-08-14
- Amends: the Edit-only restriction in ADR 0017; Review snapshot behavior is unchanged

## Context

Static Edit is the source-fidelity baseline, but generated local reports often
leave a uniquely bound empty host for ECharts to fill. The earlier experiment
used a hidden probe, compatibility cache, two execution identities and a later
promotion of the visible iframe. That made an asynchronous runtime decision able
to replace an iframe after native editing or commenting had started.

The desired capability is smaller: show a normal ECharts report once when it
can be prepared deterministically, then stop it before PageRoot editing begins.
It must not create a second source, a Review bitmap path or a user-facing mode.

## Decision

- Static Edit remains the default. Only desktop, exact persisted source with an
  explicit ECharts signal, ordered classic scripts and at least one unique,
  source-empty non-dangerous host may take the isolated-capture path.
- `EditAuthorRuntimeSession` is the sole application owner. Its identity is
  exactly `(sourcePath, canvasGeneration)`: comments, autosave, IME and a
  same-generation source echo cannot prepare again. A later generation revokes
  an unfinished old session; a settled session cannot re-enter preparation.
- Main re-reads the active source and verifies exact HTML/SHA before preparing
  a one-use `pageroot-edit-runtime:` resource closure. Local classic JavaScript
  and explicitly allowlisted ECharts CDN bytes are frozen; modules and dynamic
  imports are unsupported. A disposable hidden BrowserWindow in its own
  non-persistent partition, with no preload, Node, Bridge, navigation, popup,
  download or permission authority, runs that closure at the
  `pageroot-edit-runtime:` origin. Relative visual assets resolve only through
  the declared, contained protocol map.
- The isolated owner executes frozen scripts in order once, waits 1.2 seconds,
  stops tracked timers, rAF, listeners, observers and animations, seals runtime
  descendants and performs one source/host audit. Only bounded PNG pixels,
  dimensions, hashes and the four existing allowed host layout declarations
  may cross back to trusted renderer memory.
- The visible initial editable `srcdoc` never runs author code. It remains
  script-disabled and mounts the verified PNG as a non-interactive,
  non-persistent display child of the approved source host; selection and
  comments resolve to that source host. There is no post-interaction iframe
  replacement, compatibility cache, second execution identity or background
  promotion.
- The source bytes, SourcePatch, save, history, Version, export and AI Request
  paths never read or serialize runtime DOM. Failed preparation, execution,
  audit or deadline silently mounts ordinary static Edit before interaction. A
  later full-frame rebuild in the same generation is static.
- The runtime resource protocol has no CSP bypass, no general directory access
  and no author-controlled programmatic network/worker channel. The disposable
  owner contains a malicious synchronous author script away from the renderer;
  a failed capture simply mounts static Edit.

## Consequences

Users can see qualifying charts in Edit without running author code in the
renderer or swapping the editable iframe after interaction starts. Editing,
comments and IME use the same static source-backed iframe, while
unsupported/non-ECharts pages remain static. The tradeoff is intentional: no
generic script runtime, retry control or compatibility UI is added.
