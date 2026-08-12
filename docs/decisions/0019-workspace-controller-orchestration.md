# ADR 0019: WorkspaceController orchestrates application workflows without owning facts

- Status: Accepted
- Date: 2026-08-11
- Supersedes: none
- Extends: ADR 0011

## Context

ADR 0011 moved mutable renderer facts into explicit Sessions, but
`app/workbench.tsx` still owned several cross-Session workflows. Project
registration was the first such workflow: a React callback kept its
single-flight Promise, called the Bridge and sequenced `ProjectSession`,
`DocumentSession`, `VersionSession`, `CommentSession`, `DraftSession` and
`SourceHistorySession` publication.

That arrangement left the fact owners intact but made the identity fence,
unknown/rejected outcome and late-result behavior depend on a large React
component. Introducing a second global store or copying Session facts into a
Controller would create duplicate authority and violate ADR 0011.

## Decision

Introduce `WorkspaceController` as the one public Application facade for
Workbench workflows. It is not a global store and never constructs a competing
set of Sessions.

At final composition:

- `createRuntimeWorkspaceController()` is the sole production composition
  entrypoint. It creates the one typed Bridge client, shared `RunSession` and
  remaining fact-owning Sessions, then constructs the Controller and its
  workflows. The injected Controller constructor remains a Node-test seam.
- The Controller is the sole Application aggregate observer for Project,
  Document, Comment, Run and Version Sessions. Its fixed frozen snapshot and
  event stream are the only business-state input to Workbench; derived
  Document write/flush flags reveal neither write contents nor Promises.
- `ensureRegistered()` owns registration operation identity, single-flight,
  response validation, stale-result fencing and synchronous cross-Session
  publication. It returns an explicit `CommandOutcome`.
- Project, Document, Comment, Draft, Version and SourceHistory Sessions remain
  the sole mutable-fact owners. The Controller owns only workflow-local
  operation state and a narrow registration snapshot/event stream.
- Workbench maps Controller snapshots, events and outcomes to presentation
  state, supplies only narrow host adapters, and dispatches Controller commands.
  It imports neither Bridge nor business Session code. The Controller does not
  import React, Workbench models, components or desktop code, or operate Drawer,
  Toast or focus state.
- Existing Workbench pure codecs are injected through
  `workspace-controller-codecs.js` until a later PR can relocate them without a
  reverse dependency. They are not reimplemented as a competing decoder.

The migration was intentionally staged. PR-1 began with Workbench-provided
Sessions and a checked 28-call Bridge allowance. PR-7 removes that temporary
composition and allowance: direct Workbench Bridge calls, Session refs and
generic command escape are forbidden by the architecture gate.

## Consequences

- A real cross-Session command is Node-testable with fake Bridge and ports.
- A late registration response cannot publish into a later project epoch.
- Registration continues to be lazy: opening an unregistered HTML alone does
  not create a project record.
- Canonical source adoption, Draft authority rebind and comment-target rebind
  retain their existing Hash and current-identity guards.
- Later workflows may join the same facade only one at a time; they must not
  add a second Controller, temporary dual-write or persistent schema change.
- A Controller disposal disconnects aggregate Session observers before a late
  callback can publish; Workbench cannot retain a parallel business snapshot.

## Rejected alternatives

### A Redux, Zustand or application-wide store

Rejected because current Sessions already own the mutable facts. A global store
would mirror identity, source, Draft and Version state instead of clarifying a
workflow boundary.

### Keep every workflow in Workbench callbacks

Rejected because React dependency lifecycle is not the appropriate owner for
single-flight, stale fencing and Bridge outcome reconciliation.

### Move all Workbench orchestration in one rewrite

Rejected because switch, autosave, comments, Request and Version transitions
have distinct drain and recovery contracts. Each requires an independently
testable migration PR.
