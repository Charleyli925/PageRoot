# ADR 0025: Edit runs the author program once in the final visible iframe

- Status: Accepted
- Date: 2026-08-15
- Supersedes: [ADR 0022](0022-edit-one-shot-author-runtime.md) for Edit presentation
- Does not change: Review isolated PNG capture ([ADR 0016](0016-owner-controlled-review-runtime-capture.md), [ADR 0017](0017-shared-runtime-snapshot-owner.md)); Preview author-script execution ([ADR 0007](0007-independent-interactive-preview.md))

This ADR is a product constraint above implementation and security-review
opinions. Changing it requires explicit product-owner authorization. A later
security fix cannot restore Edit screenshots without amending this document.

## Product constraint

PageRoot Edit, for qualifying ECharts HTML, must execute the author program
once in the final visible, editable iframe, and must keep the script-generated
real DOM, Canvas and SVG.

“Freeze” only means stopping timers, `requestAnimationFrame`, Observers, author
event listeners and animations. It does not mean screenshot, rasterization,
serialization or replacement of the runtime result.

Edit must not use PNG, JPEG, screenshots, bitmap projection, ChartSpec,
PageRoot-redrawn SVG, hidden-window capture or any other visual stand-in to
impersonate the author chart.

Each `canvasGeneration` may execute the author program at most once. Editing,
comments, IME, autosave, explicit save and same-generation source echoes must
not execute author scripts again and must not replace the iframe.

Source HTML, SourceIndex, TargetRef, SourcePatch, comments and persistence
remain the only authority. Runtime-generated nodes exist only for display and
never enter save, history, Version, export or AI input.

Security is the lowest priority in this requirement. Security measures may
narrow candidates, network capability, Node/Bridge authority, or statically
fall back before interaction starts. They must not change the product
representation above. If a security requirement conflicts with real Canvas,
stop and return to product decision; do not silently convert to screenshots.

## Priority

| Priority | Decision |
|---|---|
| P0 | Edit shows the real author Canvas/SVG; never a screenshot or projection |
| P0 | Editing, comments, IME, save and source authority do not regress |
| P1 | Real ECharts pages such as JD and 26Q2 display correctly |
| P2 | One execution per generation; startup is clearly faster than the old two-stage path |
| P3 | Delete the hidden window, capture budgets, PNG envelope and dual lifecycle |
| P4 | Tighten security; never override P0–P3 |

## Threat model

- This capability’s threat model is **trusted, user-opened, local generative HTML**.
- The final Edit iframe needs both script execution and parent-side DOM access
  so in-place editing can work.
- Same-origin `window.parent` access is a **known, explicitly accepted product
  risk**. This requirement must not claim that hostile HTML is isolated.
- Low-cost boundaries remain: no Node, no preload, no direct IPC, no arbitrary
  directory read, no arbitrary network, no popup, no worker, no top-level
  navigation.
- Supporting hostile HTML is a separate security project. It must not reuse
  this requirement to restore PNG.

## Runtime flow

```text
open source / new canvasGeneration
               │
        candidate?
          ┌────┴────┐
          │         │
       no          ECharts candidate
          │         │
    static Edit    Main prepares one immutable resource closure
                    │
              prepare ok/fail
             ┌──────┴──────┐
             │             │
           fail           ok
             │             │
      mount static Edit   mount the one final visible Edit iframe
                           │
                    execute once at real Edit size
                           │
                       wait 1.2s
                           │
                    one final layout/resize settle
                           │
                stop timer/rAF/Observer/animation
                           │
                audit source nodes and approved hosts
                    ┌──────┴──────┐
                    │             │
                  pass           fail
                    │             │
          keep real Canvas/SVG   static fallback before interaction
                    │
          open editing, comments, IME, save
```

After interaction starts:

```text
edit / comment / IME / autosave / ⌘S
                  │
         do not execute author scripts
         do not replace the iframe
         do not create a new generation
         do not capture charts
         do not mount images
```

Window-size rules:

- Author scripts initialize at the current real Edit iframe size. A hidden
  `1440×2400` viewport is forbidden.
- One final layout settle and a controlled `resize` are allowed before freeze.
- After freeze, responsive callbacks do not run.
- Later window changes keep the frozen layout. Live window-resize response
  requires a separate product decision.

## Decision

- Static Edit remains the default. Only desktop, exact persisted source with an
  explicit ECharts signal, ordered classic scripts and at least one unique,
  source-empty non-dangerous host may take the direct one-shot path.
- `EditAuthorRuntimeSession` remains the sole application owner. Identity is
  exactly `(sourcePath, canvasGeneration)`. Comments, autosave, IME and a
  same-generation source echo cannot prepare again. A later generation revokes
  an unfinished old session.
- Main re-reads the active source and verifies exact HTML/SHA, then prepares
  one immutable `pageroot-edit-runtime:` resource closure. It does not execute
  author scripts and does not capture pixels. The session stays alive until the
  visible iframe has consumed bootstrap, author bytes and declared assets.
- The first mounted iframe for a successful candidate **is** the final Edit
  iframe. It runs with the sandbox tokens required for script execution and
  parent-side editing. PageRoot’s fixed bootstrap loads frozen script bytes in
  order from `pageroot-edit-runtime:`. Relative CSS, images, fonts and media
  resolve only through that closure.
- Bootstrap waits 1.2 seconds, performs one final layout/`resize` settle, then
  stops tracked timers, rAF, listeners, observers and animations, seals runtime
  descendants and audits source nodes plus approved empty hosts. Success keeps
  the real Canvas/SVG in that same iframe when at least one approved host
  contains author Canvas/SVG and no PNG/snapshot substitute exists. Unused
  empty approved hosts without paint do not by themselves cause static
  fallback. Only then does Edit install selection, editing, comments and IME.
  Failure before interaction mounts ordinary static Edit once.
- Edit screenshot/capture/projection count must be 0. There is no Edit-only
  hidden `BrowserWindow`, no `desktop/edit-runtime-capture-owner.mjs`, and no
  `capturePage()` on the Edit path. Review keeps its isolated capture owner.
  Preview keeps its existing author-script execution.
- Runtime descendants are not editable, not focusable and never SourcePatch
  targets. Selection and comments map back to the unique empty source host.
- Preparation, execution, audit or deadline failure silently mounts ordinary
  static Edit before interaction. A later full-frame rebuild in the same
  generation is static.

## Stop conditions

Any of the following forbids Ready:

- Edit produces any screenshot, PNG, JPEG, bitmap or ChartSpec.
- An Edit-only hidden BrowserWindow returns.
- `desktop/edit-runtime-capture-owner.mjs` returns to the package.
- The iframe is replaced after user interaction.
- The author program executes twice in the same generation.
- A security review is answered by converting to a static image.
- Runtime DOM enters HTML, Draft, History, Version, export or AI input.
- JD or 26Q2 works only in Preview and stays blank in Edit.
- Only source tests are verified; the exact-head installed App is not.
- New commits or a changed base continue to cite old installed-package evidence.
- Implementation touches the user’s uncommitted changes in the primary worktree.
- Security governance cannot accept the trusted-local-HTML threat model.

The last item’s rule is: **stop and let the product owner decide. Do not fall
back to screenshots.**

## Consequences

Qualifying ECharts reports paint as live author Canvas/SVG in Edit, at the
real iframe size, then freeze before editing starts. Charts are no longer a
second-stretched PNG from a hidden 1440×2400 window. The accepted cost is
same-origin `window.parent` access from the final Edit iframe. Hostile HTML
is out of scope.
