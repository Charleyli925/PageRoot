# ADR 0027: Prepared open intent, Canvas-verified finalize, and out-of-root trash

- Status: Accepted
- Date: 2026-08-16
- Extends: ADR 0022, ADR 0026
- Product: [IMPORT_CONFIRMATION_PRD.md](../IMPORT_CONFIRMATION_PRD.md) v1.2

## Context

ADR 0026 made a canonical external path a long-lived lookup to one `projectId`.
The remaining product gap was the open path itself: Desktop still activated the
chosen file before the user agreed, the renderer had no confirmation owner, and
optional deletion of the original lived nowhere that could wait for a verified
Canvas.

Renderer-supplied paths cannot be trusted. The Edit iframe is same-origin with
the application renderer (ADR 0025), so confirmation controls must also reject
untrusted programmatic events. The Repository must not gain delete authority
outside the configured projects root.

## Decision

1. Every desktop HTML open classifies first through the authenticated
   read-only `/project/open-classification` route. Class A activates the
   managed project immediately. Classes B and C write a process-memory
   Prepared Intent and return a public descriptor with only `requestId` and
   display facts. They do not call `importExternal`, write Registry/Recent/
   active, publish HTML to `DocumentSession`, or trash the original.
2. `desktop/prepared-html-open.mjs` owns the intent state machine
   (`prepared` → `committing` → `committed` → `finalized`, or `canceled`).
   A newer unanswered request cancels the previous prepared intent. A request
   that has entered commit cannot be replaced until it is committed, rolled
   back, or marked attention. Commit, finalize and rollback are idempotent for
   the same `requestId` and action.
3. Renderer confirmation is a `ProjectWorkflow` prompt snapshot. The only
   accepted actions are `import-new` (C) and `continue-current` (B).
   `view-initial` is rejected in the codec before `ProjectWorkflow` is
   required. `continue-current` opens the bound project's current active Working
   Copy, not the latest official Version and not the original file.
4. After the user confirms, `ProjectWorkflow` takes the existing switch fence
   only when a project is already bound (`epoch > 0`). Cold-start last-active
   B/C confirmation is epoch 0: there is no edit Canvas to drain, matching
   `#applyAcceptedProject`. It then commits the prepared intent inside
   `ProjectOpenQueue`, publishes the managed project synchronously, waits for
   `DocumentSession.canvasAuthority` on that generation and source Hash, then
   hydrates so the workbench can leave the `hydrating` phase that `#applyProject`
   starts, then waits for `DocumentSession.canvasAuthority`. First import keeps
   the original directory as this project's Preview and Edit resource root
   across continue-current, restart, working-copy switches and optional
   original-HTML trash; HTML bytes are copied, sibling assets are not. The
   renderer never receives that original path. `shell.trashItem` runs only from
   `finalizePreparedHtmlOpen` after a real C-class import, a checked delete
   intent, a verified Canvas, and Main revalidation that the original still
   hashes the same, is a regular non-symlink file, and lies outside the
   projects root. Trash failure does not roll back the published project.
   The Repository never receives out-of-root delete authority.
   Querying `getActiveProject` while a prepared intent already exists for that
   canonical path reuses the same `requestId`; it does not cancel and replace it.
5. Canvas verification failure after commit rolls back the Desktop active
   project when it still matches the receipt, restores previous renderer
   authority, keeps the confirmation for retry, and never trashes. Close
   treats an unanswered confirmation as cancel.

## Consequences

- Finder, Dock, Open With, the title “+”, the file menu and cold-start handoff
  share one classifier and the same two confirmation dialogs.
- The renderer never learns the original absolute path, source key, or pending
  trash path. It may submit only the current opaque `requestId`.
- `ProjectOpenQueue` is the sole active/recent mutation FIFO. The mailbox
  `activationTail` is not a second mutation owner after classify-then-prepare.
- Delete consent is per request and in-memory only. A crash before finalize
  leaves the original in place; the next open of that path is class B.

## Rejected alternatives

### Activate the original, then confirm in the renderer

Rejected because confirmation-before-mutation is the product invariant, and
activating the original writes active/recent and can publish the wrong HTML.

### Let the renderer pass the path to trash

Rejected because a compromised renderer could delete an arbitrary file.

### Unlink the original from the Repository

Rejected because project-root write authority must not extend to the user's
Downloads, Desktop or other folders. macOS Trash is the only allowed disposal.
