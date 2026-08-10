# PR-03 owner contract migration

This settlement was audited from `eede0f2a59bbb42065572771e14a83b74657aac2`,
after PR2, PR4, PR5, and PR6 had merged. It records where every test removed
from the four cross-owner source-contract files is now proved. A row names an
architecture rule only when the invariant cannot be observed reliably without
adding a test-only production interface.

The active source-shape allowlist is intentionally narrow:

- `scripts/check-architecture.mjs` owns layer/import bans, retired operations,
  Session and drain ownership, the SourcePatch/SourceTransaction publication
  path, exact source freeze, native command priority, and lease retirement.
- `tests/architecture-boundaries.test.mjs` only executes that checker.
- packaging, dependency, security, and workflow source scans remain in their
  existing dedicated owners.
- `tests/rendered-html.test.mjs` executes the built server worker; it does not
  inspect Workbench or Canvas source.

## `native-command-queue-contract.test.mjs`

| Removed test | Current owner and oracle |
| --- | --- |
| pending and already-scheduled callbacks share one cancellable latest-wins slot | `native-dom-v2-editable-island.spec.mjs` queues the same header toggle twice during composition and observes exactly one replay; stale-session behavior remains covered by Native Electron source-fence flows. |
| system work cannot replace a queued or scheduled user command | `check-architecture.mjs` keeps the explicit user-over-system arbitration boundary before the controller queue. |
| empty text-fragment deletion replays its queued explicit command after retirement | `native-dom-structural-text.spec.mjs` observes deletion ending the fragment session without a blocked resume. |
| Workbench header drawers defer until the active composition is settled | `native-dom-v2-editable-island.spec.mjs` observes the repeated Project command remaining closed until `compositionend`, then opening once. |
| format replay rebinds the live element after its checkpoint | Browser toolbar formatting plus the Native Electron persistent undo/selection case observe the post-checkpoint live target and exact source bytes. |
| canonical island replacement retires the old lease before DOM removal | `check-architecture.mjs` owns the replacement ordering boundary; Native Electron also retains the retired host and observes its editing attributes removed. |
| source-authority fences defer preview reconcile and retire the editable DOM | Browser source-byte tests and Native Electron save/switch/close tests observe a retired edit host and a fresh authoritative frame. |
| V2 composition and source revision advance both use hard generation boundaries | Browser IME replay and Native Electron Apple Pinyin/relaunch cases observe final text, selection, bytes, and late-event rejection. |
| Workbench bridges deferred manual version opening success, failure, and discard distinctly | `version-session.test.mjs` owns atomic view transitions; the AI closed loop observes accepted, blocked, and retryable version activation outcomes. |
| a background project result never attaches to the current Canvas queue | `project-application-session.test.mjs` and `external-file-open-session.test.mjs` own project identity and FIFO retention; Electron project switching observes the visible source. |
| refresh and project-switch awaiters always settle when replayed or discarded | `project-application-session.test.mjs` and `external-file-open-session.test.mjs` observe deferred sequence, blocker clearance, resume, and completion. |
| external HTML activation fences before main-process acceptance and queues its result | `external-file-open-session.test.mjs` owns request serialization/supersession; Native Electron rapid switching observes persisted old and selected new sources. |
| close waits for external acceptance and accepted-project application owners | `drain-coordinator.test.mjs` owns pending/blocked/deadline outcomes; Native Electron rapid switch-and-close observes the last edit after relaunch. |
| accepted desktop results re-fence in renderer FIFO before publication | `project-application-session.test.mjs` observes FIFO predecessor retention and retry; Native Electron observes final published project identity. |
| deferred renderer owners re-observe every deferred transition | Both project-open Session tests assert a monotonic `deferredSequence` for repeated deferrals. |
| desktop project opens publish successful FIFO predecessors | `external-file-open-session.test.mjs` observes a successful active predecessor remaining publishable when its queued successor fails; `project-open-queue.test.mjs` owns arrival order. |

## `workbench-source-fence-contract.test.mjs`

| Removed test | Current owner and oracle |
| --- | --- |
| source-boundary freeze is fail closed and verifies the exact source snapshot | `check-architecture.mjs` owns the exact `freezeNow()`/source-byte boundary. |
| source-bound request never has an Edit runtime projection | `check-architecture.mjs` bans Edit runtime projection ownership and requires the persisted frozen source hash; the AI closed loop observes a pending candidate before acceptance. |
| autosave accepts only a byte-identical acknowledgement and fences protocol failures | `document-session.test.mjs`, Bridge autosave integration, and Native Electron exact-byte reopen own acknowledgement, divergence, and persistence outcomes. |
| an identity-mismatched recovery candidate freezes before becoming a conflict | `document-session.test.mjs` owns confirmed integrity/divergence outcomes; Bridge recovery and Native Electron failure paths own durable behavior. |
| beforeunload observes native composition drafts and unacknowledged revisions | `drain-coordinator.test.mjs` owns close obligations; Native Electron rapid switch/close and composition cases observe persistence after relaunch. |
| opening a committed version strictly freezes the current Canvas before adoption | `version-session.test.mjs` owns atomic transition/rollback; the AI closed loop observes accepted version activation and failure containment. |
| workspace source adoption requires an explicit hydration token or a live source fence | `project-session.test.mjs` owns epoch/source-generation invalidation; Native Electron project switching observes the selected source and bytes. |
| canvas verification fences stale generations and performs one bounded rebuild | `document-session.test.mjs` owns disposable Canvas generation; Native Electron save observes one fresh frame and an inert retired host. |
| safe-save projection requires the visible Canvas to acknowledge current source authority | `document-session.test.mjs` owns persisted authority; Native Electron waits for the visible persisted-revision indicator before checking disk bytes. |
| project registration treats supplied empty HTML as authoritative repair content | Workspace Bridge registration/first-edit tests own exact registered content and identity without rewriting source. |
| a disk acknowledgement cannot impersonate a Canvas render acknowledgement | `document-session.test.mjs` separates source authority from Canvas generation; Native Electron independently checks visible frame and disk bytes. |
| source undo keeps its in-place Canvas lease while publishing a complete tuple | `source-history-session.test.mjs`, Bridge undo/redo integration, and Native Electron source-undo selection tests own the tuple, history cursor, frame identity, and source bytes. |

## `ai-review-workspace.test.mjs`

| Removed test | Current owner and oracle |
| --- | --- |
| a ready AI result is review-first with exactly one direct-open alternative | The AI closed loop clicks both `审阅对比` and `直接打开` on real ready candidates. |
| formal review loads and verifies the immutable candidate without activating it | The AI closed loop proves the candidate remains pending through review and only activates after explicit acceptance. |
| formal review reuses the workbench header and exposes independent review controls | The AI closed loop observes split/before/after pages, filters, visibility, navigation, zoom, and header geometry. |
| returning before the AI edit explains the reversible path before leaving review | The AI closed loop observes the confirmation dialog, returns to the editable base, and preserves the candidate. |
| the review canvas preserves authored interactions inside untrusted-document isolation | `preview-protocol.test.mjs` owns session/path/network isolation; AI preload-navigation fallback proves authored navigation is not trusted. |
| desktop review serves its bootstrap outside the renderer CSP and keeps registrations stable | `preview-protocol.test.mjs` owns bootstrap consumption/session authorization; the Browser comment-binding suite executes the generated bootstrap in a real parsed DOM. |
| change discovery builds a complete outline and precise change markers | Review text, semantic alignment, projection facts, runtime visual, and comment-source-map Node owners plus the AI closed loop own the resulting facts and geometry. |
| numbered direct text flows recognize the supported list prefixes | The AI closed loop changes a numbered `<br>` flow and observes exactly one added line frame/mask group. |
| review controls keep page, filter, visibility, and navigation orthogonal | The AI closed loop independently operates every control and verifies resulting frame state and geometry. |
| comments and formal review share one explicit and indexed Tab registry | `page-view-context.test.mjs`, Browser presentation actions/comment tabs, and the AI closed loop own tab association and reveal behavior. |
| all-change review keeps text treatment precise and mirrors authored actions | `review-text-diff.test.mjs`, `review-projection-facts.test.mjs`, `review-scroll-sync.test.mjs`, and the AI closed loop own exact facts, masks, actions, and scrolling. |
| runtime chart review is captured by the owner and never trusted from the authored page | Runtime host/contract/capture owner Node tests and the AI closed loop own the before/after capture and fail-closed behavior. |
| the generated review bootstrap keeps comments but has no runtime-evidence protocol | `generated-review-bootstrap.mjs` executes the production bootstrap generator; the Browser comment-binding suite executes its output and `preview-protocol.test.mjs` owns the private transport. |
| review candidates are source-backed rather than script or comment-scope inference | Runtime host/contract/projection Node owners and the AI closed loop own source-host resolution, exact source SHA, and silent omission. |
| formal review projects frozen user comments with private source identities | `review-comment-source-map.test.mjs`, the Browser hostile-binding matrix, and the AI closed loop own frozen identities, private channel behavior, and marker geometry. |

## `rendered-html.test.mjs`

| Original test | Current owner and oracle |
| --- | --- |
| server-renders the autosave-first workbench entry points | Retained as the only test in `rendered-html.test.mjs`; it imports `dist/server/index.js`, calls `worker.fetch`, and checks public/retired surfaces. |
| application boundaries encode the v3 single-source lifecycle instead of save-created versions | Session Node owners, Bridge lifecycle integration, package retired-closure checks, and `check-architecture.mjs` own the former assertions. |
| history cards read only v3 immutable annotations and show audit details | `version-history-records.test.mjs`, compatibility decoders, and Bridge version-list integration own decoded immutable records. |
| canvas persistence has one SourcePatchEngine path and clean v3 TargetRefs | `check-architecture.mjs`, source-patch/index/TargetResolver Node tests, Browser exact-byte tests, and Native Electron persistence own this boundary. |
| handoff fails closed before locking when a comment target is unsafe | `scope-validator.test.mjs`, Bridge Request submission integration, and Native/AI Electron relink and handoff flows own the observable rejection and recovery path. |
