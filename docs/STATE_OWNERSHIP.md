# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action, registered identity, renderer generation and late-query fence | Renderer `ProjectSession` | active-file record before registration; project registry and `project.json` afterwards | Application workflows and the Controller aggregate snapshot |
| FIFO OS/QoderWork HTML-open requests, the single renderer-delivered head awaiting explicit acknowledgement, committed-exit handoff, plus active/recent-project transitions | Main-process external-file-open mailbox and `ProjectOpenQueue` | in-memory for the current process plus one private, validated `userData` handoff record after close commits; no renderer-supplied path authority | preload lifecycle delivery, startup adoption and trusted project IPC; Main never publishes the next head before renderer accept/cancel/reject acknowledgement |
| Prepared A/B/C open intent, commit receipt and one-shot original-file trash disposition | Main-process `desktop/prepared-html-open.mjs` store | none; process memory only; delete consent is never persisted | trusted project IPC and `ProjectWorkflow` commit/finalize/rollback |
| Open-confirmation busy/retry projection and optional delete-original consent | Renderer `ProjectWorkflow` | none; reset per request and cancelled on close | Workbench auto-confirms ordinary import/reopen; delete-original keeps a registered confirm |
| External HTML request IDs, active/queued/deferred renderer delivery, blocker-transition/manual retry policy and unaccepted-result fence | Renderer `ExternalFileOpenSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Accepted local/external project results, their FIFO renderer publication and deferred final-fence blocker-transition/manual retry policy | Renderer `ProjectApplicationSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Registered mutation context resolution and atomic-replacement source observation | `ProjectFileRepository` (`bridge/project-file-repository.mjs` façade; internals under `bridge/project-file-repository/` do not become a second owner) | v4 `.pageroot-registry.json` plus the owning Project File working copy and `.pageroot` metadata | Bridge mutation routes and `/project/ensure` |
| Canonical external-source path → unique `projectId` lookup, first-import Hash relation, and read-only A/B/C open classification | `ProjectFileRepository` | Registry `importSourceKey` / `importSourceSha256` pair plus the bound project's current active Working Copy | `/project/open-classification`, `/project/ensure` and Desktop Prepared Intent |
| Registry project-catalog membership, availability and validated registered-project OpenTarget resolution | `ProjectFileRepository` Registry reader | Registry `projectId → registeredProjectRootPath` records plus validated per-project metadata; Desktop Recent may rank but never add/remove/authorize a member | read-only catalog route, `ProjectWorkflow` projectId open command and Workbench project list |
| Runtime Bridge/Session/workflow composition, aggregate-observer lifecycle, registration operation identity, single-flight, stale-result fence and cross-Session publication sequence | `createRuntimeWorkspaceController()` and `WorkspaceController` | none; the factory creates the one fact-owner set and the Controller publishes only frozen aggregate projections through existing Project, Document, Comment, Draft, Version and SourceHistory owners | Workbench aggregate-snapshot subscription, Controller commands and presentation-event adapter |
| Desktop workbench navigation admission, receipt and tab order/active/pending/mounted/runtime-owner identity | Renderer `WorkbenchNavigationSession` owns the transaction phase/receipt and `WorkbenchTabsSession` owns the tab projection; the Controller-owned `WorkbenchNavigationWorkflow` is the only coordinator | validated `workbench-tabs.json` stores only `tabId + projectId + documentId` and the active document tab; it is restart-convenience metadata written best-effort, with no close veto and no path, title, HTML, Hash, Request, Candidate, Version or Conversation authority | Startup/restore, local/recent, registered/sidebar/tab, OS-external and confirmation all enter one ordered admission stream; ProjectWorkflow applies the tab mutation synchronously through the correlated application receipt before its presentation event |
| Read-only tab display projections, hot/warm LRU order and per-tab Canvas mode/PageViewContext/scroll restoration | Controller-owned `DocumentSurfaceCacheSession` owns source projections; Workbench owns at most five mounted inert static iframe presentations and exactly one active `HtmlCanvasEditor`; `WorkbenchNavigationWorkflow` only touches/removes projection entries | none; bounded process memory only, maximum five static display iframes, one active Edit Canvas and its bounded editor-internal A/B handoff slot, 20 HTML entries and 32 MiB of source projections; inactive tabs retain no editor or Runtime DOM | pending tab presentation may show a script-disabled cached frame while canonical registered-project open validates the sole editable authority; the cache never covers the same document's live editor during text input or Runtime refresh; Runtime DOM never enters this cache contract |
| Project hydration generation and load outcome, switch/open operation, accepted-result execution, close request identity, project-switch publication, Prepared Intent commit after confirmation, and the unified managed-source prepare/commit handoff for Candidate promotion, historical Working Copy continuation and Registry opens | Renderer `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through existing Session owners and trusted ProjectOpen/Canvas ports | Workbench commands and presentation-event adapter |
| Durable source filename transaction, pending operation and active/recent path rebase | Desktop source-rename transaction | active-file `pendingRename` / `lastRename`, then filesystem path | trusted desktop rename port and Bridge relink |
| Current active managed Working Copy restart cache | Main `activeManagedLocator` in the private active-file record | none; non-authoritative, fail-closed cache of the last verified identity tuple and path. Registry plus project metadata remain the only write authority. Missing cache never guesses by name or Hash | startup `getActiveProject`, Finder locator reconcile and trusted `reconcileActiveManagedSource` IPC |
| Renderer source-rename and Finder locator rebase, expected Hash/context fence, lost-response reconciliation and synchronous Project/Document/Run publication | `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through the existing Session owners after desktop/Bridge validate the same identity tuple. Present-file directory hints only hash-observe; missing-path hints, startup and title-bar rename drain switch and rebind | Workbench filename intent, directory-change hints and presentation-event adapter |
| Current source bytes, disk-confirmed Hash, working-HTML Hash, edit revision, persistence projection, pending write, single-flight source flush, Canvas-rendered Hash, exact-byte boundary reconciliation and protection evidence | Renderer `DocumentSession` owns current bytes/state; `DocumentWorkflow` owns revision/context-bound verified recovery/export receipts | source HTML and runtime autosave record; Main owns the atomic per-document recovery journal; journal path is a CAS-rebased location, and the Canvas generation itself is disposable | Canvas acknowledgements authorize presentation/cache reuse only. Save/export/AI/leave consume complete Working HTML and exact persistence or recovery evidence; a stale rendered projection remains a distinct honest fact |
| Force-unlock of a Working Copy conflict (adopt disk Hash as `saved`, no HTML write; clear `runtime.activeRequest` if present; keep `lastPersistedRevision`) | `ProjectFileRepository.forceUnlockWorkingCopy` via `POST /conflict/resolve` `force-unlock` | Working Copy state record and runtime request pointer | `DocumentWorkflow.forceUnlockConflict` / `reloadAuthority({ acceptExternalConflict: true })` and the conflict banner |
| Allowlisted GlobalInterruption | Renderer Workbench via `globalInterruptionPresentation()` | none; closed kind union only | existing `NoticeBar` with `className="toast"` |
| WorkspaceSafetyState | Renderer Workbench derived from `workspaceIssue` / persist / pending-exit | none; at most one kind | existing workspace-unavailable / persist banners and chrome status |
| Current-source commit, same-directory two-state CAS replacement (`prepared` → atomic rename → `committed`) and Project File settlement | `ProjectFileRepository` | source HTML working copy and `.pageroot` runtime/autosave records; the save journal is two-state CAS owned by `ProjectFileRepository`; each `#serial()` turn caches one verified project root (realpath, not a symlink) | `/autosave` route adapter and restart recovery |
| Managed Working Copy source-element identity schema, sealed binding Hash, one-time materialization and crash recovery | `ProjectFileRepository` (`working-copy.mjs` supplies pure inspection/materialization/binding and CAS paths; the façade owns transaction sequencing) | current Working Copy HTML, `working-copy-state.v4.sourceElementIdentitySchemaVersion + sourceElementIdentityBindingSha256`, manifest file identity, committed `source-element-identity-migration.v1` transaction and temporary complete before/after recovery bytes | editable workspace hydration; external clean edits must preserve the sealed ID/tag/parent/order binding or require explicit force-unlock; `IslandEditingController` and the text-range style planner preserve existing IDs and allocate them for new inline source descendants, while normal save verifies every prior claim and fills only valid new-element omissions; historical Versions, external originals, Runtime DOM, comments and Review are not consumers with write authority |
| Pure semantic document revision, accepted operation lineage, system-derived identity delta and generated in-process inverse | `SemanticOperationKernel` | Canvas supplies current source/revision and receives complete HTML from one kernel apply; tracked comment/selection refs pass through that apply. An owned `SourceIndex` may be remembered on a live semantic state object for those exact bytes only; it is not a second fact owner, Session, or history pool. SourcePatch remains an internal exact-range materializer, not a second public edit API | text/style/reorder and stable-ID insert/duplicate/delete/move/replace paths; Repository independently verifies the delta but does not create semantic authority; Desktop, Runtime DOM, AI and Review do not own this state |
| Current-open Canvas undo/redo context, at most 20 exact Patch pairs, cursor and pending-save evidence | Renderer `SourceHistorySession` | bounded process memory only; recovery may retain exact save evidence but never a restorable cursor; no Bridge action route or persistent history schema exists | Canvas, Document session, desktop Edit intent router |
| Durable AI Conversation, its Contexts, Turns and terminal messages, the per-Document current-conversation pointer and the Composer draft | Bridge-owned `ConversationRepository` in `bridge/conversation-repository.mjs` is the only writer | `.pageroot/conversations/`: one record per Conversation plus a per-project index and a separate small draft record, all atomically replaced. A Conversation belongs to exactly one Document, so a cross-Document read fails closed on identity rather than being filtered at read time. `sequence` is assigned from the record's own `lastSequence`; the single writer makes strict increase need no coordination. A streaming fragment is never written: `draft`, `queued` and `streaming` are refused, so every stored message is terminal and crash recovery repairs nothing. A stored message carries no interface member | typed Bridge routes `/conversation`, `/conversation/list` and `/conversation/draft`; renderer receives a read projection only |
| Renderer conversation projection, load status and unsent Composer text/intent | Renderer `ConversationSession` | none; it holds a disposable projection of the Bridge record. Switching Document clears it before the next load so one Document's messages can never appear under another | AI sidebar through the aggregate `WorkspaceController` snapshot |
| Conversation load ordering, document-keyed response acceptance and debounced single-flight draft persistence | Renderer `ConversationWorkflow`, composed by `WorkspaceController` | none; it publishes only through `ConversationSession` and reads only the Bridge projection. A response for a Document the user already left is discarded; a draft flush runs at close, project switch and document switch | AI sidebar commands on `WorkspaceController` and the typed Bridge client |
| Focused comment/rules/filename text input undo history and active composition | The native text control and Electron/Chromium editing engine; `ProjectRulesSession` records rules-editor composition and the workflow owns its eligibility/explicit restore orchestration | in-memory control-local history only | desktop Edit intent router, `ProjectRulesWorkflow` |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Draft snapshot recovery sequence/operation, attachment upload count, in-flight attachment identity and stale/cancel compensation | Renderer `CommentWorkflow` | recovery store is crash-only; Draft aggregate and managed attachment repository remain the durable authority | `WorkspaceController.comments` projection, aggregate compatibility snapshot and `ProjectWorkflow` drain |
| Renderer comment/edit-event working copy, deletion tombstones, composer fields and saved-comment edit session | Renderer `CommentSession` | none; disposable projection until Draft acknowledgement | `WorkspaceController.comments` projection, Draft session and Request preparation |
| Comment-rail composer/edit/focus/target-loss disclosure, delete confirmation, draft target reselection, input refs, card measurement, virtualization, paired reveal/focus, Canvas selection and source-tagged target geometry | `CommentRailContainer` and `commentCanvasPort` | none; disposable React/adapter state only, never a comment fact | comment rail view; Workbench host commands may read current presentation intent without subscribing the root render |
| Acknowledged comments, edit events, tombstones and operation identities | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | Draft session and Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| Active/background AI run projections, per-Request Agent delivery mode/session status, recovered handoff-risk disposition, background results, submission phase/unknown-outcome lock and renderer operation locks | Renderer `RunSession` | none beyond authoritative runtime and immutable Request/Attempt records; ACP events are bounded presentation evidence, never Candidate authority | `RunWorkflow`, conversation sidebar, drain coordinator and project context |
| Renderer Agent provider availability, selected provider/runtime/model/reasoning, bounded public model catalog, installable/installSource/installState projection and selection-keyed preflight cache | `AgentCatalogState` | Settings consumes the Bridge-owned four-fact `AgentDiagnosticSnapshot`; diagnosis is selection-keyed single-flight, never owns a ticket or changes selection, and cannot erase stronger preflight/use evidence. Renderer hydrates `installState` but Bridge remains the install-job owner. Execution tickets are keyed by frozen provider/runtime/model/reasoning/installation/trust and deleted when handed to execution | `WorkspaceController`, Settings, conversation sidebar and `RunWorkflow` |
| 源页 Agent session Token | Bridge `AgentRuntimeCoordinator` | process memory for the live session; optional Main `safeStorage` ciphertext under `userData/agent-session-credential.v1.json` only after explicit remember; never `ui-preferences.json`, logs or GET responses | Settings connection card; Renderer posts `POST /agent/session-credential` and never rereads the secret |
| Product ACP allowlist, managed Agent inventory, in-flight install jobs and install drain | Bridge `AgentCatalog` / `AgentInstaller` | managed bytes live under Electron `userData/agents/<providerId>/<version>/` (or `HTML_AI_AGENTS_ROOT`); jobs are process-local with a monotonic `generation`; user-global npm is never spawned | `GET /agent/providers`, `POST /agent/install`, `POST /agent/install/cancel`, Qoder provider discovery and Coordinator shutdown; public rows expose `activeOperation` without paths |
| Agent access-operation projection (`install`/`login`/later auth kinds), `enabled` and stale-generation discard | Renderer `AgentProviderCatalog`; `shared/agent-access-operation.mjs` is a pure helper with no persistence | `enabled=false` persists only as workspace `disabledAgentProviderIds`; operations stay in process memory and cannot rewrite a finished state | Settings cards and Controller `applyDisabledAgentProviders`; diagnose/preflight consume the same snapshot |
| AI Request freeze, pre-Request Agent use-time check, persisted-boundary verification, safely fenced same-Request Agent start/retry, unknown-POST authority reconciliation, polling lifecycle, cancellation ordering and conflict command sequence | Renderer `RunWorkflow`, composed by `WorkspaceController` | the user intent synchronously freezes selection; after Request publication every path reads the durable Request selection and never the mutable catalog selection | Workbench intent/conversation/sidebar adapter, typed Bridge client and Bridge run lifecycle |
| AI Request/Attempt lifecycle transition | Bridge run lifecycle | runtime state and immutable Request/Attempt records | `RunWorkflow`, RunSession and finalizer |
| `AI任务/` derived prompt/Candidate publication, collision allocation and recovery stage | `ProjectFileRepository` plus narrow `ai-task-projection` materializer | immutable Request/Attempt/Candidate records remain authoritative; `.pageroot/recovery/ai-task-projections/` receipt is only a rebuildable display-progress record; runtime `lastAiTask` is a sealed no-change/error Finder anchor, never an active run or Candidate authority | `/ai-task`, trusted Desktop Finder port and handoff presentation |
| AI Candidate complete-HTML source identity, normalization and report | `ProjectFileRepository` through the pure `candidate-identity` validator | frozen base binding Hash, submitted-output Hash, normalized Candidate Hash and sealed identity report; current Working Copy remains unchanged until Promotion | Candidate Review, Promotion and historical Candidate readers; Runtime DOM is never an input |
| Immutable Version list and based-on/exact/restored/current-history projection facts | Renderer `VersionSession` | immutable Version records and current runtime pointers | `VersionWorkflow`, Workbench history and Canvas projection |
| Version activation, review-candidate preparation, current/history navigation and historical Working Copy continuation operation identity, Bridge I/O, full OpenTarget/Hash/time validation, receipt-forward recovery and synchronous cross-Session publication | Renderer `VersionWorkflow`, composed by `WorkspaceController` | Repository owns the durable history activation receipt; the workflow publishes only through Project, Document, Version, Draft and Comment owners | Workbench review/history commands, presentation-event adapter and Bridge version lifecycle |
| `PROJECT.md` content, editor generation, composition fence and save projection | Renderer `ProjectRulesSession` | managed `PROJECT.md` | `ProjectRulesWorkflow` and Request freeze |
| `PROJECT.md` Bridge reads/writes, 700ms autosave timer, unknown-write authority reconciliation and close/switch drain | Renderer `ProjectRulesWorkflow`, composed by `WorkspaceController` | none; it publishes only through `ProjectRulesSession` and the managed `PROJECT.md` remains authoritative | `ProjectWorkflow` drain and Request freeze |
| Close/switch/submit/history readiness and desktop close lifecycle | The unique `DrainCoordinator` owned by `WorkspaceController`; `ProjectWorkflow` owns the request-scoped close operation | composed owner snapshots, request identity and bounded presentation class; no copied dirty booleans | Electron close handshake, browser fallback and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client created by the runtime Controller factory | no durable state | application workflows only |
| Product Agent diagnosis, dispatch, use-time execution ticket/session, cancellation, activity timeout, lease, structured recovery, bounded canonical events and shutdown drain | Bridge-owned `AgentRuntimeCoordinator`; `AgentBridgeService` is the route façade. Provider-specific diagnosis/preflight stays in the registry/provider | diagnosis is ticketless and sessionless. Tickets bind provider/runtime/security profile/execution purpose/installation digest, are one-use and expire in memory. Runtime sessions own `lastActivityAt`, `receivedBytes`, `safeToRetry` and `recoveryKind`; Request/Attempt/Candidate remain durable authority | `AgentDiagnosticSnapshot`, typed Agent routes and bounded `PublicExecutionSession`; hidden reasoning, paths, stderr and partial HTML never cross them |
| Product Agent process cleanup and crash/restart fence | `AgentRuntimeCoordinator` owns the unified provider/runtime/purpose/project/document/turn-or-request lease and cancellation order `requested → provider-acknowledged → termination-confirmed → durable-cancelled` | an exclusive `.pageroot/agent-bridge-leases/` record is a crash/orphan fence, never task authority. Old leases are never reclaimed or adopted. Release false/throw preserves the fence and blocks retry, durable cancellation and shutdown | coordinator façades only; workspace/Desktop shutdown own no tickets or sessions |
| Development synthetic provider/runtime fixture and Qoder ACP live-probe report | `tests/fixtures/agent-provider/qoder-provider.mjs` provides path-free registry evidence; `scripts/qoder-acp-spike.mjs` reuses `bridge/qoder-acp-client.mjs` only against its disposable synthetic Project File | no product authority; the fixture is process-only and ignored `output/qoder-acp-spike/report.json` is diagnostic evidence only | provider contract tests and developers evaluating live account/network compatibility; never a release gate or Candidate authority |
| Codex ACP installation evidence | `codex-acp-provider.mjs` owns user/managed installation discovery, package identity, preflight and model catalog; the managed catalog owns the downloaded adapter+native closure outside the packaged application | process-only version, installation digest, auth class and provider-namespaced model catalog; no account details, thread, Request, Candidate or Conversation write | default Provider catalog and managed `userData/agents/codex/` closure |
| Codex ACP execution process, ephemeral Provider binding and visible progress | `codex-acp-provider.mjs` plus the shared `acp` runtime own launch, ACP session and process cleanup. Coordinator continues to own ticket, lease, cancel and session projection | Agent text is disposable process evidence. Only the fixed finalizer plus Repository validation creates a pending-review Candidate; Working Copy and Version authority never move on ACP completion | existing Conversation/sidebar projection and Candidate Review; pure discussion remains disabled |
| Bridge startup operation, live utility process and ready-only port | Main-process Bridge startup lifecycle | no durable state; one in-memory single-flight operation per app process | window bootstrap, graceful shutdown and workspace-unavailable recovery |
| Undelivered Bridge-unavailable recovery issue and renderer-listener readiness | Main-process recovery mailbox | in-memory for the current app process | preload handshake, native fallback and Workbench banner |
| Renderer edit, project-picker, attachment-persistence, close-coordination and interactive-preview capabilities | Runtime capability resolver | immutable preload manifest; fail-closed browser default | Workbench presentation host adapters |
| Volatile interactive-preview document, bootstrap, allowed source-relative asset root, completed-frame identity set and one-way pre-load scriptless navigation-fallback flag | Main-process preview protocol controller plus the owning window's navigation fence | none; bounded in-memory session/window state only; the fallback cannot be reversed inside a session | isolated preview iframe and the script-disabled edit iframe's resource base |
| Current preview/edit display context, safe reveal transition and per-surface render acknowledgement | Workbench page-view context state | none; source-bound in-memory projection tagged by `DocumentSession` Canvas generation and rendered source Hash | `HtmlCanvasEditor`, `HtmlInteractionPreview` and toolbar |
| Disposable Edit author-runtime program identity, scoped prepare grant, public phase/load outcome, latest persisted retry identity and at-most-once compatible recovery | `EditAuthorRuntimeSession`, composed by `WorkspaceController`; `DocumentSession` remains the sole source owner and Main owns exact-source admission plus immutable compatible/exact resource sessions | none; bounded process memory only. Attempt admission remains keyed by `(sourcePath, canvasGeneration)` so source checkpoints never auto-prepare. A same-directory Finder rename that keeps HTML, SHA and canvas generation relocates that live key instead of consuming another prepare. Within that key the Session separately tracks the latest persisted `{HTML, source SHA}` only for explicit retry; failure-time HTML cannot be reused after Working advances. It does not own or cache physical last-known-good availability | Workbench loading acknowledgement, Controller-provided current Document identity and the frame coordinator's identity-bound settlement result; Runtime DOM never enters persistence |
| Two fixed Edit Runtime slots, slot leases, active/latest-candidate phase, last-known-good identity, ignored stale callbacks and Native Edit/IME promotion gate | Pure `RuntimeFrameCoordinator`; `HtmlCanvasEditor` owns only the corresponding two iframe DOM effects, minimal presentation anchor and Selection effects | none; bounded renderer memory only. Stable state is exactly one loaded active slot plus one inert empty slot. `superseded` is coordination, never authored-program failure; a former active slot is cleared on the next frame after promotion | candidate load/activation/deadline/rAF/microtask/position callbacks and `EditAuthorRuntimeSession`; only the latest identity and current slot lease can publish a terminal result |
| Current Edit Runtime degradation presentation (`none`, `static-preparing`, `static-visible`, `last-known-good-readonly`) | `HtmlCanvasEditor`; Workbench only derives `direct-static-visible` when `EditAuthorRuntimeSession` reports a direct static fallback before any Editor failure transition | none; disposable renderer presentation. Workbench may dismiss a non-severe notice for only its current state; a transition to `last-known-good-readonly` remounts the notice and permanently retains reload/export recovery actions | Workbench notice and read-only projection; it cannot change Working HTML, Runtime outcome or slot identity |
| Exact-version external ECharts script bytes, URL metadata and LRU | Main `desktop/edit-runtime-library-store.mjs` | `Application Support/PageRoot/edit-runtime-library-cache/v1`; content-addressed blobs plus atomically replaced bounded index; bytes are verified on every read and are never source or runtime-session authority | `desktop/edit-runtime-protocol.mjs` resource preparation only; compatible success never promotes later exact bytes into the current Canvas |
| Imported project's original sibling-asset directory | Main `importedAssetRoots` in `userData/html-projects.json` plus process `activeImportedAssetSourcePath` | desktop project state keyed by project root; renderer never receives the original path | preview protocol, edit-runtime protocol and the script-disabled Edit iframe resource base |
| AI review page view, change filter, context visibility, navigation target, canonical page-presentation path, scroll mode and zoom mode | `AiReviewWorkspace` review reducer | none; disposable state bound to the frozen before/after pair | review toolbar, content map and isolated review frames |
| AI review semantic pair graph, stable-ID topology, text/element-presence/movement/attribute/inline-style/CSS/Script source facts, disposable fact/semantic/geometry owner IDs, prepared immutable review documents and canonical frame/mask geometry | Cancellable `ReviewAnalysisSession` plus `review-document` analyzer (`app/workbench/review/` pipeline), ready-review session and isolated-frame projection runtime | none; byte-bounded multi-entry cache keyed by base/candidate Hash, bootstrap mode and source path. The cache stores annotated HTML plus source-diff facts only; comment binding and current-session/Frame projection are derived after a hit and are not cache keys. Cache hits are not adoption authority. Mutable Document/Element, runtime geometry and an old Frame are never reused across sessions. Fact identities are analysis-only and never persisted | review outline, semantic frames and context mask; Runtime DOM, computed style and pixels are never inputs |
| AI review Tab/disclosure/control presentation state and transition epoch | Parent `AiReviewWorkspace` presentation coordinator; either frame may propose an intent | none; disposable parent state plus frame projection only | both review frames, content map and overlay/mask projection |
| Frozen review comment set and read-only before-page marker projection | Ready-review session owns comment text; `review-document` resolves opaque targets during analysis via unique `data-pageroot-id`, strips temporary review attributes, and carries Stable-ID bindings only in the parser-blocking first private bootstrap response; trusted `AiReviewWorkspace` delivers targets only through a challenged private port, then joins anonymous viewport geometry and renders it | none beyond the immutable Request/Draft evidence already frozen for the run | trusted review host above the before frame only; authored frames never receive comment text, comment keys, a comment marker, or a Stable-ID/locator map in HTML or later bootstrap source |
| Current source-backed comment identity, runtime visual hint, resolution, visibility, coordinates, marker eligibility and natural document height | `CommentSession`/Draft carry the validated `sourceAnchor` as the only source authority; `TargetResolver` owns Stable-ID-only official resolution on complete managed Working Copies; leftover heuristic helpers in the resolver module are unused by the official entry and are not a shadow metrics path; `html-canvas-comment-layout` measurement is owned by `HtmlCanvasEditor` and stabilized by `commentCanvasPort` | `sourceAnchor` persists `elementId`, current expected canonical source Hash and optional text locator; bounded `visualHint` is explanatory only and is best-effort matched inside that host after a rerun; tag/fingerprint is compatibility evidence only; geometry remains a disposable snapshot tagged by rendered source Hash, applied page-view generation and exact target-ID set | `CommentRailContainer` and the inherited Canvas-height CSS variable; Workbench root does not subscribe; runtime operation targets never become source authority |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, Settings PageRoot, sidebar update entry, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Install-level first-real-HTML guide status, generation and built-in welcome `projectId` | Main `desktop/ui-preferences.mjs`; renderer `FirstEditGuideSession` owns visibility and the 800ms present-dwell timer and is composed only by `WorkspaceController` | bounded `ui-preferences.json` under PageRoot Application Support; atomic replace; schemaVersion 2 with v1 migration | `document.body` portal overlay (`FirstEditGuideCard`); Canvas does not mount or dismiss the card |
| Settings tab/category, settings-mode sidebar and return/focus route | Workbench presentation state (`settingsCategory` plus the existing tab navigation commands) | none; the category is disposable and is reset only after the settings tab is truly closed | Settings sidebar/Page, gear entry, Agent install/login entry and Escape/return actions |
| Workspace layout/motion/restore/default-Agent/`disabledAgentProviderIds` projection, pending patch, save error and bounded retry/flush | Renderer `WorkspacePreferencesSession`, composed by `useWorkspacePreferences` and `WorkspaceController`; Workbench only renders the projection | Main `desktop/ui-preferences.mjs` owns the v2 `workspace` object, strict field/range validation, migration and atomic queued writes; it contains no HTML, comments, attachments, credentials or localStorage authority | Settings Page; startup tab coordinator consumes only `restoreTabsOnLaunch`, Agent Catalog consumes the validated default provider and explicit disconnect list, resizers submit widths only at an interaction boundary |
| Edit-canvas pointer-capability hover cursor, delayed outline and one-line caption | `HtmlCanvasEditor` presentation | none; disposable overlay of `resolveCanvasPointerHit`, hidden on click, scroll or text editing | `html-canvas-selection-chrome` overlay |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 text-session lease, editable-island host DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | `commentCanvasPort` | in-memory and cleared on project transition | `CommentRailContainer` only |
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
  then hydrates after the Working HTML is published so the workbench can leave
  `hydrating`. Canvas Hash verification may fail independently: the projection
  becomes non-editable or statically degraded, and already published source is
  never rolled back. The renderer
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
- A tab is presentation and navigation, never a second Workspace. The renderer
  creates exactly one runtime `WorkspaceController`. `WorkbenchNavigationWorkflow`
  asks the existing `ProjectWorkflow.openProject(kind=registered)` to run its
  canonical `prepareSwitch`/drain/Canvas fence, rejects pre-open matching
  identity, then mounts only a newer aggregate Project epoch. The operation
  commits its user-facing admission as soon as the correlated application has
  published exact display bytes. Hydration, accepted-result FIFO and Canvas
  verification remain background readiness owned by `ProjectWorkflow` and the
  close drain. A failure after display readiness remains attached to the mounted
  target tab, keeps editing closed and offers hydration retry; it is never
  handled as a failed open or pre-commit cleanup.
  A byte-bounded `DocumentSurfaceCacheSession` may retain exact, fully persisted
  and Canvas-verified HTML for recent tabs. At most three script-disabled display
  iframes remain mounted; they never retain contenteditable, Selection, IME,
  observers or source serialization. Warm entries retain only allowlisted
  presentation context and scroll. Evicted tabs become cold identities without
  being closed, and every activation still enters canonical project open.
  Start activation calls the same canonical `prepareSwitch`; only then
  does it unmount the document outlet while retaining `runtimeOwnerTabId`, so
  close/quit obligations remain owned by the same Controller. Close and activate
  are mutually exclusive. Inactive tabs keep no contenteditable, Selection or
  IME DOM.
- Every authoritative `project-applied` publication carries the already
  verified `projectId + documentId` pair and is synchronously projected into
  `WorkbenchTabsSession` before React aggregate rendering. Accepted-project
  FIFO successors therefore cannot erase a predecessor tab. A pending
  registered-tab switch may stage or refresh that identity, but only
  `WorkbenchNavigationWorkflow` may commit its active/mounted tab through the
  synchronous application receipt after Controller
  identity verification. A non-null transaction/application generation is
  synchronously authorized before ProjectWorkflow mutates Controller Sessions;
  expired or terminal generations cannot later resume a deferred application.
  Null transaction identity is reserved for legal authority refresh.
- Browser-only file input has no filesystem locator authority. After bytes are
  decoded and hashed, it mints a presentation identity from a versioned digest
  of NFC filename, size, last-modified time and content Hash. The resulting
  `project_browser_* + doc_browser_*` pair lets reselection deduplicate and
  `project-applied` replace Start, but it never becomes path, HTML or Hash
  authority. Desktop identities continue to come only from verified
  Bridge/managed-open results.
- A failed Desktop acknowledgement retains an opaque request-keyed completion
  in `ProjectWorkflow`: retry performs only that ack, while the external Session
  keeps the FIFO head and withholds successors. Close drain cancels and
  acknowledges every queued confirmation until the Session is idle.
- Desktop close synchronously freezes the same navigation admission stream
  before awaiting idle, then enters the Project content-safety boundary. Tab
  layout persistence continues best-effort and cannot veto exit. Ready retains
  the navigation freeze through final exit; close rejection or abort releases
  the exact request before at most one automatic retry. Finder FIFO
  acknowledgement requires the matching terminal navigation outcome.
- `RunSession` owns the one in-memory submission lifecycle. `preparing` blocks
  duplicate intent and drain without freezing the current canvas; `frozen`
  blocks edits until the Request is known; `uncertain` preserves a current
  read-only fence while reconciliation determines whether a durable run exists.
  Workbench must derive its active lock and submission presentation from that
  snapshot rather than maintain a second boolean or ref.
- `RunWorkflow` owns the I/O sequence around that Session fact: it soft-checkpoints
  native input, performs one `leave-canvas` freeze, drains the authoritative source, submits only one Request,
  reconciles an unknown POST with read-only workspace authority, and fences
  timer/late callbacks by run identity and disposal generation. Clipboard
  success means exact readback only; it never implies an external Agent has run.
- Workbench presentation modules receive snapshots and callbacks only. They
  may not import application sessions, Bridge services or persistence
  adapters. File header, comment rail and project-files drawer live in
  `app/workbench/*-view.tsx` modules composed by `workbench.tsx`; they do not
  own Sessions or create a second Store.
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
  write for a registered v4 Project File. Canvas undo/redo submits complete HTML
  through that same path; the retired Bridge history journal and action cursor
  cannot become current authority. AI Version publication remains a separate
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
- Interactive-preview sessions, page-view context and the direct Edit
  author-runtime resource session are disposable. They do
  not participate in save, switch, submit or close drains, and cannot become a
  second copy of the source HTML. Desktop `pageroot-preview` sessions are owned
  by the preview protocol controller: Edit static sibling-asset sessions
  refresh in place for the same source path, and a full map evicts the
  least-recently-accessed idle session rather than the oldest insert. The Edit
  session has no bitmap/projection state: it serves disposable script-enabled
  frames while exact program identity remains current and never persists
  runtime descendants. Edit screenshot count must be 0.
- `HtmlCanvasEditor` owns native-edit checkpoint disposition. Soft checkpoints
  materialize complete Working HTML and autosave/recovery evidence while
  retaining the iframe, contenteditable, Selection, caret and focus.
  `leave-canvas` retires native editing without queuing a candidate or clearing
  a pending Runtime refresh; a later unlock may refresh only as recovery. History
  retains its separate bookmark and canonical-adoption path.
- The pure `decideEditRuntimeRefresh()` policy owns the projection decision for
  an accepted source operation: safe static text/style/reorder stays in place;
  Runtime text/style stays in place and coalesces one pending refresh; Runtime
  reorder/structure or any authored-program identity change prepares a
  candidate immediately. `HtmlCanvasEditor` stores only the latest pending
  source revision/reason/count for diagnostics. It is not save authority and
  never retains an intermediate iframe revision.
- An active last-known-good Edit Runtime remains visible while the latest
  candidate prepares. A failed dynamic Candidate leases one Script-disabled
  Candidate for the latest Working revision; its predecessor identity and
  source revision prevent an older failure from superseding newer work. During
  Native Edit or IME no Candidate may promote and no active frame may retire.
  If that deferred static request becomes stale while Native Edit advances the
  source, `HtmlCanvasEditor` replaces it with one request for the latest full
  Working HTML instead of treating the dropped request as a settled fallback.
  If the static Candidate succeeds it becomes the editable latest source; if it
  also fails, the last-known-good frame stays visible but read-only while reload
  and export remain available. Working HTML never rolls back.
- `RuntimeFrameCoordinator` uses exactly two fixed DOM slots. Candidate
  preparation never changes the visible active slot or Active identity.
  Hidden Candidate positioning restores the candidate iframe reading position
  without rewriting Editor Active refs or the shared outer scroller, and does
  not take the Native Edit commit lock. One
  commit then flips Active identity, slot roles and visibility together after
  a final identity/source/native-edit check. Failure before that commit
  discards only the Candidate. If `connectFrame` fails after the slot switch,
  the one-shot commit restores the previous Active identity and
  `data-render-verified` attribute; that short transactional rollback does not
  span the Candidate lifecycle and never rolls back Working HTML. The former
  active document is cleared on the
  next animation frame. A stale callback cannot act after its slot lease has
  been reused. Immediately before the commit, `HtmlCanvasEditor` re-captures
  the small Presentation Anchor from the still-visible Active frame so
  scrolling during preparation is the current user intent rather than an old
  restoration target. A selected element becomes the viewport anchor only when
  it is currently visible; otherwise the current reading region is kept.
  Comment layout is measured from the currently visible frame after commit,
  not migrated as a frozen proof that the new revision was already measured.
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
- Review facts are static and analysis-local. Stable-ID pairing may produce
  text, outermost presence, movement, authored attribute/inline-style and
  CSS/Script source facts under ADR 0066. A valid ID is sole identity; tag,
  parent and order are reported changes rather than replacement identities.
  Layout, wrapping, computed cascade impact and runtime drawing have no formal
  fact owner. Main, preload and authored frames expose no Review capture or
  screenshot capability.
- `CommentSession` is a renderer working copy, not durable Draft authority.
  Runtime state is likewise not a second copy of draft contents: it carries
  lifecycle state and a revisioned pointer to the draft repository.
- Local recovery records are an outbox/fallback, never an equal authority to an
  acknowledged Bridge revision.
- A persistence issue has one visible owner. Source persistence takes priority
  on the workspace banner; otherwise Draft persistence uses that same surface.
  The comment rail does not repeat either issue.
- Canvas never owns a parallel snapshot or DOM undo stack. A pending history
  operation is built from the accepted semantic result, its system-derived
  identity delta and exact SourcePatch byte proof. `SourceHistorySession` alone
  owns the acknowledged at-most-20-entry cursor for the current open HTML.
  Optional
  logical Selection and the operation's TargetRef transition may restore
  presentation identity after canonical adoption but cannot change bytes. A
  proven island-only result may update the disposable mounted projection in the
  same iframe; failed proof replaces that projection and never changes history
  authority.
- The desktop Edit menu owns no history. It routes focused native text controls
  to platform undo and all eligible Canvas intent to `SourceHistorySession`.
  Comment cards, attachments and project actions are outside both histories.
- Repository owns Hash/CAS, atomic complete-HTML publication, recovery and
  external-conflict detection. It recomputes semantic identity transitions and
  verifies kernel evidence; it does not infer product authorization from an
  exact patch kind. The tag/parent/order binding is a resealed integrity fact,
  not an identity owner.
- Telemetry is observational and best effort. It never owns product state,
  never receives content or paths, and never registers a drain obligation for
  edit, save, switch, submit, close or update installation.
- Provider Registry owns installed descriptors and selection dispatch. Agent Delivery
  Codec owns canonical Request selection, shipped-binding checks for new
  managed Requests, and historical `qoder-acp` read projection. Coordinator owns
  preflight tickets and sessions by selection only. Public session `driver` is a
  compatibility projection from that selection, not execution authority. Conversation Repository is
  the only v2 writer; v1 conversation records are never migrated in place.

## 文件与历史合同

外部原 HTML 与首次导入的隐藏 V1 快照保留原始字节且不含 Stable ID。可见 V1
Working Copy 可以因物化 Stable ID 而与它们逐字节不同。AI Candidate 在晋升前
完成 Stable ID 归一化；V2 及后续不可变 Version 保存完整的已采纳 Candidate
HTML，因此可以包含 Stable ID。V2+ 新 Working Copy 初始与对应 Version 快照逐字节
一致，之后本地编辑只更新 Working Copy，不改写已建立的 Version 快照。Stable ID
不回写外部原文件。唯一导出动作原样复制当前完整 Working Copy，包括 Stable ID，
不改变项目、Version、Registry、Recent 或当前打开文件。Undo/Redo 只属于当前打开
文档会话，不属于正式 Version 历史，也不跨切换、关闭或重启恢复。
