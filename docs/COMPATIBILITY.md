# Compatibility register

This register is the single inventory of PageRoot compatibility inputs. A
compatibility decoder may read an immutable historical record, but it must not
rewrite the record, revive a terminal outcome, or cause a current producer to
emit its retired shape. Domain, Bridge service, and Workbench view code consume
only the decoder's canonical output.

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

## Direct-edit identity names

- Historical producer and version: an early Workbench/Draft producer with no
  stored semantic version used `baseVersionId` and `capturedRevision`; current
  immutable Version archives use `basedOnVersionId` and `revision`.
- Current consumer: the Request freeze adapter in
  `scripts/workspace-bridge.mjs` and Version history ingress in
  `app/workbench/version-model.ts`.
- Decoder and canonical output:
  `shared/direct-edit-compatibility.mjs` yields the persisted canonical pair
  `{ basedOnVersionId, revision }`. The Workbench-only
  `app/workbench/version-compatibility-decoder.js` maps a validated Version
  archive into the current `DirectEditEvent` view model. A transient
  `capturedRevision: 0` may use only the trusted freeze revision and is never
  written into a Version archive. The existing legacy envelope `id` is also
  accepted only here when `eventId` is absent; both forms together fail closed.
- Historical fixtures:
  `fixtures/compatibility-decoders/version-edit-event.legacy-aliases.json`;
  the current disk archive oracle is
  `fixtures/v3/annotation-records.frozen.json`.
- Disk persistence read: yes. Draft input may be frozen; immutable Version
  archive records are read-only. Unknown keys, dual alias pairs, invalid
  revisions, and Version IDs outside the safe integer range fail closed.
- Support window and deletion evidence: retain until a read-only scan of
  supported Draft/Version records proves the legacy pair is absent and the
  matching early Workbench build is outside the supported upgrade window.
  Expected removal time: not scheduled pending that evidence.

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
