# Compatibility register

This register is the single inventory of PageRoot compatibility inputs. A
compatibility decoder may read an immutable historical record, but it must not
rewrite the record, revive a terminal outcome, or cause a current producer to
emit its retired shape. Domain, Bridge service, and Workbench view code consume
only the decoder's canonical output.
An explicitly bounded storage migration is listed separately when historical
mutable metadata must be completed before the canonical model can be read.

Retired Developer Preview readers are marked **(removed)** and must not return.
Remaining live entries still do not have a calendar deletion date.

## Forward compatibility for mutable records

This is a standing policy, not a decoder entry, and it is never removed.

A mutable record is one the product reads, edits and writes again: the Registry,
the Draft aggregate, `manifest.json`,
`working-copy-state.json` and `runtime-state.json`. For those records every
required member stays strictly validated and fails closed when missing or
invalid, while a member added by a newer PageRoot is preserved unchanged across
the round trip.

A sub-record is either preserved or authored, and only a preserved one may carry
unknown members. Authored sub-records are rebuilt from an authoritative source on
every write and stay strict: `workingCopies[].fileIdentity` (a fresh stat, since
a save publishes through an atomic rename), the Runtime `activeRequest` (replaced
on every status transition), the Runtime `lastAiTask` anchor, the Registry
write-lock owner file, and the stored Draft envelope. The rule is applied per
level, not per file: `runtime-state.json` is preserved at its root and in
`historyActivation` while authored in the other two.

- Why: the Registry previously refused any record carrying a key outside a
  hard-coded allowlist, so one added member locked the user out of every managed
  project. The Runtime `historyActivation` receipt had the same exact-key
  rejection, so one added member made the whole Runtime unreadable. The Draft
  top level previously rebuilt each object from a fixed field list, so an added
  member was silently discarded and the truncated record was written back.
- This does not weaken `ADR 0028`. A record whose required members are missing is
  still an unrecognized shape and still fails closed; only a fully explainable
  record with extra members is now carried through.
- Write ordering: a preserved record must be written as
  `{ ...read, ...authoritative }`. The reverse order lets a stale file overwrite
  the identity the writer just computed and pin the schema version forever. The
  stored Draft envelope had the reverse order and was corrected.
- Proof: `tests/draft-service.test.mjs` and
  `tests/project-working-copy-save.test.mjs` assert the remaining mutable-record
  round trips. `tests/project-working-copy-save.test.mjs` pins both the Draft
  envelope defect and the authored `fileIdentity` boundary.
- Direction: this protects builds from this change onward only. A build released
  before it still refuses or discards a newer member. Any release that adds a
  member to a mutable record must come strictly after the release carrying
  `docs/decisions/0057-forward-compatible-record-members.md`.
- Not yet covered: nothing. `project.json` is written once at import and never
  rewritten, so it is an immutable record and stays strict by design.

## Draft operation IDs (removed)

- Historical producer and version: an older packaged renderer could send an
  otherwise valid `/draft` command without `operationId`.
- Current consumer: none. `bridge/draft-command-decoder.mjs` requires a current
  `draftop_` identifier and fails closed when it is missing.
- Decoder and canonical output: removed. Existing `draftop_legacy_*`
  acknowledgements remain opaque, readable IDs; nothing creates them.
- Historical fixtures:
  `fixtures/compatibility-decoders/draft-command.missing-operation-id.json`
  now proves fail-closed ingress.
- Disk persistence read: current Draft aggregates still accept already stored
  `draftop_*` acknowledgements, including the retired prefix.
- Support window and deletion evidence: Developer Preview history may be
  reset. Auto-generation at ingress is gone.

## Project storage metadata migration

- Historical producer and version: pre-metadata v3 project registries and
  `project.json` files contained a valid project/document/source identity but
  omitted `displayName`, `createdAt`, and `storageDirectoryName`.
- Current consumer: none. Desktop open and Bridge mutation are v4-only.
  `bridge/workspace-bridge.mjs` no longer reads `project-registry.json` or
  runs `migrateLegacyProjectStorageMetadata`.
- Migration and canonical output: removed from the live Bridge. Unregistered
  HTML is an unmanaged import source for a new v4 V1. On-disk v3 project
  directories are not migrated, recovered, or deleted.
- Historical proof: retired with the v3 Bridge stack in P0-B.
- Disk persistence read/write: no current runtime read.
- Support window and deletion evidence: the live consumer is gone. Remaining
  on-disk v3 registries are user data and are left in place.

## Exact legacy V4 Registry metadata completion (removed)

- Historical producer and version: the short-lived pre-hardening V4 desktop
  Registry producer wrote `schemaVersion: "4.0.0"` with top-level
  `schemaVersion`, `updatedAt` and `projects`, but no `pendingImports`; each
  project record contained exactly `projectRootPath` and `updatedAt`.
- Support window and deletion evidence: removed. That shape existed on `main`
  from `4fe5eb7` (2026-08-14 15:04) to `379523b` (2026-08-14 21:17) and was never
  part of a tagged release — `bridge/project-file-repository.mjs` is absent from
  `v0.9.8`, the newest tag. No shipped PageRoot can produce it, so no user disk
  can hold it.
- Current consumer: none. `ProjectFileRepository.#readRegistry` performs one
  validation, and any Registry that is not a valid current Registry fails closed
  with `UNSUPPORTED_REGISTRY_SCHEMA` (HTTP 422) — the same path every other
  unknown, mixed or extended shape already took.
- Why not a fallback: returning an empty Registry would validate, and the next
  import would then atomically replace the real file, destroying every recorded
  external-source binding and root filesystem identity while orphaning the
  project directories on disk. Refusing to read is recoverable; overwriting is
  not.
- Disk persistence read/write: none. A refused Registry keeps its exact bytes,
  and Project, Working Copy, Version, Draft, comment, attachment and HTML are
  untouched, so re-importing rebuilds the Registry.
- Historical proof: `tests/project-registry-and-open.test.mjs` asserts that an
  unrecognized shape fails closed across read, classify and import without
  changing the Registry bytes, the managed HTML, or creating a backup directory.
- Decision: `docs/decisions/0028-unrecognized-registry-fails-closed.md`
  supersedes `docs/decisions/0023-exact-legacy-v4-registry-migration.md`.

## External-source provenance pair

- Historical producer and version: current V4 Registry records may omit or
  include the optional `importSourceKey` / `importSourceSha256` pair. The
  previous reader used that pair only as a clean-V1 import retry.
- Current consumer: `ProjectFileRepository.classifyOpenPath` /
  `importExternal` treat a unique pair as a long-lived path→project binding.
  Schema shape is unchanged; a valid current Registry is still read without
  rewriting timestamps or bytes merely because it was classified.
- Decoder and canonical output: none. Missing pairs stay unbound and are not
  guessed from filename or Hash. Duplicate keys fail closed.
- Historical proof: `tests/project-registry-and-open.test.mjs` and
  `tests/project-file-bridge.test.mjs`.
- Disk persistence read/write: read-only for classification; writes occur only
  on a successful new import under the current Registry write lock.
- Prepared Open Intent and optional Trash are not a compatibility adapter:
  they are process-memory only and never rewrite historical Registry bytes.
- Support window and deletion evidence: retain while current Registry records
  may carry this optional pair. Not scheduled for removal.

## ID-less mutation context

- Historical producer and version: older local clients and compatibility tests
  could send a mutation with neither `projectId` nor `documentId`.
- Current consumer: none in the live Bridge. `loadMutationContext` was removed
  with the v3 stack. v4 mutations resolve a Project File from the request
  OpenTarget or source path and fail closed with `PROJECT_NOT_FOUND` when no
  v4 project is registered.
- Decoder and canonical output: removed in PR10 after the live Bridge consumer
  and package entry were both proven absent. The v4 import guard now preserves
  the old v3 tree byte-for-byte while creating a separate v4 V1.
- Historical proof: `tests/project-file-bridge.test.mjs`.
- Disk persistence read: no current Bridge read of `project-registry.json`.
- Support window and deletion evidence: live consumer removed in P0-B; the
  unused policy helper and its standalone test were removed in PR10.

## Legacy stamped-document repair

- Historical producer and version: an older PageRoot source file could retain
  its embedded document stamp while its file identity sidecar lagged after an
  owned atomic replacement.
- Current consumer: none. v3 source-observation relink was removed from
  `bridge/workspace-bridge.mjs` with the v3 Bridge stack.
- Decoder and canonical output: historical. Unregistered HTML, including HTML
  beside old v3 directories, is an unmanaged import source for a new v4 V1.
- Historical proof: retired with the v3 Bridge stack in P0-B.
- Disk persistence read/write: no current sidecar repair.
- Support window and deletion evidence: live consumer removed in P0-B.

## TargetRef source-element identity

- Historical producer and version: comments, frozen Requests and immutable
  Versions written before ADR 0061 have no `elementId` or
  `expectedSourceSha256`; they carry selector, sourceAnchor and fingerprint
  evidence only.
- Current consumer: current Comment/Draft records, Canvas target resolution,
  Request freeze and read-only historical Version projection.
- Decoder and canonical output: `selectionFromRecord` requires `targetId`.
  Official location uses only `elementId`; ID-less refs are `orphaned`. There
  is no Shadow scorer and no official selector/fingerprint/`id` fallback.
  New local-comment producers emit a valid stable ID and capture Hash.
- Support window and deletion evidence: Developer Preview history may be
  reset. Do not restore a parallel official reader for selector, fingerprint,
  DOM `id`, `data-ai-id` or source-offset scoring.

## Direct-edit identity names (removed)

- Historical producer and version: an early Workbench/Draft producer used
  `baseVersionId` and `capturedRevision`; current records use
  `basedOnVersionId` and `revision`.
- Current consumer: `shared/direct-edit-compatibility.mjs` accepts only the
  canonical pair. Unknown fields, including the retired aliases, fail closed.
- Decoder and canonical output: removed. Comments persist
  `basedOnVersionId`. Draft events use `change_*` identities; Version archives
  keep `edit_*` identities.
- Historical fixtures:
  `fixtures/compatibility-decoders/version-edit-event.legacy-aliases.json`
  now proves fail-closed ingress.
- Support window and deletion evidence: Developer Preview history may be
  reset. Architecture gates forbid `baseVersionId`, `capturedRevision`,
  `editEvents` and `editEventIds` from returning in production code.

## Request freeze direct-edit defaults

- Historical producer and version: an older Request freeze could carry a
  direct-edit event without its own Version identity while the current unsaved
  Draft already had a trusted freeze version and revision.
- Current consumer: `normalizeFrozenEditEvents` in
  `bridge/workspace-bridge.mjs`.
- Decoder and canonical output:
  `decodeDirectEditIdentity` may use the trusted freeze
  `basedOnVersionId` and revision for that unsaved Draft, including an
  unassigned revision. Those defaults never apply when reading an immutable
  Version archive; invalid dual forms still fail closed.
- Historical proof: `tests/compatibility-decoders.test.mjs` and
  `tests/workspace-bridge.test.mjs`.
- Disk persistence read: Draft freeze input only; immutable Version archives
  are read without fallback rewriting.
- Support window and deletion evidence: retain until a read-only Draft/Request
  inventory proves every supported freeze event has a canonical identity.
  Expected removal time: not scheduled pending that evidence.

## Run lifecycle aliases (removed)

- Historical producer and version: earlier run records used
  `waiting`, `importing`, `result-ready`, `awaiting-check-decision`,
  `version-created`, `completed`, or `canceled`.
- Current consumer: none. `canonicalLifecycleState` accepts only the current
  lifecycle vocabulary. Unknown names fail closed to `error`.
- Decoder and canonical output: removed. A current `ready` status with a
  ready Version still presents as `ready-to-open`.
- Historical proof: `tests/run-lifecycle.test.mjs`.
- Support window and deletion evidence: Developer Preview history may be
  reset.

## Legacy user-data and workspace paths

- Historical producer and version: earlier desktop installs stored recent
  project state under `PageRootV2`, `YuanYe`, or `HTML AI 工作台`, and
  used the corresponding Documents workspace directories.
- Current consumer: none. Desktop startup reads only the current
  `userData/html-projects.json`. `workspacePath()` uses `HTML_AI_WORKSPACE`
  when set, otherwise only `Documents/PageRoot/项目记录`.
- Decoder and canonical output: removed 2026-08-15. The desktop no longer
  opens `html-projects.json` from older appData directory names. Those
  directories are not deleted.
- Historical proof: `tests/product-contract.test.mjs` (main process must not
  mention the old appData names) and
  `docs/NOTIFICATION_AND_STARTUP_POLICY.md`.
- Disk persistence read: no. Recent-file UI state is only the current
  `userData` file. Bridge open authority remains the v4 Project File Registry.
- Support window and deletion evidence: appData probes were removed after
  P0-B already dropped Documents workspace-root probes. Users who never
  launched a PageRoot-named install still re-open HTML files to rebuild
  Recent; project content is not migrated or deleted.

## Developer Preview candidate assessments (removed)

- Historical producer and version: the short-lived 2026-08-04 Developer
  Preview emitted v1 `candidate-assessment.json` with
  `health.executableSurfaceUnchanged` plus `executable`, or Candidate records
  without `identityReport`.
- Current consumer: none. Schema and decoder accept only the current bounded
  assessment and require Candidate `identityReport`.
- Decoder and canonical output: removed. Sealed HTML Hash verification still
  runs for current assessments.
- Historical fixtures remain as negative evidence in
  `fixtures/candidate-assessment-compat/`.
- Support window and deletion evidence: Developer Preview history may be
  reset.

## Version-record full-array Candidate impact

- Historical producer and version: earlier Candidate assessments persisted
  `changedStableElementIds`, `requestedTargetElementIds` and
  `outsideRequestedTargetElementIds` on Version records. Current producers
  write only bounded counts and samples.
- Current consumer: `assertCandidateAssessment` still reads both shapes from
  Version records and rejects a mixed form. `candidate-assessment.json`
  continues to refuse full-array facts.
- Decoder and canonical output: `candidateAssessmentFromRecord` projects a
  valid historical full-array impact into bounded counts, samples and
  `truncated`. Review display reads only that bounded result. The Version
  file is not rewritten.
- Support window and deletion evidence: keep the Version-record reader until
  a census shows the full-array shape is outside the supported upgrade
  window.

## Legacy release update manifest

- Historical producer and version: `scripts/create-release-assets.mjs` still
  publishes schema-1 `update-manifest.json` for clients from the earlier
  ad-hoc/manual-update era.
- Current consumer: already shipped legacy clients only. The current signed
  application uses electron-updater's `latest-mac.yml`; removal of the
  in-app manual reader is owned by the parallel PR 01
  (`chore/remove-legacy-manual-updater`).
- Decoder and canonical output: none in the current application. This is a
  release-distribution artifact, not a current application input; its
  canonical modern replacement is the signed updater metadata, not a decoded
  object.
- Historical fixture:
  `fixtures/compatibility-decoders/legacy-update-manifest.json`.
- Disk persistence read: no project/Draft/Version data is read. Release
  provenance verifies the artifact before publication.
- Support window and deletion evidence: retain until release governance proves
  all supported earlier clients have completed the one-time signed migration
  and the published compatibility URL is no longer required. Expected removal
  time: not scheduled pending upgrade evidence.

## Decoder test contract

`tests/compatibility-decoders.test.mjs` proves that retired historical
fixtures fail closed, current producers do not create retired shapes, and
unknown fields remain invalid. `tests/workspace-bridge.test.mjs` additionally
proves the sealed historical Candidate path without mutating its evidence.

Native text APIs are `checkpointNativeTextIntent()`, `endNativeTextIntent()`
and `freezeWorkingSource()`. Architecture gates forbid
`checkpointPendingEdit`, `fencePendingEdit` and `commitPendingEdit`.
