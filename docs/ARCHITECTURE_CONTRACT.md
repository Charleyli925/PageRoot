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
- Workbench presentation files (`presentation.tsx`, `ExternalHtmlOpenDialog.tsx`
  and `*-view.tsx`) are
  snapshot-and-callback views. They may import domain types and pure Workbench
  models, but not `app/application` sessions or services.
- Application modules own session identity, request generations, mutation
  outcomes, recovery and orchestration. `WorkspaceController` is the public
  workflow facade: it may sequence injected Session transitions, but it is not
  a second fact store and may not import React, Workbench presentation,
  components or desktop code.
- Domain modules are pure and may be shared by the renderer and Bridge. They do
  not import React, DOM components, Electron or filesystem adapters.
- Existing source-fidelity engines under `app/lib` are also pure shared core;
  narrow `scripts/` re-export adapters may consume them. They cannot import
  Workbench, React components or application sessions.
- Bridge routes decode transport input and delegate. Durable state changes run
  under the Project File repository boundary. `/autosave` retains only
  route-specific validation and response encoding; `ProjectFileRepository`
  owns the current-source write. `/source-history/action` does not persist a
  Bridge journal: a registered v4 project returns current source bytes and
  empty history. The retired v3 `SourceTransaction` service is not a live
  Bridge owner.
- `scripts/check-architecture.mjs` enforces the dependency direction. Do not
  weaken the gate to land a feature.
- Runtime capability decoding has one ingress:
  `app/application/runtime-capabilities.js`. Source editing, project opening,
  attachment persistence, close coordination and interactive preview transport
  are independent declarations. The immutable preload manifest is the only
  authority: a missing or malformed manifest fails closed to the browser
  capability set;
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
- `CommentWorkflow`: durable-comment command sequencing, crash-only Draft
  recovery projection, attachment staging/upload count and stale/cancel
  compensation; it publishes through `CommentSession` and `DraftSession` and
  is not a second Draft aggregate owner;
- `ProjectRulesSession`: `PROJECT.md` working copy, generation, composition
  fence and save projection facts;
- `ProjectRulesWorkflow`: `PROJECT.md` Bridge read/write, 700ms autosave,
  unknown-write authority reconciliation, close/switch drain and narrow native
  editor-restore host port. It publishes through `ProjectRulesSession` and is
  not a second editor-state owner;
- `RunSession`: current/background run projections, Qoder status, background
  outcomes, the one preparing/frozen/uncertain submission lock, and operation
  locks;
- `RunWorkflow`: Request freeze/persisted-boundary verification, unknown-POST
  authority reconciliation, tracked-run polling, cancellation, conflict
  commands and confirmed clipboard handoff. It publishes through `RunSession`
  and never creates a second run store;
- `VersionSession`: immutable Version records plus the current/history
  projection facts;
- `VersionWorkflow`: Version operation identity/generation, Bridge version
  reads and activation mutation, review-candidate preparation, historical
  Working Copy continuation, complete project/document/version/OpenTarget
  identity and Hash validation, synchronous cross-Session publication, and
  read-only current/history navigation rollback. A committed historical
  activation recovers forward through its receipt; it never restores V6 over
  durable V2 state. It publishes through `ProjectSession`,
  `DocumentSession`, `VersionSession`, `DraftSession` and `CommentSession`; it
  never owns a second mutable Version store;
- `SourceHistorySession`: pending exact Patch operations and history action.
- `ExternalFileOpenSession`: opaque external-open delivery IDs, one active
  switch, newest queued request, deferred safe-switch retry and stale-result
  fencing for work that has not yet been accepted.
- `ProjectApplicationSession`: FIFO accepted project results, final renderer
  switch fence, deferred application retry and successor preservation.
- `ProjectWorkflow`: hydration generation/load outcome, picker/external/switch
  operation identity, accepted-result execution, close request lifecycle,
  project-switch publication, typed source-rename transition and the unified
  managed-source prepare/commit handoff used by Candidate promotion, historical
  Working Copy continuation and future Registry opens. The command fences/drains
  existing owners, validates the expected source Hash and trusted desktop result
  (including lost-response reconciliation), then synchronously publishes through
  existing Session owners. It is an operation owner, not a second owner of any
  Session fact.

`CommentSession` does not replace the Draft aggregate or Bridge CAS authority,
and `VersionSession` does not make mutable copies of immutable Version files.
The composition root may derive labels, availability and other read-only view
data from these snapshots, but all writes return to the listed owner.

Fact ownership and workflow ownership are separate. A workflow may hold only
its operation identity, single-flight, timer, reconciliation and publication
sequence; it must publish through the existing fact-owning Sessions.
`createRuntimeWorkspaceController()` is the sole production composition path:
it creates one typed Bridge client, one shared `RunSession`, and the remaining
Project, Document, Comment, Draft, Version and SourceHistory fact owners before
constructing `WorkspaceController`. Its injected constructor remains a
Node-test seam only; it may not become a second production composition path.

`WorkspaceController` is the only Application observer of the Project,
Document, Comment, Run and Version Sessions. It exposes their immutable
aggregate snapshot through its fixed `getSnapshot()`/`subscribe()` contract and
forwards typed workflow events through `subscribeEvents()`; it does not create a
second mutable store. It owns the unique `DrainCoordinator`, protocol Sessions,
and Project, Comment, Run and Version workflow composition. `DocumentSession`
may derive `hasPendingWrite` and `isFlushing` for that snapshot, but neither a
pending-write payload nor a Promise crosses into Workbench.

Workbench owns only presentation state and narrow host adapters. It receives
the aggregate snapshot and Controller commands, never a business Session or the
Bridge client. Its direct-Bridge allowance is exactly 0: the checked architecture
gate permits no `bridgeClient.*` call, generic Bridge-command escape, business
Session construction or Session ref in Workbench. The gate also forbids React,
Workbench, component or desktop imports from Application composition code.

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
`ProjectOpenQueue` then assigns the whole classify/prepare/commit/finalize,
picker/read/Bridge-check and
active-project transition its FIFO position at entry, shared by local picker,
recent-project, external, startup, generated-version, rename and forget
routes. Class A activates the managed project. Classes B and C store a
Prepared Intent and return only a public `requestId` descriptor; they do not
activate the original file. The renderer's `ExternalFileOpenSession` owns delivery de-duplication,
one active request, one newest queued request and a deferred retry when the
normal project-switch boundary cannot yet close safely. Preload subscribes
before requesting its readiness catch-up, and drops that catch-up if a live
delivery arrives first, so an older mailbox snapshot cannot replace a newer
external intent. The session fences only an
older request that has not yet been accepted when a newer request is queued,
and it freezes the Canvas from the final safe switch fence through the awaited
external acceptance; a newer external request inherits that freeze. Each
renderer open/application session owns its own deferred retry transition. It
records whether `DrainCoordinator.inspect("switch")` observed a relevant
blocker, resumes only after that blocker clears, and otherwise leaves the
explicit retry action available. Project hydration is an explicit switch
obligation rather than a copied Workbench boolean. If the final fence captures
a post-cutoff native edit, it does not begin the IPC, releases that edit to
normal persistence, and resumes only after that source blocker clears.

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
successfully published predecessor. `ProjectWorkflow` consumes the FIFO and,
before applying each result, re-enters the complete switch boundary and takes
one synchronous final Canvas freeze. A post-drain native edit leaves that accepted result in the session
until a relevant blocker transition or explicit continuation makes another
attempt safe. Thus a slow later read cannot unlock the Canvas through an older
result and then discard an intervening edit. Ordinary Workbench project-picker
retry state may not carry either external delivery or accepted-result protocol.

A transition that changes the current source or Version has two phases. The
asynchronous phase prepares and validates one complete candidate: project and
document identity, canonical path, full OpenTarget/Working Copy identity,
Version authority, HTML bytes and Hash. The publication phase contains no
`await`: it synchronously advances `ProjectSession`, publishes the complete
`DocumentSession` tuple, updates `VersionSession`, `DraftSession` and
`CommentSession`, then invalidates prior Canvas acknowledgements. Publishing
only the path, only the Hash or any other partial combination is forbidden.

The history “continue editing” command is not a Version restore or snapshot
write. It accepts only the current project identity, one `versionId` and an
operation ID; Repository chooses the one matching existing Working Copy after
validating its state and immutable snapshot, atomically records V2 as active
with a `desktop-pending` receipt, and confirms that receipt only after Desktop
activation. If a Bridge, Desktop or confirmation response is lost, the same
receipt operation is safe to replay and must resolve to the same `workingCopyId`;
it must not roll durable V2 back to V6. A background Candidate carries its own
complete OpenTarget and may never use whichever target happens to be mounted in
the foreground.

## Registry catalog and AI-task display projections

The Registry is the sole project-catalog membership and write-authority source.
`ProjectFileRepository` may enumerate only its registered records, recover a
verified same-parent root rename through the existing Registry path, and return
ready/unavailable/invalid rows independently. Optional `importSourceKey` values
are a long-lived lookup to at most one `projectId`; they do not grant writes
and do not deduplicate by Hash. Current Registry mutations serialize through a
dedicated write lock, distinct from exact-legacy-V4 migration. Desktop Recent records contribute
only sorting, `lastOpenedAt` and startup preference; they cannot add a member,
remove a member or authorize an open. A Workbench catalog intent carries only
`projectId`; the Bridge re-resolves and validates the complete Project,
Document, Working Copy, OpenTarget, bytes and Hash tuple before the normal
source-transition publication boundary.

`AI任务/` is intentionally outside every authority chain. Once a durable
Request or verified Candidate already exists, the Repository validates the
frozen project/request/attempt/candidate lineage and hashes, then delegates
only those verified bytes to the narrow `ai-task-projection` materializer. Its
receipt under `.pageroot/recovery/ai-task-projections/` records display recovery
progress; it cannot recreate an active Request, Candidate, Version or runtime
state. The materializer publishes a frozen `PROMPT.md`, then a finalizer-verified
`*-Vn-待审阅.html`, using exclusive directories and no-replace files. It neither
writes nor reads `附件与图片/`, `附件快照说明.md`, `AI_RULES.md`, `PROJECT.md` or a
formal Version in P2.

Desktop's `revealAiTask` accepts the current source locator rather than a
Renderer-supplied Request path. The Bridge returns a root-contained,
non-symlink `AI任务/<single-child>` result only after validation. A deleted,
tampered or user-occupied display path cannot affect review or Promotion and
may only be rebuilt from hidden authority or replaced with a new safe display
directory. The project Finder entry opens the validated project root; the
Version Finder entry opens the validated visible Working Copy rather than the
hidden immutable snapshot.

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

Edit has no runtime-snapshot authority. It normally remains script-disabled and
renders source-static content, but desktop may choose one bounded direct author
runtime before the initial editable frame becomes interactive. The sole
`EditAuthorRuntimeSession`, composed by `WorkspaceController`, keys the attempt
to `(sourcePath, canvasGeneration)` rather than an autosave revision, source
echo or comment state. It accepts one exact persisted-source prepare result
only for the same source SHA and generation; a late old result is revoked and a
settled session cannot prepare again. Its `preparing` snapshot first commits
the non-interactive loading surface; only that presentation acknowledgement
starts the narrow prepare port, so a fast grant cannot promote a static iframe
that has already mounted.

The direct path permits only a bounded classic-script ECharts candidate, frozen
local/allowlisted-CDN bytes and at most 32 uniquely bound, source-empty hosts.
For an HTML-only imported V1, Main records the original selected HTML directory
in desktop `html-projects.json` and uses it as the local asset root for Preview,
static Edit and the one-shot ECharts path. The renderer neither supplies nor
learns that original path; the Working Copy remains source authority. The
binding survives continue-current, restart, working-copy switches and optional
original-HTML trash while sibling files remain in that directory.
The final frame executes once, waits the fixed settle interval, then stops
tracked runtime activity and audits source-node identity/text/attributes plus
host containment before installing Canvas interaction. An approved empty host
may add only absent ECharts layout declarations (`position: relative`,
`user-select: none`, transparent `-webkit-tap-highlight-color`, or a positive
`scale()` no greater than `1`);
its authored declarations and every other
attribute remain exact. Runtime descendants are
display-only and map to their approved source host. They never become a
`SourcePatch`, Source HTML, save, Version, export, Request or AI input. Any
prepare, load, audit or deadline failure selects the ordinary static frame;
there is no Edit cache, bitmap/Blob projection, hidden probe, background
promotion or post-interaction iframe replacement.

Review alone uses one `SourceHostResolver`, one narrow owner request schema,
one `RuntimeSnapshotOwner` and one trusted PNG parser. The resolver admits only
direct source Canvas/SVG roots and source-empty hosts with a unique stable
source binding. It does not infer candidates from JavaScript, runtime DOM,
computed selectors, comments, arbitrary HTML or `tbody`.

The main-process owner creates one hidden authored-page window and preview
session per active Review capture; replacement, timeout and disposal destroy
both. It accepts only exact source HTML/SHA, `before`/`after` side, viewport and
frozen bindings, then confirms the host in an isolated world before bounded PNG
capture. A PNG has no drain, persistence, review-diff, source-history or AI
authority. The renderer request never carries a project path. For an active
desktop document, main may supply the preview protocol with only that
document's declared, contained relative-asset allowlist; the authored page
still receives no filesystem or project capability.

Prepared formal-review documents are owned by a cancellable
`ReviewAnalysisSession` keyed to exact operation/source/comment identity. Its
multi-entry cache is byte bounded. Parsing and annotation yield between phases,
and stale work stops before publication. Fuzzy node pairing may compare only
compatible tag/context buckets after exact and unique explicit identity
matches; it cannot restore a page-wide Cartesian candidate set or change the
existing evidence thresholds. Stable identity, exact subtree equality and own
non-presentation compatibility have different roles: exact equality skips only
an unchanged branch, while an empty Canvas/SVG/control/container needs the same
parent, kind and compatibility to become a candidate. Ambiguous alternatives
remain unmatched. Analysis-local signature caches and projection facts are
disposable; a trusted 25th distinct fact is an explicit analysis failure, while
an oversized serialized payload fails closed rather than being treated as a
complete review.

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
owner boundary, and no TargetRef or PNG enters either review frame.

The one before/after snapshot pair is compared once. Captured layout dimensions
and the owner-isolated visible DOM/SVG-text hash are strict. When both match,
different PNG hashes are decoded only in trusted renderer memory and emit an
opaque `{candidateKey, changeId}` fact only above the fixed `0.04` mean absolute
RGB-channel error budget; byte/encoder variance and small raster tile noise do
not emit a fact. Raw text never leaves the owner, and this path has no OCR,
script causality or second pair.
The candidate key maps back to an exact per-side source `Element` captured by
the first parser-blocking bootstrap from a path plus complete narrow
fingerprint. The trusted parent transfers the result through a distinct random-
challenge private port fenced by contract version, session, side and full
source SHA. Candidate keys/bindings never enter authored HTML, DOM attributes,
ordinary window messages or later bootstrap reads. The bootstrap stores runtime
facts only in a disposable `Map<Element, facts[]>` and unions them with static
serialized facts; outline IDs stay navigation-only. Replacement, disconnect or
fingerprint drift removes that runtime fact without outline fallback. A missing
desktop API, unmapped host, malformed envelope, timeout, cancellation or late
result is a silent static-only outcome. There is no second fresh pair,
confirmation coordinator, runtime UI or Review cache. Edit does
not invoke the resolver or owner and has no snapshot state; its separate
one-shot author-runtime session is governed by ADR 0025 and cannot consume
Review bindings, PNGs or facts. Edit screenshot/capture/projection count must
be 0.

For each Review side and active filter, overlay frames and context masking
consume the same final canonical projection records. The mask is a session-,
side- and projection-epoch-scoped SVG luminance mask: a white full-page
background retains the dim rectangle and each record path is a black transparent
hole. Therefore overlapping independent facts stay transparent as a geometric
union; a full-page `evenodd` path is not a permitted representation. Reserved
mask background, hole and dim primitives reset authored fill, stroke, opacity,
filter and transform while preserving the current context-opacity value.

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
application transition owned by `WorkspaceController`: it adopts those
identifiers and activates Draft authority from the same Bridge response. If a
registered page later finds its Draft session inactive or bound to another
context, the Controller queries current workspace authority and safely rebinds
before creating a mutation; it does not leave an unchangeable close blocker.

Every registered mutation captures that complete ProjectContext once. The
Bridge resolves `projectId + documentId` against the registry before consulting
the mutable path and uses `sourcePath` only to prove that the command remains
inside the registered source or an explicit alias. Supplying exactly one ID is
invalid. Omitting both IDs is a temporary compatibility route that may address
an existing registration but may not create one; `/project/ensure` is the sole
creation boundary. `/project/open-classification` is an authenticated read-only
classifier: it must not write Registry bytes, create a project, or return raw
source keys, external absolute paths, hidden snapshot paths or HTML bodies.
Desktop Prepared Intent commit is the only path that may later call
`/project/ensure` for a class-C confirmation. Attachments and their compensating cleanup use the same
captured context, plus their composer/edit identity, for their complete
asynchronous lifetime. `CommentWorkflow` is the only renderer application
owner that may stage an attachment, call its Bridge repository, or compensate a
late write; browser-memory attachments never acquire that Bridge capability.

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

Autosave then enters `ProjectFileRepository`. It is the only live Bridge-side
owner of the current-source write for a registered v4 Project File. The retired
v3 `SourceTransaction` kernel is not on this path. An AI Version publication
remains a separate immutable transaction. `/source-history/action` does not
apply a persisted journal; it returns current source bytes and empty history.

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

`WorkspaceController` owns exactly one `DrainCoordinator`; workflows and
injected Sessions register obligations on that coordinator instead of composing
dirty booleans in React. `ProjectWorkflow` owns the request-scoped desktop close
lifecycle. The Workbench close listener synchronously registers only
`detail.waitUntil(controller.prepareClose(...))`; abort and browser fallback are
commands to the same workflow, not parallel close authorities.

`CommentWorkflow` supplies the `draft/comment persistence` and `attachment
staging` obligations; `ProjectRulesWorkflow` supplies `project-rule
persistence`. `ProjectWorkflow` delegates those obligations without reading
React refs or reproducing mutable snapshots; Workbench only renders the
Controller projection and dispatches durable commands.

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

After the aggregate drains, `ProjectWorkflow` asks `DocumentWorkflow` to
reconcile source close readiness against the independently hashed frozen HTML
and `DocumentSession` authority. An acknowledged
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

- An exact pre-hardening V4 `.pageroot-registry.json` may complete its missing
  Registry-only root identity metadata through `ProjectFileRepository`. The
  current shape is validated and read without a write. The historical shape
  must have exactly `schemaVersion: "4.0.0"`, no `pendingImports`, and only
  `{ projectRootPath, updatedAt }` project records. Every record must prove its
  ID, direct-child non-symlink root, real-path containment and matching
  `.pageroot/project.json`; current `rootFileIdentity` comes from that live
root stat, never a filename or HTML Hash. A short-lived exclusive migration
lock serializes this replacement across Bridge processes; sealed dead-owner
reclamation first atomically claims the exact token-named marker, while an
unsealed or malformed lock fails busy. After acquiring it,
the repository re-reads the Registry and returns a current record without a
write when another process already completed it. All entries validate before
the old raw bytes are backed up by Hash and the full current Registry is
atomically published. A failure preserves the old Registry, cannot reset or
reassociate a project, and grants no write authority. Remove this migration
  only after a read-only Registry census proves the exact historical shape is
  outside the supported upgrade window.
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
