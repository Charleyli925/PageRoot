# ADR 0018: Autosave and source history share one SourceTransaction kernel

- Status: Accepted
- Date: 2026-08-10

## Context

Autosave and persistent Canvas undo/redo already produced identical durable
effects: a complete HTML candidate, an exact source-history candidate, a
`pendingWrite` recovery record, same-directory atomic source replacement,
project/runtime settlement and an exactly-once audit record. They implemented
that sequence independently in Bridge route adapters. A later recovery or
atomic-write correction would therefore need to change two near-identical
orchestrations, risking a split crash boundary.

The product contract still requires distinct route semantics. Autosave accepts
a complete HTML request and can retain a conflict candidate; history actions
validate an action ID, revision and cursor, and can replay an acknowledged
action. AI Version publication is a different immutable protocol.

## Decision

- `bridge/source-transaction-service.mjs` is the sole Bridge owner of the
  current-source commit/recovery kernel.
- Both routes retain only their decode, input validation, action/revision
  policy and response encoding, then supply an already-validated transaction
  to the kernel.
- The kernel owns recovery HTML/history preparation, `pendingWrite`, the
  same-directory hash/CAS/fsync/atomic-replace/re-read writer, history apply,
  project/runtime settlement, audit outbox replay and cleanup.
- Existing request/response fields, HTTP statuses, error codes, failpoint
  names, recovery paths and disk schemas remain unchanged.
- The project queue, cross-process file lock, project-context service,
  source-history service and immutable AI Version transaction remain separate
  owners. No generic ProjectUnitOfWork or Patch transport is introduced.

## Consequences

- A source commit or recovery defect has one Bridge implementation and one
  durable state machine to repair.
- Both routes retain their observable behavior, including stale/replay logic,
  autosave conflict candidates and all four existing crash failpoints.
- Packaging and impact mapping include the new Bridge module, and tests cover
  both ordinary route behavior and restart recovery around the shared commit
  points.
