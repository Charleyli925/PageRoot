# ADR 0039: Deleting a project trashes its registered folder, withdraws authorization first, and keeps the record as a tombstone

- Status: Proposed
- Date: 2026-08-25
- Extends: ADR 0022, ADR 0024, ADR 0027
- Product: [VERSION_AND_PROJECT_FILES_PRD.md](../VERSION_AND_PROJECT_FILES_PRD.md) §6, §12, §14
- Depends on: PR #290 introduced the `pendingProjectRenames` marker and its
  identity-checked commit. The deletion marker described here lives beside it in
  the same Registry write lock and reuses that recovery shape rather than
  inventing a second one.

## Context

PageRoot has never been able to delete a project. That is not an oversight in
the UI layer; three separate parts of the system are currently built on the
assumption that it cannot happen, and each has to be answered explicitly.

**Registry membership has no removal path, by construction.** ADR 0022 made the
registered project root user-owned with Registry as its single write authority.
ADR 0024 then made Registry the only source of catalog membership and denied the
one component that looked like it could shrink the list: "Desktop Recent is
limited to ranking, `lastOpenedAt` presentation and startup preference. It
cannot add, remove or authorize a catalog member." So removal was never
considered and rejected — it was never expressible. Every existing Registry
mutation adds a record, rebinds a path, or transfers a claim. This is the first
one that takes a member out.

**The projects root is explicitly protected from trashing.** `assertTrashableOriginal()`
in `desktop/main.mjs` refuses any path inside the projects root:
`isInsideDirectory(canonical, projectsRootPath())` throws
`EXTERNAL_OPEN_DELETE_NOT_ALLOWED` — "不能删除项目目录里的文件。" ADR 0027's own
title names the scope that guard serves: *out-of-root* trash. The only thing
PageRoot may trash today is the external original of a class C first import,
with the user's ticked checkbox, and only after Canvas verified the import
committed. A managed file inside the projects root can never be that original,
so the guard is not merely conservative — it is load-bearing, and relaxing it
would widen a path whose entire purpose is to be narrow.

**Every other recovery in the product is guaranteed from inside it.** Versions
are immutable, drafts survive crashes, a folder moved in Finder is found again by
file identity, a lost mutation reply is reconciled from what Desktop reports.
Deletion has none of those properties: the versions, drafts, comments,
attachments and AI request records of a project all live inside the one directory
being removed, and whatever recovery exists afterwards depends on the operating
system's trash rather than on a PageRoot invariant. This is the first operation
whose recovery leaves the product's own guarantees, so it is the first that has
to be argued rather than merely implemented.

There is also a subtler hazard specific to this product's shape. A project is a
Registry record plus a directory. Deletion has to end the authority of the one
and the presence of the other, and those two cannot end atomically. Whichever
order is chosen, a crash in between leaves a state the rest of the system must
already understand — and the two orders leave *very* different states.

## Decision

A project can be deleted. It means exactly one thing: the whole registered
project folder goes to the system trash, and its Registry membership ends. The
authorization is withdrawn before the bytes move, and the record survives only
as a tombstone that can recognise the folder if the user puts it back.

### 1. `assertTrashableOriginal` is not relaxed, and deletion does not reuse it

Project deletion is a separate path that never calls that function. The guard
keeps refusing everything inside the projects root, because the class C original
it protects is by definition outside. Widening it would make one predicate serve
two operations with opposite requirements — one must never touch the projects
root, the other only ever touches it — and the next reader would have no way to
tell which caller each branch existed for.

The new path carries its own, stricter admission test: the target must be a
direct child of the projects root, must not be a symbolic link, and must match
the path the Registry currently has registered for that `projectId`.

### 2. There is one semantics: move to the trash. No soft delete

PageRoot does not offer "remove from the list but keep the folder where it is."
That option sounds gentler and is in fact the most dangerous state this product
can produce: a directory carrying `.pageroot` metadata, versions and drafts,
sitting in the projects root, authorized by nothing. ADR 0024 already treats an
unregistered copy as something the catalog must never scan for or adopt. A soft
delete would manufacture exactly that orphan on purpose, and the user's next
move — reopening the HTML inside it — would import it as a brand-new project
from V1 while its real history sat one directory away, unreachable.

Conversely PageRoot does not offer a permanent delete either. `shell.trashItem`
hands recovery to the operating system, which the user already knows how to
operate and which PageRoot does not have to reimplement.

The record surviving as a tombstone (§10) is not a soft delete, and the
distinction is load-bearing rather than verbal. Three conditions keep them
apart, and all three are requirements on the implementation:

1. The folder always goes to the trash. There is no path where a deleted
   project's folder stays in the projects root.
2. A tombstone authorizes nothing. It cannot be written to, opened, saved into,
   or used to resolve a source path.
3. A tombstone never appears in the catalog. The project leaves the product's
   surface the moment it is deleted.

A soft delete violates all three at once; the tombstone violates none. All it
adds is the ability to recognise the folder if it comes back.

### 3. Authorization is withdrawn first, then the folder is trashed

This ordering is the core of the decision, so the failure modes are worth
stating in full.

*Registry first* (chosen): the record becomes a tombstone — membership, catalog
visibility and every write authority end at that moment — the write lands, then
the directory is trashed. If the trash step fails or the process dies before it,
the folder is still in the projects root, nothing authorizes it, and PageRoot
knows exactly which project it belongs to. No data is lost, no component is
misled, and §4 defines how the next start resolves it.

*Trash first* (rejected): the directory would be gone while Registry still
authorizes it. Every consumer would then report the project as
`REGISTERED_PROJECT_UNAVAILABLE` — the code that exists to say "your project is
temporarily somewhere else, your changes are retained, put it back and it
recovers." The user would read a true-sounding message that is now a lie: the
folder is in the trash, and restoring it *would* in fact recover the project, so
the product would be simultaneously encouraging recovery and having already
decided on deletion. That is worse than an inert residue, because a dangling
authorization actively misinforms.

The tombstone improves this ordering rather than complicating it. Under a
record-removal design, a crash between the two steps left a directory that
nothing authorized *and nothing could identify* — inert, but anonymous. With a
tombstone the same crash leaves a directory PageRoot can name, which is what
makes §4's recovery possible at all.

### 4. A `pendingProjectDeletion` marker owns the window between the two steps

The tombstone records that a project was deleted. It does not record whether the
trash actually happened. Those are different facts, and conflating them produces
a specific bug: a failed trash would look identical to a successful restore, so
the project would quietly reappear in the catalog and the failure would never be
reported.

The marker exists to close exactly that window. It is written into Registry
under the same write lock, before the record becomes a tombstone, and it holds
the path to be trashed. It is cleared once the trash is confirmed. On the next
start:

- marker present, folder absent from the recorded path — the trash completed, or
  the user moved the folder. Clear the marker and leave the tombstone.
- marker present, folder still at the recorded path with the recorded identity —
  the trash never completed. This is a pending deletion, not a restore. PageRoot
  resolves it explicitly and never silently readmits the project.

It cannot resurrect membership on its own: the marker holds a path, and only the
identity check in §10 can turn a folder back into a project.

The marker lives in Registry rather than in desktop state for the same reason
the rename marker does — Registry already has the write lock and is already the
sole authority over registered paths, so a second location would create a second
authority over the same fact.

### 5. Repository decides; Desktop trashes

`ProjectFileRepository.deleteRegisteredProject({ projectId, expectedProjectRootPath })`
performs all validation and the Registry write that converts the record to a
tombstone, and returns the absolute path to be trashed. It does not call
`shell.trashItem`, because the repository runs without Electron and must stay
that way.

The main process then validates the returned path *independently* before
trashing it — canonicalize, refuse a symbolic link, require containment in the
projects root, and require that it be exactly a direct child. Repository's
validation is not accepted on trust across the IPC boundary; a returned path is
an instruction, and the process holding the destructive primitive re-earns the
right to use it.

### 6. The caller must name the project it believes it is deleting

`expectedProjectRootPath` is required and must equal the currently registered
path. A stale list — a folder renamed in Finder, a project deleted in another
window, a snapshot the renderer never refreshed — then fails closed instead of
deleting a different project than the one whose name the user just confirmed.
This is the same reasoning that makes every other mutation in this codebase
carry an expected Hash or identity tuple, applied to the one operation whose
mistake cannot be corrected without leaving the product.

### 7. Deleting the open project goes through the existing close boundary

Deletion is a project switch whose destination happens to be "no project." It
therefore uses the same drain the switch path already uses: close request
identity plus the registered drain obligations. Unsaved drafts, an in-flight
save, and an AI run in progress all block it exactly as they block a switch —
there is no separate, weaker check for deletion, and no silent discard.

After the trash succeeds, `activeManagedLocator` is cleared if the deleted
project was the active one; it names the project the user is working in, and
that is no longer true. The `importedAssetRoots` entry is deliberately left in
place: it is keyed by the project root path, it is inert while that path does
not exist, and leaving it means a restored project resolves its imported assets
without needing a second recovery mechanism. One stale key is a smaller cost
than an incomplete restore.

### 8. The tombstone releases the external-source claim but remembers it

The project's `importSourceKey` claim must stop being honoured the moment the
project is deleted. If a tombstone kept claiming it, reopening the original
external HTML would resolve to a deleted project: the user could neither open it
nor import it again, and that original path would be permanently poisoned by a
deletion PageRoot had already carried out. So the tombstone records the key it
used to hold and asserts nothing with it.

Reopening the original external HTML after a deletion is therefore a class C
first import — a new project starting at V1. That is surprising enough that the
confirmation must say so before the deletion, not after. The confirmation states
consequences, not reassurances.

A restore does **not** bring the binding back. By then the user may already have
re-imported that HTML as a new project which now legitimately owns the claim,
and handing it back would leave two projects claiming one original. "Restore the
project, not its binding" is the only rule that cannot produce a conflict, and a
missing binding is a re-establishable inconvenience rather than a lost history.

### 9. The confirmation requires the project name typed back

The dialog names what leaves: the entire project folder, including every
historical version, comment and attachment. It says the folder goes to the
system trash and can be restored from there. It requires the user to type the
project name, because recovery depends on an action outside PageRoot that the
user may not think to take, and because a plain "confirm" button is muscle
memory. The tombstone lowers the cost of a mistake; it does not make the
operation ordinary.

### 10. A restored folder is recognised by file identity, and by nothing else

The tombstone records the `projectId`, the registered root path, and the root
file identity captured under the same write lock before the move — the shape that
PR #290 established for renames.

Recognising a restore is a targeted check, not a search: for each tombstone,
test whether its own recorded path now exists and carries its recorded file
identity. That is one `stat` per tombstone against a path PageRoot wrote down
itself. It is not a scan of the projects root, so ADR 0024's rule that the
catalog never discovers unregistered directories is untouched.

Matching is by file identity **only**. A `projectId` written inside `.pageroot`
is never accepted as a claim to be that project, even though it would cover more
cases. Any directory can carry that file, so honouring it would let a folder the
user duplicated in Finder for safekeeping impersonate a live project — reopening
precisely the "adopt an unregistered copy" path ADR 0024 closed, and reopening it
for a hazard that has nothing to do with deletion.

File identity covers the case that matters. The projects root lives under
`~/Documents` and the trash under `~/.Trash`, so both the move to the trash and
"Put Back" are same-volume renames and the identity survives the round trip. A
user who *copies* a folder out of the trash instead of putting it back gets a new
project from V1 — which is the correct answer, because the original is still in
the trash and a copy is genuinely a different object.

Two limits are accepted rather than solved. If the recorded path is occupied by
the time the user restores, the operating system puts the folder back under a
different name, the recorded path no longer matches, and PageRoot does not claim
it; finding it would require searching the projects root by identity, which is
the scan this section refuses. And a folder restored to somewhere other than the
projects root is not adopted either, because ADR 0022 requires a registered root
to be a direct child of it.

Tombstones have no expiry. Their only ongoing cost is one `stat` each per
refresh, negligible at the scale a personal project catalog reaches, and an
expiry policy would have to answer "when is a user done regretting a deletion" —
a question with no defensible answer. If tombstone volume ever becomes
measurable, that is the signal to revisit, and the fix is a bound on count, not a
timer.

## Consequences

- Users gain the ability to remove a project they no longer want, without
  leaving PageRoot and without needing to know where the projects root is.
- Registry gains its first authorization-withdrawal path. ADR 0024's rule
  survives unchanged in substance: Recent still cannot remove a member, and now
  exactly one audited transaction can. Any future removal path must go through
  this one rather than adding a second.
- Putting the folder back from the system trash restores the project itself — its
  versions, drafts, comments and attachments — because the tombstone is still
  there to recognise it. This is what the operating system's own "Put Back"
  already implies, so the product no longer contradicts it.
- A crash between the Registry write and the trash leaves a folder in the
  projects root that nothing authorizes but PageRoot can identify. It is resolved
  as a pending deletion (§4), never as a silent readmission.
- `REGISTERED_PROJECT_UNAVAILABLE` keeps its current meaning — the project is
  somewhere else and its changes are retained — because deletion never produces
  it. That message stays trustworthy precisely because this ADR chose the other
  ordering.
- Registry now retains one small record per deleted project indefinitely. This is
  a deliberate deferral, not an oversight; §10 records both the reasoning and the
  signal that would reopen it.
- A restored project comes back without its external-source binding, and a folder
  copied out of the trash comes back as a new project from V1. Both are narrower
  than a user might hope, and both are stated in §8 and §10 rather than left to
  be discovered.
- Deleting a project sends its AI request and attempt records to the trash along
  with everything else in the directory. There is no separate retention of run
  history outside the project, and this ADR does not create one.
- This ADR authorizes deleting a whole project only. Deleting a single Version,
  a single comment thread, or the `AI任务/` projection tree remains unspecified.
  Bulk or multi-select deletion is likewise not authorized: the confirmation
  described here is per-project by design.
