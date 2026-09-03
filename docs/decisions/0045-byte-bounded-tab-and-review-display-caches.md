# ADR 0045: Byte-bounded display caches accelerate tabs and review

- Status: Accepted
- Date: 2026-08-27
- Scope: document-tab display projections, formal-review preparation and post-accept presentation

## Decision

PageRoot keeps one authoritative `WorkspaceController`, one mutable
`DocumentSession` and one editable Canvas. Faster tab switching is implemented
with a separate `DocumentSurfaceCacheSession` whose entries are disposable,
read-only projections:

- **hot**: at most three recent exact HTML entries keep script-disabled iframes
  mounted; inactive frames are hidden and have no editing or serialization API;
- **warm**: exact HTML, SHA-256, source identity, Canvas mode, allowlisted
  `PageViewContext` and scroll position remain in a byte-bounded LRU;
- **cold**: the tab keeps only its durable `projectId + documentId` identity.

The cache holds at most eight HTML entries and 48 MiB. Tab count remains
unlimited because eviction removes only the projection, not the tab. A cache
entry is admitted only when Document revision is fully persisted and the
current Canvas has verified the identical source SHA-256. Selecting a cached
tab may display that safe scroll-only frame immediately, but the normal registered-project
open, Registry/OpenTarget validation, source read, hydration and Canvas gates
still run. Cached bytes never become Source, save, Version or export authority.
Restart persistence remains identity-only.
After restart, a trusted read-only Registry projection may repopulate the active
display cache before normal activation and then prewarm inactive tabs while the
app is idle. Those bytes remain presentation-only and are never persisted with
the tab identities.

Formal Review retains exact operation/base/candidate/path/comment cache entries
created by an explicit Review command across tab applications. Candidate-ready
state does not precompute Review data. On an uncached explicit Review, a minimally prepared
before/after transport mounts first with the same sandbox/bootstrap policy; the
semantic diff, comment annotations and optional runtime visual facts replace
that shell when ready.

Accepting a Candidate uses durable promotion plus synchronous Project,
Document, Version, Draft and Comment publication as the visible cut. Review
closes at `version-activation-published`; mandatory Canvas verification and
workspace refresh continue behind the sole edit surface. A later Canvas failure
keeps the committed source visible but locked and uses the existing recovery
path. It never restores obsolete review bytes as current authority.

## Rejected alternatives

- Retaining multiple editable iframes would duplicate contenteditable,
  Selection, IME, observers and mutation authority.
- Persisting cached HTML or paths with tabs would create a second source and
  filesystem-authority channel.
- Treating review annotations or runtime snapshots as an acceptance gate would
  keep the user behind optional analysis after exact Candidate validation.
- Closing Review only after Canvas verification would continue exposing
  rendering latency after the version was already durably promoted.

## Required proof

- Dirty, unpersisted, failed or SHA-mismatched documents are not cached.
- Hot count, warm count and aggregate bytes are bounded; eviction never removes
  tab identities.
- Tab activation shows only read-only cached HTML and still invokes the normal
  project-open workflow.
- Review cache survives a tab application, stale in-flight work is cancelled,
  Candidate-ready state starts no analysis, and uncached explicit Review
  publishes its shell before semantic analysis completes.
- Candidate publication occurs before awaited Canvas verification, while the
  run completes only after verification succeeds.
