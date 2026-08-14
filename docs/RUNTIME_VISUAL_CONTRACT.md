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

## Edit one-shot ECharts behavior

Edit never consumes a Review snapshot or its Blob URL. It normally renders only
what source can statically present. Desktop has one narrow exception: before
the initial editable frame is mounted, an exact persisted source with
classic-script ECharts evidence may receive one isolated resource session for
its `(sourcePath, canvasGeneration)`.

The Session first publishes a non-interactive `preparing` state and the
Workbench commits that loading surface before acknowledging the one port call.
This makes even an immediately resolved grant choose the initial runtime frame,
rather than becoming a forbidden late promotion of static Edit.

The session accepts no arbitrary source path or later source revision. Main
rechecks active HTML/SHA, freezes declared local or allowlisted ECharts-CDN
script bytes, and serves only that resource closure under
`pageroot-edit-runtime:` without CSP bypass. A disposable hidden sandboxed
BrowserWindow with a separate non-persistent session, no preload, Node or
Bridge runs the closure once, waits 1.2 seconds, stops tracked runtime activity
and audits that source nodes/text/attributes and the approved unique empty-host
bindings stayed intact. It returns only bounded PNG pixels plus dimensions,
hashes and the allowed host declarations (`position: relative`,
`user-select: none`, transparent `-webkit-tap-highlight-color`, or a positive
`scale()` no greater than `1`); it cannot overwrite authored style or mutate
another source attribute. At most 32 non-dangerous empty hosts are eligible.

Main owns a bounded replay/admission fence before creating a resource session
or hidden window: a request ID and Main-read `(sourcePath, source SHA, canvas
generation)` can each consume one preparation. At most two captures may overlap
in an app process, accommodating the external-source to Managed V1 hand-off;
a duplicate, exhausted replay history or saturated request fails closed to
ordinary static Edit.

The visible Edit iframe remains source-static and script-disabled. Trusted
renderer memory validates the bounded snapshot envelope, Base64/PNG header,
byte and dimension budgets, while retaining Main's capture digest as
attestation, and injects it only as a non-interactive transient image below the
same approved source host. The image, runtime marker and allowed derived style
never enter source patches, saves, Versions, exports or Requests;
selection/comment resolution remains on the original source host.

When importing an external HTML into an HTML-only V1 Working Copy, Main may
retain the selected external HTML directory as a session-only asset root for
that same verified Working Copy. It is set only by the Main-process activation
handoff, never sent by the renderer or written into project authority, and a
missing or unsafe asset still fails closed to static Edit.

Preparation, capture, audit or deadline failure silently mounts ordinary static
Edit before interaction. Comments, autosave, IME and source echoes do not
prepare, execute or replace the frame. A later necessary full rebuild is static
for that generation. There is no status UI, retry, compatibility cache or
background promotion. Authored inline SVG remains native and source-backed;
unsupported runtime-only Canvas/SVG remains available in Preview.

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
bytes/hash/bitmap size, the owner-measured CSS-pixel layout width/height and a
`renderedTextSha256`. The hash is calculated in the isolated owner from a
normalized sequence of visible DOM/SVG text inside the captured host; raw text,
raw DOM and node handles never leave the owner. Trusted renderer memory
revalidates PNG headers, bitmap dimensions, layout bounds, byte length,
SHA-256, per-page pixels and aggregate bytes. Authored pages receive no owner
channel, binding, image data or text summary.

## Review behavior

After both static Review frames are ready, `AiReviewWorkspace` sends one
bounded before/after pair through the same owner and validates the same snapshot
envelope and parser. It compares exactly that one pair in three ordered steps:

1. Bitmap and owner-measured layout dimensions differ strictly.
2. Matching captured hosts with different `renderedTextSha256` values differ
   strictly. This covers visible DOM/SVG labels and numeric characters without
   allowing a style tolerance to hide a character edit.
3. When text and dimensions match but PNG hashes differ, trusted browser memory
   decodes the already captured pair once and calculates mean absolute
   RGB-channel error. Only an error greater than the fixed `0.04` budget
   (0–255 channel scale) emits a fact; PNG byte length, encoder output and a
   small tile/sub-pixel raster difference are not facts by themselves.

Canvas-internal text has no DOM/SVG semantic representation at this boundary,
so it follows the bounded raster rule; this contract does not add OCR, canvas
instrumentation, script causality or a second capture. A qualifying difference
emits one opaque `{candidateKey, changeId}` fact per changed source host.
Outline aggregation may update the content map but never chooses geometry. Each
side's first managed bootstrap privately binds those keys to exact source
`Element` references by a path plus complete narrow fingerprint; later
bootstrap reads are unbound. The trusted parent delivers facts through a
distinct challenged private port fenced by contract version, session, side and
full source SHA. The bootstrap keeps a disposable `Map<Element, facts[]>` and
unions it with static serialized facts. It never writes runtime marker
attributes, and replacement, disconnect or fingerprint drift has no outline
fallback. An unavailable, malformed, late or mismatched result adds no runtime
fact and has no user-visible capture status.

There is no second fresh pair, deterministic coordinator, Review cache or
capture/retry UI. Static Review never waits for the owner, and empty or failed
runtime delivery never clears static facts.

## Shared limits

`app/domain/runtime-visual-contract.js` is the frozen production limit source:
contract version, source/session identity, 1.5-second owner deadline, a
320–4,096 by 320–2,400 viewport, 32 snapshots, 4,194,304 pixels, a
2,000,000-byte individual PNG cap, a 4,096-pixel single-edge cap and
16,000,000 aggregate PNG bytes, plus a 65,536-byte pre-hash visible-text
summary cap. The owner and trusted snapshot parser read the same frozen limits
and fail closed on an over-limit result.
