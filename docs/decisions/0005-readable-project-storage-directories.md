# ADR 0005: Project identity is separate from its readable storage directory

- Status: Accepted
- Date: 2026-07-28

## Context

Project records were stored directly under the opaque `projectId`, producing
Finder names such as `project_4a7ea0c68a1840ca8ac4bc6705969356`.
Those names were stable for machines but did not help a user distinguish
projects. Using only the HTML filename would remain ambiguous when the same file
is registered more than once.

## Decision

- `projectId` remains the stable internal identity used by runtime, Request,
  Attempt and Version records.
- Project creation persists `displayName`, immutable `createdAt` and immutable
  `storageDirectoryName` in both `project.json` and the project registry.
- `displayName` defaults to the HTML filename without its extension.
- `storageDirectoryName` uses
  `<safe display name>__<local YYYYMMDD-HHmmss>__<short project token>`.
  Collisions extend the token while keeping the same project identity.
- Every managed path resolves `projectId` through the registry before accessing
  the readable directory. The finalizer and supplement recorder use the same
  mapping.
- Source-file renames, moves and generated working files do not rename the
  project directory.
- A complete 0.9.0 project is upgraded additively on first start: the Bridge
  derives `displayName` and `createdAt` from its source identity and immutable
  initial Version, then records the existing `projectId` directory as its
  legacy `storageDirectoryName`.
- Legacy project directories are never renamed automatically, because frozen
  Request/Attempt paths may still refer to them. New projects use readable
  directory names.

## Consequences

Finder exposes recognizable, collision-resistant folders for newly registered
projects while protocol records retain stable opaque identities. Existing UUID
directories remain accepted only when the registry, `project.json` and initial
Version prove one matching project identity. The upgrade changes metadata
additively and never scans, moves, guesses ownership, or deletes a directory.

Project creation may leave an unregistered orphan if the process stops before
the registry publish; as before, recovery never scans or guesses ownership
from directory names.
