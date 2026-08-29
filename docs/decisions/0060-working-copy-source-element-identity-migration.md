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
   claimed by its current source. Existing edit operations may author a new
   wrapper or line-break element before the semantic-operation PRs land, so the
   Repository assigns identities only to otherwise valid missing-ID additions
   before publication. A malformed, duplicate or missing prior claim fails
   closed. This PR does not convert TargetRef, comments, undo/redo, AI identity
   continuity or Review pairing; those remain dependent PRs. Until ID-based
   Review lands, its legacy exact-subtree signature treats every PageRoot
   attribute, including the persistent ID, as disposable comparison metadata.

## Consequences

- Opening an old managed project in Edit can change only its current Working
  Copy bytes, through a recoverable CAS transaction. The immutable history and
  the original external HTML remain untouched.
- The first managed Working Copy may differ from its exact imported V1 only by
  the persistent identity attributes; this is represented by the existing
  `baseSha256`, `currentSha256` and `differsFromBase` fields.
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
