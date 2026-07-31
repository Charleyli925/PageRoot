# Architecture contract

This document is normative for state ownership, asynchronous coordination and
persistence. Product behavior remains normative in `docs/MVP_PRD.md` and
`docs/INTERACTION_FLOW.md`; when those documents disagree, the conflict must be
resolved in the same Pull Request before implementation proceeds.

## Dependency direction

```text
React views
  -> application sessions and coordinators
    -> domain state and pure transition functions
      -> typed Bridge client

Bridge route adapters
  -> application commands and queries
    -> domain transitions
      -> repositories
        -> project lock and atomic filesystem writer
```

- Views render snapshots and dispatch user intent. They do not know Bridge
  routes, use raw `fetch`, or read and write browser persistence.
- Application modules own session identity, request generations, mutation
  outcomes, recovery and orchestration.
- Domain modules are pure and may be shared by the renderer and Bridge. They do
  not import React, DOM components, Electron or filesystem adapters.
- Existing source-fidelity engines under `app/lib` are also pure shared core;
  narrow `scripts/` re-export adapters may consume them. They cannot import
  Workbench, React components or application sessions.
- Bridge routes decode transport input and delegate. Durable state changes run
  under the project mutation lock and repository boundary.
- `scripts/check-architecture.mjs` enforces the dependency direction. Do not
  weaken the gate to land a feature.
- Runtime capability decoding has one ingress:
  `app/application/runtime-capabilities.js`. Source editing, project opening
  attachment persistence and close coordination are independent declarations;
  consumers may not infer the whole runtime from the presence of one preload
  API. Electron owns desktop close safety through its acknowledged handshake;
  `beforeunload` is only the browser fallback.

## State ownership

Every mutable fact has exactly one owner, listed in `docs/STATE_OWNERSHIP.md`.
React state may project an owner snapshot for rendering, but a state/ref pair
must not become two independent authorities.

An asynchronous result may update state only when its complete identity is
current:

```text
projectId + documentId + sourcePath + session generation + query sequence
```

Revisions are monotonic. A query result with an older revision may never
replace an acknowledged state, even if the project identity is unchanged.

Opening a user HTML may remain lazy until the first durable product action.
During that interval the renderer owns only an `epoch + sourcePath` locator,
not a registered project context. A registered context always has non-empty
`projectId`, `documentId` and canonical `sourcePath`. Registration is one
application transition: it adopts those identifiers and activates Draft
authority from the same Bridge response. If a registered page later finds its
Draft session inactive or bound to another context, it queries current
workspace authority and safely rebinds before creating a mutation; it does not
leave an unchangeable close blocker.

Canvas operation history has split but non-overlapping ownership:
`SourceHistorySession` owns the renderer context, unsaved operation outbox and
one in-flight action intent; `history/source-operations.json` owned by the
Bridge is the durable cursor, operation and applied-action authority. React
state may display capabilities, but it cannot maintain a parallel undo stack.
The preview DOM, browser editing history and edit-audit list are not history
authorities.

## Mutation protocol

Every durable command defines:

1. a stable operation identity;
2. the expected revision or Hash;
3. an idempotent acknowledgement;
4. explicit rejected and unknown outcomes;
5. an authoritative query used for reconciliation;
6. deterministic retry or a genuine user-owned semantic conflict.

Network failure after a mutation is an **unknown outcome**, not a rejection.
The client queries authority before retrying. A retry action must change its
precondition through reconciliation, refreshed identity, backoff or new user
information; resending the same known-stale command is forbidden.

A persisted source-history operation is created only from an accepted
SourcePatch result. It carries stable operation identity, exact forward and
reverse patch lists, before/after source Hashes and bounded logical target
snapshots, plus optional bounded before/after logical Selection for text-focus
restoration. Selection is presentation metadata, not a patch precondition or
source authority. Autosave validates the full operation chain before placing
the HTML candidate and history candidate in the same recoverable `pendingWrite`.
Undo/redo is another durable command with stable action ID, expected source
Hash, expected history revision and expected cursor. An unknown response is
reconciled by querying workspace authority; the same action ID may be replayed
once only when authority proves it was already applied or its original
preconditions still hold.

The history journal is bounded and may be reset only at a proven current source
Hash. A forward edit after undo truncates redo. Source mismatch never attempts
best-effort patching and never serializes preview DOM; it creates a new history
boundary or reports the existing source conflict.

Comment deletion tombstones and processed operation identities are durable
draft data. Attachments must be tied to a durable comment operation or cleaned
as unreferenced staged data. The draft artifact carries the authoritative
revision needed to recover the crash window between artifact replacement and
runtime-pointer refresh.

No durable command may be constructed with empty identity fields. In a
persistence-capable app, starting a comment composer counts as a real project
action: registration may begin eagerly, and confirming the comment must await
that identity so the visible comment and its recovery record have one owner.
The pure browser preview is explicitly non-durable and may demonstrate a
temporary comment without claiming that it was saved.

## React effects

Effects are for DOM integration, subscriptions and timers. Business
persistence is invoked by an application session or coordinator. Adding an
effect that writes because several React values changed requires an ADR and a
behavior test proving there is one write authority and no feedback loop.

## Drain boundaries

Close, project switch, Request freeze and history navigation consume the same
registered obligations:

- native edit checkpoint;
- source autosave;
- draft/comment persistence;
- attachment staging;
- project-rule persistence;
- Request freeze or outcome reconciliation.

A Canvas undo/redo request uses the same native-edit checkpoint and source
autosave obligations before it reads the durable history cursor. It does not
drain or mutate comment cards, attachments or project rules. Focused native
text controls keep their platform-local input history and do not invoke this
Canvas drain. Project-rule autosave is not eligible while its native control
owns an active composition; explicit restore retires that control before
adopting the saved value.

Each obligation reports pending, draining, resolved or blocked. A blocked
result includes an action that changes the condition. Entry points must not
copy their own boolean lists. An obligation may request a final verification
without reporting permanent pending state; an already acknowledged aggregate
must drain as a no-op without advancing its revision.

A lazily opened page with no durable material closes as a no-op and remains
unregistered. If it contains a comment, composer recovery, tombstone or edit
audit, the Draft obligation first completes project registration and authority
binding, then drains the aggregate.

## Compatibility

Compatibility belongs at one versioned decoder or route adapter. Each fallback
must state the old producer, removal condition and focused coverage. Domain and
view code use only current canonical states. Inline aliases and permanent
“just in case” branches are not allowed.

The one compatibility decoder accepts only complete PageRoot 0.9.0 v3 project
records whose registry, `project.json`, initial Version and existing
`projects/<projectId>` directory prove one identity. It adds `displayName`,
`createdAt` and `storageDirectoryName=projectId` in place without renaming or
scanning directories. Remove this adapter only when 0.9.0 project records leave
the supported upgrade window. v1/v2 and incomplete records remain unsupported
and are rejected without migration, renaming or deletion.

## Change requirements

A change affecting state, persistence or lifecycle must include:

- owner and transition;
- late-response behavior;
- crash and unknown-outcome recovery;
- close/switch/submit impact;
- behavior and failure-injection coverage;
- updated architecture or product documentation when the contract changes.

Source-string tests are reserved for packaging, dependency and security
boundaries. Runtime coordination is proven through public behavior, bytes,
Hashes, state transitions and fault injection.
