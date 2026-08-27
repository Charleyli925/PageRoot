# ADR 0047: Project open publishes Core before fenced Supplemental projections

- Status: Accepted
- Date: 2026-08-28
- Scope: registered project hydration, ProjectWorkflow ownership and workspace transport

## Context

ProjectWorkflow already publishes the trusted Desktop open result before its
background hydration. The hydration response nevertheless remained one flat
payload and, when the initial projection differed, the renderer issued a second
`/source` request even though `/workspace` had read and hashed the same exact
HTML bytes.

The packaged real-HTML benchmark shows that Repository queue topology is not
the current bottleneck: the observed workspace median is about 20 ms, queue
wait is normally below 1 ms, and the maximum workspace sample is below 28 ms.
Splitting the Repository queue or repeating the project load for a second HTTP
request would therefore add race surface without a measured benefit.

## Decision

The Bridge may return workspace envelope version 1 under one renderer-created
operation identity:

- **Core** contains the managed source bytes and Hash, Project/Document/OpenTarget
  identity, Working Copy safety state, edit/draft conflict obligations and the
  active locked run needed before editing can be safe;
- **Supplemental** contains version rows, source-history projection and display
  metadata such as the project records path.

Both sections carry the same `operationId` and `snapshotRevision`. A mismatch is
rejected before either section is used. Legacy injected Bridge ports may still
return the flat shape, but production always requests the split envelope.

ProjectWorkflow remains the only executor and rollback owner. It creates the
operation ID and stale fence, asks a stateless open procedure to acquire and
validate the envelope, commits Core Session facts, verifies required Canvas
authority, and then ends the blocking hydration phase. Supplemental projection
is applied after a microtask yield only if the original query, epoch, source and
revision remain current. Supplemental failure is recorded internally and never
rolls back already committed Core HTML.

The Core HTML and its workspace Hash replace the redundant `/source` read. The
renderer hashes those returned bytes before adopting them, so removing the
second request does not remove a content-integrity gate.

The Repository continues to build one invariant-consistent workspace under its
existing serial owner. Queue topology remains unchanged because measurements do
not meet the threshold for a concurrency redesign.

## Ownership constraints

`project/open-operation-procedure.js` is internal and stateless. It must not:

- own or update any Session;
- create operation IDs;
- subscribe to events;
- publish snapshots;
- commit or roll back ProjectWorkflow;
- maintain mutable caches;
- become a second public open entry point.

All IO and stale checks are injected for one invocation. Final commit, rollback,
hydration state and events remain in ProjectWorkflow.

## Required proof

- Production `/workspace` returns Core and Supplemental with an identical
  operation identity and snapshot revision.
- A mismatched Supplemental response is rejected before publication.
- A Core source adoption verifies the returned bytes against the workspace Hash
  and performs no second `/source` request.
- Core readiness ends the interaction-blocking hydration phase; Supplemental
  state is stale-fenced and cannot roll back Core on failure.
- Project switch, close, autosave conflict, draft recovery, Version and Canvas
  authority tests remain green.
