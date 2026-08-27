# ADR 0028: Unrecognized project Registry shapes fail closed, with no migration

- Status: Accepted
- Date: 2026-08-17
- Supersedes: ADR 0023
- Extends: ADR 0022, ADR 0026

## Context

ADR 0023 added a migration for one exact historical Registry shape: top-level
`schemaVersion`, `updatedAt` and `projects` with no `pendingImports`, and project
records containing exactly `projectRootPath` and `updatedAt`. It came with a
second cross-process file lock, dedicated to serializing that one replacement
across Bridge processes, plus a hash-named backup of the original bytes.

Three facts about that shape were established from Git history rather than
assumption:

- `bridge/project-file-repository.mjs` does not exist in `v0.9.8`, the newest
  tag. The V4 project files have never been part of a tagged release.
- The shape was introduced by `4fe5eb7` at 2026-08-14 15:04 and the migration
  for it landed in `379523b` at 2026-08-14 21:17 — a window of 6h13m on `main`.
- Only a developer machine that ran `main` inside that window can hold it.

The cost side was measured too. The dedicated migration lock was a near-verbatim
copy of the current Registry write lock: acquire, retire, release, path, marker,
owner and lease helpers, about 230 lines. The two copies had already diverged in
three places — release swallowing versus rethrowing, whether release syncs the
parent directory, and the comment and branch around a transient lease read. Both
copies also carried the same defect class, where an unresolvable lock directory
could never be reclaimed.

## Decision

1. The exact-legacy-V4 Registry migration is removed, together with its dedicated
   `.pageroot-registry-migration-lock/` protocol and the
   `.pageroot-registry-backups/` copy it produced.
2. `#readRegistry` performs one validation. Any Registry that is not a valid
   current Registry fails closed through the existing validator, which is the
   path every other unknown, mixed or extended shape already took.
3. Failing closed is deliberate and is not a fallback to an empty Registry. An
   empty Registry would validate, and the next import would then atomically
   replace the real file — destroying every recorded external-source binding and
   root filesystem identity while leaving the project directories orphaned on
   disk. Refusing to read is recoverable; overwriting is not.
4. `.pageroot-registry-write-lock/` remains the only Registry lock. `ADR 0026`
   item 4 and `docs/SECURITY_MODEL.md` no longer need to distinguish two locks.

## Consequences

- The privileged persistence layer loses 454 lines of production code and 588
  lines of test code, and one of its two cross-process lock protocols.
- No shipped PageRoot can produce the removed shape, so no released version
  changes behavior. A developer machine holding it sees a 422
  `UNSUPPORTED_REGISTRY_SCHEMA` instead of a silent migration; its managed HTML
  and project directories are untouched, and re-importing rebuilds the Registry.
- `docs/COMPATIBILITY.md` no longer claims a migration for this shape.
- The remaining lock keeps the reclaim behavior added for unresolvable residue,
  now with a single implementation to maintain instead of two divergent ones.

## Rejected alternatives

- **Keep the migration but run it under the current Registry write lock.** This
  would still remove the duplicated protocol and would preserve the migration for
  the narrow developer population. Rejected because it retains about 200 lines and
  a re-entrancy path in the most dangerous file in the repository to serve a shape
  that no user disk can hold, and because the migration would then be able to
  block ordinary Registry writes.
- **Fall back to an empty Registry when validation fails.** Rejected as data loss;
  see Decision item 3.
- **Leave the whole cluster in place.** Rejected because two divergent copies of a
  cross-process lock in the privileged persistence layer is a standing hazard, and
  the divergence had already begun.
