# ADR 0022: v4 Registry-authorized project roots and promotion paths

- Status: Accepted
- Date: 2026-08-13
- Supersedes: ADR 0005
- Extends: ADR 0011, ADR 0019

## Context

The original project-file proposal treated `.pageroot/project.json` as enough
authority to follow a folder wherever Finder moved or copied it. It also
treated the Registry as a last-known-location cache that could be reassociated
to another matching `projectId`. That leaves a copied control directory able to
turn itself into a write target and makes a path change indistinguishable from
a new, user-owned project.

v4 needs a narrower authority boundary. Stable IDs prove the object inside a
root; they do not authorize PageRoot to write that root. A pathname alone also
does not prove identity. The Registry must therefore be the durable write
whitelist, with filesystem identity used only as a same-parent rename clue.

Project states created before v4 are intentionally incompatible with this
opening boundary. The v4 path does not migrate, dual-write, recover, clone,
reinterpret, or read their frozen Request and Version evidence; their selected
HTML is instead imported as a new v4 Project beginning at V1.

## Decision

### Registry authority

For v4, PageRoot writes only when all of the following agree:

1. `projectId` is registered in `.pageroot-registry.json`.
2. The requested root is exactly that record's
   `registeredProjectRootPath`, or is the one uniquely recovered same-parent
   rename of that record.
3. The root is a real, non-symlink direct child of the configured PageRoot
   projects directory; every managed path is a non-symlink whitelist path
   under it.
4. `.pageroot/project.json`, `manifest.json`, the OpenTarget and the requested
   Working Copy agree on project/document/Working Copy identity.

Each Registry project record has `registeredProjectRootPath`,
`rootFileIdentity`, and `updatedAt`. `rootFileIdentity` is not object identity
and never grants write access by itself; it is used only to identify one
same-parent directory rename. Registry-side `pendingImports` records durable
import intent before staging or publication. Recovery may publish only an
existing Registry intent; it never scans arbitrary copied
`.pageroot/recovery/import.json` files to claim a project.

The standalone Request finalizer applies the same Registry check before it
reads or writes Candidate completion facts.

### Root, copy, and Working Copy movement

- A same-parent rename inside the configured projects directory may update the
  Registry path once when the old path is absent, root filesystem identity is
  continuous, IDs validate, and exactly one candidate exists. The update uses
  a compare-and-set read of the record and the ProjectSession receives the
  resulting OpenTarget.
- Moving a root out of that directory, or moving it across volumes, stops all
  PageRoot writes. PageRoot neither follows, locates, nor reassociates the
  moved directory. In-memory edits remain retained. Writes resume only after
  the project returns to its exact registered path and v4 identity/manifest
  validation succeeds; a returned cross-volume directory may refresh the
  filesystem-identity clue only at that exact path.
- A complete project copy is always external, including a copy placed under the
  configured projects directory. Opening it is an exact external preview. Its
  first persistence imports only the selected HTML into a fresh V1 project;
  no history is cloned and no duplicate-project dialog appears.
- A root-level Working Copy rename preserves `workingCopyId` and updates its
  direct manifest mapping plus `preferredFileStem`/`preferredExtension`.
  Missing mappings may be recovered only by a unique file identity, or when
  the file returns at its exact recorded path. Equal HTML Hashes never prove
  ownership or cause a manifest rebind. Extra HTML files and HTML moved into
  another project remain external and never alter a manifest.

### v4 paths and Promotion

The v4 manifest has no project-wide `fileNaming`. Each Working Copy records a
top-level `.html`/`.htm` `sourceRelativePath`, `preferredFileStem`, and
`preferredExtension`. File names never create IDs.

Promotion rereads the latest Working Copy naming at adoption. A Candidate made
from `A-V1.html` and adopted after that Working Copy is renamed to `B-V1.html`
creates `B-V2.html`. A file, directory, or symlink collision is user-owned and
selects the next frozen path: `B-V2-V2.html`, then `B-V2-V2-V2.html`, and so
on.

Before the manifest can name visible Working Copy bytes, the Promotion
transaction durably records the final relative path, private preparation,
guard and replacement paths, preferred naming, allocation ordinal, a strict
Working Copy object, and the preparation file identity. It writes private
transaction bytes first, stages the initial visible link into a private guard,
then creates a fresh visible path from the private replacement with
no-replace `link()`. The manifest boundary rechecks both the fresh visible
bytes and the guard: a retained external descriptor is restored visibly and
causes a conflict, while an external path collision wins without being
overwritten. A collision before visible publication can allocate the next
path; once preparation starts, no path changes. Replacing a prepared, guarded
or visible transaction file makes recovery fail without deleting user bytes
or overwriting a collision.

### Product behavior

There is no positive `reassociate`, duplicate-project resolution, or
“locate moved project” action in v4. The nonblocking states are:

- `REGISTERED_PROJECT_UNAVAILABLE`: “项目暂不可用，修改仍保留；放回原登记位置后自动恢复”。
- `WORKING_COPY_UNAVAILABLE`: “文件暂不可用”。
- one nonblocking success notification after verified automatic recovery.

Only actual content conflicts or path ambiguity ask the user for a choice.
When PageRoot is clean, external bytes returned to the same Working Copy are
adopted. When PageRoot and disk both changed, both sides are retained and the
operation enters a conflict state.

## Consequences

- v4 has one durable write authority: Registry authorization plus verified
  project-local identity. Preview and runtime DOM remain presentation-only.
- A returned folder is recoverable only at the registered path; a copy cannot
  bypass the Registry merely by retaining IDs and hidden files.
- Candidate adoption gets deterministic names and crash recovery without
  overwriting user files.
- Pre-v4 project state is neither migrated nor a fallback way to bypass v4
  Registry checks; it is not an opening-path input at all.

## Rejected alternatives

### Registry as a replaceable location cache

Rejected because a matching `projectId` in a copy proves neither user intent
nor write authority.

### Follow every moved root after explicit user selection

Rejected because it turns the picker into reassociation authority and lets
cross-volume copies acquire durable writes.

### Use equal HTML Hashes as global navigation identity

Rejected because equal bytes at different paths are still different user
files. Hashes confirm bytes after a trusted path or filesystem-identity match;
they never recover an otherwise missing registered Working Copy mapping.

### Overwrite or rename around an already-started Promotion

Rejected because a visible collision or replaced preparation file may be
user-owned. The transaction must stop with recoverable evidence instead.
