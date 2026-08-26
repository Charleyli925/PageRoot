# ADR 0039: Deleting a project trashes its registered folder, and Registry membership is withdrawn first

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

**Nothing else in the product is unrecoverable.** Versions are immutable, drafts
survive crashes, a folder moved in Finder is found again by file identity, a lost
mutation reply is reconciled from what Desktop reports. Deletion has none of
those properties: the versions, drafts, comments, attachments and AI request
records of a project all live inside the one directory being removed. This is
the first operation whose failure mode is permanent loss of user work, so it is
the first that has to be argued rather than merely implemented.

There is also a subtler hazard specific to this product's shape. A project is a
Registry record plus a directory. Deletion has to end both, and they cannot end
atomically. Whichever order is chosen, a crash in between leaves a state the
rest of the system must already understand — and the two orders leave *very*
different states.

## Decision

A project can be deleted. It means exactly one thing: the whole registered
project folder goes to the system trash, and its Registry membership ends. The
authorization is withdrawn before the bytes move.

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

PageRoot does not offer "remove from the list but keep the folder." That option
sounds gentler and is in fact the most dangerous state this product can produce:
a directory carrying `.pageroot` metadata, versions and drafts, sitting in the
projects root, authorized by nothing. ADR 0024 already treats an unregistered
copy as something the catalog must never scan for or adopt. A soft delete would
manufacture exactly that orphan on purpose, and the user's next move — reopening
the HTML inside it — would import it as a brand-new project from V1 while its
real history sat one directory away, unreachable.

Conversely PageRoot does not offer a permanent delete either. `shell.trashItem`
hands recovery to the operating system, which the user already knows how to
operate and which PageRoot does not have to reimplement.

### 3. Registry membership is withdrawn first, then the folder is trashed

This ordering is the core of the decision, so the failure modes are worth
stating in full.

*Registry first* (chosen): the record is removed, the write lands, then the
directory is trashed. If the trash step fails or the process dies before it, the
worst outcome is a directory on disk that nothing authorizes. It is invisible to
the catalog, it cannot be written to, and the user can remove it in Finder. No
data is lost, and no component is misled.

*Trash first* (rejected): the directory would be gone while Registry still
authorizes it. Every consumer would then report the project as
`REGISTERED_PROJECT_UNAVAILABLE` — the code that exists to say "your project is
temporarily somewhere else, your changes are retained, put it back and it
recovers." The user would read a true-sounding message that is now a lie: the
folder is in the trash, and restoring it *would* in fact recover the project, so
the product would be simultaneously encouraging recovery and having already
decided on deletion. That is worse than an orphan directory, because an orphan
is inert while a dangling authorization actively misinforms.

### 4. A `pendingProjectDeletion` marker owns the window between the two steps

The marker is written into Registry under the same write lock, before the record
is removed, and it records the path to be trashed. On the next start, a marker
whose directory is gone is simply cleared; a marker whose directory is still
present is offered for completion. It cannot resurrect membership: the record is
already gone, and the marker holds a path, not a project.

The marker lives in Registry rather than in desktop state for the same reason
the rename marker does — Registry already has the write lock and is already the
sole authority over registered paths, so a second location would create a second
authority over the same fact.

### 5. Repository decides; Desktop trashes

`ProjectFileRepository.deleteRegisteredProject({ projectId, expectedProjectRootPath })`
performs all validation and the Registry write, and returns the absolute path to
be trashed. It does not call `shell.trashItem`, because the repository runs
without Electron and must stay that way.

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
carry an expected Hash or identity tuple, applied to the one operation where
being wrong cannot be undone from inside the product.

### 7. Deleting the open project goes through the existing close boundary

Deletion is a project switch whose destination happens to be "no project." It
therefore uses the same drain the switch path already uses: close request
identity plus the registered drain obligations. Unsaved drafts, an in-flight
save, and an AI run in progress all block it exactly as they block a switch —
there is no separate, weaker check for deletion, and no silent discard.

After the trash succeeds, the desktop records keyed by the deleted project's
root path are cleared: its `importedAssetRoots` entry and, if it was the active
project, `activeManagedLocator`. Both are non-authoritative caches whose keys
would otherwise point into the trash.

### 8. Losing the external-source binding is a consequence, and is stated before the deletion

The project's `importSourceKey` claim lives in the record being removed, so it
ends with it. Reopening the original external HTML afterwards is a class C first
import: a new project starting at V1. That is correct — the history it would
otherwise rebind to has been deleted — but it is surprising enough that the
confirmation must say the original HTML will be treated as a new document if it
is opened again. The confirmation states consequences, not reassurances.

### 9. The confirmation requires the project name typed back

The dialog names what leaves: the entire project folder, including every
historical version, comment and attachment. It says the folder goes to the
system trash and can be restored from there. It requires the user to type the
project name, because the cost of a mistaken click here is not recoverable
inside PageRoot, and a plain "confirm" button is muscle memory.

## Consequences

- Users gain the ability to remove a project they no longer want, without
  leaving PageRoot and without needing to know where the projects root is.
- Registry gains its first membership-removal path. ADR 0024's rule survives
  unchanged in substance: Recent still cannot remove a member, and now exactly
  one audited transaction can. Any future removal path must go through this one
  rather than adding a second.
- A crash between the Registry write and the trash leaves an unauthorized
  directory in the projects root. This is accepted, bounded and recoverable by
  hand; it is also the only residue either ordering can leave, and it is the
  inert one.
- `REGISTERED_PROJECT_UNAVAILABLE` keeps its current meaning — the project is
  somewhere else and its changes are retained — because deletion never produces
  it. That message stays trustworthy precisely because this ADR chose the other
  ordering.
- Deleting a project deletes its AI request and attempt records along with
  everything else in the directory. There is no separate retention of run
  history outside the project, and this ADR does not create one.
- Restoring the folder from the system trash does *not* restore the project
  under this proposal. The Registry record is gone, so the restored directory is
  an unregistered copy, and ADR 0024 forbids the catalog from adopting it.
  Reopening the HTML inside it imports a new project from V1. **This is the one
  point still open (see Open questions below), so it is not yet a settled
  consequence.**
- This ADR authorizes deleting a whole project only. Deleting a single Version,
  a single comment thread, or the `AI任务/` projection tree remains unspecified.
  Bulk or multi-select deletion is likewise not authorized: the confirmation
  described here is per-project by design.

## Open questions

**What should happen when the user drags the project folder back out of the
trash?** The proposal above answers "it becomes an unregistered copy, and
reopening its HTML imports a new project from V1." That answer is internally
consistent and needs no new state, but it is not obviously the behaviour a user
expects: the operating system told them the folder was restored, and PageRoot
would still show no history.

The alternative is to keep the Registry record as a tombstone so a restored
folder can rebind to its original `projectId`, versions, drafts and comments.
That is a materially different design, not a detail of this one:

- A tombstone is a Registry member that authorizes nothing, which is close to
  the orphan state §2 rejects. Distinguishing the two needs an explicit rule.
- Tombstones need an expiry policy, or Registry grows without bound.
- Rebinding a restored folder means matching it by file identity or by
  `projectId` inside `.pageroot`, which reopens exactly the "adopt an
  unregistered copy" path ADR 0024 closed.
- The confirmation copy changes: "can be restored from the trash" would then
  mean restored *as this project*, which is a stronger promise than the current
  wording makes.

Deciding this changes §2, §3, §4 and the confirmation text, so it is settled
before implementation rather than during it.
