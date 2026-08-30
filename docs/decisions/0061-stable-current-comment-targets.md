# ADR 0061: current comments resolve persistent source element identity

## Status

Accepted.

## Context

ADR 0059 defines `data-pageroot-id`, and ADR 0060 guarantees a complete ID set
for managed Working Copies. Existing TargetRefs still identify elements through
source offsets, selectors and fingerprints. Those facts are useful for old
Versions, but text edits, sibling insertion and moves can change all of them and
make a current comment drift, become ambiguous or require a guessed rebind.

## Decision

1. A new TargetRef captured from an identified source element carries
   `elementId`, `expectedSourceSha256` and compatibility fingerprint evidence;
   deterministic current-source rebind refreshes the expected Hash.
   `elementId` is the sole persistent element identity. `tagName` remains useful
   display/stale evidence but is not a second identity. `targetId` remains the independent
   record identity: several comments may have different target IDs while
   sharing one element ID.
2. When `elementId` is present, `TargetResolver` uses only SourceIndex's valid,
   unique `byPagerootId` entry. A source-Hash change, text change or move does
   not weaken the result: the surviving element resolves `exact`, including
   when its authored tag changes. A missing or invalid ID resolves `orphaned`;
   selector, tag, other fingerprint fields and offset evidence must not select
   a replacement. If the source element still exists but the current Canvas
   projection cannot locate or display it, presentation reports it as currently
   missing/hidden without changing or transferring its source identity.
3. A selected text range may add `textLocator = { quote, startOffset,
   endOffset, affinity }`. Offsets are UTF-16 positions in the owning element's
   decoded descendant text and are accepted only when the source-backed range
   reproduces the quote. The locator gives comment context; element identity
   remains the persistence anchor.
4. Current comments keep the existing `baseVersionId` captured from
   `VersionSession`. History mode reads only the immutable selected Version's
   own comments. This contract does not migrate comments across Versions.
   The existing whole-page comment remains the deterministic
   `selector=body + level=module` semantic target so implicit document roots do
   not require an invented source identity.
5. TargetRefs without `elementId` keep the single legacy resolver for old
   comments, ID-less historical Versions and unmanaged compatibility input.
   Explicit user relink may replace an orphaned target; background code may not.
6. Stable comment grouping and Canvas selection matching use `elementId` plus
   level. Disposable geometry and Runtime DOM remain non-persistent.
7. This decision does not change AI modification scope, frozen Review comment
   projection or Review diff authority. Those consumers may carry the additive
   TargetRef fields without treating a comment as a subtree authorization.

## Consequences

- Current comments survive text edits, tag changes, sibling insertion and
  element moves without heuristic rebinding.
- Deletion is explicit. A visually identical new element has a new ID and
  cannot inherit the old comment.
- Historical records remain readable without rewriting immutable Versions.
- Text-range context can become stale after later text edits, but the comment
  stays on its proven element rather than moving to another occurrence.

## Rejected alternatives

- **Derive comment identity from selector or source offset.** Both change under
  ordinary semantic edits.
- **Fall back to fingerprints after a stable ID disappears.** This silently
  transfers a comment to a replacement and violates deletion semantics.
- **Reuse one TargetRef ID for every comment on an element.** This collapses
  independent audit records and comment-card geometry.
- **Rewrite historical Versions with IDs.** Immutable history is not a
  migration target.
