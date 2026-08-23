# ADR 0038: A changed original may be imported as a second project, but only by explicit choice, and the path binding transfers instead of forking

- Status: Proposed
- Date: 2026-08-23
- Extends: ADR 0026, ADR 0027
- Product: [IMPORT_CONFIRMATION_PRD.md](../IMPORT_CONFIRMATION_PRD.md) §6, §13
- Depends on: PR #277 rewrote the B-class confirmation copy; the third action
  described here is added to that dialog, not to the pre-#277 one.

## Context

ADR 0026 made one canonical external path a long-lived lookup to exactly one
`projectId`. ADR 0027 turned every desktop open into a read-only classification
where class B — an external original already bound to a project — offers exactly
one forward action. Together they gave PageRoot the property that matters most
here: double-clicking the same original twice never silently forks the user's
work into two projects.

That property is correct while the original still holds the bytes PageRoot
imported. It is incomplete once the original has changed. Repository already
computes this: `sourceRelation` compares the original's current SHA-256 against
`importSourceSha256` recorded at import time. When they differ, the original
holds content that exists nowhere inside PageRoot, and the product's only
answer is "open the previous project" — which opens something else entirely and
says nothing about the content the user may have come back for.

The obvious fix — classify a changed original as new and import it — is wrong,
for reasons that are worth recording because they are not obvious:

1. **The `changed` bar is one byte.** The comparison is exact SHA-256 equality
   against the import-time digest. An editor appending a trailing newline, a
   formatter run, a CRLF conversion, a sync client rewriting the file, or a
   `git checkout` all flip `changed` with no user intent. Auto-creating a project
   on that signal shows the user a fresh project with an empty history, whose
   first reading is "everything I did in PageRoot is gone."
2. **`changed` does not say which side is newer.** It says the original differs
   from the common ancestor. The user has meanwhile been editing inside PageRoot,
   so the normal case is that *both* sides moved away from V1. This is a fork.
   Automatically deciding that the original wins silently discards the other
   branch; automatically deciding the project wins is today's behaviour. Neither
   is a decision the system is entitled to make.
3. **The state is sticky, so automation compounds.** The comparison baseline is
   the import-time digest and is never re-synchronised. Every subsequent external
   edit followed by a double-click would mint another project, and the projects
   root fills with same-named projects.

There is also a hard mechanical obstacle, and it is deliberate rather than
missing. `ProjectFileRepository#importExternal` resolves the external source
binding before publishing anything and, when a binding exists, returns
`{ imported: false, target: bound.openTarget }` — it does not error, it routes
the caller back to the existing project. `#resolveExternalSourceBinding` throws
`EXTERNAL_SOURCE_BINDING_CONFLICT` whenever more than one committed project
claims the same `importSourceKey`. So forcing a second binding onto one path
does not produce two usable projects; it produces an original HTML that can
never be opened again, and an existing project that can no longer be reached
through it. Any design here must therefore answer where the binding lives, not
only which button exists.

`IMPORT_CONFIRMATION_PRD.md` §13 already anticipated this request and constrained
it: releasing an old association and importing the path as a new project must be
an explicit, auditable flow that does not delete the old project, and must never
be guessed automatically.

## Decision

A changed original may become a second project. The choice is the user's, the
uniqueness invariant is preserved by transferring the binding rather than
duplicating it, and the previous project is never destroyed.

1. **The action exists only while the original has changed.** The B-class
   confirmation offers `import-as-new` only when `sourceRelation === "changed"`.
   While the original is unchanged, a second project would be a byte-identical
   duplicate carrying no information, and the dialog keeps the two actions
   established by PR #277. This is what makes the third action defensible: it
   appears exactly when it is not a duplicate.

2. **`import-as-new` is a distinct action, never a reclassification.** The intent
   stays class B throughout. Repository does not start reporting a bound path as
   `new-external`, because that would also change what happens on the paths that
   do not ask for this — startup restore, Recent, and the file picker — and would
   reintroduce silent forking through a side door.

3. **The binding transfers to the new project.** On commit, the new project
   becomes the single committed claim for that `importSourceKey`, and the
   previous project's claim is released in the same Registry write. One canonical
   path still resolves to exactly one project, so ADR 0026's uniqueness rule and
   the `EXTERNAL_SOURCE_BINDING_CONFLICT` guard stay exactly as they are. A later
   double-click of that original therefore lands on the new project, which is the
   project whose V1 matches the bytes on disk.

   The rejected alternative is one-to-many with a chooser. It models the truth
   more faithfully but makes *every* subsequent open a decision, which is more
   friction than the problem being solved, and it needs a second selection UI
   that has no other use.

4. **The previous project is unbound, never deleted.** Its directory, versions,
   Working Copy, comments and attachments are untouched. It stays reachable from
   the projects root and from Recent. The transfer is recorded so it can be
   audited and explained: the release names the project that lost the binding and
   the project that took it.

5. **The transfer is one Registry transaction under the existing write lock.**
   Release and claim cannot be observed separately. A crash between them must
   leave either the old binding or the new one intact — never zero bindings, which
   would silently downgrade the original to class C and reintroduce the fork this
   ADR exists to prevent, and never two, which would make the path unopenable.
   Recovery follows the existing `pendingImports` publish-or-clear path: a pending
   import that cannot be published leaves the previous binding in force.

6. **Confirmation still fails closed on drift.** The original's digest is re-read
   inside `ProjectOpenQueue` at commit time, as ADR 0027 already requires. If the
   original changed again during confirmation, nothing is imported and nothing is
   unbound; the user reopens. The Canvas verification, rollback and finalize
   sequence is unchanged, so a failed Canvas restores the previous project *and*
   the previous binding.

7. **Deleting the original stays out of this action.** ADR 0027 permits
   `shell.trashItem` only for a class C first import whose checkbox the user
   ticked. `import-as-new` never trashes the original, and the confirmation shows
   no delete option, because the original is the only copy of the content the
   user is choosing to keep.

8. **The user is told the original changed.** The confirmation states that the
   original was modified after import and that the previous project does not
   contain those changes. This sentence is the reason the third action is
   offered, so it is required whenever the action is offered — it is not optional
   detail, and its removal would leave an unexplained button.

## Consequences

- The user gains a way to bring an externally edited original into PageRoot
  without losing the project built from its earlier bytes. Both contents exist,
  as two projects, because they are genuinely two different documents.
- Nothing forks automatically. Every path that does not carry an explicit
  `import-as-new` action behaves exactly as it does today, so a formatter run or
  a sync client can still only ever produce a confirmation, never a project.
- ADR 0026's one-path-one-project rule survives unchanged. What becomes mutable
  is which project a path points at, and only through one audited transaction.
- The previous project loses its external-source link. Reopening that original
  will no longer route to it, so users who relied on the original as the way back
  into that project need the projects root or Recent instead; the confirmation
  must say so before the transfer, not after. Its imported asset root is a
  separate record: `importedAssetRoots` is keyed by project root path in desktop
  state, so the previous project keeps resolving relative assets from the
  original's directory. Both projects then read assets from the same directory,
  which is correct — they descend from the same file — but means neither owns it.
- Repeated use produces one project per external edit the user chose to import.
  That is bounded by explicit choices rather than by file-system noise, but the
  projects root can still accumulate same-stemmed projects, and project naming
  must keep disambiguating them.
- `#importExternal`'s current "already bound, return the existing target" guard is
  no longer the whole story. It stays the default; the transfer becomes a separate
  authorised entry point rather than a relaxation of that guard, so no existing
  caller changes behaviour.
- This ADR authorises nothing about comparing, merging or synchronising the two
  contents. Showing a diff between a changed original and a project, or importing
  the changes into the existing project as a new Version, remains unspecified and
  needs its own decision.
