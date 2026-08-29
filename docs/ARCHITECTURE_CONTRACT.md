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
- `RunSession`: current/background run projections, per-Request Agent delivery
  status, background outcomes, the one preparing/frozen/uncertain submission
  lock, and operation locks. ACP events remain bounded presentation facts and
  never become completion authority;
- `RunWorkflow`: pre-Request Agent use-time check, Request freeze/persisted-boundary
  verification, safely fenced same-Request Agent start/retry, unknown-POST authority
  reconciliation, tracked-run polling, stop-before-durable-cancel ordering,
  conflict commands and confirmed clipboard fallback. It publishes through
  `RunSession` and never creates a second run store;
- Bridge `AgentRuntimeCoordinator`: ephemeral provider/runtime/security-profile/
  purpose-bound preflight tickets, both session lifetimes, persistent launch
  fence, bounded canonical progress and cleanup. Legacy Services only delegate.
  It never owns or writes Request/Candidate/Version state; task authority is
  re-derived from the registered Repository/runtime record, and only the
  official finalizer plus Repository status path can publish a Candidate;
- Bridge Agent provider/runtime registries: the provider registry is the sole
  legacy-driver/provider dispatch point and the runtime registry is the sole
  runtime dispatch point. The Qoder provider owns installation identity,
  version, login/model preflight and raw-error normalization. The Codex ACP
  provider owns the same facts for `providerId: "codex"`; missing login is
  `session/new` JSON-RPC `-32000`, not advertised `authMethods`. Unknown IDs fail
  closed; opaque installation facts, digests and capabilities stay inside the
  ticket;
- Bridge Agent catalog/installer: `AgentCatalog` owns the product ACP
  allowlist, public provider projection and managed-command candidates.
  `AgentInstaller` owns in-flight install jobs, atomic verified layout under
  `userData/agents` and shutdown drain. Coordinator does not own install. This
  is a product allowlist, not a live public registry; Qoder and Codex ACP are
  the installable shipped ACP entries. The packaged application contains no
  private Codex runtime or native Codex package;
- Bridge Agent Host/Policy Ports: `bridge/agent/policies/` owns the execution
  policy and freezes all readable files, output/completion paths,
  runtime authority and finalizer authority. `bridge/agent/hosts/` owns the
  single-output Execution surface, including cancellation fencing, completion proof and managed terminal
  cleanup. Provider/runtime code may invoke these ports but cannot choose their
  paths, command, success criteria or durable outcome;
  these Ports constrain only requests mediated through the ACP Client Host.
  They are not a sandbox for native filesystem or command operations performed
  by an Agent process. After the Codex ACP cut-over there is no registered `agent-native` provider.
  Both installed ACP providers use one fresh ephemeral session, approval
  `never`, disabled MCP/skills/plugins/apps/Web/subagents, tool network
  disabled, a Request-output-only workspace-write root, fixed finalizer,
  unique Candidate acceptance and confirmed process-group cleanup; they remain
  trusted local processes with the signed-in user's native read authority. Any
  future registered `agent-native` provider requires a separate sandbox
  conformance and security gate before registration;
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
and Project, Comment, Run, Version and Workbench Tabs workflow composition.
Capability facets such as `controller.comments`, `controller.runs`,
`controller.navigation` and the narrow
`controller.projectCatalog` projection are stable views of this same
Controller instance. A facet exposes only `getSnapshot`, `subscribe` and typed
business commands; it neither stores copied facts nor exposes another
capability. React capability containers subscribe to facets directly so local
draft or focus updates do not publish through the Workbench composition root.
The aggregate contract remains available during migration and for genuinely
cross-capability presentation.

Comment geometry is a disposable presentation port, not Controller or Session
state. `HtmlCanvasEditor` publishes source-tagged layout snapshots to one stable
`commentCanvasPort`; `CommentRailContainer` alone subscribes, owns composer/edit
disclosure, delete confirmation and file-input refs, measures cards, virtualizes
the rail and routes paired reveal/focus/relink intents. Workbench may issue a
typed presentation intent or read the latest target status inside a user command,
but it must not subscribe its composition render to comment presentation changes.
`WorkbenchGlobalSidebarContainer` and the Start surface subscribe
`controller.projectCatalog` independently and render only project identity,
open/switch actions and the existing version-tree context. There is no
user-facing project management panel, `controller.projects` presentation facet
or `projectPanelPort`. `ProjectRulesSession` and `ProjectRulesWorkflow` retain
the durable rules facts and safe lifecycle commands, but rules editing,
version-detail presentation, Finder/export actions and history-preview entry
points are not exposed through a drawer or a React editor container.
`RunConversationOutlet` subscribes `controller.runs`; public Agent narration
and its timestamps therefore commit only the conversation region. Workbench's
aggregate comparator still publishes run identity, lifecycle, phase and error
changes needed by cross-capability locks and navigation.
`WorkbenchTabBarContainer` subscribes `controller.navigation` and owns tab
commands, keyboard shortcuts and post-close focus restoration. Startup restore,
Registry reconciliation and tab persistence enter through Controller-owned
commands and narrow host ports, never React refs or Workbench effects. `DocumentSession`
may derive `hasPendingWrite` and `isFlushing` for that snapshot, but neither a
pending-write payload nor a Promise crosses into Workbench.

Workbench owns only cross-capability presentation state and narrow host
adapters. Capability-local presentation state belongs in its container.
Workbench receives the aggregate snapshot, stable facets and Controller
commands, never a business Session or the
Bridge client. Its direct-Bridge allowance is exactly 0: the checked architecture
gate permits no `bridgeClient.*` call, generic Bridge-command escape, business
Session/Workflow construction or Session ref in Workbench. The gate also forbids React,
Workbench, component or desktop imports from Application composition code.

Workbench navigation has one application transaction contract. Startup restore,
local/recent/Registry selection, tab activation, browser file continuation, OS
external FIFO delivery and confirmation continuations enter the same admission
order. Each admitted intent owns one `transactionId` and moves through:

```text
idle -> admitted -> preparing -> awaiting-user/opening
     -> applied(identity, epoch, application receipt)
     -> display-ready -> committed -> idle

background readiness after display-ready:
     -> hydrating -> canvas-verified/edit-ready -> context-ready
```

`ProjectWorkflow` calls the synchronous navigation application port while the
new Project/Document authority is being published. A non-null transaction must
first pass the navigation workflow's live transaction/application-generation
authorization; mismatched, expired or terminal transactions are rejected before
any Controller Session changes. A null transaction remains the explicit legal
path for an authority refresh. The returned receipt is the
only authority for tab mutation and the start of background hydration and
Canvas settlement;
`project-applied` remains presentation information and React may not infer an
application from any-pending state. A pre-applied failure restores the captured
tab authority without changing the Controller. Once the exact bytes are
display-ready, navigation is successful; a later hydration or Canvas failure
retains the tab, marks its readiness error and keeps edit authority closed. A
failure inside a still-atomic Prepared Intent may restore Controller and tabs
from the same receipt. A close may cancel an awaiting-user prompt, but it
must wait for committing, applied, hydrating, finalizing and acknowledgement
work to reach a terminal receipt. Cold-start priority is explicit OS external
FIFO, persisted active tab, `activePath` compatibility, then Start.

Registered-project opening uses one Repository-produced immutable open envelope
for the exact `Project + Document + OpenTarget + path + HTML + Hash` tuple.
Desktop must not repeat `/workspace` and a filesystem HTML read before Renderer
publication. Renderer workspace hydration may skip `/source` and a repeated
content hash only when the live `/workspace` identity and Hash exactly match
that opening envelope; every mismatch remains fail-closed and read-only.

Desktop close synchronously freezes that admission stream before its first
await. The freeze spans navigation-idle settlement, a pinned tabs-persistence
revision, and the ProjectWorkflow close drain. Ready keeps the freeze through
final exit; blocked or aborted close releases it, including final-exit abort IPC,
before navigation retry. External FIFO acknowledgement requires a correlated
terminal navigation outcome and never treats a missing terminal as success.

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
dedicated write lock, the only Registry lock; a Registry that is not a valid
current Registry fails closed rather than migrating. Desktop Recent records contribute
only sorting, `lastOpenedAt` and startup preference; they cannot add a member,
remove a member or authorize an open. A Workbench catalog intent carries only
`projectId`; the Bridge re-resolves and validates the complete Project,
Document, Working Copy, OpenTarget, bytes and Hash tuple before the normal
source-transition publication boundary. Automatic Recent/catalog refreshes are
deferrable projections: the renderer publishes Project/Document/Version/Draft/
Comment authority and confirms Working Copy activation first, then schedules
the list refresh behind the current context fence. A slow or failed catalog
scan therefore cannot reorder the Repository mutation queue ahead of a
confirmation or downgrade a completed rename/continuation to unknown.

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

The install-level first-real-HTML guide is a separate Session fact.
`FirstEditGuideSession`, composed only by `WorkspaceController`, owns
visibility and the 800ms present-dwell timer. Durable `pending` /
`presented` / `dismissed` status and the built-in welcome `projectId` live in
Main `ui-preferences.json`. Workbench may pass a narrow get/record port at
composition time and dispatch `evaluateFirstEditGuide` / `dismissFirstEditGuide`;
it must not call UI-preference IPC itself. Workbench mounts `FirstEditGuideCard`
as a `position: fixed` portal on `document.body`, not as a grid child of the
workbench or canvas; `HtmlCanvasEditor` must not mount or dismiss the card.
Send that enters waiting writes `dismissed`; Escape does not. Hover captions
are disposable Canvas presentation and must not change the click selection path.

The direct path permits only a bounded classic-script ECharts candidate, frozen
local/allowlisted-CDN bytes and at most 32 uniquely bound, source-empty hosts.
For an HTML-only imported V1, Main records the original selected HTML directory
in desktop `html-projects.json` and uses it as the local asset root for Preview,
static Edit and the one-shot ECharts path. The renderer neither supplies nor
learns that original path; the Working Copy remains source authority. The
binding survives continue-current, restart, working-copy switches and optional
original-HTML trash while sibling files remain in that directory.
The final frame executes once, disables its disposable initial ECharts
animation, then freezes after real paint and two quiet frames; the deadline is
only a broken-script fallback. It stops tracked runtime activity and audits
source-node identity/text/attributes plus
host containment before installing Canvas interaction. An approved empty host
may add only absent ECharts layout declarations (`position: relative`,
`user-select: none`, transparent `-webkit-tap-highlight-color`, or a positive
`scale()` no greater than `1`);
its authored declarations and every other
attribute remain exact. Runtime descendants are
display-only and map to their approved source host. They never become a
`SourcePatch`, Source HTML, save, Version, export, Request or AI input. Any
prepare, load, audit or deadline failure selects the ordinary static frame.
Workbench may retain five already verified iframe documents and prewarm exact
immutable script bytes for registered tabs. Those caches are inert presentation
or resource facts only: there is no bitmap/Blob projection, hidden execution
probe, source promotion or post-interaction iframe replacement.

Review has no runtime-snapshot owner or PNG evidence path. It compares only the
frozen before/after HTML and emits bounded text facts plus outermost
element-presence facts. Its script-enabled frames may keep an opaque origin and
use a frame-local memory Storage compatibility bootstrap so ordinary authored
scripts do not abort, but that compatibility surface grants no durable or
shared storage and produces no Review facts. Position, order, attributes, CSS,
layout, computed style, Canvas/SVG pixels and runtime-discovered nodes remain
outside the Review contract.

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

Exact completed review entries survive unrelated tab applications; only stale
in-flight analysis is cancelled. Candidate-ready state may prewarm the same
cache key. An uncached explicit Review first publishes a minimally prepared
sandbox/bootstrap shell with no change, comment or runtime facts, then replaces
it with complete analyzed documents. The shell is presentation only and cannot
approve, promote or alter either source.

Successful Candidate adoption and stale Review invalidation clear the prepared
document cache immediately. Unmounting the Review workspace then releases its
paired preview sessions and iframes; the five verified Edit canvases remain the
separate hot-resource budget.

Formal Review has no runtime-snapshot supplement. The trusted
`AiReviewWorkspace` begins with the immutable static document pair and keeps
the analysis, navigation, masking and acceptance paths display-only. Inline
and browser Review use the same static contract.

Comment location remains a separate private capability. An opaque initial
bootstrap binding may identify a frozen before target for comment geometry, but
it neither reaches authored markup nor authorizes runtime host discovery. No
TargetRef, source binding or runtime output enters either review frame's
authored HTML or the Review fact list. Edit does not invoke any Review resolver
or owner and has no Review snapshot state; its separate one-shot author-runtime
session is governed by ADR 0025. Edit screenshot/capture/projection count must
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

The semantic source-operation foundation is a pure pre-persistence boundary.
It accepts only complete identity-v1 HTML plus an operation carrying stable
operation identity, exact base revision, complete-source Hash and stable
ID/tag/outer-Hash target evidence. It returns complete next HTML, Hash, lineage
and a generated in-process inverse. Intent is lowered to SourcePatch, whose
apply path independently re-plans the operation before enforcing exact ranges,
outside-scope equality and parse integrity. Runtime DOM is never an input.
Until PR5 explicitly adopts this boundary, Canvas, `SourceHistorySession`,
autosave and Repository remain on their existing route and do not maintain a
parallel semantic revision.

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

That same Repository is the sole source-element identity migration owner. New
imports preserve the external file and immutable V1 snapshot while writing an
identified managed Working Copy. A legacy registered Working Copy migrates only
on editable workspace hydration, after normal save recovery and external-change
reconciliation. The transaction seals exact before/after Hashes and complete
recovery bytes, uses the Working Copy CAS writer, then publishes the state schema
marker, canonical ID/tag/parent/order binding Hash and fresh manifest file
identity. Restart accepts only the sealed old or new side. A clean external edit
may reconcile only when that binding Hash survives; a changed or missing binding
requires explicit force-unlock before a new controlled migration. Invalid
identities, an unresolved save state or third-party bytes fail closed; no
historical Version, Request, Candidate or Runtime DOM is serialized.
Until structural editing moves to semantic operations, a normal save may add an
ID to a newly authored wrapper or line-break only after proving that every ID
claimed by the current Working Copy remains valid and present in the candidate.

Current managed TargetRefs add `elementId` and the expected canonical source
Hash, refreshed by deterministic current-source rebind. Presence of the
stable ID selects one resolver contract: only the valid unique SourceIndex ID
entry may resolve, and deletion or tag migration is orphaned without heuristic
fallback. `targetId` remains per-record identity; optional selected-text
locators are UTF-16 ranges inside the owning element's decoded descendant text.
ID-less historical TargetRefs keep the legacy resolver and immutable Version
records are never rewritten. See ADR 0061.

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

### Architecture gate assertion forms

`scripts/check-architecture.mjs` enforces the boundaries above as four explicit
responsibility groups:

- `layerBoundaryViolations`: import direction between Domain, Application,
  Views, Bridge and build scripts;
- `ownershipBoundaryViolations`: the single runtime composition root and the
  approved persistence owners;
- `escapeBoundaryViolations`: typed Bridge access, browser persistence,
  endpoint knowledge and provider-neutral workflow boundaries;
- `retiredArtifactViolations`: deleted production modules and their imports.

The gate uses structural queries from `scripts/architecture-ast-query.mjs`
(`moduleSpecifiers`, `callNames`, `newExpressionNames`, filesystem-write
classification and literal comparisons). These queries operate on dependency,
call, construction and data-category facts. They do not assert private fields,
private methods, exact object properties or the spelling/order of a business
call, so a responsibility-preserving rename or reflow cannot fail the gate.
Document-content checks remain in the ADR and packaging gates where the text or
artifact itself is the boundary.

The gate must not assert that a specific code fragment *exists* by substring or
by ordered substring (`String.prototype.includes` on code, ordered marker
lists). A required behavior is proven by a behavior or fault-injection test, not
by matching its source text.

#### Review behavior test debt

Converting the gate away from ordered source-string matching exposed renderer
behaviors whose ordering guarantees are now asserted only structurally (call
presence), because the repository has no DOM test harness for
`HtmlCanvasEditor.tsx`. Native deferred-command arbitration now has a Node
unit test on `html-canvas-native-commands.js` (system work blocked by a pending
user-explicit command, supersede, and stale-lease drain). The remaining items
still need Electron/Playwright behavior coverage:

- Canvas fail-closed freeze: a source transition must abort when
  `freezeNow()` fails or returns bytes that differ from the live source.
- Canonical host replacement: the native lease must be disposed before the
  authored DOM host is replaced.

### Complexity budget ratchet

`scripts/architecture-budget.json` records a line count and total React-hook
count ceiling for files with a demonstrated regrowth risk (currently
`app/workbench.tsx`, `app/components/HtmlCanvasEditor.tsx` and
`bridge/project-file-repository.mjs`). The gate counts hooks structurally, so generic-typed calls such as
`useState<T>()` are included.

This is a guardrail against silent drift, not a hard cap, and it is deliberately
not applied to every large file:

- Exceeding a ceiling is advisory only: the architecture check prints a visible
  notice naming the low-friction escape valve — if the growth is intentional,
  raise the number in the same change — but a budget notice never fails the
  gate, CI or merge, and no test asserts the ceilings. Growth is allowed, but
  it must be a conscious, reviewed decision rather than silent drift.
- Lowering a ceiling is not an acceptance goal. Do not split a module only to
  reduce `maxLines`.
- When a file shrinks for a real invariant boundary, the check may hint to
  lower the ceiling; that hint is observational.
- Prefer a narrower public command surface over moving lines to a new file
  that still exports the same illegal state combinations.

The budget is a trend brake, not a design target. There is no enforced descent
schedule; the numbers track real progress, they do not mandate it.
