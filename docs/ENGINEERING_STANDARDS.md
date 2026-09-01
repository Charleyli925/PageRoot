# Engineering standards

This document is normative for implementation shape. Product requirements
still come from the routed product documents; architecture and state ownership
come from `ARCHITECTURE_MAP.md`, `ARCHITECTURE_CONTRACT.md` and
`STATE_OWNERSHIP.md`. Defense class and user-visible blocks are recorded in
`GUARD_LEDGER.md`.

## Defense classes

Classify a failure by whether it is irreversible. P1-A (#191) is the
presentation template: enter native editing first, then validate with stale
hash, patch scope and MutationObserver rollback. Notification policy
`silent-recover` is the reversible-coordination template. P1-B CAS is the
authority-boundary template: one verified realpath cache per `#serial()` turn,
re-checked on the next turn.

### Authority boundary — fail-closed

Wrong-disk writes, mistaken AI adoption, wrong Version activation, destructive
deletes and wrong published packages. Validate the same fact at most three
times: at ingress, after an external await, and immediately before irreversible
commit. Do not re-normalize, realpath, hash and compare in every function.
`Verified*Context` objects live only inside one operation; they are not a
Session or Registry authority.

### Reversible coordination — converge automatically

Stale queries, expired Canvas acknowledgements, catalog refresh failures,
rebuildable projections and Bridge replies that can be reread. Discard the old
result, reread authority, rebuild, retry once within a bound, or degrade. Do
not show a dialog, lock the canvas, or ask the user to retry an internal
uncertainty. An unknown mutation queries authority before retry; a bounded
retry that cannot change the precondition is a loop, not recovery.

### Presentation and edit eligibility — fail-open

Layout preflight, hover/outline trust, Review annotation projection,
comment-marker location and UI projection lag. Let the user continue. Enter
edit first.
Keep a comment whose target failed, marked for relink. Hide a failed outline;
do not forbid editing.

User confirmation is reserved for deleting a project, discarding edits that
cannot be autosaved, explicitly overwriting an external change, and
unrecoverable identity or permission changes. Global Notice growth is frozen:
do not add `setToast({...})`, a new `NoticeBar`, or free-form
`background-result` copy. Classify or delete an existing site in
`scripts/notice-disposition-ledger.json`. Do not invent replacement error UI
to retire a Notice.

Do not remove an irreversible authority-boundary protection unless an
equivalent protection remains. Reversible interaction, presentation and
preflight blocks may move to post-validation, automatic repair or degradation
when tests and a recovery path exist. Record the decision in `GUARD_LEDGER.md`.

Line-count ceilings in `scripts/architecture-budget.json` are observational.
They are not an acceptance goal. Do not split a file only to lower `maxLines`.

## Prefer invariants over patches

Before adding a guard, retry, ref, effect or compatibility branch, write down:

1. the mutable fact and its sole owner;
2. the invariant that was violated;
3. the command/query outcome (`acknowledged`, `rejected` or `unknown`);
4. the late-response and crash behavior;
5. the close, switch, submit and history drain impact.

A branch that cannot name these five items is not a safety mechanism. It is
unowned state and must not be added.

Fix the producer or ownership boundary first. Do not compensate for an invalid
state independently in several consumers. When a new invariant replaces an
old workaround, remove the workaround and its implementation-shape test in the
same Pull Request.

## Modules and abstractions

An abstraction is justified only when it removes a responsibility from its
caller and has a stable contract that can be tested without reading the
caller's source. A wrapper that forwards the same parameters, adds no invariant
and leaves all decisions in the caller is prohibited.

- Use one options object at infrastructure boundaries; do not thread unrelated
  booleans through several layers.
- Prefer a small state machine or aggregate command over many coordinated
  refs.
- Keep compatibility decoding at the ingress. Current domain/view code never
  branches on retired names.
- Keep I/O at adapters and repositories. Domain transitions are pure.
- Keep generated identifiers, revision checks, idempotency and rebase policy in
  the owning command/session, not in a React effect.

Large source-fidelity engines are not split merely to reduce line count. A
split must create a real invariant boundary and preserve byte, Selection, IME
and transaction coverage. Prefer a narrow command interface and mutually
exclusive view-model states over another file cut. New product persistence or lifecycle behavior may
not be added directly to `workbench.tsx`, `HtmlCanvasEditor.tsx`,
`IslandEditingController.ts` or `workspace-bridge.mjs`; first introduce or use
the owning application/domain/service module. The retired V1 controller and
its tracker/draft/planner modules are deleted and forbidden by the architecture
gate; they are not compatibility or extension points.

## Effects and asynchronous work

React effects may connect DOM, subscriptions and timers. They may request work
from an owner, but may not implement CAS, retries, merge policy or lifecycle
aliases.

Every async query carries full project/session identity and a monotonic
sequence. Every mutation carries an operation ID and precondition. Unknown
mutation outcomes query authority before retry. A bounded retry that cannot
change the precondition is a loop, not recovery.

Do not represent “not registered yet” with an otherwise valid context whose
identifier fields are empty strings. Model a locator and a registered context
as different states. Any transition that creates or adopts project identity
must initialize every dependent session from the same authoritative response;
setting React identifiers without binding the Draft session is incomplete.

## Tests

Prefer observable outcomes:

- exact source bytes and Hashes;
- revision and operation identity;
- durable records after restart;
- state-machine transitions and late-response rejection;
- close/switch/submit/history behavior under injected failure.

Source-string assertions are limited to security, packaging, dependency and
explicit architecture boundaries. Moving code behind a better owner should
move the test to that owner's public behavior instead of preserving the old
file shape.

Every new owner or protocol must be listed in `STATE_OWNERSHIP.md`, mapped in
`tests/test-impact-map.json` and covered by `npm run architecture:check`.

## Definition of complete

A state or architecture migration is complete only when:

- one owner is active and all former writers are removed;
- old aliases/workarounds exist only in one documented compatibility adapter;
- current PRs and local changes that touch the same boundary are incorporated
  or explicitly proven independent;
- behavior, failure, restart and packaging coverage pass;
- normative docs and impact mapping match the code;
- no temporary dual-write, TODO migration path or untracked generated artifact
  remains.
