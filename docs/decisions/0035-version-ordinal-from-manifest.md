# ADR 0035: A Version ordinal is read from the manifest, and full identifier globalisation is deferred

- Status: Accepted
- Date: 2026-08-21
- Extends: ADR 0022

## Context

`versionId` is `ver_` plus the zero-padded Version ordinal, and `workingCopyId`
is `work_ver_` plus the same number. Those generators are fine on their own. The
problem was the reverse direction: `workingCopyOrdinal()` recovered the ordinal
by slicing the identifier, and that ordinal decided which `-V<n>` suffix to
strip when deriving a Working Copy's preferred filename. The identifier was not
an opaque name; it was a data carrier whose payload was read back and shown to
the user.

Nothing validated that coupling. `assertManifest` checks that a Working Copy's
`versionId` refers to a known Version, but never that the digits inside
`workingCopyId` agree with that Version's `ordinal`. The agreement held only
because both identifiers were minted from the same number in the same call.

Making identifiers globally unique — needed once more than one device or account
can mint them — is a much larger change than it appears:

- Identifiers are directory and file names. `snapshotRelativePath` is
  `versions/<versionId>/index.html` and a Draft lives at
  `drafts/<workingCopyId>.json`, so a new scheme renames directories in every
  existing project. This is the only item in this series that moves user files
  rather than JSON members.
- `assertManifest` enforces `version.versionId === versionId(version.ordinal)`.
  Globalising removes that consistency check rather than strengthening it.
- Fifteen schemas encode the `ver_` shape in 43 places, and `ADR 0032` does not
  help: it makes an *added* member safe for an older reader, while *relaxing an
  existing pattern* still leaves that reader rejecting the new form.
- The ordinal is user-visible as `-V2` in managed filenames.

None of that is urgent. Identifier collisions require two minting authorities,
which requires accounts; today one device and one user cannot collide. And
unlike record provenance in `ADR 0033`, deferring loses no information: the cost
of globalising later is a migration, not a fact that can never be recovered.

## Decision

1. A Version ordinal is read from the manifest. `versionOrdinalFor(manifest,
   versionId)` is the supported accessor, and `workingCopyOrdinal()` is removed.
2. Identifiers are treated as opaque names. Recovering the ordinal by slicing,
   parsing or capturing digits out of an identifier is not allowed, and
   `tests/identifier-opacity.test.mjs` fails on any new site.
3. `shared/direct-edit-compatibility.mjs` is the one recorded exception. It
   decodes immutable historical direct-edit records whose identifiers are
   permanently the zero-padded form, extracts the number only to fail closed on
   an out-of-range Version, and returns the identifier unchanged. The exception
   list is asserted to still match, so a stale entry is deleted rather than
   forgotten.
4. Full identifier globalisation is deferred. It should be done together with
   the account system's migration, so a user absorbs one directory-structure
   change instead of two.

## Consequences

- The hardest coupling between an identifier and its payload is gone, and it is
  gone everywhere rather than at the one call site that had it: the guard covers
  future code as well.
- What remains for globalisation is mechanical — a new generator, relaxed schema
  patterns and a one-time directory migration — and can be scheduled with the
  account work instead of ahead of it.
- The change is behaviour preserving. It cannot be distinguished through the
  public interface, because a manifest where the identifier digits disagree with
  the Version ordinal is a state the validator does not permit. Its proof is the
  existing suite staying green plus the guard above, not a new behavioural
  assertion.

## Rejected alternatives

- **Globalise identifiers now.** Rejected: it renames directories in every
  existing project, removes an enforced manifest invariant and relaxes 43 schema
  patterns, to prevent a collision that cannot occur before accounts exist.
- **Leave the reverse parse and globalise everything at once later.** Rejected:
  the number of reverse-parse sites only grows, and each one found later is
  found under migration pressure. Removing it now is cheap and independent.
- **Enforce that `workingCopyId` matches its Version ordinal.** Rejected: that
  strengthens exactly the coupling this decision removes.
