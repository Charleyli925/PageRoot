# Inline runtime visuals — Phase 0 evidence

- Status: **No-go for production implementation**.
- Date: 2026-08-12.
- Scope: synthetic Electron probe only; no PageRoot product path was changed.
- Reproduce: `npm run experiment:inline-visual-phase0`.

## Question tested

The probe tests the proposed single-runtime-surface direction with a separate,
transparent, non-focusable Electron window. The runtime window contains a
trusted wrapper and one sandboxed source iframe. The wrapper exposes only two
discontinuous fixed rectangles through an SVG clip path; the source iframe runs
synthetic author code.

The experiment is under `experiments/inline-visual-pr1/`, is not imported by
Workbench/preload/desktop production code, and is not included by the explicit
electron-builder file allowlist. It does not read, write, or embed a user HTML
file.

## Measured result

The reproducible local run used Electron 43.2.0 / Chromium 150.0.7871.129 on
macOS arm64, with DPR 2 and a fractional-zoom DPR 2.5 case.

| Probe | Result | Evidence |
| --- | --- | --- |
| Isolated fault domain | Passed for the synthetic host | Editor renderer PID differed from runtime PID; a synthetic `while (true)` left Edit responsive and the owner destroyed the runtime window in 2–3 ms, below the provisional 1000 ms budget |
| One page, multiple discontinuous rectangles | Passed in hidden compositor capture | One runtime source iframe; Canvas and SVG sample colors appeared only inside the two SVG clip rectangles; an unapproved replacement slot and an outside sample were transparent |
| Geometry transfer | Passed for probe fixture | Exact rect agreement after initial load, resize, 1.25 zoom, and source scroll; the only values carried were key plus rectangle metadata |
| Pre-script binding | Passed for probe fixture | Bootstrap captured source Elements before author script; a forged window message was ignored, the author listener did not observe the private binding, and a replaced host was detected |
| Resource / permission policy | Passed narrowly | Temporary partition denied permissions and cancelled a synthetic external navigation with `ERR_BLOCKED_BY_CLIENT` before network use |
| Cleanup | Passed for probe owner registry | After every path, active experiment runtime windows and active experiment partitions were both zero; handlers were removed and storage/cache clear attempted |
| Native pointer pass-through | **Not proven** | `BrowserWindow.setIgnoreMouseEvents(true, { forward: true })`, non-focusable window, wrapper `pointer-events:none`, and an Edit input smoke test work, but they do not prove real OS click, drag, selection, context-menu, keyboard, wheel, or IME traversal through the native overlay |
| Native final composition | **Not proven** | The probe safely uses hidden windows and capture-page pixels. That proves wrapper masking, not the final WindowServer composition over the visible editing window |

The probe intentionally reports `no-go` unless every mechanical test and the
two native behaviors are proven. Its current result is:

```text
no-go
- phase0-native-pointer-pass-through-unverified
- phase0-native-window-composition-unverified
```

## Decision

PR-1 does **not** authorize PR-2's runtime owner, overlay, feature flag, UI,
preload capability, or any edit-mode execution. The current product contract
remains intact:

- Edit is script-disabled and static.
- Preview remains the place to run and interact with authored pages.
- Review remains the sole owner of its existing bounded screenshot supplement.
- Unsupported pages remain silent/static in Edit; no new toast, modal, or
  status UI is introduced.

The probe validates that several pieces are technically promising, but it does
not erase the two user-critical unknowns. Treating Electron API configuration
as a substitute for real native input/IME and visible-compositor proof would be
the same kind of unbounded lifecycle and edge-case risk the Phase 0 gate was
created to prevent.

## Allowed next work

Only the source-only Profile/Validator path is completed in this PR. A future
reconsideration requires a new, independently reviewed native test protocol
that can safely prove all pointer classes and visible window composition without
stealing user input or forwarding author events. It may not bypass the gate by
using screenshots, DOM/pixel transfer, per-chart pages, stale visual caching,
or a same-renderer iframe.
