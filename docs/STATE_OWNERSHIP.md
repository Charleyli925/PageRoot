# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action | Project session | active-file record only | initial view and registration command |
| Explicit source filename transition, pending operation and active/recent path rebase | Desktop source-rename transaction | active-file `pendingRename` / `lastRename`, then filesystem path | project session, Bridge relink, views |
| Registered project/document/source identity, readable storage locator and session generation | Project session | project registry and `project.json` | views, all durable sessions |
| Current source bytes, Hash, edit revision and pending write | Document session | source HTML, runtime autosave record and recovery log | Canvas, drain coordinator |
| Canvas source-history context, pending Patch operations, cursor and applied action IDs | Renderer `SourceHistorySession` for pending intent; Bridge source-history service for acknowledged authority | `history/source-operations.json`, committed with the source through the runtime `pendingWrite` outbox | Canvas, Document session, desktop Edit intent router |
| Focused comment/rules/filename text input undo history and active composition | The native text control and Electron/Chromium editing engine; project-rules session owns autosave eligibility and explicit restore fencing | in-memory control-local history only | desktop Edit intent router, project-rules drain |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Comments, edit events, tombstones and operation acknowledgements | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | draft session, Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| AI Request/Attempt/Version transition | Run lifecycle | runtime state, immutable Request/Attempt/Version records | process panel, project list |
| `PROJECT.md` content and save status | Project-rules session | managed `PROJECT.md` | project panel, Request freeze |
| Close/switch/submit/history readiness and desktop close lifecycle | Drain coordinator plus one renderer close lifecycle | composed owner snapshots and request identity; no copied dirty booleans | Electron close handshake, browser fallback and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client | no durable state | application sessions |
| Undelivered Bridge-unavailable recovery issue and renderer-listener readiness | Main-process recovery mailbox | in-memory for the current app process | preload handshake, native fallback and Workbench banner |
| Renderer edit, project-picker, attachment-persistence and close-coordination capabilities | Runtime capability resolver | immutable preload manifest; fail-closed browser default | Workbench composition root |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, About PageRoot, Workbench update notice, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 editable-island lease, draft DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | Comment-rail layout session | in-memory and cleared on project transition | comment rail only |

Rules:

- A consumer never writes another owner's fields directly.
- An opened source locator is not a registered project context. Empty
  `projectId` or `documentId` values may not be used as placeholder authority.
- The first durable action atomically registers the project identity and binds
  the Draft session to the returned authoritative draft before local aggregate
  state can be acknowledged.
- Cross-owner operations are coordinated explicitly; they do not synchronize
  through incidental React effects.
- A filename transition never owns HTML bytes or Document identity. It may
  advance the source locator only after the expected source Hash is verified;
  the project session then adopts the Bridge-confirmed path for the same
  `projectId` and `documentId`.
- Runtime features are declared independently. The presence of a project-picker
  API never implies source-edit or attachment-persistence authority.
- Runtime state is not a second copy of draft contents. It carries lifecycle
  state and a revisioned pointer to the draft repository.
- Local recovery records are an outbox/fallback, never an equal authority to an
  acknowledged Bridge revision.
- Canvas never owns a parallel snapshot or DOM undo stack. A pending history
  operation is built only from the accepted SourcePatch result; after
  acknowledgement, the Bridge journal cursor is authoritative. Optional
  logical Selection and the operation's TargetRef transition may restore
  presentation identity after canonical adoption but cannot change bytes.
- The desktop Edit menu owns no history. It routes focused native text controls
  to platform undo and all eligible Canvas intent to `SourceHistorySession`.
  Comment cards, attachments and project actions are outside both histories.
- Telemetry is observational and best effort. It never owns product state,
  never receives content or paths, and never registers a drain obligation for
  edit, save, switch, submit, close or update installation.
