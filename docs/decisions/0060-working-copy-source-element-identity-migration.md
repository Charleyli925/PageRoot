# ADR 0060: managed Working Copies materialize source element identity once

## Status

Accepted.

## Context

ADR 0059 defines the persistent `data-pageroot-id` value contract but leaves
all parsing read-only. Semantic editing, current-version comments and ID-based
Review require the managed Working Copy itself to carry a complete identity set.
The upgrade must not turn an ordinary parse, a Runtime DOM or an immutable
historical Version into a write source, and an interrupted rewrite must never
leave mixed or externally overwritten HTML.

## Decision

1. `ProjectFileRepository` is the sole migration owner. A new import keeps the
   external file and its immutable V1 snapshot byte-exact, while its managed
   Working Copy is created with identity schema v1. An existing registered
   Working Copy upgrades only when it enters the editable workspace path.
   Historical Version files, frozen Requests, Candidates and unregistered HTML
   are never rewritten by this migration.
2. The materializer reads exact authored start-tag ranges, preserves every
   valid unique existing ID and adds cryptographically generated IDs only to
   source elements that are missing one. It preserves all other bytes. A
   repeated attribute, malformed value or duplicate value fails closed; the
   migration never guesses or repairs it. Once the Working Copy state records
   schema v1, any later missing or invalid identity is corruption and is not
   silently reminted.
3. The Working Copy state records
   `sourceElementIdentitySchemaVersion: 1`. Legacy records may omit it. The
   migration is idempotent: a complete legacy identity set is adopted without
   rewriting HTML, while a current v1 state plus a complete document performs
   no transaction.
4. A legacy rewrite uses one Repository-serialized transaction. It records the
   project/document/Working Copy identity, source-relative path, before and
   after Hashes, identity schema, recovery ID and recovery paths. Complete old
   and new HTML are staged under `.pageroot/recovery/`; publication uses the
   existing same-directory expected-Hash CAS. Working Copy state and manifest
   file identity are updated only after the complete target bytes are verified.
   The import receipt exposes the verified original `importSourceSha256`
   separately from the identified Working Copy `sourceSha256`; Desktop verifies
   both facts before activating the managed file.
5. Restart recovery accepts only the registered project and the sealed
   transaction. It may finish from the exact old side or exact new side. Bytes
   matching neither side fail closed and are never overwritten. A committed
   transaction is audit evidence; its temporary recovery directory is removed.
6. A normal save from an identity-v1 Working Copy must preserve every identity
   claimed by its current source. Existing edit planners allocate identities for
   new wrappers and line-break elements before autosave; the Repository accepts
   only a complete next document and never guesses whether a missing element is
   new or an existing element whose ID was transplanted. It also verifies that
   retained IDs keep their tag, retained source order and nearest retained
   ancestor. The existing sibling-reorder capability is allowed only when the
   autosave's bounded SourcePatch history exactly replays from current bytes to
   next bytes and every relocated ID keeps its complete source-element bytes;
   editing or swapping ID values cannot masquerade as a move. Later semantic
   operation PRs can replace this compatibility authorization. A save that
   introduces a fresh persistent ID also requires the exact bounded SourcePatch
   chain, and a reorder operation cannot claim a newly created identity. This
   PR does not convert TargetRef, comments, undo/redo, AI identity continuity or
   Review pairing; those remain dependent PRs. Until ID-based Review lands, its
   legacy exact-subtree signature treats every PageRoot attribute, including
   the persistent ID, as disposable comparison metadata.
7. Candidate Promotion keeps the immutable Version snapshot byte-exact to the
   sealed Candidate. Its private prepared Working Copy is materialized
   separately, and the Promotion transaction seals that file's distinct
   `workingCopySourceSha256` before no-replace publication. The new Working Copy
   state records identity schema v1, the Candidate Hash as `baseSha256`, and the
   identified file Hash as `currentSha256`. Recovery validates each artifact
   against its own sealed Hash; it never runs a later workspace migration that
   would invalidate an already returned activation target.
8. An explicit user choice to adopt conflicting disk bytes through force-unlock
   clears the old identity marker only after recording that complete disk Hash,
   then immediately re-enters the same recoverable migration. Ordinary external
   edits that lose identities still fail closed; this exception exists only for
   the product's explicit conflict-resolution action.
9. Recovery remains compatible with an interrupted schema-v4 Promotion written
   before `workingCopySourceSha256` existed. A legacy prepared Working Copy was
   byte-identical to its Candidate, so recovery derives that hash only when the
   member is absent, publishes without claiming the identity marker, and then
   enters the same controlled Working Copy migration. Present invalid values
   still fail closed. Identity materialization also enforces the 20 MiB managed
   HTML cap before import publication, migration CAS, save, or Promotion staging.

## Consequences

- Opening an old managed project in Edit can change only its current Working
  Copy bytes, through a recoverable CAS transaction. The immutable history and
  the original external HTML remain untouched.
- The first managed Working Copy may differ from its exact imported V1 only by
  the persistent identity attributes; this is represented by the existing
  `baseSha256`, `currentSha256` and `differsFromBase` fields.
- A promoted Working Copy can likewise differ from its immutable Candidate
  Version only by identity materialization performed inside the Promotion
  transaction.
- Partial valid identity sets converge once. Invalid or later-damaged sets are
  explicit errors rather than a heuristic rebinding opportunity.
- Runtime DOM serialization remains prohibited.

## Rejected alternatives

- **Rewrite every Version.** This destroys immutable history and changes frozen
  AI inputs.
- **Inject on render.** This creates an untracked second writer and cannot
  provide durable identity.
- **Use an ordinary autosave without a migration record.** A crash between HTML
  replacement and state publication would make the new inode and Hash
  unauditable.
- **Repair duplicate or malformed values automatically.** No deterministic
  repair can prove which authored element owns the old identity.
