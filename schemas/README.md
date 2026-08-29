# Active schema allowlist

Only the files listed below are product contracts and package inputs.

## HTML source identity

- `pageroot-element-identity.v1.schema.json` defines the value written to the
  sole persistent PageRoot-owned HTML attribute, `data-pageroot-id`. The schema
  does not itself authorize writing that attribute.
- `source-element-identity-migration.v1.schema.json` is the strict recoverable
  transaction that authorizes a registered managed Working Copy to materialize
  that identity once. It seals before/after Hashes and recovery paths; it never
  covers historical Versions, external originals or Runtime DOM.
- `promotion-transaction.v4.schema.json` seals the immutable Candidate output
  Hash separately from `workingCopySourceSha256`. Promotion preserves the
  Candidate bytes in the Version snapshot and publishes only the independently
  identity-materialized Working Copy bytes under the latter Hash.

## Unknown members in mutable records

A mutable record is one this product reads, edits and writes again. For those
records every required member stays strictly validated, and a member added by a
newer PageRoot is preserved unchanged across the round trip. A record whose
required members are missing or invalid is still an unrecognized shape and still
fails closed. Dropping a member we do not recognize is silent data loss, and
refusing the whole file over one added member locks the user out of data this
build can otherwise read.

A sub-record is either **preserved** or **authored**, and only a preserved one
can carry unknown members:

- **Preserved** — round-tripped from disk. A writer either mutates the object it
  read, or spreads it first and overrides authoritative members after
  (`{ ...read, ...authoritative }`). Covered: `project-registry.v4`,
  `source-history.v1`, `project-manifest.v4` (manifest, Version entries, Working
  Copy entries), `working-copy-state.v4`, `project-runtime-state.v4` (root and
  `historyActivation`), and the Draft aggregate, which has no schema file. These
  drop `additionalProperties: false` and carry a `$comment`.
- **Authored** — rebuilt from an authoritative source on every write, so it
  cannot carry an unknown member and keeps `additionalProperties: false`. This is
  `workingCopies[].fileIdentity` (a fresh stat; a save publishes through an
  atomic rename, so the inode legitimately changes), the Runtime `activeRequest`
  (replaced on every status transition), the Runtime `lastAiTask` anchor
  (re-derived from the AI task record), the Registry write-lock owner file, and
  the stored Draft envelope (`schemaVersion`, `projectId`, `documentId`,
  `workingCopyId`, `basedOnVersionId`).

A record can be layered: `project-runtime-state.v4` is preserved at its root and
in `historyActivation` but authored in `activeRequest` and `lastAiTask`, so the
rule is applied per level rather than per file.

The reverse spread order `{ ...authoritative, ...read }` is a defect: it lets a
stale file overwrite the identity the writer just computed and pin the schema
version forever. `tests/project-working-copy-save.test.mjs` pins that case.

`project-identity.v4` is written once at import and never rewritten, so it is an
immutable record and stays strict by the rule below.

## Portable records and device-scoped members

`project-manifest.v4` travels with the project directory, so every member must
still mean something on another machine. Exactly one member is device-scoped:
`workingCopies[].fileIdentity`. It stays in the manifest because the promotion
protocol compares it to detect a replaced Version Working Copy
(`PROMOTION_PATH_REPLACED`) and a committed record that no longer matches its
sealed transaction (`PROMOTION_COMMIT_MISMATCH`); a device-local sidecar can be
absent, which would turn both fail-closed controls into checks that silently
pass. A future synchronisation layer recomputes it on the receiving device
instead of transporting it.

`tests/portable-project-record.test.mjs` enumerates the schema's members and
fails when one is neither classified portable nor classified device-scoped, so a
new member forces an explicit decision. See
[`docs/decisions/0034-portable-project-record-boundary.md`](../docs/decisions/0034-portable-project-record-boundary.md).

Immutable records — anything written once and never rewritten — and the
compatibility decoders keep their strict `additionalProperties: false` form. See
[`docs/decisions/0057-forward-compatible-record-members.md`](../docs/decisions/0057-forward-compatible-record-members.md).

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
- `conversation.v1.schema.json`
- `conversation.v2.schema.json`
- `conversation-index.v1.schema.json`
- `conversation-draft.v1.schema.json`
- `conversation-draft.v2.schema.json`

## v4 project-file records

- `project-identity.v4.schema.json`
- `project-registry.v4.schema.json`
- `project-manifest.v4.schema.json`
- `project-runtime-state.v4.schema.json`
- `working-copy-state.v4.schema.json`
- `candidate.v4.schema.json`
- `promotion-transaction.v4.schema.json`
- `source-element-identity-migration.v1.schema.json`

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
read. `bridge/candidate-assessment-decoder.mjs` verifies the record against
sealed HTML and all four Hashes, normalizes those fields out in memory, and
never lets them affect current status, review routing or adoption. Current
writers do not emit them; archived outcomes remain terminal and history is
never rewritten. See [`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md) for
its removal evidence and fixture contract.

`source-history.v1.schema.json` is the bounded, document-owned journal of
byte-exact canvas source operations. Its cursor is independent from immutable
Versions; comments, attachments, and project-rule edits are not entries.

`conversation.v2.schema.json` is the current writer contract for one AI
conversation thread; v1 remains read-only compatibility. A Conversation
belongs to exactly one Document and its contexts, turns and messages live in the
same record, so reading one Document's thread can never surface another's. Two
rules are load-bearing and pinned by
`tests/conversation-repository.test.mjs`:

- **A stored message is always terminal.** A streaming fragment stays in Bridge
  memory and is written once, when its Turn seals. `draft`, `queued` and
  `streaming` are refused on write, so crash recovery never has to repair a half
  record.
- **A stored message carries no interface member.** `actions`, `buttons`,
  `cardState`, `disabled`, `pending` and `controls` are refused. An executable
  action is derived from current product state by the action bar, never read
  from a stored fact, so scrolling back through history cannot surface a stale
  button.

`conversation-index.v1.schema.json` maps each Document to its Conversations and
to that Document's single current Conversation. It is a rebuildable projection
of the authoritative conversation records; it exists so the history list renders
without opening every conversation file.

`conversation-draft.v2.schema.json` is the current unsent Composer content for one
Conversation, kept in its own small record so a debounced draft write never
rewrites the message history. A draft never enters a Request, Prompt,
`USER_SUPPLEMENT` or Candidate.

Conversation v2 binds each Agent turn to a provider selection, nullable runtime
binding, and capability-snapshot fingerprint. Stored Agent messages use the
generic `agent` actor plus `providerId` and the actual provider-namespaced model.
The codec projects legacy `qoder` actors and `qoder-default` reasoning without
rewriting v1 files; new writes are v2 and preserve unknown future members.

Deprecated main v1/v2 schemas and `migration-report.v1.schema.json` are not
kept in the active source tree or release package. Their evidence exists only
in the read-only pre-cutover backup.
