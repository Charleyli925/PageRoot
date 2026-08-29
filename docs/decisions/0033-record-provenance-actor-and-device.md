# ADR 0033: Records carry an authored actor and device, and the device identity is separate from telemetry

- Status: Accepted
- Date: 2026-08-21
- Extends: ADR 0057
- Relates to: ADR 0006

## Context

No PageRoot record answers "who produced this fact". No schema has an `author`,
`userId`, `actor` or `owner` member, and no module anywhere in the repository
holds a device or installation identity for product data. Every comment, edit
event and Version is anonymous.

Three planned directions need that answer: a multi-turn agent conversation has
to distinguish a human turn from an agent turn; an account system has to attach
ownership to existing records; and multi-device work has to reconstruct who
changed what. All three read history that is being written today.

Attribution is the irrecoverable kind of information. A field that was never
captured cannot be backfilled: no later release can decide who wrote a comment
in 2026. `ADR 0057` made a member addition safe for an existing installation, so
the remaining cost of capturing attribution now is only the cost of writing it.

## Decision

1. Records carry `provenance` = `{ actor: { kind, id }, device }`. `kind` is
   `human` or `agent`. `id` is a bounded identifier, currently `local` for the
   only human that exists.
2. **Provenance is authored by the writer and never accepted from the caller.**
   A record introduced by a save is stamped with the writer's own identity. A
   record that already exists keeps the author **persisted on disk**, not the one
   supplied in the request, so a renderer cannot forge or rewrite an author.
3. Re-stamping every record on every save is forbidden. The renderer resends the
   whole comment list, so re-stamping would silently turn "who wrote this" into
   "who saved last".
4. The device identity is a random `device_<uuid>` stored in
   `device-identity.json` under Application Support. It is **not** the telemetry
   installation identity and is never transmitted.
5. A repository without a device identity records no provenance rather than
   inventing one.
6. Provenance carries no per-device sequence number yet.

## Scope

Applied to the Draft aggregate: comments and change events, which is the live v4
record for "what the user said about the page".

Deliberately not applied to `history/source-operations.json`. The v4 Bridge never
appends to that journal — `runSourceHistoryAction` returns `history-no-op` with a
freshly created empty history, and no production caller of
`appendSourceHistoryOperations` exists. Decorating a journal nothing writes would
add an unverifiable field. When that journal is revived, its entries must carry
provenance under the same rule.

## Consequences

- Application Support gains one new file. `PRIVACY.md` discloses it, states that
  it is never transmitted, and states that it is a different random value from
  the telemetry install ID.
- Packaging is split and the split is load-bearing. `shared/provenance.mjs` ships
  through electron-builder `extraResources` into `Resources/shared`, while
  `desktop/device-identity.mjs` is packaged inside the asar through
  `build.files`. A relative import across that boundary resolves in development
  and fails only in the packaged application, so the desktop module restates the
  identifier pattern and `tests/record-provenance.test.mjs` pins the two copies
  to the same behavior from both directions.
- Both packaging manifests and the packaged-artifact verifier list the new files,
  so a missing entry fails a test rather than a user's launch.
- Existing comments have no provenance. The next save stamps them with the local
  human on this device, which is the truthful answer for a single-device
  installation and is better than leaving them permanently unknown.
- When accounts exist, `actor.id` becomes an account identity. The shape does not
  change; only the identifier and its verification boundary do.

## Rejected alternatives

- **Reuse the telemetry `installId`.** Rejected on privacy grounds. That
  identifier is transmitted to the analytics endpoint, and `ADR 0006`
  deliberately avoids sending raw project identity by hashing it. Embedding the
  analytics identity inside user project files would invert that boundary and let
  anyone who reads a project file correlate it to the analytics stream.
- **Store the device identity beside the managed projects.** Rejected: that
  directory is under `~/Documents` and can be synchronised by iCloud, which would
  clone one device identity onto several machines.
- **Trust a caller-supplied provenance when the record already carries one.**
  Rejected as forgeable: it lets a renderer assign any author to a new record.
  Reading the previous author from disk achieves the same preservation without
  trusting the caller.
- **Stamp source-history entries as well.** Rejected for now: that journal has no
  production writer in v4, so the field could not be verified end to end.
- **Include a per-device sequence number now.** Rejected: it needs persistent
  counter state in a Bridge that has none, and ordering is not the irrecoverable
  part. A sequence can be introduced later precisely because the records will
  already be attributable to an actor and a device.
