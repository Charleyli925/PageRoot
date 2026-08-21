# Active schema allowlist

Only the files listed below are product contracts and package inputs.

## Unknown members in mutable records

A mutable record is one this product reads, edits and writes again. For those
records every required member stays strictly validated, and a member added by a
newer PageRoot is preserved unchanged across the round trip. A record whose
required members are missing or invalid is still an unrecognized shape and still
fails closed. Dropping a member we do not recognize is silent data loss, and
refusing the whole file over one added member locks the user out of data this
build can otherwise read.

This rule is implemented and proven by round-trip tests for
`project-registry.v4`, `source-history.v1` and the Draft aggregate, which has no
schema file. Those two schemas therefore drop `additionalProperties: false` and
carry a `$comment` stating the rule.

`project-manifest.v4`, `project-identity.v4` and `project-runtime-state.v4`
already preserve unknown members in code, but their schemas still declare
`additionalProperties: false` and no test pins the round trip, so they are not
yet claimed by this rule. `working-copy-state.v4` has not been audited. Bringing
those four records under the rule is a separate change.

Immutable records — anything written once and never rewritten — and the
compatibility decoders keep their strict `additionalProperties: false` form. See
[`docs/decisions/0032-forward-compatible-record-members.md`](../docs/decisions/0032-forward-compatible-record-members.md).

## Strict v3 main records

- `annotation-records.v3.schema.json`
- `change-request.v3.schema.json`
- `project-state.v3.schema.json`
- `runtime-state.v3.schema.json`
- `version-manifest.v3.schema.json`

The runtime must reject v1/v2 forms of these records with
`UNSUPPORTED_SCHEMA_VERSION`. It does not migrate, infer, fill, or display old
records.

## Current auxiliary records

- `candidate-assessment.v1.schema.json`
- `scope-report.v1.schema.json` (direct-patch and legacy Attempt evidence; new AI Attempts use candidate assessment)
- `completion.v1.schema.json`
- `input-manifest.v1.schema.json`
- `attempt-outcome.v1.schema.json`
- `version-transaction.v1.schema.json`
- `committed-marker.v1.schema.json`
- `source-history.v1.schema.json`

## v4 project-file records

- `project-identity.v4.schema.json`
- `project-registry.v4.schema.json`
- `project-manifest.v4.schema.json`
- `project-runtime-state.v4.schema.json`
- `working-copy-state.v4.schema.json`
- `candidate.v4.schema.json`
- `promotion-transaction.v4.schema.json`

The Registry is the canonical write whitelist for v4. It records only direct
children of the configured project root, the registered root path, a root
filesystem identity used only for same-parent rename recovery, and durable
pending-import intent. A copied `.pageroot` directory is never registry
authority.

The v1 suffix here is local to each auxiliary artifact and remains its current
strict contract. These files are not compatibility readers for old main
records.

`candidate-assessment.v1.schema.json` requires document-health and continuity
evidence. The retired `health.executableSurfaceUnchanged` and `executable`
members remain optional only so immutable Developer Preview history can be
read. `scripts/candidate-assessment-decoder.mjs` verifies the record against
sealed HTML and all four Hashes, normalizes those fields out in memory, and
never lets them affect current status, review routing or adoption. Current
writers do not emit them; archived outcomes remain terminal and history is
never rewritten. See [`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md) for
its removal evidence and fixture contract.

`source-history.v1.schema.json` is the bounded, document-owned journal of
byte-exact canvas source operations. Its cursor is independent from immutable
Versions; comments, attachments, and project-rule edits are not entries.

Deprecated main v1/v2 schemas and `migration-report.v1.schema.json` are not
kept in the active source tree or release package. Their evidence exists only
in the read-only pre-cutover backup.
