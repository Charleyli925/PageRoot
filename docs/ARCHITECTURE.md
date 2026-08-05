# Architecture

PageRoot is an Electron application with a React renderer and a local Bridge process.

```text
User HTML bytes
  -> SourceIndex / TargetResolver
  -> isolated authored-DOM preview
  -> native Selection + V2 Editable Island controller
  -> canonical island + exact content-range SourcePatch
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
  turns the source directory into a general-purpose local-file origin.
- Preview-to-edit carries only a bounded `PageViewContext`: source-backed
  active/inactive class transitions and `hidden`, `open`, `aria-selected` or
  `aria-expanded` state. It never carries runtime DOM, pixels or table markup.
- Desktop Edit has one separate, disposable runtime-visual projection. A
  renderer session indexes source-empty hosts, asks one hidden sandboxed
  `pageroot-preview:` window to run the authored page, and accepts bounded PNG
  captures only when the original source Hash, host identity and viewport
  request are still current. `HtmlCanvasEditor` mounts each PNG as a
  pointer-transparent child of its original source host (or one bitmap row for
  an empty `tbody`). The host therefore remains the selectable/commentable
  TargetRef. The runtime DOM is never merged or synchronized, and neither the
  bitmap nor its temporary attributes enter SourcePatch, save, version, review
  diff or AI Request input.
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
  and zoom fields. The document
  analyzer first establishes high-confidence before/after node pairs, derives
  copy, structure and visual facts from those pairs, and only then emits one
  typed canonical change footprint. It never promotes tag/position proximity
  alone into a change fact. Connected line fragments retain their exact union
  boundary, so one stepped frame avoids overlapping per-line boxes without
  becoming a whitespace-crossing bounding rectangle. Global context masking
  punches holes from those same union paths, so mask and frame cannot diverge. The disposable
  projection uses reserved attributes plus an explicit presentation reset and
  important geometry, preventing authored `svg`/`div` rules from restyling its
  mask or frames. Stable
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
| Current source bytes, Hash, revisions, persistence projection, source-write single flight and Canvas authority generation | `app/application/document-session.js` |
| Renderer draft revision, pending operations and reconciliation | `app/application/draft-session.js` |
| Renderer comment working copy, composer and saved-comment edit projection | `app/application/comment-session.js` |
| Active/background runs, Qoder status, background outcomes and operation locks | `app/application/run-session.js` |
| Immutable Version projection and history-view transition | `app/application/version-session.js` |
| `PROJECT.md` editor, composition fence, autosave and reconciliation | `app/application/project-rules-session.js` |
| Renderer source-history context, pending Patch operations and action intent | `app/application/source-history-session.js` |
| Pure comment/edit-event/tombstone transition rules | `shared/draft-aggregate.mjs` |
| Pure source-history validation, cursor transitions and exact Patch replay | `shared/source-history.mjs`, re-exported through `app/domain/source-history.js` |
| Bridge-side draft command validation and CAS | `scripts/draft-service.mjs` |
| Bridge-side source-history repository, autosave preparation and action application | `scripts/source-history-service.mjs` |
| Bridge-side registered command identity and source-observation classification | `scripts/project-context-service.mjs` |
| Close, switch, submit and history obligations | `app/application/drain-coordinator.js` |
| Late query rejection and monotonic draft reads | `app/application/project-query-fence.js` |
| Crash-only browser recovery | `app/application/recovery-store.js` |
| Renderer, project-picker, attachment, interactive-preview and edit-visual capabilities | `app/application/runtime-capabilities.js` |
| Same-directory source rename, operation journal and active/recent path rebase | `desktop/source-rename.mjs` |
| Known-source Finder reveal | narrow project IPC in `desktop/main.mjs` |
| Validated default-browser HTML launch | `desktop/open-in-default-browser.mjs`, behind `desktop/project-ipc-security.mjs` sender authority |
| Pseudonymous identity, strict event schemas, local queue and PostHog delivery | `desktop/usage-telemetry.mjs` |
| Preview sanitization and verified frame injection | `app/components/html-preview-sandbox.js` |
| Volatile desktop preview sessions and contained local-asset serving | `desktop/preview-protocol.mjs` |
| Source-backed preview/edit display-state filtering, rebinding and safe action resolution | `app/lib/page-view-context.js` |
| Source-bound edit visual request/late-result ownership and payload validation | `app/application/runtime-visual-projection-session.js`, `app/domain/runtime-visual-projection.js` |
| Sandboxed offscreen page execution and bounded bitmap capture | `desktop/edit-visual-capture.mjs` |
| Read-only bitmap mounting inside original source hosts | `app/components/html-canvas-runtime-visual.ts` |
| Run lifecycle decoding and transition policy | `app/domain/run-lifecycle.js` |
| Workbench pure record/comment/project/version/browser helpers | `app/workbench/*-model.ts`, `app/workbench/browser-io.ts` |
| History, attachment and preview presentation | `app/workbench/presentation.tsx` |
| AI handoff drawer presentation | `app/workbench/handoff-view.tsx` |
| Formal AI review state transitions | `app/workbench/review-state.ts` |
| Formal AI review analysis, paired runtime mapping, global mask and overlay projection | `app/workbench/review-document.ts` |
| Formal AI review composition and isolated-frame coordination | `app/workbench/AiReviewWorkspace.tsx` |

The V2 source-fidelity path remains a protected core: `SourceIndex`,
`TargetResolver`, `editable-island`, `IslandEditingController`,
`SourcePatchEngine` and the atomic source writer may be split only around a
proven invariant, not to satisfy a line-count target. The retired V1
`NativeEditingController`, its per-keystroke tracker, shadow block draft,
FormatSkeleton and structural planner have been removed. The architecture gate
rejects reintroducing those files or imports; production text editing has one
V2 editable-island route.

`HtmlCanvasEditor.tsx` remains the Canvas coordinator. Parsing, DOM
instrumentation, interaction policy, preview synchronization, selection,
source-backed page view and style inspection live in the adjacent
`html-canvas-*.ts` modules. Those helpers do not gain a second source or
editing authority; `IslandEditingController` and `SourcePatchEngine` remain
the only production text and source-mutation route.

## Persistence

Direct edits form ordered revisions and are written through a single queue. Every write checks the expected source Hash, uses a same-directory temporary file and atomic replacement, then rereads the result. External modification causes a fail-closed conflict.

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
historical Version query has one bounded adapter for the August 4, 2026
Developer Preview record that omitted executable-surface fields while still
declaring auxiliary Schema `1.0.0`: it verifies the immutable base/output
bytes and all four Hashes, re-runs the current assessor, and publishes only the
canonical in-memory result. The old file remains unchanged. Active or unopened
candidates never use this history-only adapter, so direct-open safety is not
widened and this known historical display shape no longer strands an otherwise
valid current HTML in project hydration.

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

The renderer is sandboxed with context isolation and no Node integration. The preload exposes narrow validated IPC methods. The Bridge uses a per-process authentication token and only operates on managed project paths. AI output is untrusted until protocol, identity, Hash, path, complete-document and unchanged-executable-surface checks succeed. A coarse continuity fingerprint compares visible text, stable anchors, classes, assets and title with the frozen base. Strong continuity enters the normal ready flow; weak continuity preserves the immutable candidate but removes direct-open and requires side-by-side review. Frozen comment targets remain generation and review context, not a subtree-exact acceptance gate. Telemetry schemas have no fields for HTML, user text, attachments, clipboard data, filenames, paths, raw exceptions, account identity or hardware identity.

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
