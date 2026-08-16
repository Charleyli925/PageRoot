# ADR 0026: External source to project binding is a long-lived lookup

- Status: Accepted
- Date: 2026-08-16
- Extends: ADR 0022, ADR 0023
- Product: [IMPORT_CONFIRMATION_PRD.md](../IMPORT_CONFIRMATION_PRD.md) v1.2

## Context

Registry project records already store an optional
`importSourceKey` / `importSourceSha256` pair. The previous reader treated that
pair as a one-shot import retry: it only returned the existing project when the
latest official Version was still V1, the active Working Copy was still the V1
Working Copy, and the visible V1 file still hashed to the first import. After a
normal local edit, a Promotion to V2+, or a historical Working Copy
continuation, opening the same external original created a second project.

Equal HTML bytes on another path must remain a different project. A Hash scan
of V1 snapshots is not an identity system. Multiple Registry claims for one
source key are an integrity fault, not a user-facing chooser.

## Decision

1. `importSourceKey` is an opaque digest of the canonical, real, non-symlink
   external path. It is a long-lived lookup from that path to at most one
   `projectId`. It is not write authority, not a portable file identity, and
   not a content-addressed index.
2. `importSourceSha256` is the first-import byte Hash. It decides only
   `sourceRelation: unchanged | changed` and confirmation-period CAS. It never
   decides whether a binding exists, and it never matches a file at another
   path.
3. `#importExternal` and `classifyOpenPath` resolve that lookup before creating
   a project. A unique committed claim returns the project's **current active
   Working Copy**. A missing Working Copy, invalid V1 snapshot, or multiple
   claims fail closed and do not create a substitute project.
4. Current Registry read-modify-write uses a dedicated
   `.pageroot-registry-write-lock/` distinct from the exact-legacy-V4
   migration lock. Dead-owner retirement claims the exact sealed token marker
   before moving the lock directory. Live owners wait or fail `REGISTRY_BUSY`.
5. The product does not offer a multi-project ambiguity selector, Hash
   deduplication, or cross-path tracking after the original file is moved.

## Consequences

- Re-opening a retained original after local edits or Promotion returns the
  same `projectId` even while the confirmation UI is still pending.
- Copies, unlisted HTML inside a project root, and identical bytes at another
  path still import as independent projects.
- Renderer and Bridge classification responses must not include the raw source
  key, Registry record, external absolute path, hidden snapshot path, or HTML
  body.
- Confirmation dialogs, Prepared Intent, trash-after-import, and Canvas
  terminal ACK remain a later PR.

## Rejected alternatives

### Keep the clean-V1 retry predicate

Rejected because ordinary editing is enough to lose the binding.

### Deduplicate by V1 Hash

Rejected because two different files with the same bytes are still two
projects.

### Reuse the legacy V4 migration lock for current writes

Rejected because that lock exists only to complete one historical Registry
shape. Current mutations need their own owner, timeout and error code.
