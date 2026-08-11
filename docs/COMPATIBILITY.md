# Compatibility register

This register is the single inventory of PageRoot compatibility inputs. A
compatibility decoder may read an immutable historical record, but it must not
rewrite the record, revive a terminal outcome, or cause a current producer to
emit its retired shape. Domain, Bridge service, and Workbench view code consume
only the decoder's canonical output.
An explicitly bounded storage migration is listed separately when historical
mutable metadata must be completed before the canonical model can be read.

No entry below has enough release-inventory or on-disk census evidence to set a
truthful calendar deletion date. Each is therefore **not scheduled**: its next
removal step is a separate conditional PR after the stated evidence is
collected. A guessed date is not a support-window policy.

## Draft operation IDs

- Historical producer and version: an older packaged renderer with no recorded
  semantic version sent an otherwise valid `/draft` command without
  `operationId`. Its acknowledgement could be persisted as
  `draftop_legacy_*`.
- Current consumer: `scripts/draft-service.mjs` command ingress and Draft
  acknowledgement reconciliation.
- Decoder and canonical output:
  `scripts/draft-command-decoder.mjs` maps a missing ID to a newly generated
  current `draftop_<id>`. Existing `draftop_legacy_*` values remain opaque,
  readable acknowledgement IDs; nothing creates them.
- Historical fixtures:
  `fixtures/compatibility-decoders/draft-command.missing-operation-id.json`
  and `fixtures/compatibility-decoders/draft-authority.current.json`.
- Disk persistence read: yes, only from `draft/annotations.json` through the
  authoritative aggregate; the decoder does not rewrite that file.
- Support window and deletion evidence: retain while a supported packaged
  renderer can omit `operationId` or an on-disk Draft can contain the legacy
  prefix. Before deletion, inventory supported renderer builds and perform a
  read-only managed-project census proving neither condition remains. Expected
  removal time: not scheduled pending that evidence.

## Project storage metadata migration

- Historical producer and version: pre-metadata project registries and
  `project.json` files contained a valid project/document/source identity but
  omitted `displayName`, `createdAt`, and `storageDirectoryName`.
- Current consumer: registry startup in `scripts/workspace-bridge.mjs`.
- Migration and canonical output:
  `migrateLegacyProjectStorageMetadata` validates the registry, matching
  `project.json`, and initial `ver_0001` identity before completing the
  metadata. It writes only the missing metadata to the registry and, when
  necessary, `project.json`; the existing `projectId` directory remains the
  storage identity. Partial metadata or mismatched identity fails closed.
- Historical proof: `tests/workspace-bridge.test.mjs` covers successful
  migration, invalid records, and preservation of the original project
  directory.
- Disk persistence read/write: yes. This is an idempotent, bounded migration
  of mutable registry metadata rather than a decoder for immutable evidence.
- Support window and deletion evidence: retain until a read-only managed
  workspace census proves no supported registry or project file lacks the
  metadata. Expected removal time: not scheduled pending that evidence.

## ID-less mutation context

- Historical producer and version: older local clients and compatibility tests
  could send a mutation with neither `projectId` nor `documentId`.
- Current consumer: `registeredCommandIdentity` in
  `scripts/project-context-service.mjs` and `loadMutationContext` in
  `scripts/workspace-bridge.mjs`.
- Decoder and canonical output: the pair is either complete or absent. A
  complete pair resolves the registered project; an absent pair may resolve an
  existing project only by canonical source path and never gains
  project-creation authority. A partial pair is rejected.
- Historical proof: `tests/project-context-service.test.mjs` and
  `tests/workspace-bridge.test.mjs`.
- Disk persistence read: yes, only to resolve an existing registration; the
  fallback does not create one.
- Support window and deletion evidence: retain until supported local-client
  builds and a Bridge request census show both IDs are always present. Expected
  removal time: not scheduled pending that evidence.

## Legacy stamped-document repair

- Historical producer and version: an older PageRoot source file could retain
  its embedded document stamp while its file identity sidecar lagged after an
  owned atomic replacement.
- Current consumer: source observation reconciliation in
  `scripts/workspace-bridge.mjs`.
- Decoder and canonical output:
  `classifySourceObservation` recognizes a matching legacy embedded document
  ID as `legacy-stamped-document`. Bridge repairs only the registry/project
  sidecar identity in the narrow compatibility window; it never rewrites the
  source HTML bytes. Non-matching observations remain external replacements.
- Historical proof: `tests/project-context-service.test.mjs` and
  `tests/workspace-bridge.test.mjs`.
- Disk persistence read/write: yes for sidecars only; authored source remains
  immutable under this repair.
- Support window and deletion evidence: retain until a read-only managed
  project census shows no lagging stamped source/sidecar pairs and no supported
  build can create them. Expected removal time: not scheduled pending that
  evidence.

## Direct-edit identity names

- Historical producer and version: an early Workbench/Draft producer with no
  stored semantic version used `baseVersionId` and `capturedRevision`; current
  immutable Version archives use `basedOnVersionId` and `revision`.
- Current consumer: the Request freeze adapter in
  `scripts/workspace-bridge.mjs`, mutable Draft ingress and immutable Version
  history ingress in `app/workbench/version-model.ts`.
- Decoder and canonical output:
  `shared/direct-edit-compatibility.mjs` yields the persisted canonical pair
  `{ basedOnVersionId, revision }`. The Workbench-only
  `app/workbench/version-compatibility-decoder.js` passes that same canonical
  pair into the `DirectEditEvent` view model. Mutable Draft ingress retains the
  Workbench `change_*` event identity and an explicitly unassigned based-on
  Version until Request freeze can apply its trusted fallback; immutable
  Version ingress still requires its normalized `edit_*` identity and complete
  local Version pair. New Workbench producers emit only canonical identity
  names and read the synchronous `VersionSession` authority when assigned. A
  transient
  `capturedRevision: 0` may use only the trusted freeze revision and is never
  written into a Version archive. The existing legacy envelope `id` is also
  accepted only here when `eventId` is absent; both forms together fail closed.
- Historical fixtures:
  `fixtures/compatibility-decoders/version-edit-event.legacy-aliases.json` and
  `fixtures/compatibility-decoders/draft-authority.current.json`; the current
  disk archive oracle is
  `fixtures/v3/annotation-records.frozen.json`.
- Disk persistence read: yes. Draft input may be frozen; immutable Version
  archive records are read-only. Unknown keys, dual alias pairs, invalid
  revisions, and Version IDs outside the safe integer range fail closed.
- Support window and deletion evidence: retain until a read-only scan of
  supported Draft/Version records proves the legacy pair is absent and the
  matching early Workbench build is outside the supported upgrade window.
  Expected removal time: not scheduled pending that evidence.

## Request freeze direct-edit defaults

- Historical producer and version: an older Request freeze could carry a
  direct-edit event without its own Version identity while the current unsaved
  Draft already had a trusted freeze version and revision.
- Current consumer: `normalizeFrozenEditEvents` in
  `scripts/workspace-bridge.mjs`.
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

## Run lifecycle aliases

- Historical producer and version: earlier run records used
  `waiting`, `importing`, `result-ready`, `awaiting-check-decision`,
  `version-created`, `completed`, or `canceled`.
- Current consumer: `app/domain/run-lifecycle.js`.
- Decoder and canonical output: `canonicalLifecycleState` maps those names
  to the current lifecycle vocabulary, with a ready Version separately shown
  as `ready-to-open`. Unknown values resolve to the caller's canonical
  fallback (processing by default) instead of becoming a new lifecycle
  authority.
- Historical proof: `tests/run-lifecycle.test.mjs`.
- Disk persistence read: yes, when historical run state is projected; the
  decoder does not rewrite the record.
- Support window and deletion evidence: retain until a managed-history census
  and supported-build inventory prove no alias remains readable. Expected
  removal time: not scheduled pending that evidence.

## Legacy user-data and workspace paths

- Historical producer and version: earlier desktop installs stored recent
  project state under `PageRootV2`, `YuanYe`, or `HTML AI 工作台`, and
  used the corresponding Documents workspace directories.
- Current consumer: desktop startup in `desktop/main.mjs`.
- Decoder and canonical output: the desktop process reads a legacy
  `html-projects.json` only when the current state file is absent, and selects
  the first existing workspace in the order PageRoot, PageRootV2, YuanYe, then
  HTML AI 工作台. It continues using the selected existing directory and does
  not delete or overwrite an older location.
- Historical proof: `tests/desktop-package.test.mjs` and
  `docs/NOTIFICATION_AND_STARTUP_POLICY.md`.
- Disk persistence read: yes; startup location selection is compatibility
  input, not a migration of project content.
- Support window and deletion evidence: retain until supported desktop builds
  and an opted-in installation census show no legacy state or workspace path
  remains. Expected removal time: not scheduled pending that evidence.

## Developer Preview candidate assessments

- Historical producer and version: the short-lived 2026-08-04 Developer
  Preview emitted v1 `candidate-assessment.json` either without the retired
  executable-surface pair or with
  `health.executableSurfaceUnchanged` plus `executable`.
- Current consumer: Version history and archived terminal-outcome reads in
  `scripts/workspace-bridge.mjs`.
- Decoder and canonical output:
  `scripts/candidate-assessment-decoder.mjs` validates strict input, requires
  the retired fields to appear as a consistent pair, verifies sealed HTML
  evidence, recomputes current document-health/continuity policy, and returns
  a v1 assessment without either retired field.
- Historical fixtures:
  `fixtures/candidate-assessment-compat/candidate-assessment.pre-executable-dev.json`,
  `fixtures/candidate-assessment-compat/candidate-assessment.retired-executable-dev.json`,
  and their sealed `base.html` / `output.html`.
- Disk persistence read: yes, immutable Attempt/Version evidence only; old
  assessments and terminal outcomes are never rewritten.
- Support window and deletion evidence: retain while August 2026 Developer
  Preview records remain inside the supported upgrade window. Delete only
  after a managed-history inventory proves those records are outside support
  and no supported project needs the reader. Expected removal time: not
  scheduled pending that evidence.

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

`tests/compatibility-decoders.test.mjs` proves that historical and current
fixtures arrive at their documented canonical model, current producers do not
create retired shapes, and unknown fields, invalid dual forms, and out-of-range
Version identities fail closed. `tests/workspace-bridge.test.mjs` additionally
proves the sealed historical Candidate path without mutating its evidence.
