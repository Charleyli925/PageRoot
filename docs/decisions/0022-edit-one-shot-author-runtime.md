# ADR 0022: Edit uses one bounded ECharts author-runtime frame

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
  source-empty non-dangerous host may take the direct path.
- `EditAuthorRuntimeSession` is the sole application owner. Its identity is
  exactly `(sourcePath, canvasGeneration)`: comments, autosave, IME and a
  same-generation source echo cannot prepare again. A later generation revokes
  an unfinished old session; a settled session cannot re-enter preparation.
- Main re-reads the active source and verifies exact HTML/SHA before preparing
  a one-use `pageroot-edit-runtime:` resource closure. Local classic JavaScript
  and explicitly allowlisted ECharts CDN bytes are frozen; modules and dynamic
  imports are unsupported. The final `srcdoc` retains direct editor DOM access,
  while its base is forced to that session so relative visual assets can only
  resolve through the declared, contained protocol map. There are no hidden
  BrowserWindows, probe documents, compatibility caches, second execution IDs
  or background promotions.
- The initial editable frame is the only possible runtime frame. It executes
  frozen scripts in order once, waits 1.2 seconds, stops tracked timers, rAF,
  listeners, observers and animations, seals runtime descendants and performs
  one source/host audit. Runtime descendants may exist only under an approved
  host and remain display-only; selection and comments resolve to that source
  host.
- The source bytes, SourcePatch, save, history, Version, export and AI Request
  paths never read or serialize runtime DOM. Failed preparation, execution,
  audit or deadline silently mounts ordinary static Edit before interaction. A
  later full-frame rebuild in the same generation is static.
- The runtime resource protocol has no CSP bypass, no general directory access
  and no author-controlled programmatic network/worker channel. This is a bounded,
  trusted-local ECharts capability, not a promise to isolate a malicious
  synchronous script from renderer responsiveness.

## Consequences

Users can see qualifying charts in Edit without a second execution or a late
iframe swap. Editing, comments and IME keep the same iframe after runtime
settlement, while unsupported/non-ECharts pages remain static. The tradeoff is
intentional: pathological author code remains outside scope, and no generic
script runtime, retry control or compatibility UI is added.
