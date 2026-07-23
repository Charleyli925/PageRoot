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

- `app/` owns the visual workbench, source mapping and direct-edit transaction model.
- `desktop/` owns privileged filesystem access, windows, lifecycle, update checks and safe IPC exposure.
- `scripts/` owns the local Bridge, protocol finalization, scope validation and automated gates.
- `schemas/` defines persisted and exchanged records. `fixtures/` proves strict current and legacy behavior.
- Preview DOM is disposable. It is never a persistence source.
- `native-edit-policy` is the single policy source for session attributes, host modes, wrapper disposal and editing timeouts. `native-edit-runtime-preflight` owns iframe geometry/event capability inspection; `HtmlCanvasEditor` only coordinates its result with selection, SourcePatch and UI.
- `contenteditable="true"` is a measured, controlled fallback rather than a second editor engine. It shares the same Controller, FormatSkeleton and SourcePatch authority as `plaintext-only`, and cannot commit rich structure.

## Persistence

Direct edits form ordered revisions and are written through a single queue. Every write checks the expected source Hash, uses a same-directory temporary file and atomic replacement, then rereads the result. External modification causes a fail-closed conflict.

Initial and accepted AI results are immutable versions. Routine local edits do not create versions. A validated AI result is not activated until the user explicitly chooses it.

## Trust model

The renderer is sandboxed with context isolation and no Node integration. The preload exposes narrow validated IPC methods. The Bridge uses a per-process authentication token and only operates on managed project paths. AI output is untrusted until protocol, identity, Hash, path, scope and HTML checks succeed.
