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
| Navigation and tabs | `WorkbenchTabsSession`, `WorkbenchNavigationSession`, `BrowserDocumentSession` | `WorkbenchNavigationWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.navigation`), `workbench-navigation-container.tsx` |
| Document save | `DocumentSession` | `DocumentWorkflow` | `document-workflow.js`, `document/save-plan.js`, `verified-project-context.js` |
| Source element identity migration | `ProjectFileRepository` Working Copy state | `ProjectFileRepository` serialized migration transaction | `bridge/project-file-repository.mjs`, `bridge/project-file-repository/working-copy.mjs` |
| Semantic source editing | immutable semantic document state, stable-ID operation intent and lineage | pure `SemanticOperationKernel`; SourcePatch is its internal materializer; Canvas owns only current-open invocation | `app/lib/semantic-operation-kernel.js`, `app/lib/source-structure-edit.js`, `app/lib/source-patch-engine.js`, `app/components/html-canvas-structure-commands.ts`, `schemas/semantic-operation.v1.schema.json` |
| Comments | `CommentSession`; persistent element identity resolves through `TargetResolver` | `CommentWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.comments`), `comment-workflow.js`, `comment/commit-plan.js`, `target-resolver.js`, `comment-text-locator.js`, `comment-rail-container.tsx`, `comment-canvas-port.js`, `comment-rail-view.tsx` |
| Attachments | Draft attachment repository; Request freeze owns independent byte copies and recovery staging | `CommentWorkflow` before send, `ProjectFileRepository` during Request preparation/publication | `comment-workflow.js` upload/read/delete, `bridge/project-file-repository/request-attachments.mjs`, `request-draft.mjs` |
| Run and AI request | `RunSession` | `RunWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.runs`), `run-workflow.js`, `run/text-locator-validation.js`, `run/submit-plan.js`, `run-conversation-outlet.tsx` |
| Review and Candidate | Repository owns immutable Candidate HTML, runtime seal, source-identity report and bounded Stable-ID impact assessment with descendant scope closure; `VersionSession` owns only the renderer projection | Repository validates/normalizes full-HTML Candidate; `VersionWorkflow` prepares Review and accepts; Review analysis presents bounded warning-only impact context | `bridge/candidate-assessment.mjs`, `bridge/candidate-assessment-decoder.mjs`, `bridge/project-file-repository/candidate-identity.mjs`, `bridge/project-file-repository/version-candidate.mjs`, `app/domain/run-lifecycle.js`, `app/application/version-workflow.js`, `app/workbench/ReviewAnalysisPrewarm.tsx`, `app/workbench/review-document.ts`, `app/workbench/AiReviewWorkspace.tsx` |
| Version and history | `VersionSession` | `VersionWorkflow` | `version-workflow.js`, `version/review-plan.js` |
| Project context and version navigation | `ProjectSession`, `ProjectRulesSession`, `VersionSession` | `ProjectWorkflow`, `ProjectRulesWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.projectCatalog`), `workbench-sidebar-container.tsx`, `WorkbenchChrome.tsx`, `project-rules-editor.tsx` |
| Canvas edit runtime | `EditAuthorRuntimeSession` owns the scoped resource grant and one compatible-to-exact recovery; Main's library store owns only verified immutable CDN bytes; source HTML remains authoritative | Canvas rebuild/rerun in `HtmlCanvasEditor`; `DocumentWorkflow` persists complete HTML | `edit-runtime-contract.js`, `HtmlCanvasEditor.tsx`, `desktop/edit-runtime-protocol.mjs`, `desktop/edit-runtime-library-store.mjs`, `desktop/edit-runtime-bootstrap.mjs` |
| Preview | disposable preview session | Desktop preview protocol | `desktop/` preview owner, `HtmlInteractionPreview` |
| Project open / switch / close | `ProjectSession` | `ProjectWorkflow` | `project-workflow.js`, `project/open-intent.js`, `project/switch-plan.js`, `project/close-plan.js`, `project/source-locator-plan.js` |
| External open | Main mailbox + `ExternalFileOpenSession` + `ProjectApplicationSession` | `ProjectWorkflow` | `desktop/prepared-html-open.mjs`, Workbench auto-confirm of `openConfirmation` |
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
| Comments UI or composer | this map, `workspace-controller-capabilities.d.ts`, `CommentWorkflow`, `CommentSession`, `comment-rail-container.tsx`, `comment-canvas-port.js`, `comment-rail-contract.ts`, focused comment tests |
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

## Comment render boundary

```text
CommentSession + CommentWorkflow
  -> WorkspaceController.comments { getSnapshot, subscribe, commands }
    -> CommentRailContainer
      -> stable CommentRailView model/actions

HtmlCanvasEditor selection + stable element TargetRef + source-tagged geometry
  -> commentCanvasPort
    -> CommentRailContainer
```

`CommentSession` keeps immutable collection identities when only draft text
changes. `CommentRailContainer` owns capability-local subscriptions, disclosure,
delete confirmation, composer/edit refs, the attachment picker, card measurement,
virtualization, rail scrolling and reveal/focus timing. `commentCanvasPort`
stabilizes disposable cross-region presentation: Canvas selection, layout authority,
target geometry, document height, composer/edit/focus disclosure and relink/picker
intents; it never owns comment facts. Workbench's aggregate
subscription may suppress composer-text and edit-text-only revisions; saved
comments, attachment structure, persistence errors and every non-comment
capability still invalidate the composition root.
Persistent `elementId`, refreshed expected source Hash and optional text locator are Comment/Draft facts;
`TargetResolver` maps the ID to current source and never consults disposable
geometry or Runtime DOM. `commentCanvasPort` carries only the resulting
selection and measurements.

## Project render boundary

```text
ProjectSession + ProjectWorkflow + ProjectRulesWorkflow + VersionSession
  -> WorkspaceController.projectCatalog { getSnapshot, subscribe, commands }
    -> WorkbenchGlobalSidebarContainer / StartPage catalog containers
      -> current-project context and version-tree navigation
```

The global sidebar owns the visible project context, safe project switching, the
single mixed project list and the fixed settings entry. The current project
contains the “长期规则” row; it is not part of the version timeline and opens
the singleton `project-rules` tab in the workbench without a version date.
Project rows are deduplicated by `projectId` and ordered by the authoritative
content-update timestamp; opening a project does not update that order.
`ProjectRulesSession` and `ProjectRulesWorkflow` remain fact and lifecycle
owners for persistence, autosave and close/switch safety; the editor is only a
projection over that workflow. The document canvas remains mounted while the
rules tab is visible, so switching presentation does not rebuild the HTML
iframe. The repository may continue to persist the rules in its internal
`PROJECT.md` file without exposing that filename in the UI.

## Run and navigation render boundaries

```text
RunSession + RunWorkflow
  -> WorkspaceController.runs { getSnapshot, subscribe, commands }
    -> RunConversationOutlet
      -> AiConversationSidebar

WorkbenchTabsSession + WorkbenchNavigationWorkflow
  -> WorkspaceController.navigation { getSnapshot, subscribe, commands }
    -> WorkbenchTabBarContainer
```

Agent narration, truncation and narration timestamps are high-frequency
presentation facts. The Run outlet subscribes them directly; Workbench wakes
only when run identity, lifecycle, handoff phase or error structure changes.
The retired Handoff drawer has no parallel lifecycle or recovery UI: progress,
candidate decisions, conflict resolution and terminal failure recovery all live
in the conversation. The Tabs container owns keyboard selection/close/new and
focus restoration, while Workbench retains only the active-outlet composition
and the host callback that snapshots page presentation before a switch.

## Capability-context for `gate:plan`

`npm run gate:plan` also prints a capability reading set from
`scripts/capability-context.json`. That map is separate from
`tests/test-impact-map.json`. Impact-map owners choose tests; capability-context
chooses what to read: `entryInterfaces`, `owners`, `implementationFiles`,
`focusedTests`, `requiredDocs` and `estimatedContextBytes`.
