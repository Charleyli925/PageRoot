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
classic-script ECharts evidence may receive one immutable resource session for
its `(sourcePath, canvasGeneration)`.

The Session first publishes a non-interactive `preparing` state and the
Workbench commits that loading surface before acknowledging the one port call.
This makes even an immediately resolved grant choose the initial runtime frame,
rather than becoming a forbidden late promotion of static Edit.

Main bounds resource preparation only. The visible Edit iframe then has one
bounded deadline to execute, settle and freeze at its real size. Because those
are serial, the Workbench permits their two fixed deadlines plus one bounded
acknowledgement margin before it declares the source unacknowledged. This is a
verification allowance, not a second execution, retry or capture: expiry still
selects the existing one-time static Canvas rebuild.

The session accepts no arbitrary source path or later source revision. Main
rechecks active HTML/SHA, freezes declared local or allowlisted ECharts-CDN
script bytes, and serves only that resource closure under
`pageroot-edit-runtime:` without CSP bypass. The first mounted Edit iframe is
the final iframe. It is same-origin with the application renderer so in-place
editing can reach parent DOM; author scripts can therefore call renderer-exposed
preload APIs on `window.parent`. That is an accepted product risk, not a reason
to restore screenshots. A fixed bootstrap runs the closure once at the real Edit
size, waits 1.2 seconds, dispatches one controlled `resize`, stops tracked
timers, listeners, observers, animations and MessageChannel ports, and audits that source nodes/text/attributes and the approved
unique empty-host bindings stayed intact. Success keeps the real Canvas/SVG
when at least one approved host contains author Canvas/SVG and the frame has
no PageRoot PNG/snapshot substitute. Source-authored inline images remain.
Unused empty approved hosts, including tables or
other unique empty bindings that never receive a chart, do not by themselves
cause static fallback. Failure before interaction mounts ordinary static Edit.
Runtime descendants cannot overwrite authored style beyond the existing
host-style audit allowlist
(`position: relative`, `user-select: none`, transparent
`-webkit-tap-highlight-color`, or a positive `scale()` no greater than `1`).
At most 32 non-dangerous empty hosts are eligible.

Main owns a bounded replay/admission fence before creating a resource session:
a request ID and Main-read `(sourcePath, source SHA, canvas generation)` can
each consume one preparation. At most two preparations may overlap in an app
process, accommodating the external-source to Managed V1 hand-off; a duplicate,
exhausted replay history or saturated request fails closed to ordinary static
Edit.

The visible Edit iframe executes author scripts once, then freezes. Trusted
renderer memory never mounts PNG, JPEG, ChartSpec or other visual substitutes.
Selection/comment resolution remains on the original source host. Runtime
markers and descendants never enter source patches, saves, Versions, exports
or Requests. After freeze, ending native edit, comments, IME, autosave,
⌘S, hard breaks and sibling reorder must keep that same iframe. A later
same-generation remount is static Edit and therefore forbids Ready once
interaction has started. A structural change that cannot be reconciled in
place must keep the current iframe or explicitly start a new
`canvasGeneration`; it is not an accepted silent static fallback.

When importing an external HTML into an HTML-only V1 Working Copy, Main may
retain the selected external HTML directory as a session-only asset root for
that same verified Working Copy. It is set only by the Main-process activation
handoff, never sent by the renderer or written into project authority, and a
missing or unsafe asset still fails closed to static Edit.

Preparation, execution, audit or deadline failure silently mounts ordinary static
Edit before interaction. Comments, autosave, IME, source echoes, hard breaks and
sibling reorder do not prepare, execute or replace the frame. There is no status
UI, retry, compatibility cache, background promotion or hidden capture window. Authored inline SVG remains
native and source-backed; unsupported runtime-only Canvas/SVG remains available
in Preview. Review isolated PNG capture is unchanged.

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
- denied permissions, navigation, popups, downloads, webviews and other URLs,
  except allowlisted chart-library scripts served from main-frozen bytes as
  described below — the capture page itself never reaches the live network;
- one isolated rect pass, at most one PNG per host, bounded PNG/pixel budgets,
  a main-process deadline and forced cleanup.

Before the first side of a pair is captured, the main process prewarms every
allowlisted chart-library `<script src>` URL declared in the frozen HTML
(the same HTTPS host allowlist and bounded fetcher as the Edit one-shot
ECharts session) and freezes the bytes, under its own bounded prewarm budget.
The isolated session then answers exactly those pinned URLs from the frozen
bytes and blocks every other https request; a URL that failed or missed the
prewarm stays absent for both sides of that capture session, so a fetch that
would succeed between the two sides can never render one side and leave the
other blank. Frozen bytes are immutable and shared across later reviews;
fetch failure, oversize or timeout only leaves the affected chart unverified.

After the first offscreen paint the owner waits one bounded settle period
(`captureSettleMs`) before measuring and sampling, because chart libraries
initialize asynchronously and animate after that first paint; the settle
outlasts the default one-second entrance animation so two sides are not
sampled at different animation phases. The settle wait stays subordinate to
the owner deadline and never retries.

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
envelope and parser. Host enumeration may look beyond the capture budget (up to
`candidateLimit`) so that comment-anchored hosts are ordered first before the
list is truncated to the 32-snapshot budget; the owner drains its pixel and
byte budgets in that same priority order. It compares exactly that one pair in
three ordered steps:

1. Bitmap and owner-measured layout dimensions differ strictly.
2. Matching captured hosts with different `renderedTextSha256` values differ
   strictly. This covers visible DOM/SVG labels and numeric characters without
   allowing a style tolerance to hide a character edit.
3. When text and dimensions match but PNG hashes differ, trusted browser memory
   decodes the already captured pair once and calculates mean absolute
   RGB-channel error. Only an error greater than the fixed `0.04` budget
   (0–255 channel scale) emits a fact; PNG byte length, encoder output and a
   small tile/sub-pixel raster difference are not facts by themselves.

The comparison result is a tri-state verdict per candidate, because dimming a
chart host as context requires positive pixel evidence:

- **changed** — one of the three steps above emitted a fact;
- **verified unchanged** — both sides were captured and the decoded pixels are
  identical or within the raster budget, and the surface is not near-uniform;
- **unverified** — the capture is unavailable on either side, the PNG pair
  cannot be decoded, or both decoded surfaces are near-uniform (per-channel
  spread of at most 3), which is the signature of a chart host that never
  rendered (blocked network, script failure, unfinished initialization).

Only a verified-unchanged host may dim. An unverified host surfaces as
suspected only when a user comment anchors on it or an enclosing element; a
global page comment anchors on `<body>` and never marks hosts as commented,
and an uncommented unverified host keeps the plain dimmed presentation so a
page full of unverifiable charts cannot flood the review with amber frames. A
suspected host keeps full visibility on both pages through a dim-mask
exemption and receives one suspected fact: the after page draws an amber
dashed "疑似有改动" frame while the before page stays unmarked. Suspected
facts are always their own synthetic changes (`suspected-<outlineId>`) and
never fold into, or overwrite, a confirmed change or its outline slot; they
claim an outline slot only when the section has no confirmed change. Losing
the capture capability entirely leaves every commented runtime host
unverified rather than silently unchanged.

Canvas-internal text has no DOM/SVG semantic representation at this boundary,
so it follows the bounded raster rule; this contract does not add OCR, canvas
instrumentation, script causality or a second capture. A qualifying difference
emits one opaque `{candidateKey, changeId, verdict}` fact per source host,
where `verdict` is `changed` or `suspected`; any other verdict rejects the
whole marker batch. Outline aggregation may update the content map but never
chooses geometry. Each
side's first managed bootstrap privately binds those keys to exact source
`Element` references by a path plus complete narrow fingerprint; later
bootstrap reads are unbound. The trusted parent delivers facts through a
distinct challenged private port fenced by contract version, session, side and
full source SHA. The bootstrap keeps a disposable `Map<Element, facts[]>` and
unions it with static serialized facts. It never writes runtime marker
attributes. Replacement or disconnection of the bound element drops that
host's runtime fact with no outline fallback; the source-box signature is
enforced only while the parser-blocking bootstrap captures the reference,
because a chart library legitimately rewrites its own host's style, box
attributes and children when it renders. An unavailable, malformed, late or
mismatched result adds no runtime
fact and has no user-visible capture status beyond the suspected presentation
described above.

There is no second fresh pair, deterministic coordinator, Review cache or
capture/retry UI. Static Review never waits for the owner, and empty or failed
runtime delivery never clears static facts.

## Shared limits

`app/domain/runtime-visual-contract.js` is the frozen production limit source:
contract version, source/session identity, 4-second owner deadline, a
1,200-millisecond post-paint settle wait, a
320–4,096 by 320–2,400 viewport, 32 snapshots, 4,194,304 pixels, a
2,000,000-byte individual PNG cap, a 4,096-pixel single-edge cap and
16,000,000 aggregate PNG bytes, plus a 65,536-byte pre-hash visible-text
summary cap. The owner and trusted snapshot parser read the same frozen limits
and fail closed on an over-limit result.
