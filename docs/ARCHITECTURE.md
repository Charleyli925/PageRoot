# Architecture

PageRoot is an Electron application with a React renderer and a local Bridge process.

```text
User HTML bytes
  -> SourceIndex / TargetResolver
  -> isolated authored-DOM preview
  -> native Selection and editing controller
  -> minimal SourcePatch transaction
  -> serialized atomic file writer

Comments + frozen input
  -> Change Request / Attempt
  -> clipboard-only AI handoff
  -> completion + scope validation
  -> immutable Version
  -> explicit user-controlled activation
```

## Boundaries

- `docs/ARCHITECTURE_CONTRACT.md` is the normative dependency, state-ownership,
  asynchronous outcome and drain contract. `docs/STATE_OWNERSHIP.md` names the
  sole owner of each mutable fact.
- `app/` owns the visual workbench, source mapping and direct-edit transaction model.
- `desktop/` owns privileged filesystem access, windows, lifecycle, update checks and safe IPC exposure.
- `scripts/` owns the local Bridge, protocol finalization, scope validation and automated gates.
- `schemas/` defines persisted and exchanged records. `fixtures/` proves strict current and legacy behavior.
- Preview DOM is disposable. It is never a persistence source.
- Pure-browser preview is a supported read-only route. It may run authored page interactions inside the sandbox, but it exposes no PageRoot edit, comment, attachment, project-write, or AI-submit authority.
- `native-edit-policy` is the single policy source for session attributes, host modes, wrapper disposal and editing timeouts. `native-edit-runtime-preflight` owns iframe geometry/event capability inspection; `HtmlCanvasEditor` only coordinates its result with selection, SourcePatch and UI.
- `contenteditable="true"` is a measured, controlled fallback rather than a second editor engine. It shares the same Controller, FormatSkeleton and SourcePatch authority as `plaintext-only`, and cannot commit rich structure.

## Module map

`app/workbench.tsx` is the composition root for the review workspace. It
renders owner snapshots and dispatches user intent; it does not own persistence
protocols.

| Boundary | Owner |
| --- | --- |
| Bridge routes, timeouts and structured outcomes | `app/application/bridge-client.js` |
| Renderer draft revision, pending operations and reconciliation | `app/application/draft-session.js` |
| Pure comment/edit-event/tombstone transition rules | `shared/draft-aggregate.mjs` |
| Bridge-side draft command validation and CAS | `scripts/draft-service.mjs` |
| Close, switch, submit and history obligations | `app/application/drain-coordinator.js` |
| Late query rejection and monotonic draft reads | `app/application/project-query-fence.js` |
| Crash-only browser recovery | `app/application/recovery-store.js` |
| Renderer, project-picker and attachment capabilities | `app/application/runtime-capabilities.js` |
| Preview sanitization and verified frame injection | `app/components/html-preview-sandbox.js` |
| Run lifecycle decoding and transition policy | `app/domain/run-lifecycle.js` |

The source-fidelity path remains a protected core: `SourceIndex`,
`TargetResolver`, `FormatSkeleton`, `SourcePatchEngine`,
`NativeEditingController` and the atomic source writer may be split only around
a proven invariant, not to satisfy a line-count target.

## Persistence

Direct edits form ordered revisions and are written through a single queue. Every write checks the expected source Hash, uses a same-directory temporary file and atomic replacement, then rereads the result. External modification causes a fail-closed conflict.

When no desktop project can be restored, the main process provisions the built-in welcome content once as a regular HTML source beside the selected workspace and immediately registers its initial V1 through the authenticated Bridge. Existing welcome bytes are never replaced on startup. From that point onward it uses the same source, comment, Request, handoff and Version boundaries as any user-opened HTML.

Initial and accepted AI results are immutable versions. Routine local edits do not create versions. A validated AI result is not activated until the user explicitly chooses it.

`PROJECT.md` uses debounced autosave and is flushed before project switch or close. One recoverable unsaved comment composer is allowed at a time. Attachment uploads, rule saves and ordinary source writes are finished or surfaced in their owning panel before navigation proceeds.

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

## Trust model

The renderer is sandboxed with context isolation and no Node integration. The preload exposes narrow validated IPC methods. The Bridge uses a per-process authentication token and only operates on managed project paths. AI output is untrusted until protocol, identity, Hash, path and HTML checks succeed. Scope validation remains strict evidence: managed metadata, scripts and unresolved targets hard-stop; ordinary out-of-target content/style findings are persisted as `observed` audit records and do not create a separate user-waiver state.

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
