# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action, registered identity, renderer generation and late-query fence | Renderer `ProjectSession` | active-file record before registration; project registry and `project.json` afterwards | Application workflows and the Controller aggregate snapshot |
| Latest unaccepted OS/QoderWork HTML-open request, committed-exit one-shot handoff, plus FIFO active/recent-project transitions | Main-process external-file-open mailbox and `ProjectOpenQueue` | in-memory for the current process plus one private, validated `userData` handoff record after close commits; no renderer-supplied path authority | preload lifecycle delivery, startup adoption and trusted project IPC |
| Prepared A/B/C open intent, commit receipt and one-shot original-file trash disposition | Main-process `desktop/prepared-html-open.mjs` store | none; process memory only; delete consent is never persisted | trusted project IPC and `ProjectWorkflow` commit/finalize/rollback |
| Open-confirmation prompt, C-class delete checkbox and busy/retry projection | Renderer `ProjectWorkflow` | none; reset per request and cancelled on close | Workbench `ExternalHtmlOpenDialog` |
| External HTML request IDs, active/queued/deferred renderer delivery, blocker-transition/manual retry policy and unaccepted-result fence | Renderer `ExternalFileOpenSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Accepted local/external project results, their FIFO renderer publication and deferred final-fence blocker-transition/manual retry policy | Renderer `ProjectApplicationSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Registered mutation context resolution and atomic-replacement source observation | `ProjectFileRepository` | v4 `.pageroot-registry.json` plus the owning Project File working copy and `.pageroot` metadata | Bridge mutation routes and `/project/ensure` |
| Canonical external-source path → unique `projectId` lookup, first-import Hash relation, and read-only A/B/C open classification | `ProjectFileRepository` | Registry `importSourceKey` / `importSourceSha256` pair plus the bound project's current active Working Copy | `/project/open-classification`, `/project/ensure` and Desktop Prepared Intent |
| Registry project-catalog membership, availability and validated registered-project OpenTarget resolution | `ProjectFileRepository` Registry reader | Registry `projectId → registeredProjectRootPath` records plus validated per-project metadata; Desktop Recent may rank but never add/remove/authorize a member | read-only catalog route, `ProjectWorkflow` projectId open command and Workbench project list |
| Runtime Bridge/Session/workflow composition, aggregate-observer lifecycle, registration operation identity, single-flight, stale-result fence and cross-Session publication sequence | `createRuntimeWorkspaceController()` and `WorkspaceController` | none; the factory creates the one fact-owner set and the Controller publishes only frozen aggregate projections through existing Project, Document, Comment, Draft, Version and SourceHistory owners | Workbench aggregate-snapshot subscription, Controller commands and presentation-event adapter |
| Project hydration generation and load outcome, switch/open operation, accepted-result execution, close request identity, project-switch publication, Prepared Intent commit after confirmation, and the unified managed-source prepare/commit handoff for Candidate promotion, historical Working Copy continuation and Registry opens | Renderer `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through existing Session owners and trusted ProjectOpen/Canvas ports | Workbench commands and presentation-event adapter |
| Durable source filename transaction, pending operation and active/recent path rebase | Desktop source-rename transaction | active-file `pendingRename` / `lastRename`, then filesystem path | trusted desktop rename port and Bridge relink |
| Current active managed Working Copy restart cache | Main `activeManagedLocator` in the private active-file record | none; non-authoritative, fail-closed cache of the last verified identity tuple and path. Registry plus project metadata remain the only write authority. Missing cache never guesses by name or Hash | startup `getActiveProject`, Finder locator reconcile and trusted `reconcileActiveManagedSource` IPC |
| Renderer source-rename and Finder locator rebase, expected Hash/context fence, lost-response reconciliation and synchronous Project/Document/Run publication | `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through the existing Session owners after desktop/Bridge validate the same identity tuple. Present-file directory hints only hash-observe; missing-path hints, startup and title-bar rename drain switch and rebind | Workbench filename intent, directory-change hints and presentation-event adapter |
| Current source bytes, Hash, edit revision, persistence projection, pending write, single-flight source flush, Canvas authority generation and exact-byte boundary reconciliation | Renderer `DocumentSession` | source HTML, runtime autosave record and recovery log; the generation itself is disposable | Canvas, preview readiness, source-history session and drain coordinator |
| Force-unlock of a Working Copy conflict (adopt disk Hash as `saved`, no HTML write; clear `runtime.activeRequest` if present; keep `lastPersistedRevision`) | `ProjectFileRepository.forceUnlockWorkingCopy` via `POST /conflict/resolve` `force-unlock` | Working Copy state record and runtime request pointer | `DocumentWorkflow.forceUnlockConflict` / `reloadAuthority({ acceptExternalConflict: true })` and the conflict banner |
| Toast dismissal/repeat window (1s merge, 5s TTL) | Renderer `createNoticeDismissalMemory()` owned by Workbench | none; bounded in-memory map only | `NoticeBar` repeat badge |
| Current-source commit, same-directory two-state CAS replacement (`prepared` → atomic rename → `committed`) and Project File settlement | `ProjectFileRepository` | source HTML working copy and `.pageroot` runtime/autosave records; the save journal is two-state CAS owned by `ProjectFileRepository`; each `#serial()` turn caches one verified project root (realpath, not a symlink) | `/autosave` route adapter and restart recovery |
| Canvas source-history context, pending Patch operations, cursor and applied action IDs | Renderer `SourceHistorySession` for pending intent | none on the live v4 Bridge; `/source-history/action` returns current source bytes and empty history | Canvas, Document session, desktop Edit intent router |
| Focused comment/rules/filename text input undo history and active composition | The native text control and Electron/Chromium editing engine; `ProjectRulesSession` records rules-editor composition and the workflow owns its eligibility/explicit restore orchestration | in-memory control-local history only | desktop Edit intent router, `ProjectRulesWorkflow` |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Draft snapshot recovery sequence/operation, attachment upload count, in-flight attachment identity and stale/cancel compensation | Renderer `CommentWorkflow` | recovery store is crash-only; Draft aggregate and managed attachment repository remain the durable authority | `WorkspaceController` aggregate snapshot, `ProjectWorkflow` drain and Workbench presentation |
| Renderer comment/edit-event working copy, deletion tombstones, composer fields and saved-comment edit session | Renderer `CommentSession` | none; disposable projection until Draft acknowledgement | Workbench views, Draft session and Request preparation |
| Acknowledged comments, edit events, tombstones and operation identities | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | Draft session and Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| Active/background AI run projections, Qoder handoff status and recovered handoff-risk disposition, background results, submission phase/unknown-outcome lock and renderer operation locks | Renderer `RunSession` | none beyond authoritative runtime and immutable Request/Attempt records | `RunWorkflow`, Workbench process panel, drain coordinator and project list |
| AI Request freeze, persisted-boundary verification, unknown-POST authority reconciliation, polling lifecycle, cancellation and conflict command sequence | Renderer `RunWorkflow`, composed by `WorkspaceController` | none; it publishes only through `RunSession` and reads Bridge runtime/immutable Request records | Workbench intent/Drawer/Toast adapter and Bridge run lifecycle |
| AI Request/Attempt lifecycle transition | Bridge run lifecycle | runtime state and immutable Request/Attempt records | `RunWorkflow`, RunSession and finalizer |
| `AI任务/` derived prompt/Candidate publication, collision allocation and recovery stage | `ProjectFileRepository` plus narrow `ai-task-projection` materializer | immutable Request/Attempt/Candidate records remain authoritative; `.pageroot/recovery/ai-task-projections/` receipt is only a rebuildable display-progress record; runtime `lastAiTask` is a sealed no-change/error Finder anchor, never an active run or Candidate authority | `/ai-task`, trusted Desktop Finder port and handoff presentation |
| Immutable Version list and based-on/exact/restored/current-history projection facts | Renderer `VersionSession` | immutable Version records and current runtime pointers | `VersionWorkflow`, Workbench history and Canvas projection |
| Version activation, review-candidate preparation, current/history navigation and historical Working Copy continuation operation identity, Bridge I/O, full OpenTarget/Hash/time validation, receipt-forward recovery and synchronous cross-Session publication | Renderer `VersionWorkflow`, composed by `WorkspaceController` | Repository owns the durable history activation receipt; the workflow publishes only through Project, Document, Version, Draft and Comment owners | Workbench review/history commands, presentation-event adapter and Bridge version lifecycle |
| `PROJECT.md` content, editor generation, composition fence and save projection | Renderer `ProjectRulesSession` | managed `PROJECT.md` | `ProjectRulesWorkflow` and project panel |
| `PROJECT.md` Bridge reads/writes, 700ms autosave timer, unknown-write authority reconciliation, close/switch drain and restore-port invocation | Renderer `ProjectRulesWorkflow`, composed by `WorkspaceController` | none; it publishes only through `ProjectRulesSession` and the managed `PROJECT.md` remains authoritative | `ProjectWorkflow` drain, project panel and Request freeze |
| Close/switch/submit/history readiness and desktop close lifecycle | The unique `DrainCoordinator` owned by `WorkspaceController`; `ProjectWorkflow` owns the request-scoped close operation | composed owner snapshots, request identity and bounded presentation class; no copied dirty booleans | Electron close handshake, browser fallback and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client created by the runtime Controller factory | no durable state | application workflows only |
| Bridge startup operation, live utility process and ready-only port | Main-process Bridge startup lifecycle | no durable state; one in-memory single-flight operation per app process | window bootstrap, graceful shutdown and workspace-unavailable recovery |
| Undelivered Bridge-unavailable recovery issue and renderer-listener readiness | Main-process recovery mailbox | in-memory for the current app process | preload handshake, native fallback and Workbench banner |
| Renderer edit, project-picker, attachment-persistence, close-coordination and interactive-preview capabilities | Runtime capability resolver | immutable preload manifest; fail-closed browser default | Workbench presentation host adapters |
| Volatile interactive-preview document, bootstrap, allowed source-relative asset root, completed-frame identity set and one-way pre-load scriptless navigation-fallback flag | Main-process preview protocol controller plus the owning window's navigation fence | none; bounded in-memory session/window state only; the fallback cannot be reversed inside a session | isolated preview iframe and the script-disabled edit iframe's resource base |
| Current preview/edit display context, safe reveal transition and per-surface render acknowledgement | Workbench page-view context state | none; source-bound in-memory projection tagged by `DocumentSession` Canvas generation and rendered source Hash | `HtmlCanvasEditor`, `HtmlInteractionPreview`, save-status projection and toolbar |
| One-shot Edit author-runtime identity, presentation-gated direct prepare grant, phase and final outcome | `EditAuthorRuntimeSession`, composed by `WorkspaceController`; Main owns the bounded replay/admission fence | none; one disposable `(sourcePath, canvasGeneration)` attempt, at most two Main-admitted overlap captures to tolerate Managed V1 activation and one revokeable resource session | Workbench loading-surface acknowledgement, initial-frame choice and `HtmlCanvasEditor` load/settle callbacks |
| Imported project's original sibling-asset directory | Main `importedAssetRoots` in `userData/html-projects.json` plus process `activeImportedAssetSourcePath` | desktop project state keyed by project root; renderer never receives the original path | preview protocol, edit-runtime protocol and the script-disabled Edit iframe resource base |
| Review runtime-snapshot limits, page budget, owner deadline, envelope and PNG/visible-text-hash parser | `runtime-visual-contract.js` and `runtime-visual-snapshots.js`; consumers may validate but not redeclare either | none; frozen process-local contract only | Review pair, shared owner and hostile-page gates |
| AI review page view, change filter, context visibility, navigation target, canonical page-presentation path, scroll mode and zoom mode | `AiReviewWorkspace` review reducer | none; disposable state bound to the frozen before/after pair | review toolbar, content map and isolated review frames |
| AI review semantic sibling pair graph, typed change facts (including multiple independent facts on one prepared element), disposable fact/semantic/geometry owner IDs, prepared immutable review documents and canonical frame/mask geometry | Cancellable `ReviewAnalysisSession` plus `review-document` analyzer, ready-review session and isolated-frame projection runtime | none; byte-bounded multi-entry cache keyed only by exact operation/source/comment identity; fact identities are analysis-only and never persisted | review outline, semantic frames and context mask |
| Review runtime snapshot request, temporary owner window/session, deadline/cancellation, bounded PNG snapshots and visible-text hash | Electron main `RuntimeSnapshotOwner`; `AiReviewWorkspace` is the sole consumer | none; exact-source, side/session-fenced in-memory decisions; TargetRefs remain in trusted renderer memory, raw DOM/text never leaves the owner and PNGs remain disposable presentation bytes | effective Review changes/outline and static review-frame presentation |
| Review runtime projection binding, challenged port lifecycle and additive facts | `review-document` first bootstrap owns exact per-side `Element` bindings and `Map<Element, facts[]>`; `AiReviewWorkspace` owns the current side/session/source-SHA-fenced private ports and latest owner result | none; first-bootstrap-only bindings and disposable frame memory, cleared on document/frame/unmount lifecycle | exact-host runtime rectangles unioned with, but unable to delete, static review facts; outline remains navigation-only |
| AI review Tab/disclosure/control presentation state and transition epoch | Parent `AiReviewWorkspace` presentation coordinator; either frame may propose an intent | none; disposable parent state plus frame projection only | both review frames, content map and overlay/mask projection |
| Frozen review comment set and read-only before-page marker projection | Ready-review session owns comment text; `review-document` resolves opaque targets during analysis, strips temporary review attributes, and carries source-node bindings only in the parser-blocking first private bootstrap response; trusted `AiReviewWorkspace` delivers targets only through a challenged private port, then joins anonymous viewport geometry and renders it | none beyond the immutable Request/Draft evidence already frozen for the run | trusted review host above the before frame only; authored frames never receive comment text, comment keys, a comment marker, or a source-node/locator map in HTML or later bootstrap source |
| Current source-backed comment resolution, visibility, coordinates, marker eligibility and natural document height | `HtmlCanvasEditor` presentation measurement | none; disposable snapshot tagged by rendered source Hash, applied page-view generation and exact target-ID set | Workbench comment rail and Canvas height |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, About PageRoot, Workbench update notice, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Install-level first-real-HTML guide status, generation and built-in welcome `projectId` | Main `desktop/ui-preferences.mjs`; renderer `FirstEditGuideSession` owns visibility and the 800ms present-dwell timer and is composed only by `WorkspaceController` | bounded `ui-preferences.json` under PageRoot Application Support; atomic replace; schemaVersion 1 | Workbench window overlay (`FirstEditGuideCard`); Canvas does not mount or dismiss the card |
| Edit-canvas pointer-capability hover cursor, delayed outline and one-line caption | `HtmlCanvasEditor` presentation | none; disposable overlay of `resolveCanvasPointerHit`; hidden on click, scroll or text editing | canvas overlay |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 text-session lease, editable-island or disposable direct-text host DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island or direct-text-node SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | Comment-rail layout session | in-memory and cleared on project transition | comment rail only |
| Current source/Draft persistence recovery banner | Workbench status-banner projection, with source failure priority | owner snapshots only; no independent durable state | workspace view and recovery actions |

Rules:

- A consumer never writes another owner's fields directly.
- Registry membership is distinct from Desktop Recent. The Repository may return a
  registered row as ready, unavailable or invalid without granting a second
  authority path; Recent contributes only ranking/last-opened presentation.
  Renderer catalog commands carry only `projectId`, and every open revalidates
  the Registry/Project/Document/Working Copy/OpenTarget/HTML/Hash tuple before
  any Session publication.
- External `importSourceKey` is a lookup, not a write credential. Equal HTML
  bytes at another path remain a new project. Multiple claims for one source
  key fail closed and do not present a chooser.
- Recent and Registry-catalog lists are deferrable projections. Automatic
  refreshes run only after the authoritative transition has settled
  (hydration, Working Copy confirmation or synchronous cross-Session
  publication), are fenced by the current Project context, and never
  participate in or block a rename, history continuation, Candidate adoption
  or hydration. A catalog failure can only surface a projection event; it
  cannot downgrade a completed transition to unknown.
- `AI任务/` is a display projection, not a second Candidate store. The
  materializer first validates the complete frozen identity and hashes, writes
  a recovery receipt before no-replace output, and never reads a visible copy
  for review or Promotion. A deleted, tampered, user-owned or symlinked target
  is rebuilt only from hidden authority or allocated a different safe display
  directory. The Finder port accepts only the current source locator and opens
  only a Bridge-validated direct child of `AI任务/`; it never accepts a
  renderer-supplied Request path or exposes `.pageroot/requests/...`.
- External HTML delivery has four explicit owners plus a Prepared Intent
  store. The main mailbox accepts only its latest unconsumed opaque request.
  `ProjectOpenQueue` assigns every classify/prepare/commit/finalize and
  active/recent-project transition its order before a picker, source read or
  Bridge check can finish; local picker, recent-project, external, startup,
  generated-version, rename and forget transitions therefore share one durable
  state boundary.   Class A activates immediately. Classes B and C write a
  process-memory Prepared Intent and wait for confirmation; they do not
  activate the original, import, or trash. Re-querying the same canonical
  last-active path while an intent is still `prepared` or `committing` reuses
  that `requestId`. Cold-start confirmation at epoch 0 skips the Canvas fence,
  then hydrates after Canvas verification so the workbench can leave
  `hydrating`. The renderer
  `ExternalFileOpenSession` deduplicates delivery
  IDs and owns active, queued and deferred switching. Preload suppresses an
  older readiness catch-up once it has observed a live request, so delivery
  order cannot reverse at the renderer boundary; `ProjectWorkflow` never stores
  an external request in an ordinary picker retry. A newer queued
  external request fences only older work that has not yet been accepted and
  inherits its Canvas freeze. Each renderer session owns its deferred retry
  transition: it records whether `DrainCoordinator.inspect("switch")` has
  observed a relevant blocker, resumes only after that blocker clears, and
  otherwise reports that the explicit retry action remains necessary. Project
  hydration is an explicit switch obligation rather than a copied Workbench
  boolean. If the final pre-IPC fence itself captures a post-cutoff native
  edit, no external activation starts; that edit returns to normal persistence
  before the session retries.
  Once main-process acceptance succeeds, `ProjectApplicationSession` becomes
  the sole owner of accepted-result FIFO and deferred application state.
  `ProjectWorkflow` executes those results, repeats the switch drain and takes
  a synchronous final Canvas freeze immediately before every publication. A deferred final fence keeps
  its already-accepted result until a relevant blocker clears or the user
  explicitly continues. An accepted project therefore publishes before a later
  queued result runs, and that later result replaces it only on its own safe
  application. After the FIFO settles, the visible project and main-process
  active/recent source stay aligned without discarding input or losing a prior
  successful open to a failed successor. Close treats both a main-process
  external acceptance and an accepted renderer application as drain
  obligations before either the hydration or load-error close fast path; it
  cannot approve shutdown while either owner is active or deferred. An unanswered
  open confirmation is cancelled during close drain. A new
  external delivery during an uncommitted close cancels that exact handshake
  before normal mailbox delivery. After close commits, the mailbox does not
  accept the request in the exiting process; its owner atomically records only
  the latest validated path in a one-shot handoff that only the next
  single-instance owner claims and deletes before normal delivery.
- `workbench.tsx` is a composition root, not an additional state owner. It
  subscribes to Session/Controller snapshots, derives read-only presentation
  values, adapts narrow host ports and dispatches user intent to the owning
  Session or workflow facade.
- `WorkspaceController` owns the renderer's unique `DrainCoordinator` and
  composes `ProjectWorkflow`, `CommentWorkflow`, `RunWorkflow` and
  `VersionWorkflow`. The workflows own operation state only: they create the
  narrow external-open/application protocol Sessions, receive the existing
  Project, Document, Comment, Draft, Run, Version and SourceHistory owners,
  and must never duplicate their facts. Workbench's direct Bridge-call
  allowance is exactly 0; the checked architecture gate permits no
  `bridgeClient.*` call from Workbench.
- `RunSession` owns the one in-memory submission lifecycle. `preparing` blocks
  duplicate intent and drain without freezing the current canvas; `frozen`
  blocks edits until the Request is known; `uncertain` preserves a current
  read-only fence while reconciliation determines whether a durable run exists.
  Workbench must derive its active lock and submission presentation from that
  snapshot rather than maintain a second boolean or ref.
- `RunWorkflow` owns the I/O sequence around that Session fact: it fences native
  input, freezes and drains the authoritative source, submits only one Request,
  reconciles an unknown POST with read-only workspace authority, and fences
  timer/late callbacks by run identity and disposal generation. Clipboard
  success means exact readback only; it never implies an external Agent has run.
- Workbench presentation modules receive snapshots and callbacks only. They
  may not import application sessions, Bridge services or persistence
  adapters.
- An opened source locator is not a registered project context. Empty
  `projectId` or `documentId` values may not be used as placeholder authority.
- The first durable action atomically registers the project identity and binds
  the Draft session to the returned authoritative draft before local aggregate
  state can be acknowledged.
- A registered mutation captures one complete `projectId + documentId +
  sourcePath` context. The Bridge resolves both IDs before validating the path;
  only `/project/ensure` may create a new registration. A `pendingWrite` target
  Hash may repair PageRoot's own atomic-replacement window but never authorize
  an unrelated external replacement.
- `/autosave` may decide its own command preconditions, but it may not own a
  partial write path. `ProjectFileRepository` alone advances the current-source
  write for a registered v4 Project File. `/source-history/action` does not
  persist a Bridge journal. AI Version publication remains a separate
  immutable transaction.
- Cross-owner operations are coordinated explicitly; they do not synchronize
  through incidental React effects.
- A current-source transition first stages one complete candidate containing
  project identity, full OpenTarget identity, source path, Version authority,
  HTML bytes and verified Hash. Only after every field is valid may the
  coordinator synchronously publish Project, Document, Version, Draft and
  Comment state and advance the Canvas authority generation. A Hash-only or
  path-only publication is invalid.
- Historical continue-edit owns no mutable Version snapshot. `VersionWorkflow`
  may call the narrow Bridge activation route only from the exact read-only
  history view; Repository atomically owns the `desktop-pending`/`desktop-confirmed`
  receipt, and `ProjectWorkflow` passes its operation ID to the same managed-source
  primitive as Candidate promotion. A lost Bridge, Desktop or confirmation response
  may be retried only against that complete receipt identity; it must not borrow
  another project's OpenTarget or roll durable V2 back to V6.
- Edit and preview acknowledge rendering with the exact Document Canvas
  generation and source Hash. A late acknowledgement from an older generation
  is discarded and cannot make persistence appear safe.
- A filename transition never owns HTML bytes or Document identity. It may
  advance the source locator only after the expected source Hash is verified;
  `ProjectWorkflow` then rebases the existing Run/Project/Document facts as one
  typed renderer operation. A lost response may reconcile only against the
  trusted active file's expected path and Hash; a late result is stale and
  cannot rebase a newer Project context. After validation, the project session
  adopts the Bridge-confirmed path for the same
  `projectId` and `documentId`.
- Runtime features are declared independently. The presence of a project-picker
  API never implies source-edit or attachment-persistence authority.
- Interactive-preview sessions, page-view context, the direct one-shot Edit
  author-runtime session and Review runtime snapshots are disposable. They do
  not participate in save, switch, submit or close drains, and cannot become a
  second copy of the source HTML. Desktop `pageroot-preview` sessions are owned
  by the preview protocol controller: Edit static sibling-asset sessions
  refresh in place for the same source path, and a full map evicts the
  least-recently-accessed idle session rather than the oldest insert. The Edit session has no bitmap/cache/
  projection state: it selects one initial frozen runtime frame or the static
  frame and never persists runtime descendants. Edit screenshot count must be 0.
- AI review state fields are orthogonal. Page, filter, visibility, navigation,
  page presentation, scroll and zoom actions may update only their own reducer field. Review
  navigation can reveal a hidden panel in both frames but cannot become a
  second filter or mask owner. The parent owns the full nested panel path and
  one transition epoch; frames report readiness but cannot independently
  commit a new overlay state. The paired action-key projection mirrors safe
  runtime presentation in either direction and never writes source bytes,
  Version records or project state. Frozen review comments remain read-only
  evidence. Their text stays in the trusted host. Scope attributes are removed
  before either document is serialized. A source-resolved local before target
  is represented only by an opaque private initial-bootstrap binding: an
  element path plus a narrow static fingerprint, never a source-node identity
  in authored-page markup. The managed preview serves it only to the
  parser-blocking first bootstrap request, then returns an unbound fallback to
  later reads. The trusted parent releases targets only to the before bootstrap
  through a challenged private port; comment text, keys, source-node IDs and
  locator maps never enter document bytes or later fetchable bootstrap source.
  A unique source `id`, `data-*`, `name`, or `aria-label` is only a safe
  fallback when private binding is unavailable, never a positional sibling
  path. An unsafe, ambiguous, replaced or disconnected target, or an
  unavailable capability, produces no marker. Neither review frame receives
  comment text or a comment marker in authored-page markup.
- Semantic pairing is analysis-local. Its parent-scoped pair graph,
  `semanticOwnerId`/`geometryOwnerId`, and exact stable-sentence geometry
  offsets may annotate the disposable prepared
  documents so the projection can group one frozen review result, but they have
  no database, source, Version, comment locator, Bridge or IPC authority and
  are discarded with that review session or its bounded cache entry. Its
  analysis-local signatures distinguish unique explicit identity, exact subtree
  equality and own non-presentation compatibility; a deep child change cannot
  unpair a stable ancestor, and an ambiguous empty sibling never gains a
  positional identity. Trusted fact generation reports an overflow instead of
  silently publishing a partial fact set.
- The Review runtime-snapshot path starts only from source-backed candidates:
  direct Canvas/SVG roots or source-empty stable hosts paired by
  `SourceHostResolver`. It never derives candidates from scripts, comment
  metadata, selectors, arbitrary HTML/`tbody` or runtime DOM.
  `AiReviewWorkspace` presents static Review first and issues one
  `before`/`after` pair. Authored frames have no runtime request or result
  capability, and Edit never requests a runtime snapshot.
  `RuntimeSnapshotOwner` alone creates the temporary non-persistent partition,
  preview session and hidden sandboxed window. It revalidates the raw source
  binding, confirms the same runtime host and visible Canvas/SVG paint in an
  isolated world, then takes one rect pass, hashes bounded visible DOM/SVG text
  without returning it, and takes at most one bounded screenshot per host. Main
  owns the deadline, cancellation and cleanup. PNG bytes/hash, dimensions and
  aggregate limits are revalidated in trusted renderer memory. Layout and the
  visible-text hash are strict; equal-text PNG hash differences require a local
  mean absolute RGB error above `0.04`, so small encoder/tile raster noise does
  not become a fact. One captured before/after difference may merge an opaque
  marker into the existing static presentation; anything unavailable, malformed,
  timed out or late leaves static Review unchanged. No confirmation pair,
  coordinator or persistence authority exists.
- `CommentSession` is a renderer working copy, not durable Draft authority.
  Runtime state is likewise not a second copy of draft contents: it carries
  lifecycle state and a revisioned pointer to the draft repository.
- Local recovery records are an outbox/fallback, never an equal authority to an
  acknowledged Bridge revision.
- A persistence issue has one visible owner. Source persistence takes priority
  on the workspace banner; otherwise Draft persistence uses that same surface.
  The comment rail and Toast layer do not repeat either issue.
- Canvas never owns a parallel snapshot or DOM undo stack. A pending history
  operation is built only from the accepted SourcePatch result; after
  acknowledgement, the Bridge journal cursor is authoritative. Optional
  logical Selection and the operation's TargetRef transition may restore
  presentation identity after canonical adoption but cannot change bytes. A
  proven island-only result may update the disposable mounted projection in the
  same iframe; failed proof replaces that projection and never changes history
  authority.
- The desktop Edit menu owns no history. It routes focused native text controls
  to platform undo and all eligible Canvas intent to `SourceHistorySession`.
  Comment cards, attachments and project actions are outside both histories.
- Telemetry is observational and best effort. It never owns product state,
  never receives content or paths, and never registers a drain obligation for
  edit, save, switch, submit, close or update installation.
