# ADR 0016: Electron owns Review runtime capture

- Status: Accepted
- Date: 2026-08-09

## Context

Formal Review compares immutable source HTML first, but some source-empty
hosts acquire meaningful Canvas, SVG or script-generated paint at runtime. The
old review bootstrap ran the supplemental fact collection in the authored page
realm. Even with a narrow channel, that made a mutable page responsible for
private candidate identity, scheduling and the evidence it reported.

Authored JavaScript shares the DOM with any isolated world and can alter it, so
isolation alone is not enough. Review capture needs a single privileged owner,
stable source binding and failure behavior that never delays or changes the
static review result.

## Decision

- Static source/TargetRef analysis remains the Review authority. Runtime facts
  are optional presentation evidence only.
- `AiReviewWorkspace` retains the raw before/after source HTML and frozen
  candidate bindings in trusted renderer memory. Its preload API sends one
  bounded owner request containing only contract version, capture session,
  source SHA-256, side, HTML, candidates and viewport. It cannot send a source
  path, TargetRef, comment data, script or binary payload.
- `desktop/runtime-visual-capture-owner.mjs` owns every request. Each before or
  after request creates a fresh non-persistent partition, a volatile preview
  session with no source root/assets and a hidden sandboxed `BrowserWindow`.
  Before/after may run in parallel but never share a window or session; only a
  duplicate request for the same side supersedes its predecessor. The window
  has no preload, Node, Bridge, popup, navigation, download, webview or general
  network authority. Main owns the 1.5-second deadline, cancellation,
  destruction, preview-session revocation and isolated-session cleanup.
- The owner evaluates facts only in a dedicated isolated world. It rechecks the
  frozen element path, tag and identity fingerprint after authored scripts run;
  missing, duplicate or rebound matches fail closed. The owner separately
  validates path/tag/source-box/fingerprint against raw source before scripts
  run. It takes two fact passes, captures each accepted rectangle once, and
  validates PNG header/dimensions/aggregate budget before hashing the pixels.
- Screenshot bytes, raw DOM, node handles and candidate bindings stop in the
  owner. The renderer receives only a bounded envelope of derived signatures
  bound to contract version, capture session and exact source SHA.
- The authored review bootstrap retains static presentation and its separate
  comment-locator capability only. It receives no runtime candidate key, path,
  baseline, challenge, runtime message channel or screenshot result.
- Every local runtime candidate needs a second fresh owner capture pair. The
  source SHA, frozen viewport, facts and pixel hash must all match before its
  marker can appear. Any timeout, cancellation, mapping failure or instability
  omits only that supplemental marker and preserves the static review unchanged.

## Consequences

Review can become usable before capture completes, and an unavailable desktop
owner becomes a static-only review rather than a blocked screen. The main
process adds a narrowly audited BrowserWindow/session lifecycle and packaged
runtime module. Existing Review candidate analysis and coordinator logic stay
separate from source persistence, Draft, Version and AI acceptance authority.

Tests must cover request rejection, isolated-world-only execution, poisoned
page scheduling, navigation/download/network denial, session/window cleanup,
late results, two-session confirmation, package inclusion and a real Electron
static-first regression. Future Edit capture may reuse the owner boundary, but
must preserve its separate PNG projection contract.
