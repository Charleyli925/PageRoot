# Architecture contract

This document is normative for state ownership, asynchronous coordination and
persistence. Product behavior remains normative in `docs/MVP_PRD.md` and
`docs/INTERACTION_FLOW.md`; when those documents disagree, the conflict must be
resolved in the same Pull Request before implementation proceeds.

## Dependency direction

```text
React views
  -> application sessions and coordinators
    -> domain state and pure transition functions
      -> typed Bridge client

Bridge route adapters
  -> application commands and queries
    -> domain transitions
      -> repositories
        -> project lock and atomic filesystem writer
```

- Views render snapshots and dispatch user intent. They do not know Bridge
  routes, use raw `fetch`, or read and write browser persistence.
- `app/workbench.tsx` is the renderer composition root. It may connect
  application-session snapshots to view props and callbacks, but it may not
  recreate a session-owned fact as an independently writable ref or state
  variable.
- Workbench presentation files (`presentation.tsx` and `*-view.tsx`) are
  snapshot-and-callback views. They may import domain types and pure Workbench
  models, but not `app/application` sessions or services.
- Application modules own session identity, request generations, mutation
  outcomes, recovery and orchestration.
- Domain modules are pure and may be shared by the renderer and Bridge. They do
  not import React, DOM components, Electron or filesystem adapters.
- Existing source-fidelity engines under `app/lib` are also pure shared core;
  narrow `scripts/` re-export adapters may consume them. They cannot import
  Workbench, React components or application sessions.
- Bridge routes decode transport input and delegate. Durable state changes run
  under the project mutation lock and repository boundary.
- `scripts/check-architecture.mjs` enforces the dependency direction. Do not
  weaken the gate to land a feature.
- Runtime capability decoding has one ingress:
  `app/application/runtime-capabilities.js`. Source editing, project opening,
  attachment persistence, close coordination, interactive preview transport
  and edit visual projection are independent declarations;
  consumers may not infer the whole runtime from the presence of one preload
  API. Electron owns desktop close safety through its acknowledged handshake;
  `beforeunload` is only the browser fallback.

## State ownership

Every mutable fact has exactly one owner, listed in `docs/STATE_OWNERSHIP.md`.
React state may project an owner snapshot for rendering, but a state/ref pair
must not become two independent authorities.

The renderer's main workspace facts are partitioned as follows:

- `ProjectSession`: open/registered identity, generation and query fencing;
- `DocumentSession`: current HTML bytes, Hash, edit/persist revisions,
  persistence projection, pending write, flush single flight, Canvas authority
  generation and exact-byte reconciliation at persistence boundaries;
- `CommentSession`: disposable comment working copy, composer, tombstones and
  saved-comment edit session;
- `DraftSession`: acknowledged Draft revision, pending mutation and
  unknown-outcome reconciliation;
- `ProjectRulesSession`: `PROJECT.md` working copy, composition fence,
  autosave and reconciliation;
- `RunSession`: current/background run projections, Qoder status, background
  outcomes and operation locks;
- `VersionSession`: immutable Version projection and history-view transition;
- `SourceHistorySession`: pending exact Patch operations and history action.
- `ExternalFileOpenSession`: opaque external-open delivery IDs, one active
  switch, newest queued request, deferred safe-switch retry and stale-result
  fencing for work that has not yet been accepted.
- `ProjectApplicationSession`: FIFO accepted project results, final renderer
  switch fence, deferred application retry and successor preservation.

`CommentSession` does not replace the Draft aggregate or Bridge CAS authority,
and `VersionSession` does not make mutable copies of immutable Version files.
The composition root may derive labels, availability and other read-only view
data from these snapshots, but all writes return to the listed owner.

An asynchronous result may update state only when its complete identity is
current:

```text
projectId + documentId + sourcePath + session generation + query sequence
```

Revisions are monotonic. A query result with an older revision may never
replace an acknowledged state, even if the project identity is unchanged.

External HTML delivery is separately authorized but not separately ordered.
The main-process mailbox accepts only a validated, opaque `.html`/`.htm`
request ID and replaces an older unaccepted OS request with the newer one.
`ProjectOpenQueue` then assigns the whole picker/read/Bridge-check and
active-project transition its FIFO position at entry, shared by local picker,
recent-project, external, startup, generated-version, rename and forget
routes. The renderer's `ExternalFileOpenSession` owns delivery de-duplication,
one active request, one newest queued request and a deferred retry when the
normal project-switch boundary cannot yet close safely. Preload subscribes
before requesting its readiness catch-up, and drops that catch-up if a live
delivery arrives first, so an older mailbox snapshot cannot replace a newer
external intent. The session fences only an
older request that has not yet been accepted when a newer request is queued,
and it freezes the Canvas from the final safe switch fence through the awaited
external acceptance; a newer external request inherits that freeze. Its
snapshot includes a monotonically increasing deferred-transition sequence.
Workbench observes a new sequence but never resumes from that snapshot alone:
automatic retry requires a relevant safe-switch blocker to be observed and
then clear. If no tracked blocker is present, Workbench keeps the current HTML
and offers an explicit retry action instead. If the final fence captures a
post-cutoff native edit, it does not begin the IPC, releases that edit to normal
persistence, and resumes only after that source blocker clears.

An external delivery that arrives while the Electron close handshake is still
awaiting the renderer cancels that exact close attempt before the request is
published. Once close is committed, the exiting process never publishes or
accepts another external request: it atomically writes only the latest
validated native HTML path to a private one-shot handoff. Only the next launch
that acquires Electron's single-instance lock claims and deletes that handoff
before routing it through the same mailbox, so a losing secondary process
cannot consume the request and no late delivery can mutate active/recent-project
authority without a matching renderer publication.

`ProjectApplicationSession` owns every successful local or external project
result after main-process acceptance and before renderer publication. It keeps
those results FIFO, so a later accepted result cannot erase a deferred or
successfully published predecessor. Before applying each result, Workbench
re-enters the complete switch boundary and takes one synchronous final Canvas
freeze. A post-drain native edit leaves that accepted result in the session
until a relevant blocker transition or explicit continuation makes another
attempt safe. Thus a slow later read cannot unlock the Canvas through an older
result and then discard an intervening edit. Ordinary Workbench project-picker
retry state may not carry either external delivery or accepted-result protocol.

A transition that changes the current source or Version has two phases. The
asynchronous phase prepares and validates one complete candidate: project and
document identity, canonical path, Version authority, HTML bytes and Hash. The
publication phase contains no `await`: it synchronously advances
`ProjectSession`, publishes the complete `DocumentSession` tuple, updates
`VersionSession` and invalidates prior Canvas acknowledgements. Publishing only
the path, only the Hash or any other partial combination is forbidden.

Edit and preview surfaces acknowledge the exact Canvas authority generation and
rendered source Hash. Acknowledgements are disposable and generation-fenced;
they never become source authority. The safe-save projection requires both the
persisted Document revision/Hash and the currently visible surface
acknowledgement. A missing acknowledgement triggers at most one Canvas rebuild;
a clean source mismatch triggers at most one authoritative reread before that
rebuild. Neither recovery path delegates internal reconciliation to the user.

The preview-to-edit `PageViewContext` is a non-durable projection owned by the
Workbench for one current document key and preview generation. It contains
only allowlisted source-backed presentation state. A capture result may apply
only while that complete identity is still current. Project/source changes,
history navigation, a newer preview generation or a failed capture discard it.
It never registers a drain obligation and never changes source, Draft or
Version authority.

Edit runtime visuals have a separate owner:
`RuntimeVisualProjectionSession`. Its request identity includes document key,
the complete source Hash first, source path, a runtime dependency Hash over stable source-empty TargetRefs,
executable/style sources and script/handler-referenced data containers, a bucketed edit viewport and resolved
`PageViewContext` dependency. The exact source Hash remains mandatory at every
acceptance boundary. An indirect DOM traversal conservatively includes the complete
source Hash in that dependency, so any source edit schedules a replacement rather
than reusing a stale bitmap. A projection, deferred fallback or late result may
never rebind across source Hashes; the visible projection is cleared before the
new source capture starts. Only the newest exact-source generation may publish
a changed result. The session may retain the committed projection while a
same-source viewport or presentation replacement is scheduled/captured, suspend it across Preview/Edit transitions,
and keep a recent-result LRU bounded by both bytes and entry count. Resetting
document authority clears both committed state and cache.
The main-process capture controller owns at most one hidden authored-page
window and its preview session; replacement or disposal destroys both. The
shared runtime-visual owner deadline bounds every page-realm evaluation and
bitmap operation; timeout cancels capture and destroys both. The
accepted result is a bounded binary PNG projection for source-empty hosts,
including direct Canvas/SVG roots, not a copy
of runtime DOM. It has no drain, persistence, review-diff, source-history or AI
authority. The Canvas may mount and remove it only as presentation beneath the
original source host; comments and edits continue to resolve that host. Protocol
V2 validates PNG/IHDR/content Hash/byte length/DPR/crop/sizing fields, measures
ordinary hosts by their content box and `tbody` by its border box,
keeps positive axis-aligned scale/translate and zoom in one viewport-coordinate
painted box, must reject partial viewport/overflow coverage, and may mark a hidden or
temporarily uncapturable host deferred. A deferred host may reuse only its own
previously accepted stable-key bitmap; a valid non-deferred empty response
clears a previous mount. Direct Canvas/SVG background projection temporarily
applies captured content-box dimensions and restores the original inline sizing
when it is removed. Canvas reconciliation must retain an
identical image node and stage/decode a replacement Blob before removing the
current one. Its responsive content layer must follow host flow/resize and use
aspect-preserving `contain`; a source-zero host must use validated captured
intrinsic dimensions rather than a percentage of its zero box. Stale or invalid projections do not authorize
clearing a valid mount.

Prepared formal-review documents are owned by a cancellable
`ReviewAnalysisSession` keyed to exact operation/source/comment identity. Its
multi-entry cache is byte bounded. Parsing and annotation yield between phases,
and stale work stops before publication. Fuzzy node pairing may compare only
compatible tag/context/stable-key buckets after exact and unique identity
matches; it cannot restore a page-wide Cartesian candidate set or change the
existing evidence thresholds.

Formal Review has an optional, narrower runtime-snapshot supplement. One
`SourceHostResolver` pairs only direct source Canvas/SVG roots and source-empty
stable hosts from `SourceIndex`/`TargetRef`; it does not use changed-script
causality, computed selectors, comment scope or runtime DOM guessing. The
trusted `AiReviewWorkspace` begins static Review immediately and, after both
frames are ready, sends exact HTML, side-specific source SHA, viewport and those
frozen bindings through one narrow preload call. Inline/browser review remains
static-only.

Comment location remains a separate private capability. An opaque initial
bootstrap binding may identify a frozen before target for comment geometry, but
it neither reaches authored markup nor authorizes runtime host discovery.
Electron's one-use `RuntimeSnapshotOwner` owns capture. It validates the raw
source path/tag/identity, creates a non-persistent preview session and hidden
sandboxed window, denies navigation/popups/downloads/webviews/permissions and
non-preview requests, and reads the exact rendered host only in an isolated
world. A source-empty host must contain visible Canvas/SVG paint. One rect pass
and at most one `capturePage` PNG per host are bounded by the shared contract;
the owner validates PNG shape, and trusted renderer memory validates bytes,
dimensions, SHA-256 and aggregate budgets. Raw DOM/node handles never cross the
owner boundary, and no candidate binding or PNG enters authored review HTML,
bootstrap code or page messaging.

The one before/after snapshot pair is compared once. Only captured snapshots
with different PNG presentation can add an opaque `changeId`/`outlineId` style
marker. A missing desktop API, unmapped host, malformed envelope, timeout,
cancellation or late result is a silent static-only outcome. There is no second
fresh pair, confirmation coordinator, runtime UI or Review cache. Edit remains
on its existing implementation until the later convergence milestone.

Comment layout is measured only after current disposable presentation is
applied. The Workbench accepts no card coordinates until the Canvas reports a
complete target set for the current rendered source Hash and applied generation;
missing coordinates remain an explicit recovery state and are never synthesized
from historical geometry.

Edit-mode content reveal is another transition of that same projection, not a
new owner. `HtmlCanvasEditor` may propose only an allowlisted source-backed
presentation action: the strict ARIA/HTML semantic adapter, the bounded explicit
`data-p`/`data-tab` → panel-ID adapter, or the bounded constant-index handler
adapter whose controls and unique related panel group prove the same active
position. Workbench accepts it only for the current document key and preserves
the shared page scroll position. The Canvas then applies the accepted context
without calling `onChange`, SourcePatch, authored handlers or persistence. No
React view may keep a second copy of this state for shortcut handling or toolbar
rendering. The rail's transient vertical offset is likewise Workbench-owned
presentation state: Canvas natural height supplies its bottom bound, and neither
the offset nor queued card height may become source, Draft or Version authority.

Opening a user HTML may remain lazy until the first durable product action.
During that interval the renderer owns only an `epoch + sourcePath` locator,
not a registered project context. A registered context always has non-empty
`projectId`, `documentId` and canonical `sourcePath`. Registration is one
application transition: it adopts those identifiers and activates Draft
authority from the same Bridge response. If a registered page later finds its
Draft session inactive or bound to another context, it queries current
workspace authority and safely rebinds before creating a mutation; it does not
leave an unchangeable close blocker.

Every registered mutation captures that complete ProjectContext once. The
Bridge resolves `projectId + documentId` against the registry before consulting
the mutable path and uses `sourcePath` only to prove that the command remains
inside the registered source or an explicit alias. Supplying exactly one ID is
invalid. Omitting both IDs is a temporary compatibility route that may address
an existing registration but may not create one; `/project/ensure` is the sole
creation boundary. Attachments and their compensating cleanup use the same
captured context for their complete asynchronous lifetime.

Canvas operation history has split but non-overlapping ownership:
`SourceHistorySession` owns the renderer context, unsaved operation outbox and
one in-flight action intent; `history/source-operations.json` owned by the
Bridge is the durable cursor, operation and applied-action authority. React
state may display capabilities, but it cannot maintain a parallel undo stack.
The preview DOM, browser editing history and edit-audit list are not history
authorities.

## Mutation protocol

Every durable command defines:

1. a stable operation identity;
2. the expected revision or Hash;
3. an idempotent acknowledgement;
4. explicit rejected and unknown outcomes;
5. an authoritative query used for reconciliation;
6. deterministic retry or a genuine user-owned semantic conflict.

Network failure after a mutation is an **unknown outcome**, not a rejection.
The client queries authority before retrying. A retry action must change its
precondition through reconciliation, refreshed identity, backoff or new user
information; resending the same known-stale command is forbidden.

A persisted source-history operation is created only from an accepted
SourcePatch result. It carries stable operation identity, exact forward and
reverse patch lists, before/after source Hashes and bounded logical target
snapshots, plus optional bounded before/after logical Selection for text-focus
restoration. Selection is presentation metadata, not a patch precondition or
source authority. Autosave validates the full operation chain before placing
the HTML candidate and history candidate in the same recoverable `pendingWrite`.
Undo/redo is another durable command with stable action ID, expected source
Hash, expected history revision and expected cursor. An unknown response is
reconciled by querying workspace authority; the same action ID may be replayed
once only when authority proves it was already applied or its original
preconditions still hold.

A Bridge-acknowledged history result may advance the mounted editable-island
projection without replacing its iframe only after exact old/new target
resolution through the recorded TargetRef transition, byte-equal source
prefix/suffix outside the island and a complete next-`SourceIndex` DOM mapping
all succeed. This is a projection optimization, not another history application
path: canonical bytes still come only from the Bridge. Failure at any proof
point retires the frame and loads the canonical source through the normal
verified fallback.

The history journal is bounded and may be reset only at a proven current source
Hash. A forward edit after undo truncates redo. Source mismatch never attempts
best-effort patching and never serializes preview DOM; it creates a new history
boundary or reports the existing source conflict.

An inode change is not by itself proof of a new document because PageRoot's
same-directory atomic replacement intentionally changes it. The Bridge may
repair the registered file identity only when current source bytes match the
registered current Hash, a compatible legacy document stamp, or the durable
target Hash in the existing project's `pendingWrite`. No other Hash or path
observation may silently relink or create a project.

Comment deletion tombstones and processed operation identities are durable
draft data. Attachments must be tied to a durable comment operation or cleaned
as unreferenced staged data. The draft artifact carries the authoritative
revision needed to recover the crash window between artifact replacement and
runtime-pointer refresh.

No durable command may be constructed with empty identity fields. In a
persistence-capable app, starting a comment composer counts as a real project
action: registration may begin eagerly, and confirming the comment must await
that identity so the visible comment and its recovery record have one owner.
The pure browser preview is explicitly non-durable and may demonstrate a
temporary comment without claiming that it was saved.

One unresolved failure has one visible recovery owner. A source persistence
failure takes precedence over a Draft persistence failure on the workspace
status-banner surface; when it clears, an outstanding Draft failure may own the
same surface. Views must not duplicate either issue in the comment rail or a
Toast. User-visible error text is derived from stable product codes and must
not expose bridge fields, local paths, Hashes or raw exception messages.

## React effects

Effects are for DOM integration, subscriptions and timers. Business
persistence is invoked by an application session or coordinator. Adding an
effect that writes because several React values changed requires an ADR and a
behavior test proving there is one write authority and no feedback loop.

## Drain boundaries

Close, project switch, Request freeze and history navigation consume the same
registered obligations:

- native edit checkpoint;
- source autosave;
- draft/comment persistence;
- attachment staging;
- project-rule persistence;
- Request freeze or outcome reconciliation.

A Canvas undo/redo request uses the same native-edit checkpoint and source
autosave obligations before it reads the durable history cursor. It does not
drain or mutate comment cards, attachments or project rules. Focused native
text controls keep their platform-local input history and do not invoke this
Canvas drain. Project-rule autosave is not eligible while its native control
owns an active composition; explicit restore retires that control before
adopting the saved value.

Each obligation reports pending, draining, resolved or blocked. A blocked
result includes an action that changes the condition. Entry points must not
copy their own boolean lists. An obligation may request a final verification
without reporting permanent pending state; an already acknowledged aggregate
must drain as a no-op without advancing its revision.

After the aggregate drains, source close readiness is reconciled by
`DocumentSession` against the independently hashed frozen HTML. An acknowledged
revision may be ahead of the cutoff. A stale Canvas Hash or renderer projection
is not itself a blocker; only an unresolved exact-byte check may trigger the
bounded authoritative source read. Matching bytes repair the projection, while
confirmed divergence or invalid source integrity remains fail-closed in its
owning renderer recovery surface.

A lazily opened page with no durable material closes as a no-op and remains
unregistered. If it contains a comment, composer recovery, tombstone or edit
audit, the Draft obligation first completes project registration and authority
binding, then drains the aggregate.

## Compatibility

Compatibility belongs at one versioned decoder or route adapter per retired
producer. Each fallback must state the old producer, removal condition and
focused coverage. Domain and view code use only current canonical states.
Inline aliases and permanent “just in case” branches are not allowed.

The supported compatibility adapters are:

- Complete PageRoot 0.9.0 v3 project records whose registry, `project.json`,
  initial Version and existing `projects/<projectId>` directory prove one
  identity may gain `displayName`, `createdAt` and
  `storageDirectoryName=projectId` in place without renaming or scanning
  directories. Remove this adapter only when 0.9.0 project records leave the
  supported upgrade window. v1/v2 and incomplete records remain unsupported.
- Older packaged Draft renderers may omit an `operationId`; the Draft command
  decoder allocates a current `draftop_` ID while previously persisted
  `draftop_legacy_*` acknowledgements remain readable. Direct-edit ingress
  decodes the historical `baseVersionId` / `capturedRevision` pair to the
  immutable Version pair `basedOnVersionId` / `revision`; the Workbench view
  receives only its canonical `DirectEditEvent` projection. Unknown fields,
  dual forms, and unsafe Version ranges fail closed. These adapters never
  write a retired name.
- Historical Versions and archived failed/no-change outcomes produced by the
  short-lived August 2026 Developer Previews may use either `1.0.0`
  `candidate-assessment.json` shape: without executable-surface fields or with
  the now-retired pair. The candidate-assessment decoder validates either shape,
  verifies frozen base and immutable candidate evidence as ordinary files against all
  exact/comparison Hashes, deterministically re-runs current document-health
  and continuity assessment, and exposes a canonical result without retired
  fields. It never rewrites the Attempt; old script conclusions never affect
  current status, and archived outcomes remain terminal. Remove the adapter
  when those Developer Preview records leave the supported upgrade window.

The full producer, fixture, persistence and deletion-evidence register is
[`COMPATIBILITY.md`](COMPATIBILITY.md). The legacy Release
`update-manifest.json` is a historical-client distribution artifact, not a
current application compatibility decoder.

## Change requirements

A change affecting state, persistence or lifecycle must include:

- owner and transition;
- late-response behavior;
- crash and unknown-outcome recovery;
- close/switch/submit impact;
- behavior and failure-injection coverage;
- updated architecture or product documentation when the contract changes.

Source-string tests are reserved for packaging, dependency and security
boundaries. Runtime coordination is proven through public behavior, bytes,
Hashes, state transitions and fault injection.
