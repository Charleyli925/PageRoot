# ADR 0023: Exact legacy V4 Registry metadata completion

- Status: Superseded by [ADR 0028](../0028-unrecognized-registry-fails-closed.md); the migration and its dedicated lock were
  removed before the V4 project files ever shipped
- Date: 2026-08-14
- Extends: ADR 0022

> The shape this ADR migrated existed on `main` for 6h13m on 2026-08-14 and was
> never part of a tagged release, so no user disk can hold it. Unrecognized
> Registry shapes now take the same fail-closed validator path as every other
> unknown shape. Retained as the record of why the migration existed.

## Context

The pre-hardening Developer Preview wrote the `4.0.0` Registry version before
the Registry acquired a durable root filesystem identity and
`pendingImports`. Current V4 readers correctly reject that incomplete shape,
which prevents previously valid managed Working Copies from hydrating even
though their project roots already satisfy the V4 authority boundary.

Treating the old shape as a general registry repair would violate ADR 0022. A
matching path, filename, HTML Hash, copied `.pageroot` directory or duplicate
`projectId` cannot grant a root write authority. Pre-V4 project state also
remains intentionally incompatible and is not an input to this decision.

## Decision

`ProjectFileRepository` first validates the current Registry and returns a
valid current object without rewriting it. It may migrate only this exact old
shape:

- `schemaVersion` is exactly `"4.0.0"`;
- top-level keys are exactly `schemaVersion`, `updatedAt` and `projects`, with
  no `pendingImports`;
- every project record has exactly `projectRootPath` and `updatedAt`.

For every legacy record, migration validates the key format, timestamp, direct
child location under the configured project root, component-by-component real
path containment, non-symlink directory and matching valid
`.pageroot/project.json`. It derives `rootFileIdentity` from the actual root
directory stat. It never derives identity from a path name, source HTML, equal
bytes or an HTML Hash.

The repository first takes a short-lived exclusive migration lock under the
configured projects root. A waiter re-reads the Registry only after owning that
lock: if another Bridge process already published a valid current Registry, it
returns that record read-only. Otherwise, only after every legacy record
validates does it construct the entire current Registry in memory with
`registeredProjectRootPath`, `rootFileIdentity`, original record timestamps and
`pendingImports: {}`. It validates that current object, rechecks the original
Registry SHA, writes a byte-for-byte Hash-named backup under the configured
projects root, rechecks the source SHA again, then atomically publishes the
complete current Registry. The lock is transient coordination rather than
Registry authority. A proved-dead, sealed owner is reclaimed only after its
token-named marker is atomically claimed, then that claimed directory is moved
aside before cleanup; an unsealed or malformed lock fails busy rather than
being guessed or deleted. The backup is evidence only and is never read as a
Registry authority.

Any invalid, mixed or changing Registry; escaping, missing or symlinked root;
or project-ID mismatch fails closed. The original Registry remains unchanged on
all pre-publication failures; atomic publication leaves either those original
bytes or one complete current Registry. Migration never resets or drops a
record, scans for a replacement root, reassociates an ID, imports a Project, or
writes Project, Working Copy, Version, Draft, comment, attachment or source
HTML content. A second read of the published current shape is read-only.

## Consequences

- Existing managed V4 Working Copies made by the affected Developer Preview can
  hydrate through the ordinary Registry authority path.
- The same authority rules as ADR 0022 continue to apply after migration;
  copies, moved roots and unrelated HTML remain external.
- The migration has a small, auditable write set: one transient exclusive lock,
  one backup and one atomic Registry replacement, only after complete
  validation.
- Tests must prove current no-op, valid single/multiple/empty migration,
  rejection without Registry SHA change, concurrent import serialization,
  stale-owner replacement-lock safety, atomic old-or-complete recovery, Bridge first-open, and desktop
  edit/comment/reopen behavior with external HTML bytes unchanged.

## Rejected alternatives

### Rebuild a Registry by scanning project folders

Rejected because a copied control directory and duplicate project ID do not
prove user intent or durable write authority.

### Reassociate from an equal source HTML Hash

Rejected because equal bytes at different paths are different user files and a
Hash validates content only after identity authorization.

### Migrate all old project formats

Rejected because it reopens ADR 0022's deliberately closed pre-V4 project
boundary and would make frozen Project, Request and Version evidence mutable.
