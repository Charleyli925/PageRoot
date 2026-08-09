# Compatibility decoder fixtures

These fixtures are input evidence only. They are never copied into a project,
rewritten in place, or used as a new producer format.

- `draft-command.missing-operation-id.json` represents an older packaged
  renderer that submitted a valid Draft command without `operationId`.
- `draft-authority.current.json` retains a historical
  `draftop_legacy_*` acknowledgement while its live Draft edit uses the
  current Workbench shape.
- `version-edit-event.legacy-aliases.json` represents the early Workbench
  direct-edit identity names `baseVersionId` and `capturedRevision`.
- `legacy-update-manifest.json` is a release artifact for already shipped
  manual-update clients. It is not read by the current signed updater.

Candidate assessment fixtures stay beside their sealed HTML evidence in
`../candidate-assessment-compat/`.
