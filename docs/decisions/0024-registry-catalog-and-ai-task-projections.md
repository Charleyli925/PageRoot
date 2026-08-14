# ADR 0024: Registry catalog and AI-task projection authority

- Status: Accepted
- Date: 2026-08-15
- Extends: ADR 0022 and ADR 0023

## Context

The v4 Registry already defines the only user-authorized project root, but the
desktop Recent list was previously the visible project-list source. That makes
a recency cache appear to decide whether a registered project exists or can be
opened. At the same time, product users need a Finder-visible per-AI-task view
without turning a copied Prompt or Candidate HTML into a second authority chain.

Visible attachment folders, attachment Finder locations and a recoverable
attachment trash are separate P3 work. The current comment attachment records,
limits and immutable Request snapshots remain correct without creating those
P3 paths.

## Decision

`ProjectFileRepository` reads project-list membership only from Registry
records. It may use the existing same-parent root-rename recovery and validates
each member independently, returning ready, unavailable or invalid rows without
scanning for unregistered copies. Desktop Recent is limited to ranking,
`lastOpenedAt` presentation and startup preference. It cannot add, remove or
authorize a catalog member. Renderer opens send only `projectId`; Bridge and
Repository revalidate Registry, Project, Document, Working Copy, OpenTarget,
HTML and Hash before the existing managed-source publication boundary.
Catalog availability uses that same controlled Working Copy resolution before
reading its visible path, so a supported same-root Finder rename rebinds by
stable file identity instead of leaving an otherwise openable project disabled.

`AI任务/` is a rebuildable display projection. Its only sources are the already
durable hidden Request/Attempt/Candidate facts and their frozen hashes. Before
publishing, Repository revalidates project identity, Registry root, request,
attempt, candidate, proposed Version, based-on/previous lineage and hashes. The
narrow materializer writes a receipt under
`.pageroot/recovery/ai-task-projections/`, then uses exclusive directories and
no-replace files to publish:

```text
AI任务/<YYYY-MM-DD>-候选版本N[/suffix]/
├── PROMPT.md
└── <stem>-Vn-待审阅.html       # only after Candidate verification
```

The receipt records display progress only; it cannot recreate a Request,
Candidate, Version or runtime state. P2 does not publish `附件快照说明.md`,
`附件与图片/`, `AI_RULES.md`, `PROJECT.md`, or a formal Version in this tree.
AI writes only its fixed hidden Attempt `candidate.html` output.
The Candidate display filename is likewise not receipt identity or Candidate
authority: it is re-derived from the currently verified Working Copy naming.
If a same-root Finder rename occurs after `PROMPT.md` is visible, the next
materialization updates the display receipt and either completes the existing
safe directory or allocates a collision-free one; it never rejects the hidden
Candidate because of a display-only filename change.

The Finder UI calls `revealAiTask` with the current source locator only. Bridge
re-resolves the managed project and returns only a validated, root-contained,
non-symlink direct child of `AI任务/`. It accepts no Renderer-supplied Request
path and never opens `.pageroot/requests/...`. Project Finder opens the
validated project root; Version Finder opens the validated visible Working Copy,
not an immutable snapshot. A no-change or unusable-Candidate terminal result
retains a sealed `lastAiTask` display anchor in runtime so the existing terminal
panel can still reveal its Prompt; that anchor is not an active run, Candidate
or Promotion authority.

## Consequences

- Registered projects remain visible even when never recently opened; clearing
  Recent changes ordering only.
- A missing, tampered, user-occupied or symlinked AI-task path cannot change
  review or Promotion. The materializer either reconstructs the receipt-linked
  safe display or allocates a distinct safe directory without overwriting user
  files.
- Candidate review and Promotion always read the hidden Candidate and its hash.
  A visible copy cannot produce a second Candidate or advance a Version.
- Tests cover catalog membership versus Recent ranking, validated project opens,
  status/lineage projection, visible Working Copy Finder resolution, every
  AI-task publication failpoint, tamper/delete reconstruction, and a real
  Electron/Finder V2-to-V7 path.

## Rejected alternatives

### Use Recent as the project catalog

Rejected because a local recency cache does not prove Registry membership or
write authority and would hide a valid registered project after clearing Recent.

### Let the Renderer choose a Request folder for Finder

Rejected because it exposes hidden implementation paths and weakens the Bridge
path boundary. Source-based re-resolution preserves the existing project
identity checks.

### Make `AI任务/` a Candidate or Promotion source

Rejected because users may delete or modify Finder-visible files. Candidate and
Promotion authority must stay immutable, hidden and hash-validated.

### Ship visible attachments with AI-task projection

Rejected because attachment user-file lifecycle, Finder location and recovery
trash need their own P3 authority and UX decision; adding them here would blur
the no-authority display boundary.
