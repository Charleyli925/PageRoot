# ADR 0003: Session ownership and mutation outcomes

## Status

Accepted.

## Context

Renderer state, refs, browser recovery records and Bridge artifacts previously
held overlapping draft and lifecycle facts. Same-project reads could arrive out
of order, draft CAS rejection lost the authoritative revision, and retries
replayed the same stale snapshot. Close then remained blocked by a condition
the retry could not change.

## Decision

- Mutable facts use the ownership table in `docs/STATE_OWNERSHIP.md`.
- Bridge access is centralized in the typed application client.
- Same-project queries use a generation fence and monotonic revision checks.
- A lazy source locator is distinct from registered project authority. The
  first durable action binds project identity and Draft authority together.
- An inactive or mismatched Draft session on a registered page is repaired by
  querying workspace authority before mutation or drain.
- Draft mutations have stable operation identities, durable deletion
  tombstones and processed-operation acknowledgements.
- The draft artifact carries its own revision and recovers a newer durable
  write when the runtime pointer was not refreshed before a Bridge stop.
- Rejected revision conflicts and unknown mutation outcomes reconcile against
  authoritative draft state before a bounded retry.
- Close, switch, submit and history transitions converge on a drain
  coordinator instead of copying pending-state predicates.
- Compatibility stays in explicit protocol adapters.

## Consequences

Normal revision drift recovers automatically. A user decision is required only
for a semantic conflict that deterministic rebase cannot resolve. New state or
persistence work must identify an owner, outcome model and drain obligation,
and the architecture gate prevents direct Bridge or browser-storage access from
spreading back into views.

Opening and closing an untouched lazy HTML does not create project records.
Starting durable comment or edit work does, and close can no longer be blocked
by a page identity that was registered without its Draft owner.
