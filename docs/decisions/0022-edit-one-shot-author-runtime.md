# ADR 0022: Edit one-shot author runtime loads directly and remains source-disposable

- Status: Accepted
- Date: 2026-08-13
- Extends: ADR 0017 and ADR 0021

## Context

Some reports already contain ECharts and an initialization script, but Edit had
to disable every author script. Keeping scripts permanently enabled would give
runtime code ongoing control of the same-origin editing iframe and would blur
the source-preserving boundary. Replacing the result with a screenshot or
serializing `getOption()` would create a second, lossy persistence authority.

## Decision

For a candidate source, Edit waits in the existing canvas loading surface while
the hidden compatibility probe runs. It then mounts exactly one normal Edit
iframe: a compatible source gets the one-shot runtime document, while every
other result gets the existing script-disabled static document. The runtime
iframe remains visually gated until its bootstrap proves a frozen result; there
is no static-first document and no later background replacement.

The one-shot path requires an authoritative source with an exact SHA, a current
Canvas generation, an explicit ECharts library or `echarts.init()` call,
deterministic classic scripts, and one or more unique stable source-empty hosts
with a bounded 32-host maximum. An empty, uniquely bound `<tbody>` is also an
explicit Edit-only host for reports that construct a static table alongside
charts. Hosts need not have initial non-zero geometry: hidden Tab panels and
runtime table expansion are normal report layouts. Other classic-script pages
retain static Edit.

- `WorkspaceController` composes `EditAuthorRuntimeSession` with the lifecycle
  `static → probing → compatible → loading → ready`. `loading` is the single
  direct canvas document state, not a hidden frame. Any source change,
  unpersisted edit, project change, late result or failure returns it to static.
- Electron owns `EditRuntimeProbeOwner`, a hidden non-persistent BrowserWindow,
  deadline, fixed local/explicit-ECharts-CDN script bytes and a bounded
  process-local LRU. The narrow `probe/revoke` IPC request contains exact source
  HTML/SHA and bindings but no source path; main supplies the active source path
  after trusted-frame validation.
- `pageroot-edit-runtime:` is the only additional renderer CSP script source.
  It serves one-use bootstrap bytes and a fixed author-byte array. There is no
  `unsafe-inline`, `unsafe-eval` or general remote script permission.
- The bootstrap runs parser-first, records mutations and author async/event
  resources, blocks network/navigation/worker/form/media APIs, then waits a
  fixed 1.2-second ECharts final-frame settling window (inside its 6-second
  owner deadline) and removes timers,
  listeners and observers. It rejects source identity,
  text and attribute changes outside approved hosts. An approved empty host may
  change its own attributes, generated subtree and layout; runtime descendants
  are sealed as display-only and cannot become editable text or a comment
  TargetRef. A user may still select the original source host as a whole to use
  the ordinary comment flow.
- The single normal canvas iframe repeats the fixed execution. PageRoot binds
  editing handlers only after that same iframe is frozen and validated. It is
  never swapped beneath a selection, native edit or IME session because no
  second canvas iframe exists.

No owner returns runtime DOM, screenshot or raw probe output. Runtime nodes
remain within approved hosts and never become `TargetRef`, `SourcePatch`, save,
export, Version, Review or AI input data. Failure is deliberately silent: the
user keeps the already usable static editor and receives no extra control,
dialog or status surface.

## Consequences

- A compatible chart can be visible in formal Edit without adding a
  ChartSpec, raster cache or third user mode.
- Author code runs at most once in the hidden probe and once in the direct
  canvas document; neither execution is a persistence authority.
- React/Vue root reconstruction, module/dynamic-import/worker/network pages,
  source-structure/text/attribute-changing pages outside approved hosts and
  pages with continuing runtime work fail closed to static Edit. A generated
  chart/table may freely change its approved empty-host layout.
- The final ready runtime iframe necessarily has `allow-same-origin allow-scripts`
  so PageRoot can attach its editing handlers. This is a bounded residual
  same-origin risk, reduced by fixed bytes, isolated probing, one-use bootstrap
  and teardown—not a complete cross-origin security boundary.

## Rejected alternatives

### Leave author scripts enabled in Edit

Rejected because ongoing timers, listeners, navigation and runtime DOM could
race source patches and no longer have a finite, reviewable lifetime.

### Persist ECharts `getOption()` or a screenshot

Rejected because either becomes a new representation authority and cannot
preserve the user's supplied source HTML byte-for-byte outside SourcePatch.

### Reuse Review runtime snapshots

Rejected because Review returns bounded visual evidence, while Edit needs the
actual frozen host DOM and selection-compatible iframe. The two owners have
different trust, payload and lifecycle contracts.
