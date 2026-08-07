# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action, registered identity, renderer generation and late-query fence | Renderer `ProjectSession` | active-file record before registration; project registry and `project.json` afterwards | Workbench composition root and all durable sessions |
| Latest unaccepted OS/QoderWork HTML-open request plus FIFO active/recent-project transitions | Main-process external-file-open mailbox and `ProjectOpenQueue` | in-memory for the current app process; no renderer-supplied path authority | preload lifecycle delivery, startup adoption and trusted project IPC |
| External HTML request IDs, active/queued/deferred renderer delivery, snapshot notification and unaccepted-result fence | Renderer `ExternalFileOpenSession` | none; bounded in-memory state only | Workbench composition root and the project-switch boundary |
| Registered mutation context resolution and atomic-replacement source observation | Bridge project-context service | project/document registry graph plus the owning runtime `pendingWrite` target Hash | Bridge mutation routes and `/project/ensure` |
| Explicit source filename transition, pending operation and active/recent path rebase | Desktop source-rename transaction | active-file `pendingRename` / `lastRename`, then filesystem path | project session, Bridge relink, views |
| Current source bytes, Hash, edit revision, persistence projection, pending write, single-flight source flush, Canvas authority generation and exact-byte boundary reconciliation | Renderer `DocumentSession` | source HTML, runtime autosave record and recovery log; the generation itself is disposable | Canvas, preview readiness, source-history session and drain coordinator |
| Canvas source-history context, pending Patch operations, cursor and applied action IDs | Renderer `SourceHistorySession` for pending intent; Bridge source-history service for acknowledged authority | `history/source-operations.json`, committed with the source through the runtime `pendingWrite` outbox | Canvas, Document session, desktop Edit intent router |
| Focused comment/rules/filename text input undo history and active composition | The native text control and Electron/Chromium editing engine; project-rules session owns autosave eligibility and explicit restore fencing | in-memory control-local history only | desktop Edit intent router, project-rules drain |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Renderer comment/edit-event working copy, deletion tombstones, composer fields and saved-comment edit session | Renderer `CommentSession` | none; disposable projection until Draft acknowledgement | Workbench views, Draft session and Request preparation |
| Acknowledged comments, edit events, tombstones and operation identities | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | Draft session and Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| Active/background AI run projections, Qoder handoff status and recovered handoff-risk disposition, background results and renderer operation locks | Renderer `RunSession` | none beyond authoritative runtime and immutable Request/Attempt records | Workbench process panel and project list |
| AI Request/Attempt lifecycle transition | Bridge run lifecycle | runtime state and immutable Request/Attempt records | Run session and finalizer |
| Immutable Version list, based-on/exact/restored identities and history-view transition | Renderer `VersionSession` | immutable Version records and current runtime pointers | Workbench history and Canvas projection |
| `PROJECT.md` content, editor generation, composition fence, autosave eligibility and save status | Renderer `ProjectRulesSession` | managed `PROJECT.md` | project panel, drain coordinator and Request freeze |
| Close/switch/submit/history readiness and desktop close lifecycle | Drain coordinator plus one renderer close lifecycle | composed owner snapshots, request identity and bounded presentation class; no copied dirty booleans | Electron close handshake, browser fallback and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client | no durable state | application sessions |
| Bridge startup operation, live utility process and ready-only port | Main-process Bridge startup lifecycle | no durable state; one in-memory single-flight operation per app process | window bootstrap, graceful shutdown and workspace-unavailable recovery |
| Undelivered Bridge-unavailable recovery issue and renderer-listener readiness | Main-process recovery mailbox | in-memory for the current app process | preload handshake, native fallback and Workbench banner |
| Renderer edit, project-picker, attachment-persistence, close-coordination, interactive-preview and edit-visual capabilities | Runtime capability resolver | immutable preload manifest; fail-closed browser default | Workbench composition root |
| Volatile interactive-preview document, bootstrap, allowed source-relative asset root, completed-frame identity set and one-way pre-load scriptless navigation-fallback flag | Main-process preview protocol controller plus the owning window's navigation fence | none; bounded in-memory session/window state only; the fallback cannot be reversed inside a session | isolated preview iframe and the script-disabled edit iframe's resource base |
| Current preview/edit display context, bounded read-only visuals, safe reveal transition and per-surface render acknowledgement | Workbench page-view context state | none; source-bound in-memory projection tagged by `DocumentSession` Canvas generation and rendered source Hash | `HtmlCanvasEditor`, `HtmlInteractionPreview`, save-status projection and toolbar |
| Current edit runtime-visual request identity, generation and accepted bitmap projection | Renderer `RuntimeVisualProjectionSession`; main-process capture controller solely owns its active hidden window/session | none; source-Hash-bound in-memory PNGs only | `HtmlCanvasEditor` presentation layer; original source host remains comment target |
| AI review page view, change filter, context visibility, navigation target, canonical page-presentation path, scroll mode and zoom mode | `AiReviewWorkspace` review reducer | none; disposable state bound to the frozen before/after pair | review toolbar, content map and isolated review frames |
| AI review node pairing, typed change facts and fused frame/mask geometry | `review-document` analyzer and isolated-frame projection runtime | none; deterministically rebuilt from the frozen before/after HTML pair | review outline, semantic frames and context mask |
| Initial AI review runtime-chart snapshot batch, frame-registration/comparison deadlines and accepted supplemental host markers | Parent `AiReviewWorkspace` through `ReviewRuntimeVisualCoordinator`, behind the main-process managed-preview navigation fence | none; one bounded in-memory decision bound to the frozen document pair and declared host keys; session/load failure, navigation fallback and inline/browser review are static-only | effective review changes/outline and both isolated frame projections |
| AI review Tab/disclosure/control presentation state and transition epoch | Parent `AiReviewWorkspace` presentation coordinator; either frame may propose an intent | none; disposable parent state plus frame projection only | both review frames, content map and overlay/mask projection |
| Frozen review comment set and read-only before-page marker projection | Ready-review session owns comment text; `review-document` resolves opaque before-page target keys; isolated runtime owns anonymous viewport geometry; trusted `AiReviewWorkspace` joins and renders them | none beyond the immutable Request/Draft evidence already frozen for the run | trusted review host above the before frame only; authored frames never receive comment text |
| Current source-backed comment resolution, visibility, coordinates, marker eligibility and natural document height | `HtmlCanvasEditor` presentation measurement | none; disposable snapshot tagged by rendered source Hash, applied page-view generation and exact target-ID set | Workbench comment rail and Canvas height |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, About PageRoot, Workbench update notice, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 editable-island lease, draft DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | Comment-rail layout session | in-memory and cleared on project transition | comment rail only |
| Current source/Draft persistence recovery banner | Workbench status-banner projection, with source failure priority | owner snapshots only; no independent durable state | workspace view and recovery actions |

Rules:

- A consumer never writes another owner's fields directly.
- External HTML delivery has three explicit owners. The main mailbox accepts
  only its latest unconsumed opaque request. `ProjectOpenQueue` assigns every
  active/recent-project transition its order before a picker, source read or
  Bridge check can finish; local picker, recent-project, external, startup,
  generated-version, rename and forget transitions therefore share one durable
  state boundary. The renderer `ExternalFileOpenSession` deduplicates delivery
  IDs and owns active, queued and deferred switching; Workbench's ordinary
  project-picker retry ref never stores an external request. A newer queued
  external request fences only older work that has not yet been accepted and
  inherits its Canvas freeze. The session emits a monotonically increasing
  deferred-transition sequence when a request enters `deferred`. Workbench
  observes that sequence but does not retry from the same snapshot: automatic
  retry needs a relevant safe-switch blocker to become clear; otherwise an
  explicit retry action delegates back to the session. If the final pre-IPC
  fence itself captures a post-cutoff native edit, no external activation
  starts; that edit returns to normal persistence before the session retries.
  An accepted project publishes
  before a later queued request runs, and that later request replaces it only
  on success. The final visible project and the main-process active/recent
  source therefore stay aligned without discarding input or losing a prior
  successful open to a failed successor.
- `workbench.tsx` is a composition root, not an additional state owner. It
  subscribes to session snapshots, derives read-only presentation values and
  dispatches user intent back to the owning session.
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
- Cross-owner operations are coordinated explicitly; they do not synchronize
  through incidental React effects.
- A current-source transition first stages one complete candidate containing
  project identity, source path, Version authority, HTML bytes and verified
  Hash. Only after every field is valid may the coordinator synchronously
  publish Project, Document and Version state and advance the Canvas authority
  generation. A Hash-only or path-only publication is invalid.
- Edit and preview acknowledge rendering with the exact Document Canvas
  generation and source Hash. A late acknowledgement from an older generation
  is discarded and cannot make persistence appear safe.
- A filename transition never owns HTML bytes or Document identity. It may
  advance the source locator only after the expected source Hash is verified;
  the project session then adopts the Bridge-confirmed path for the same
  `projectId` and `documentId`.
- Runtime features are declared independently. The presence of a project-picker
  API never implies source-edit or attachment-persistence authority.
- Interactive-preview sessions, page-view context and edit runtime-visual
  projections are disposable. They do not participate in save, switch, submit
  or close drains, and cannot become a second copy of the source HTML. Bitmap
  projections are presentation-only and never enter source patch, review,
  version, persistence or AI-input paths. Toolbar and Option-click actions may
  propose a new context for the current document key, but do not own or persist
  it. A projection refresh consumes that context; it does not merge runtime DOM
  into it.
- AI review state fields are orthogonal. Page, filter, visibility, navigation,
  page presentation, scroll and zoom actions may update only their own reducer field. Review
  navigation can reveal a hidden panel in both frames but cannot become a
  second filter or mask owner. The parent owns the full nested panel path and
  one transition epoch; frames report readiness but cannot independently
  commit a new overlay state. The paired action-key projection mirrors safe
  runtime presentation in either direction and never writes source bytes,
  Version records or project state. Frozen review comments remain read-only
  evidence. Their text stays in the trusted host, while the before frame reports
  only opaque-key geometry; neither review frame receives the text and the after
  page never receives a marker.
- The runtime-chart supplement never re-analyzes a statically covered host. It
  declares a host only when the changed authored script directly references
  that host's distinctive source identity; section co-location is not enough.
  The bootstrap binds its evidence-reading DOM/style/Canvas primitives before
  authored scripts run, owns the frozen analyzer-declared host-key set and
  records the parser-created element that first claims every key. Undeclared
  claims are ignored; missing, duplicate, transferred, replaced or drifting
  declared hosts and capture faults invalidate the whole supplemental batch.
  It accepts only a complete declared before/after pair before its initial deadline,
  includes the host's own painted box, fully transparent disappearance state
  and directly mutated size but prunes every descendant subtree whose ancestor
  chain reaches zero opacity, including SVG wrapper groups; hidden descendants, unpainted geometry and
  indirect layout size are not facts. It ignores
  absolute document position and unstable or late samples, merges with an
  existing owning change instead of duplicating it, and freezes after the
  initial projection commit. Pre-load evidence remains bootstrap-owned until
  frame registration, and owner installation drains frames already registered
  for that exact document pair. Once a managed session pair exists, the parent
  allows 1.5s for both exact frames to register and otherwise commits the static
  result; session failure does the same. The coordinator arms its separate
  500ms comparison deadline only when both exact frame documents are loaded.
  Runtime evidence is accepted only through the
  challenged capability port created by the trusted bootstrap before authored
  scripts run; ordinary frame messages cannot complete a side. A pre-load
  navigation attempt irreversibly switches that volatile preview session to a
  scriptless copy with the owned bootstrap, then completes without runtime
  additions. Failure has no
  visible recovery owner because the authoritative static review remains valid.
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
