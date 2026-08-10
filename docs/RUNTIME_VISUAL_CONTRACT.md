# Review Runtime Snapshot contract

Review Runtime Snapshots are disposable supplemental presentation data. They
never become Source HTML, a `TargetRef`, a review acceptance decision, a
Version, a save payload or AI input. Source bytes and static Review remain
authoritative if capture does not run, fails or returns late.

## Review-only source-host resolver

`app/domain/runtime-snapshot-hosts.js` is the sole `SourceHostResolver` for
Review. Before authored scripts execute, it starts from `SourceIndex` and
`TargetRef` and accepts only:

- a direct source `<canvas>`;
- a direct source `<svg>` (including authored SVG children); or
- a source-empty stable host with one unique `id`, `name`, `aria-label`,
  `data-*` value or class token.

Direct Canvas/SVG roots may use their exact source path as a conservative
fallback. Ordinary source-empty hosts must retain their unique stable binding.
Deleted, ambiguous, type-changed or non-empty hosts are omitted. Candidate
selection never parses JavaScript, follows a computed selector, consumes a
comment scope, inspects arbitrary HTML/`tbody` or discovers runtime DOM.

Bindings remain in trusted renderer memory. A `TargetRef`, candidate binding or
screenshot never enters authored Edit or Review documents.

## Edit behavior

Edit renders only what the source can statically present. It disables authored
scripts and does not create a snapshot request, cache, bitmap projection, Blob
URL or `data-pageroot-readonly-visual*` attribute. Authored inline SVG remains
native, source-backed and non-editable; script-generated Canvas/SVG remains
available in Preview. There is no runtime-capture status, placeholder, retry or
fallback UI in Edit.

## One Review snapshot owner

`desktop/runtime-visual-capture-owner.mjs` is the single
`RuntimeSnapshotOwner`. The narrow `htmlAIReviewRuntimeSnapshots` preload route
accepts exact source HTML, full source SHA-256, a `before` or `after` side,
viewport and bounded source-host bindings. It validates the raw binding before
scripts run, then uses a one-use isolated session to confirm the same rendered
host and, for a stable container, visible Canvas/SVG paint. Each candidate may
silently become an unavailable snapshot.

The owner always has these containment properties:

- a hidden sandboxed BrowserWindow with no Node, preload or Bridge;
- a disposable non-persistent partition and preview session;
- only main-owned, declared source-relative assets for the active document;
- denied permissions, navigation, popups, downloads, webviews and other URLs;
- one isolated rect pass, at most one PNG per host, bounded PNG/pixel budgets,
  a main-process deadline and forced cleanup.

It returns only a captured/unavailable key plus an envelope, PNG
bytes/hash/bitmap size and the owner-measured CSS-pixel layout width/height.
Trusted renderer memory revalidates PNG headers, bitmap dimensions, layout
bounds, byte length, SHA-256, per-page pixels and aggregate bytes. Raw DOM/node
handles never leave the owner; authored pages receive no owner channel, binding
or image data.

## Review behavior

After both static Review frames are ready, `AiReviewWorkspace` sends one
bounded before/after pair through the same owner and validates the same snapshot
envelope and parser. A difference in matching captured PNGs emits one opaque
`{candidateKey, changeId}` fact per changed source host. Outline aggregation may
update the content map but never chooses geometry. Each side's first managed
bootstrap privately binds those keys to exact source `Element` references by a
path plus complete narrow fingerprint; later bootstrap reads are unbound. The
trusted parent delivers facts through a distinct challenged private port fenced
by contract version, session, side and full source SHA. The bootstrap keeps a
disposable `Map<Element, facts[]>` and unions it with static serialized facts.
It never writes runtime marker attributes, and replacement, disconnect or
fingerprint drift has no outline fallback. An unavailable, malformed, late or
mismatched result adds no runtime fact and has no user-visible capture status.

There is no second fresh pair, deterministic coordinator, Review cache or
capture/retry UI. Static Review never waits for the owner, and empty or failed
runtime delivery never clears static facts.

## Shared limits

`app/domain/runtime-visual-contract.js` is the frozen production limit source:
contract version, source/session identity, 1.5-second owner deadline, a
320–4,096 by 320–2,400 viewport, 32 snapshots, 4,194,304 pixels, a
2,000,000-byte individual PNG cap, a 4,096-pixel single-edge cap and
16,000,000 aggregate PNG bytes. The owner and trusted snapshot parser read
the same frozen limits and fail closed on an over-limit result.
