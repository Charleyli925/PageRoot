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
- Registries and project files without the readable-storage metadata are
  rejected without migration, renaming or deletion.

## Consequences

Finder exposes recognizable, collision-resistant project folders while
protocol records retain stable opaque identities. Registry and `project.json`
metadata must agree before a project can be used, and directory names are
validated as one bounded path segment tied to the project token.

This is a clean storage-layout cutover. Existing UUID directories remain on
disk untouched but are not accepted by the new Bridge. Project creation may
leave an unregistered orphan if the process stops before the registry publish;
as before, recovery never scans or guesses ownership from directory names.
