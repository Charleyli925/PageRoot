# ADR 0070: Working Copy identity survives filesystem observation changes

- Status: Accepted
- Date: 2026-09-07
- Supersedes: ADR 0034 physical-identity authority and rename witness

## Decision

Repository owns one resolver for stable project/document/Working Copy identity,
registered relative paths, complete content Hashes and optional hidden hard-link
bindings. Persisted device/inode/birthtime values remain compatible observations;
they never authorize startup, opening, listing or a later write. Live physical
comparisons are restricted to one operation and its race checks.

The binding `.pageroot/source-bindings/<workingCopyId>.ref` identifies a unique
visible file after a same-project rename without changing HTML bytes. Missing or
unsupported bindings do not block a valid registered path with its recorded Hash.
The resolver never claims an unregistered file because its bytes happen to match.
Duplicate project identities, visible hard links or Working Copy bindings require
project-local isolation. Catalog and Version metadata remain independently browsable.

Save and Promotion recovery reuse their existing journals and stable identities
plus old/new Hashes. Normal saves prepare new bytes and a temporary binding, move
the actual displaced entry to the recovery transaction, then publish without
replacement. This preserves an external replacement even if it arrives after the
last path/Hash check. Formal bindings, state and manifest converge before cleanup.

There is a short missing-name interval between displacement and publication;
this is a recoverable transaction, not a single atomic rename syscall. Repository
reads serialize with recovery, desktop source reads join that authority, and
watcher save echoes do not relocate a session. External readers may retry ENOENT.
If Finder moves a member between Desktop classification and the Repository read,
Desktop commits the returned path to its active locator, recents and watcher
before returning that projection. A background watcher is not required to finish
the same operation's path repair.
An ordinary check-then-rename would silently destroy a last-moment external
replacement; a platform-specific atomic exchange helper is not introduced here.

Migration first recovers transactions, then validates each member and creates or
refreshes its binding and observation atomically. It creates no Version and does
not rewrite HTML. This locator migration is separate from the existing explicit
source-element identity materialization on opening older unidentified content.
Bridge enqueues initialization before accepting Repository requests, so inactive
Working Copies migrate too. Each project's refreshed locator observations publish
in one manifest write. A single current binding/source census bounds startup
scans; selected paths and bindings are still rechecked live. That census is local
to migration and never authorizes later opens or HTML writes. Only complete project contracts count as duplicate
roots; a partial copy with only a project identity cannot quarantine a healthy
registered project.

## Validation

`tests/durable-working-copy-binding.test.mjs` covers separate-process observation
drift, five-project/fifteen-file migration, rename and copy-delete recovery,
duplicate identities/bindings, external changes, missing-file restoration,
descriptor races and save/Promotion interruption stages. Removing the resolver
fix deterministically fails the separate-process device-drift test. The AST
architecture check rejects persistent observation comparisons used as gates.
The packaged startup test changes persisted devices between actual application
processes, then verifies unchanged bytes, repaired observations and an edit/save.
Electron also forces both HTML and project-folder renames between classification
and read, verifies persisted locators and subsequent watcher notifications, and
fails deterministically when that Desktop rebase is removed.
