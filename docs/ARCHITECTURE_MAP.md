# Architecture map

Start here. This is the default architecture reading set: capability domains,
owners and entry files. Full owner tables stay in `STATE_OWNERSHIP.md`.
Dependency direction and drain contracts stay in `ARCHITECTURE_CONTRACT.md`.
Defense class for a user-visible block is in `GUARD_LEDGER.md` and
`ENGINEERING_STANDARDS.md`.

There is one runtime `WorkspaceController`. Narrow command interfaces are
facets of that Controller, not extra controllers. `Verified*Context` objects
live only inside one operation.

## Layers

```text
React views
  -> WorkspaceController (workflow facade)
    -> Sessions (fact owners) + Workflows (operation owners)
      -> domain transitions
        -> typed Bridge client
```

Workbench renders a snapshot and dispatches product intent. It does not import
the Bridge client, construct Sessions, or own debounce, polling, or drain.

## Capability domains

| Domain | Fact owner | Operation owner | Entry |
| --- | --- | --- | --- |
| Navigation and tabs | `WorkbenchTabsSession`, `WorkbenchNavigationSession`, `BrowserDocumentSession` | `WorkbenchNavigationWorkflow` | `app/application/workbench-navigation-workflow.js`, `app/workbench.tsx` tab strip |
| Document save | `DocumentSession` | `DocumentWorkflow` | `document-workflow.js`, `document/save-plan.js`, `verified-project-context.js` |
| Comments | `CommentSession` | `CommentWorkflow` | `comment-workflow.js`, `comment/commit-plan.js`, `comment-rail-contract.ts`, `comment-rail-view.tsx` |
| Attachments | Draft attachment repository | `CommentWorkflow` | `comment-workflow.js` upload/read/delete |
| Run and AI request | `RunSession` | `RunWorkflow` | `run-workflow.js`, `run/submit-plan.js` |
| Review and Candidate | `VersionSession` (projection) | `VersionWorkflow` prepare/accept | `app/workbench/AiReviewWorkspace.tsx` |
| Version and history | `VersionSession` | `VersionWorkflow` | `version-workflow.js`, `version/review-plan.js` |
| Project rules | `ProjectRulesSession` | `ProjectRulesWorkflow` | `app/application/project-rules-workflow.js` |
| Canvas edit runtime | `EditAuthorRuntimeSession` | Canvas / `DocumentWorkflow` | `HtmlCanvasEditor.tsx`, `html-canvas-selection-chrome-contract.ts` |
| Preview | disposable preview session | Desktop preview protocol | `desktop/` preview owner, `HtmlInteractionPreview` |
| Project open / switch / close | `ProjectSession` | `ProjectWorkflow` | `project-workflow.js`, `project/open-intent.js`, `project/switch-plan.js`, `project/close-plan.js`, `project/source-locator-plan.js` |
| External open | Main mailbox + `ExternalFileOpenSession` + `ProjectApplicationSession` | `ProjectWorkflow` | `desktop/prepared-html-open.mjs`, `app/workbench/ExternalHtmlOpenDialog.tsx` |
| Close and drain | unique `DrainCoordinator` | `ProjectWorkflow` close op | `app/application/project-workflow.js` |
| Packaging and release | exact Git Tree | release workflows | `docs/RELEASING.md` |
| Conversation handoff | `ConversationRepository` / `ConversationSession` | `ConversationWorkflow` | `app/workbench/AiConversationSidebar.tsx` |

Project identity, hydration, switch, rename and managed-source handoff stay
with `ProjectSession` + `ProjectWorkflow`. Open/switch/close now have
`ready | wait | reject` plans; the executor remains the unique
`ProjectWorkflow`. Do not split that workflow for line budget, and do not
add a second Controller.

## Default reading set by task

| Task | Read first |
| --- | --- |
| Comments UI or composer | this map, `CommentWorkflow`, `CommentSession`, `comment-rail-contract.ts`, `comment-rail-view.tsx`, comment tests |
| Save / autosave / conflict | this map, `DocumentWorkflow`, `DocumentSession`, P1-B CAS in `ProjectFileRepository` |
| Open / switch / tabs / close | this map, `WorkbenchNavigationWorkflow`, `ProjectWorkflow`, `project/*.js` plans, `INTERACTION_FLOW.md` |
| AI submit / cancel / review | this map, `RunWorkflow`, `VersionWorkflow`, `CHANGE_REQUEST_PROTOCOL.md` |
| Cross-owner or persistence | `STATE_OWNERSHIP.md` and `ARCHITECTURE_CONTRACT.md` |

## Architecture gate

The gate must enforce responsibility, not private field names:

- Views cannot import or call the Bridge.
- Application cannot import React, Workbench presentation, components or desktop.
- Domain is pure.
- Sessions are constructed only by `createRuntimeWorkspaceController()`.
- Repository internals are not a second writer.
- Retired modules stay deleted.

Do not add checks for `#privateField`, private method names, or “this call
text must appear in this file”. Public outcome tests own those invariants.
Line-count ceilings are observational; they are not a reason to split files.

## Capability-context for `gate:plan`

`npm run gate:plan` also prints a capability reading set from
`scripts/capability-context.json`. That map is separate from
`tests/test-impact-map.json`. Impact-map owners choose tests; capability-context
chooses what to read: `entryInterfaces`, `owners`, `implementationFiles`,
`focusedTests`, `requiredDocs` and `estimatedContextBytes`.

