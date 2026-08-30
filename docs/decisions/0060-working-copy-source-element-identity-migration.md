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
   `sourceElementIdentitySchemaVersion: 1` together with
   `sourceElementIdentityBindingSha256`, a canonical Hash of each ID's authored
   tag, identified parent and source order. Text, attributes and styles do not
   affect this Hash. This binding is an integrity seal for the exact saved
   topology, not a second element identity: `data-pageroot-id` alone defines
   element continuity, while tag, parent and order are preconditions or change
   facts. Legacy records omit both members. The migration is
   idempotent: a complete legacy identity set is adopted without rewriting
   HTML, while a current v1 state plus a matching complete binding performs no
   transaction.
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
6. A normal save from an identity-v1 Working Copy accepts identity-set or
   topology changes only when a system-executed semantic operation proves them.
   The semantic kernel derives `identityDelta` from the operation plus the
   independently parsed before/after complete HTML; callers cannot freely
   declare it. Repository replays the exact SourcePatch chain to prove the byte,
   Hash, CAS and recovery lineage, then independently recomputes the actual ID
   delta and cross-validates the operation and `identityDelta`. SourcePatch
   `kind` is never product authorization. Insert and duplicate add only fresh
   subtree IDs; delete removes only the target subtree; move retains the whole
   subtree while allowing parent/order changes; `replaceSubtree` retains the
   target root ID while replacing descendant identities; `setText` retains the
   target and may retire its descendants. Text-range, attribute and style
   operations admit only their explicitly defined identity effects, including
   kernel-allocated rich-text wrappers and line-break nodes. Retained IDs may
   change tag when the operation permits it. Without this semantic proof, ID
   addition, deletion, swap, transplant, forgery, duplication, tag change or
   topology change fails closed even if an exact byte patch replays.
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
10. A clean external edit is reconciled only when its identity binding Hash
    still matches the last PageRoot-authorized state. Text/attribute/style edits
    may keep their IDs and continue; external ID additions, removals, swaps,
    transplants, forgeries, duplications, tag changes, moves or reparents become
    an explicit Working Copy conflict before the disk Hash is recorded.
    PageRoot semantic saves reseal the newly authorized binding after successful
    CAS; external writes cannot borrow that authority. Force-unlock is the sole user-authorized exception: it
   clears both identity members even when a prior build already recorded the
   disk Hash, adopts those bytes, and re-enters controlled migration.
   Runtime decoding also admits the brief pre-binding identity-v1 state written
   by an older PR2 build, but ordinary reconciliation treats its missing binding
   as a conflict; only explicit force-unlock can establish the first seal.

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
- A stable ID can legally survive tag, parent and order changes. The sealed
  binding records those facts for conflict detection but never overrides the ID.
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
