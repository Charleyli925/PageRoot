# Architecture

PageRoot is an Electron application with a React renderer and a local Bridge process.

```text
User HTML bytes
  -> SourceIndex / TargetResolver
  -> isolated authored-DOM preview
  -> native Selection + IslandEditingController
  -> canonical editable island or exact direct-text-node fragment
  -> exact content-range or text-node-range SourcePatch
  -> renderer SourceHistorySession + durable exact Patch journal
  -> serialized atomic file writer

Comments + frozen input
  -> Change Request / Attempt
  -> clipboard-only AI handoff
  -> completion + candidate health/continuity assessment
  -> immutable Version
  -> explicit user-controlled activation
```

## Boundaries

- `docs/ARCHITECTURE_CONTRACT.md` is the normative dependency, state-ownership,
  asynchronous outcome and drain contract. `docs/STATE_OWNERSHIP.md` names the
  sole owner of each mutable fact.
- `app/` owns the visual workbench, source mapping and direct-edit transaction model.
- `desktop/` owns privileged filesystem access, windows, lifecycle, update checks, usage telemetry and safe IPC exposure.
- `scripts/` owns the local Bridge, protocol finalization, AI candidate assessment, direct-edit/legacy scope evidence and automated gates.
- `schemas/` defines persisted and exchanged records. `fixtures/` proves strict current and legacy behavior.
- Preview DOM is disposable. It is never a persistence source.
- Current-source and generated-Version changes use prepare-then-publish: all
  project/document identities, canonical path, Version state, HTML bytes and
  Hash are validated before one synchronous renderer publication. No async
  query may expose a new path or Hash beside old Document bytes.
- `DocumentSession` advances one Canvas authority generation whenever the
  authoritative bytes/view are replaced. Edit and preview readiness are
  disposable acknowledgements tagged by that generation and the rendered
  source Hash; stale acknowledgements are ignored. “Safely saved” additionally
  requires the visible surface acknowledgement to match the persisted source.
- A clean projection mismatch is repaired automatically by one authoritative
  source reread and one bounded Canvas rebuild. Failure stays fail-closed and
  never asks the user to reconcile internal Hash state manually.
- Pure-browser preview is a supported read-only route. It may run authored page interactions inside the sandbox, but it exposes no PageRoot edit, comment, attachment, project-write, or AI-submit authority.
- Desktop interactive preview uses a short-lived `pageroot-preview:` document
  instead of `srcdoc`, so the authored page does not inherit the renderer's
  `script-src 'self'` policy. The main process owns the volatile session and
  serves only its prepared HTML, its fixed bootstrap and a session-specific
  manifest of declared relative assets beside the known source HTML. It never
  turns the source directory into a general-purpose local-file origin. A
  direct-frame authored navigation is canceled. If it occurs before the first
  load completes, that session becomes a one-way, stricter-CSP scriptless
  fallback retaining only the owned bootstrap, then reloads the same frame;
  attempts after load leave the current document intact.
- Preview-to-edit carries only a bounded `PageViewContext`: source-backed
  active/inactive class transitions and `hidden`, `open`, `aria-selected` or
  `aria-expanded` state. It never carries runtime DOM, pixels or table markup.
- Edit is script-disabled and renders only source-static content. It has no
  runtime snapshot session, cache, IPC request, bitmap projection or Blob URL;
  authored inline SVG remains source-backed while runtime-only Canvas/SVG stays
  in Preview.
- Review alone has a disposable runtime-snapshot supplement. Its
  `SourceHostResolver` admits only direct source Canvas/SVG roots and stable,
  source-empty hosts; it never uses script causality, computed selectors,
  arbitrary HTML or `tbody`. `RuntimeSnapshotOwner` accepts bounded `before`/
  `after` PNG evidence only after exact source/binding validation in an isolated
  world. Runtime DOM and PNGs never enter SourcePatch, save, Version, Review
  source analysis or AI Request input.
- Comment selection remains source-node exact inside foreign content. Authored
  SVG children retain their own instrumented SourceIndex identity; runtime-only
  children fail closed and are never promoted to an ancestor `svg`.
- Comment-rail coordinates are a disposable Canvas measurement projection.
  Every snapshot is tagged with the rendered source Hash, the generation of
  the `PageViewContext` actually applied to the edit document and the exact
  sorted target-ID set. The same snapshot owns fresh source resolution,
  visible/hidden/missing presentation status, coordinates, marker eligibility
  and the authored document's natural content height. Workbench renders cards
  only after that complete snapshot is current; one missing coordinate degrades
  only its owning item and is not permission to use saved geometry or a page-end
  fallback. That natural Canvas height also owns the comment rail's fixed bottom:
  a longer comment queue is clipped and translated inside the rail instead of
  feeding height back into the Grid or shared page. Iframe viewport height is
  never fed back as authored content height. Each visible card is measured
  against a signature of every height-changing state (content, attachments,
  edit/delete/relink controls and target recovery). A DOM or size change
  invalidates the old measurement before layout; absolute `top` is applied
  without interpolation so two cards never animate through one another.
- Edit-mode presentation actions reuse that same context. A pure allowlist
  resolver recognizes strict source-backed Tabs, bounded explicit-ID and
  constant-index legacy Tabs, native details and local disclosures; one Canvas
  executor applies the accepted context. It never invokes authored handlers,
  serializes the preview DOM or creates a second interaction mode.
- Formal AI review owns one disposable reducer with independent page, change
  filter, context visibility, navigation, canonical presentation path, scroll
  and zoom fields. A cancellable, byte-bounded `ReviewAnalysisSession` yields
  between parse/control/pair/annotation/serialization phases and after bounded
  semantic row/list-item batches, then caches multiple
  exact identities. Its document analyzer first builds a hierarchy of semantic
  units (`direct-flow`/`br-line`, list/list item, table/row group/row/cell,
  leaf text owner and atomic non-text content such as media, controls and
  foreign-namespace graphics), then aligns only siblings of an already-paired
  parent.
  `review-semantic-alignment` is the pure, bounded alignment helper: it consumes
  only unique explicit stable identities and exact-equality signatures first,
  cuts remaining intervals on those anchors, then uses a weighted monotonic
  alignment or a finite-lookahead fallback. Stable identity, exact equality and
  self compatibility are separate facts: an exact subtree can skip an unchanged
  branch but can never replace the identity of a paired container. Analysis-local
  `WeakMap` signatures describe stable identity, own non-presentation
  compatibility and exact subtree equality; empty Canvas/SVG/media/control and
  empty-container units may enter weighted matching only when that own
  compatibility agrees under the same paired parent. Repeated, low-confidence
  and ambiguous candidates remain unmatched; it never promotes tag, class,
  position or geometric proximity into a change fact.
  The shared pair graph derives copy, structure and visual facts once, and only
  then emits a typed canonical fact list. One prepared element may carry more
  than one independent fact (for example, a box-style change and a layout
  change), each with its own fact identity, disposable semantic owner and
  geometry owner. Facts never merge merely because they share an element or
  are geometrically close; final projection rectangles require the same fact
  and owners, except for the explicit structural-owner dominance rule. Neither
  identity is persisted, sent over IPC, or available to comments. The
  trusted analyzer fails explicitly rather than silently discarding a 25th
  distinct fact for one element; untrusted serialized input remains bounded by
  the 24-fact/12,000-byte parser limit and fails closed when it exceeds it.
  ready-review session prepares that immutable document pair for the exact
  operation/source/comment identity before the React review surface mounts;
  rerenders and bounded cache hits reuse it. Static source analysis remains the
  primary fact channel. `SourceHostResolver` optionally pairs direct source
  Canvas/SVG roots and source-empty stable hosts, using `SourceIndex` and
  `TargetRef` before scripts execute. It does not inspect script causality,
  computed selectors, comments or runtime-discovered nodes. After both static
  frames are usable, the trusted parent may send exact source HTML, source SHA,
  viewport and frozen bindings to the one Electron `RuntimeSnapshotOwner`.
  Inline/browser review stays static-only. The owner uses a fresh hidden
  sandboxed window and non-persistent session, validates raw source binding,
  then confirms the same rendered host and visible Canvas/SVG paint in an
  isolated world. It collects one rect pass and at most one bounded PNG per
  host, with main-owned deadline, navigation/permission denial and mandatory
  cleanup. Renderer memory revalidates PNG bytes/hash/dimensions and compares
  one before/after pair. A difference emits one opaque `{candidateKey,
  changeId}` result per changed source host; outline IDs remain navigation and
  summary metadata, never geometry authority. For each side, the analyzer puts
  the exact source-host path and complete narrow fingerprint only in the first
  parser-blocking bootstrap response. That bootstrap captures the original
  `Element` before authored scripts, accepts changed keys only through a
  separately challenged, session/side/source-SHA-fenced private port, and adds
  disposable box-style facts in an in-memory `Map<Element, facts[]>`. Static
  serialized facts and runtime facts are unioned during projection; an empty,
  invalid, late or unavailable runtime result cannot erase static facts.
  Candidate keys/bindings are absent from authored HTML, DOM attributes,
  ordinary window messages and every later bootstrap response; TargetRefs and
  PNG bytes never enter either review frame. Replaced, disconnected or
  fingerprint-drifted elements lose only their runtime fact, with no outline
  fallback. There is no confirmation coordinator or second fresh pair.

  Frozen comments use a separate private locator capability. For every
  source-resolved before target the analyzer keeps an opaque initial-bootstrap
  binding: a parser path plus a narrow static fingerprint, never a source-node
  attribute in prepared HTML. The managed preview serves it only to the first
  parser-blocking bootstrap request, then serves an unbound fallback. The
  trusted parent subsequently delivers targets only over a challenged private
  `MessageChannel`. Comment body, key, source-node and locator-map data are
  absent from document bytes and later bootstrap reads. A unique source `id`,
  `data-*`, `name`, or `aria-label` is only a safe fallback; missing, ambiguous,
  replaced or disconnected targets omit the before-side marker rather than
  rebinding by guess. This comment capability does not authorize runtime host
  discovery. Only the before bootstrap reports geometry, so authored code
  cannot react to a comment marker.
  Exact leaf text
  ranges remain immutable evidence; a separate readable-footprint planner
  groups nearby ranges, keeps stable sentence gaps separate, records exact
  stable-sentence offsets as disposable geometry boundaries, gives tiny phrases
  a bounded line-local width and promotes dense multi-line rewrites to their
  smallest semantic text owner. Local wrapped copy renders as separate
  rectangular line frames with one group label instead of a stepped union
  polygon. Global context masking consumes those same final canonical records:
  one SVG luminance mask keeps a full-page white background and adds the record
  paths as black holes, so overlapping holes remain a set union rather than an
  `evenodd` XOR and mask and frame cannot diverge. Its per-render identifier is
  scoped to the review session, side and projection epoch. The disposable
  projection uses reserved attributes plus an explicit presentation reset and
  important geometry, preventing authored `svg`/`div` rules from restyling its
  mask primitives or frames. Stable
  outline regions remain navigation-only. `page-presentation-dom` is the
  shared explicit-ID and strict indexed-Tab discovery contract consumed by
  Canvas comment presentation and formal review. Before/after panel and action keys
  are assigned as pairs before either isolated document is prepared, so safe
  runtime actions mirror bidirectionally even when copy or order differs. A
  parent-owned presentation epoch removes stale projections immediately and
  commits both frames only after their new layout is stable. Frozen comments
  resolve against the immutable before source, but their text never enters the
  authored iframe. The before frame receives only an opaque target key and
  reports anonymous viewport geometry; the trusted React host joins that
  geometry to the frozen text and renders read-only hover markers above the
  before page. Linked vertical scroll follows semantic region
  progress through frame-to-frame convergence instead of a single jump;
  Scroll mode controls only scroll following. No review state or authored
  runtime mutation has source, Version or project authority.
- `IslandEditingController` is the only production text-edit engine in PageRoot 0.9.0. `contenteditable="true"` supplies focus, caret, Selection and IME composition, while the controller owns insertion, deletion, line breaks, paste and formatting. Chromium DOM serialization never has commit authority.
- `editable-island` owns the V2 capability and normalization contract. An accepted edit replaces only the selected element's parsed `contentRange`; bytes outside that range remain exact. Inside the range, parse5 may perform the smallest safe normalization needed to preserve inline semantics, comments and immutable authored atoms.
- Transparent inline host discovery records the nearest safe editable island while climbing. If the next parent is structurally unsafe, editing stays on that safe descendant instead of promoting to the unsafe parent.
- A direct source text node under a structurally unsafe parent may use the same controller through a disposable, layout-checked inline host. Its `update-direct-text-node` transaction is authorized by the surviving parent TargetRef but patches only the exact text-node source range. The disposable host and its attributes never enter source.
- `native-edit-policy` owns shared session attributes and checkpoint timing. `native-edit-runtime-preflight` still proves that enabling the island does not change geometry or text style; `HtmlCanvasEditor` only coordinates selection, the island session and SourcePatch.

## Module map

`app/workbench.tsx` is the composition root for the review workspace. It
subscribes to owner snapshots, derives presentation values and dispatches user
intent; it does not own persistence protocols or duplicate the sessions'
mutable facts. Pure Workbench models hold deterministic formatting and
transition helpers. Presentation modules receive snapshots and callbacks only;
they do not import application services.

| Boundary | Owner |
| --- | --- |
| Bridge routes, timeouts and structured outcomes | `app/application/bridge-client.js` |
| Open/registered project identity, session generation and late-query fencing | `app/application/project-session.js` |
| External OS/QoderWork HTML-open delivery, opaque request deduplication, committed-exit one-shot handoff, cold-start native failure presentation from stable product codes, whole project-open transition ordering, monotonic deferred-transition notification, blocker-gated/manual safe-switch retry, accepted-result FIFO and final renderer fence | `desktop/external-file-open.mjs`, `desktop/project-open-queue.mjs`, `app/application/external-file-open-session.js`, `app/application/project-application-session.js` |
| Current source bytes, Hash, revisions, persistence projection, source-write single flight and Canvas authority generation | `app/application/document-session.js` |
| Renderer draft revision, pending operations and reconciliation | `app/application/draft-session.js` |
| Renderer comment working copy, composer and saved-comment edit projection | `app/application/comment-session.js` |
| Active/background runs, Qoder status, background outcomes, submission lifecycle locks and operation locks | `app/application/run-session.js` |
| Immutable Version projection and history-view transition | `app/application/version-session.js` |
| `PROJECT.md` editor, composition fence, autosave and reconciliation | `app/application/project-rules-session.js` |
| Renderer source-history context, pending Patch operations and action intent | `app/application/source-history-session.js` |
| Pure comment/edit-event/tombstone transition rules | `shared/draft-aggregate.mjs` |
| Pure source-history validation, cursor transitions and exact Patch replay | `shared/source-history.mjs`, re-exported through `app/domain/source-history.js` |
| Bridge-side draft command validation and CAS | `scripts/draft-service.mjs` |
| Bridge-side source-history repository, autosave preparation and action application | `scripts/source-history-service.mjs` |
| Bridge-side current-source commit/recovery WAL, same-directory replacement, history application, metadata settlement and exactly-once audit outbox | `scripts/source-transaction-service.mjs` |
| Bridge-side registered command identity and source-observation classification | `scripts/project-context-service.mjs` |
| Close, switch, submit and history obligations | `app/application/drain-coordinator.js` |
| Late query rejection and monotonic draft reads | `app/application/project-query-fence.js` |
| Crash-only browser recovery | `app/application/recovery-store.js` |
| Renderer, project-picker, attachment, interactive-preview and close capabilities | `app/application/runtime-capabilities.js` |
| Same-directory source rename, operation journal and durable active/recent path rebase | `desktop/source-rename.mjs` |
| Renderer source-rename operation, Hash/identity fence, lost-response reconciliation and synchronous Project/Document/Run publication | `app/application/project-workflow.js` through its narrow `ProjectOpenPort.renameSource` |
| Known-source Finder reveal | narrow project IPC in `desktop/main.mjs` |
| Validated default-browser HTML launch | `desktop/open-in-default-browser.mjs`, behind `desktop/project-ipc-security.mjs` sender authority |
| Pseudonymous identity, strict event schemas, local queue and PostHog delivery | `desktop/usage-telemetry.mjs` |
| Preview sanitization and verified frame injection | `app/components/html-preview-sandbox.js` |
| Volatile desktop preview sessions and contained local-asset serving | `desktop/preview-protocol.mjs` |
| Source-backed preview/edit display-state filtering, rebinding and safe action resolution | `app/lib/page-view-context.js` |
| Review source-host discovery and Review-only capture request shape | `app/domain/runtime-snapshot-hosts.js`, `app/components/desktop-runtime-snapshot-api.ts` |
| Review runtime-snapshot limits, source/session envelope and PNG validation | `app/domain/runtime-visual-contract.js`, `app/lib/runtime-visual-snapshots.js` |
| Sandboxed offscreen page execution and bounded bitmap capture for Review | `desktop/runtime-visual-capture-owner.mjs` |
| Run lifecycle decoding and transition policy | `app/domain/run-lifecycle.js` |
| Request freeze/persisted-boundary validation, authority reconciliation, run polling, cancellation, conflict commands and confirmed handoff | `app/application/run-workflow.js` |
| Workbench pure record/comment/project/version/browser helpers | `app/workbench/*-model.ts`, `app/workbench/browser-io.ts` |
| History, attachment and preview presentation | `app/workbench/presentation.tsx` |
| AI handoff drawer presentation | `app/workbench/handoff-view.tsx` |
| Formal AI review state transitions | `app/workbench/review-state.ts` |
| Bounded pure sibling alignment for semantic review units | `app/lib/review-semantic-alignment.js` |
| Typed, per-element review projection fact normalization and filtering | `app/lib/review-projection-facts.js` |
| Review-specific runtime-snapshot comparison and marker merge | `app/lib/review-runtime-visual.js` |
| Review runtime-capture migration interface and capture identity | `app/workbench/review-runtime-capture-adapter.ts` |
| Formal AI review analysis, first-bootstrap exact-element binding, additive static/runtime fact union, global mask and overlay projection | `app/workbench/review-document.ts` |
| Formal AI review composition, private runtime-projection port lifecycle and isolated-frame coordination | `app/workbench/AiReviewWorkspace.tsx` |

The V2 source-fidelity path remains a protected core: `SourceIndex`,
`TargetResolver`, `editable-island`, direct-text-node normalization, `IslandEditingController`,
`SourcePatchEngine` and the atomic source writer may be split only around a
proven invariant, not to satisfy a line-count target. The retired V1
`NativeEditingController`, its per-keystroke tracker, shadow block draft,
FormatSkeleton and structural planner have been removed. The architecture gate
rejects reintroducing those files or imports; production text editing has one
V2 controller route with element-island and exact direct-text-node transaction
scopes.

`HtmlCanvasEditor.tsx` remains the Canvas coordinator. Parsing, DOM
instrumentation, interaction policy, preview synchronization, selection,
source-backed page view and style inspection live in the adjacent
`html-canvas-*.ts` modules. Those helpers do not gain a second source or
editing authority; `IslandEditingController` and `SourcePatchEngine` remain
the only production text and source-mutation route.

## Persistence

Direct edits form ordered revisions and are written through a single queue. Every write checks the expected source Hash, uses a same-directory temporary file and atomic replacement, then rereads the result. External modification causes a fail-closed conflict.

`/autosave` and `/source-history/action` retain their own transport decoding,
revision/action checks and response shapes, but both enter the one Bridge
`SourceTransaction` kernel. That kernel owns recovery-byte preparation, the
durable `pendingWrite` WAL, source/history application, project/runtime
settlement, exactly-once audit replay and cleanup. There is no second inline
current-source writer or recovery state machine.

At close, `DocumentSession` independently hashes the frozen renderer HTML and
accepts any acknowledged persisted revision at or beyond the close cutoff. A
stale Canvas Hash or renderer projection is repaired silently. Only when local
authority cannot prove the exact bytes does the renderer perform a bounded
authoritative source read; identical content repairs the projection, confirmed
divergence enters the source-conflict owner, and an invalid content/Hash pair
enters the persistent workspace recovery surface without overwriting either
copy.

A durable command for an already registered project carries one captured
`projectId + documentId + sourcePath` context. The Bridge resolves the registry
graph by both opaque IDs first and treats the path only as a scope assertion;
it never creates a project while serving a registered mutation. Only
`/project/ensure` may establish a new identity. During PageRoot's own atomic
source replacement, the durable `pendingWrite.targetHtmlSha256` proves the
narrow interval in which the inode has changed but registry sidecars have not;
the Bridge reconciles that interval to the existing identity. Any other inode
replacement remains an external replacement and fails closed. This decision is
recorded in `docs/decisions/0012-id-first-project-context.md`.

Every accepted Canvas SourcePatch also emits one operation containing the
actual forward patches, the exact inverse patches returned by the engine, the
before/after source Hashes and the logical before/after target. The renderer
`SourceHistorySession` owns unsaved operations and the current action intent;
the Bridge owns the authoritative bounded journal at
`history/source-operations.json`. Autosave prepares the next journal against
the same source Hash chain and places both HTML and journal candidates in one
`pendingWrite` recovery boundary. The source HTML remains the content
authority; the journal is never a second HTML snapshot or a source for preview
serialization.

Undo and redo first checkpoint any active editable island and drain the source
queue. The Bridge then validates project/document identity, source Hash,
journal revision/cursor and every exact patch before atomically applying the
inverse or forward bytes. Stable action IDs make lost responses idempotent;
the renderer queries workspace authority before its single replay. A new
forward operation truncates redo. If current source bytes cannot be chained to
the journal—external modification or a new working file—the Bridge establishes
a fresh boundary at those bytes rather than crossing unknown content.

After that acknowledgement, the Canvas may keep the current iframe only when
both history targets resolve exactly to the same editable-island identity, the
source prefix and suffix prove that every byte outside that island is unchanged,
and the complete mounted source-node sequence validates against the next
`SourceIndex`. It then replaces only the island's children from an instrumented
canonical parse, refreshes ephemeral node IDs and restores the logical Selection
and viewport. Any failed proof uses the existing fresh verified-frame path. The
mounted DOM remains a disposable projection and is never serialized into source.

The desktop `Edit` menu is a router, not another history owner. Focused native
text inputs use Electron/Chromium's local text undo. Canvas focus routes
Undo/Redo intent to the renderer source-history session. Comment/card,
attachment and project actions never enter the source journal.

An explicit filename change is a separate desktop source-path transaction, not
an HTML write. `desktop/source-rename.mjs` validates one stable operation ID,
the current source Hash, a same-directory target and an unchanged HTML
extension. It writes `pendingRename` to the active-file record before the
exclusive hard-link/unlink move, which cannot replace a destination created
after preflight, then atomically rebases active/recent paths and records
`lastRename`. The linked inode and Hash are revalidated before and after
removing the old name; a late source change rolls back to the old name. Startup
reconciles the prepared operation from the old/new paths and expected Hash.
The Bridge's existing physical-file identity relink keeps
the same Project and Document and updates only canonical `sourcePath` and
display name; no Version is created.

After the desktop transaction returns a complete identity, `ProjectWorkflow`
owns the renderer-side transition. It first drains the existing source, draft,
attachment and rule obligations, fences the native Canvas, and captures the
current Project context plus source Hash. A lost desktop response is reconciled
only through the trusted active-project port when the expected renamed filename
and Hash both match. It then synchronously rebases `RunSession`, advances
`ProjectSession`, publishes `DocumentSession`, clears stale recovery state and
refreshes canonical workspace authority. A late result never mutates a newer
Project context; no generic desktop executor or duplicate Session fact is used.

When no desktop project can be restored, the main process provisions the built-in welcome content once as a regular HTML source beside the selected workspace and immediately registers its initial V1 through the authenticated Bridge. Existing welcome bytes are never replaced on startup. From that point onward it uses the same source, comment, Request, handoff and Version boundaries as any user-opened HTML.

Project identity and storage presentation are separate facts. The registry maps
the stable opaque `projectId` to one immutable readable directory name derived
at creation from `displayName + local creation time + short project token`.
`project.json` persists the same `displayName`, `createdAt` and
`storageDirectoryName`; source renames and moves do not rename the managed
directory. The clean-cutover decision is recorded in
`docs/decisions/0005-readable-project-storage-directories.md`.

Initial and accepted AI results are immutable versions. Routine local edits do not create versions. A validated AI result is not activated until the user explicitly chooses it.

Candidate assessment is Attempt evidence, not current-source authority. The
historical Version and archived terminal-outcome queries have one bounded
adapter for the two `1.0.0` Developer Preview shapes: records may omit or carry
the now-retired executable-surface fields. It verifies immutable base/candidate
bytes and all four Hashes, re-runs the current document-health and continuity
assessment, normalizes retired fields out in memory, and leaves the old file
unchanged. Script conclusions from an old record never affect current status or
review routing. Archived outcomes remain terminal and cannot become openable
candidates through this adapter.

`PROJECT.md` uses debounced autosave and is flushed before project switch or close. One recoverable unsaved comment composer is allowed at a time. Attachment uploads, rule saves and ordinary source writes are finished or surfaced in their owning panel before navigation proceeds.

Persistent source and Draft failures share the single workspace status-banner
surface, ordered by safety priority. The source failure owns its export and
reload/retry action; otherwise the Draft failure owns the comment retry action.
The comment rail does not render a duplicate failure card. Product copy is
selected from stable error codes and strips local paths, IDs, Hash fields and
raw English exception text before rendering.

Draft mutations carry stable operation identities. Deletion tombstones and
processed-operation acknowledgements live in `draft/annotations.json`. A stale
revision or unknown POST outcome is reconciled against the authoritative draft,
rebased and retried within a bounded loop; a blind retry of the same stale
snapshot is not a recovery action.

A draft artifact stores its own revision, timestamp and operation
acknowledgements. If the Bridge stops after atomically replacing that artifact
but before refreshing the runtime pointer, the next read may adopt an artifact
that is exactly one revision ahead and verifies its Hash. A larger forward jump
is not a valid crash window and fails closed, as does an artifact older than the
runtime pointer or a same-revision Hash mismatch.

A close or navigation boundary performs a final draft verification through the
same session. If the aggregate fingerprint is already acknowledged, that
verification is a no-op: it neither POSTs the draft nor advances its revision.
The runtime capability manifest selects exactly one close coordinator:
Electron's acknowledged handshake for the desktop app, or `beforeunload` for a
browser runtime. They never compete over the same close.
The immutable preload manifest is the only capability authority: absent or
malformed declarations fail closed to browser capabilities, and the presence
of an individual preload API cannot restore desktop authority.

The renderer close result also classifies who owns presentation. Known
recoverable blockers remain in their Canvas/banner/panel and cause Electron to
return focus without a duplicate native dialog. Missing handlers, renderer
timeouts and unexpected close-coordination faults default to the native
fail-closed surface.

The main-process application-update controller is the sole owner of stable
channel checks, the startup-plus-four-hour schedule, coalesced manual checks,
download progress and downloaded-install readiness. It exposes only immutable
status snapshots and narrow check/download/install intents through preload IPC. The
renderer can also request the fixed project repository URL, but cannot supply
an arbitrary external URL. The About surface may request the packaged user
notice through one app-level IPC intent; the main process resolves the fixed
resource name for development or the signed app bundle, and the renderer cannot
supply a local path. A renderer download intent is accepted only while
the controller owns an available stable update; it does not grant exit
authority. Restart installation is a second explicit intent that reuses the
same Electron drain coordinator before invoking the signed updater. Ordinary
app quit never installs a pending update.

The main-process usage-telemetry controller is the sole owner of analytics
identity, filtering, persistence and delivery. A narrow preload channel accepts
only renderer intent; the main process drops every event or property outside
the exact allowlist. One random installation UUID and one installation-local
HMAC secret persist in `usage-telemetry.json`; every launch gets a new session
UUID, and raw project IDs are converted to installation-specific pseudonyms
before entering the queue. Direct edits and successful saves are aggregated,
then all events use a bounded queue and batched best-effort delivery. Telemetry
never participates in editor authority or close/navigation drains.

## Trust model

The renderer is sandboxed with context isolation and no Node integration. The preload exposes narrow validated IPC methods. The Bridge uses a per-process authentication token and only operates on managed project paths. AI output is untrusted until protocol, identity, Hash, path and complete/displayable-document checks succeed. Authored scripts, handlers, executable URLs and refresh directives are accepted as candidate content without detection or UI signaling; their execution remains contained by the existing preview, edit and review sandboxes. A coarse continuity fingerprint compares visible text, stable anchors, classes, assets and title with the frozen base. Strong continuity enters the normal ready flow; weak continuity preserves the immutable candidate but removes direct-open and requires side-by-side review. Frozen comment targets remain generation and review context, not a subtree-exact acceptance gate. Telemetry schemas have no fields for HTML, user text, attachments, clipboard data, filenames, paths, raw exceptions, account identity or hardware identity.

Every renderer request to the Bridge is bounded: ordinary state/file operations use 15 seconds, attachments use 30 seconds, and Request creation uses 60 seconds. Busy refs are released in `finally`, so an unresponsive local service cannot leave a permanent UI lock. An unknown Request POST outcome remains fail-closed and is reconciled against the durable workspace state before editing resumes.

If the utility Bridge exits after startup, the main process retains one
workspace-recovery issue. It sends the narrow
`html-app:workspace-unavailable` event only after the Workbench listener
acknowledges readiness; a late listener or renderer reload receives the retained
issue through the readiness handshake. Before that acknowledgement, the
two-path native recovery dialog remains the fail-closed fallback. The renderer
keeps in-memory content visible and exportable while blocking new Bridge-backed
mutations. `html-app:relaunch` still runs the normal renderer close-readiness
handshake; an unsafe relaunch is rejected until the user exports or resolves
pending writes.

Only a non-in-place main-frame navigation revokes renderer readiness. Canvas
iframe loads and same-document navigation are subordinate UI activity; treating
them as a Workbench reload would bypass the final close drain and is forbidden.
