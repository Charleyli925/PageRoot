# ADR 0049: Desktop loads the real renderer shell before Bridge readiness

- Status: Accepted
- Date: 2026-08-28
- Scope: Electron cold start, renderer connection handoff and startup timing

## Context

The packaged baseline created `BrowserWindow` while the Bridge utility process
started, but still waited for the Bridge port before the first renderer
`loadFile`. A measured launch reached BrowserWindow creation at about 99 ms,
Bridge readiness at about 232 ms and renderer first paint at about 339 ms from
process start. The application window therefore inherited utility-process
readiness even though PageRoot chrome and the welcome workspace do not need a
Bridge endpoint to paint.

Usage telemetry also completed before window creation. It is diagnostic and
must not own first-screen availability.

## Decision

Desktop startup now has observable, non-blocking phases:

1. Electron becomes ready and constructs the real PageRoot `BrowserWindow`.
2. IPC and navigation policy are installed before renderer code can call them.
3. The local renderer shell begins one `loadFile` navigation with application
   identity and content-free startup timing, but no Bridge credential.
4. The single Bridge process starts alongside that navigation.
5. Preload receives the validated port and token over one narrow main-to-renderer
   channel and publishes an immutable connection snapshot.
6. Workbench creates its one `WorkspaceController` only after that connection is
   present; project restoration then follows the existing ProjectWorkflow.
7. Usage telemetry starts after `ready-to-show` and cannot reject application
   startup.

The renderer is not reloaded when the Bridge becomes ready. Shell state, focus,
paint and queued external-open identity therefore survive the handoff.

## Authority constraints

- The preload channel transports only port, auth token, application version and
  content-free timing marks.
- No renderer code guesses a Bridge port or creates a second controller while a
  desktop connection is pending.
- ProjectWorkflow remains the only project operation executor and owns commit,
  rollback, Session facts and final snapshots.
- Startup external-open adoption remains mailbox-based and is replayable through
  the existing opaque request identity.
- A Bridge startup failure remains a fatal workspace startup error; first paint
  does not convert an unavailable authority into a usable editor.

## Required proof

- shell navigation begins before `bridge-start` and completes before
  `bridge-await-finished`;
- exactly one normal startup navigation occurs, with no Bridge-ready reload;
- telemetry starts no earlier than `window-ready-to-show`;
- packaged startup, external HTML import, project restoration and tab switching
  still pass;
- packaged timing separately reports BrowserWindow creation, shell load/paint,
  Bridge publication, first useful document and full interactivity.
