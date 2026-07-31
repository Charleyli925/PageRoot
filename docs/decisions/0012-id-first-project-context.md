# ADR 0012: Registered project mutations resolve identity before path

- Status: Accepted
- Date: 2026-07-31

## Context

PageRoot writes source HTML with a same-directory atomic replacement. The new
file has a different inode even though it is still the same logical Document.
There is a narrow crash or concurrency interval after the replacement reaches
disk but before `project.json`, runtime state and registry file identity are all
refreshed.

Registered mutation routes previously began by resolving the mutable
`sourcePath`, with creation enabled on several paths. An attachment, Draft or
Request arriving in that interval could interpret PageRoot's own replacement
as an unrelated file and create a second Project. Renderer attachment cleanup
could also reread the current session after an asynchronous upload and combine
the old operation with a newer project's identity.

## Decision

- A renderer user intent captures one complete ProjectContext:
  `projectId + documentId + sourcePath`.
- An already registered Bridge mutation resolves the registry graph by both
  opaque IDs first. The submitted path is then validated as that project's
  canonical source or an explicit registered alias; it is not an identity
  lookup key. Before accepting the mutation, the canonical source inode and
  Hash are revalidated against the registry and the same durable observation
  evidence used by path-based project loading.
- Supplying only one ID is invalid. Omitting both IDs remains a bounded
  compatibility path for older local callers, but it can address only an
  existing registration.
- `/project/ensure` is the only route allowed to create a Project or Document.
- The existing project's durable `pendingWrite.targetHtmlSha256` proves
  PageRoot's own atomic-replacement interval. When current source bytes match
  that Hash, the Bridge repairs file identity in place and continues recovery.
  A matching registered current Hash and the bounded legacy document stamp are
  the other accepted observations. A recorded conflict external Hash and a
  ready transaction's exact expected Hash permit only the existing locked
  conflict or activation flow to continue; they do not update source identity.
  All unrelated physical replacements fail closed.
- Attachment upload and compensating deletion retain the same captured
  ProjectContext for their complete asynchronous lifetime.

## Rejected alternatives

### Treat every inode change as a new document

Rejected because PageRoot's required atomic source writer changes the inode on
every successful update. This would turn ordinary saves into identity splits.

### Serialize all routes under one path lock

Rejected because the path is mutable and therefore cannot be the authority
that defines the lock owner. It would also leave crash recovery unable to
distinguish a PageRoot replacement from an external one.

### Stamp new metadata into user HTML

Rejected because project identity belongs to managed sidecars. Rewriting user
HTML solely for bookkeeping would change source bytes outside the user's edit
and would not protect the pre-stamp concurrency window.

## Consequences

- A concurrent attachment, Draft, Request or recovery command cannot create a
  second Project for a registered Document.
- A source-path mismatch is reported as a structured conflict without writing
  source bytes or managed artifacts into another project.
- An unrelated same-path replacement is rejected before a registered metadata
  mutation can write Draft, attachment, Request or project-rule artifacts.
- The registry, `project.json` and runtime outbox remain the durable identity
  and recovery evidence; preview DOM and renderer-current refs are not used.
- Failure-injection coverage must exercise both registered mutation and
  `/project/ensure` calls after source application but before sidecar refresh,
  and must prove the registry still contains exactly one Project and Document.
