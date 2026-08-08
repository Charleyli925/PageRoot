# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action, registered identity, renderer generation and late-query fence | Renderer `ProjectSession` | active-file record before registration; project registry and `project.json` afterwards | Workbench composition root and all durable sessions |
| Latest unaccepted OS/QoderWork HTML-open request, committed-exit one-shot handoff, plus FIFO active/recent-project transitions | Main-process external-file-open mailbox and `ProjectOpenQueue` | in-memory for the current process plus one private, validated `userData` handoff record after close commits; no renderer-supplied path authority | preload lifecycle delivery, startup adoption and trusted project IPC |
| External HTML request IDs, active/queued/deferred renderer delivery, snapshot notification and unaccepted-result fence | Renderer `ExternalFileOpenSession` | none; bounded in-memory state only | Workbench composition root and the project-switch boundary |
| Accepted local/external project results, their FIFO renderer publication and deferred final-fence retry | Renderer `ProjectApplicationSession` | none; bounded in-memory state only | Workbench composition root and the final project-application boundary |
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
| Current edit runtime-visual dependency identity, generation, accepted bitmap projection and byte-bounded recent-result cache | Renderer `RuntimeVisualProjectionSession`; main-process capture controller solely owns its active hidden window/session | none; exact-source-validated in-memory binary PNGs only | `HtmlCanvasEditor` responsive keyed presentation reconciler; original source host remains comment target |
| AI review page view, change filter, context visibility, navigation target, canonical page-presentation path, scroll mode and zoom mode | `AiReviewWorkspace` review reducer | none; disposable state bound to the frozen before/after pair | review toolbar, content map and isolated review frames |
| AI review node pairing, typed change facts, prepared immutable review documents and fused frame/mask geometry | Cancellable `ReviewAnalysisSession` plus `review-document` analyzer, ready-review session and isolated-frame projection runtime | none; byte-bounded multi-entry cache keyed only by exact operation/source/comment identity | review outline, semantic frames and context mask |
| Initial AI review runtime-chart snapshot batch, one-shot private candidate element/key/source-box bindings, one conditional same-document confirmation batch for scope-only candidates, frame-registration/comparison deadlines and accepted supplemental host markers | Parent `AiReviewWorkspace` through `ReviewRuntimeVisualCoordinator`, behind the main-process managed-preview navigation fence; the first parser bootstrap response owns the transient binding map | none; one bounded in-memory decision bound to the frozen document pair and declared host keys; bindings never enter HTML, a later bootstrap read is unbound, and only a first-pair difference without direct script causality reloads once; fresh sessions serve confirmation bindings; session/load failure, binding drift, navigation fallback and inline/browser review are static-only | effective review changes/outline and both isolated frame projections |
| AI review Tab/disclosure/control presentation state and transition epoch | Parent `AiReviewWorkspace` presentation coordinator; either frame may propose an intent | none; disposable parent state plus frame projection only | both review frames, content map and overlay/mask projection |
| Frozen review comment set and read-only before-page marker projection | Ready-review session owns comment text; `review-document` resolves opaque targets during analysis, strips scope attributes, and carries source-node bindings only in the parser-blocking first private bootstrap response; trusted `AiReviewWorkspace` delivers targets only through a challenged private port, then joins anonymous viewport geometry and renders it | none beyond the immutable Request/Draft evidence already frozen for the run | trusted review host above the before frame only; authored frames never receive comment text, comment keys, a comment scope marker, or a source-node/locator map in HTML or later bootstrap source |
| Current source-backed comment resolution, visibility, coordinates, marker eligibility and natural document height | `HtmlCanvasEditor` presentation measurement | none; disposable snapshot tagged by rendered source Hash, applied page-view generation and exact target-ID set | Workbench comment rail and Canvas height |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, About PageRoot, Workbench update notice, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 text-session lease, editable-island or disposable direct-text host DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island or direct-text-node SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | Comment-rail layout session | in-memory and cleared on project transition | comment rail only |
| Current source/Draft persistence recovery banner | Workbench status-banner projection, with source failure priority | owner snapshots only; no independent durable state | workspace view and recovery actions |

Rules:

- A consumer never writes another owner's fields directly.
- External HTML delivery has four explicit owners. The main mailbox accepts
  only its latest unconsumed opaque request. `ProjectOpenQueue` assigns every
  active/recent-project transition its order before a picker, source read or
  Bridge check can finish; local picker, recent-project, external, startup,
  generated-version, rename and forget transitions therefore share one durable
  state boundary. The renderer `ExternalFileOpenSession` deduplicates delivery
  IDs and owns active, queued and deferred switching. Preload suppresses an
  older readiness catch-up once it has observed a live request, so delivery
  order cannot reverse at the renderer boundary; Workbench's ordinary
  project-picker retry ref never stores an external request. A newer queued
  external request fences only older work that has not yet been accepted and
  inherits its Canvas freeze. The session emits a monotonically increasing
  deferred-transition sequence when a request enters `deferred`. Workbench
  observes that sequence but does not retry from the same snapshot: automatic
  retry needs a relevant safe-switch blocker to become clear; otherwise an
  explicit retry action delegates back to the session. If the final pre-IPC
  fence itself captures a post-cutoff native edit, no external activation
  starts; that edit returns to normal persistence before the session retries.
  Once main-process acceptance succeeds, `ProjectApplicationSession` becomes
  the sole owner of renderer publication. It retains local and external
  results FIFO, repeats the switch drain and takes a synchronous final Canvas
  freeze immediately before every `applyProject`. A deferred final fence keeps
  its already-accepted result until a relevant blocker clears or the user
  explicitly continues. An accepted project therefore publishes before a later
  queued result runs, and that later result replaces it only on its own safe
  application. After the FIFO settles, the visible project and main-process
  active/recent source stay aligned without discarding input or losing a prior
  successful open to a failed successor. Close treats both a main-process
  external acceptance and an accepted renderer application as drain
  obligations before either the hydration or load-error close fast path; it
  cannot approve shutdown while either owner is active or deferred. A new
  external delivery during an uncommitted close cancels that exact handshake
  before normal mailbox delivery. After close commits, the mailbox does not
  accept the request in the exiting process; its owner atomically records only
  the latest validated path in a one-shot handoff that only the next
  single-instance owner claims and deletes before normal delivery.
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
  into it. Runtime dependency-stable text/history changes may rebind the exact
  committed projection without capture; indirect DOM traversal is conservatively
  source-dependent and schedules a replacement. Pending or replacement work never owns
  permission to blank the committed bitmap; identical mounts retain their DOM
  identity, and Preview/Edit suspension preserves only bounded disposable
  byte-bounded cache state. A valid non-deferred empty projection clears the prior
  mount, while direct Canvas/SVG sizing overrides remain reversible presentation
  state. Accepted PNG bytes and unchanged mounts retain their
  identity across TargetRef rebinding; Blob URLs are presentation resources and
  are revoked on replacement or frame disposal.
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
  comment text or a comment scope marker in authored-page markup.
- The runtime-chart supplement never re-analyzes a statically covered host. It
  declares an ordinary host only when the changed authored script directly
  references that host's distinctive source identity. A source-empty host
  directly targeted by, or nested beneath, a frozen non-global review comment
  may instead use the opaque comment target as explicit local scope. Every
  frozen non-global target inside the current review section also starts a
  nearest-group search: its first ancestor containing at least two pairable
  hosts owns lower-priority scope for sibling charts, even if the target is a
  caption or heading beside them. Direct, contained and nearest-group hosts are
  selected in that order before ordinary hosts under the same 128-candidate
  limit. Global
  comments do not widen runtime scope, the group cannot cross its section, and
  ordinary group-external section co-location is not enough.
  Candidate keys and original source-box baselines are held only in the first
  parser bootstrap response's session-private element map. No temporary
  identity, fixed runtime-host/source-box attribute, key or path is serialized.
  A stale path may resolve only to one matching private fingerprint; a missing,
  ambiguous, replaced or disconnected binding invalidates the full supplemental
  batch. Confirmation creates fresh sessions so its frame pair receives new
  one-shot bindings.
  The bootstrap binds its evidence-reading DOM/style/Canvas primitives before
  authored scripts run, owns the frozen analyzer-declared host-key set and
  records the parser-created element that first claims every key. Undeclared
  claims are ignored; missing, duplicate, transferred, replaced or drifting
  declared identities invalidate the whole supplemental batch. Each host retains
  independent failure isolation while one aggregate capture budget spans the
  complete two-sample batch; a local fault, instability or exhaustion is a
  validated unavailable fact with no authority over valid sibling hosts.
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
