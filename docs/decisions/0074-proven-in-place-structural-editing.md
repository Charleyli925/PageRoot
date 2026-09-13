# ADR 0074: Proven in-place structural editing

- Status: Accepted
- Date: 2026-09-14
- Relates: [ADR 0062](0062-semantic-source-operation-kernel.md),
  [ADR 0064](0064-stable-id-source-structure-editing.md),
  [ADR 0065](0065-disposable-edit-runtime.md),
  [ADR 0072](0072-source-receipts-fence-canvas-authority.md)

## Context

PR #502 proved that some Runtime rebuilds were unnecessary and eliminated
those cases. It did not prove that the remaining 140 structural rebuilds were
all unnecessary. Those 140 `copy-edit-delete-element` rebuilds stayed as the
safe default. Same-parent reorder already has a proven in-place path.

Users still lose iframe identity, author-program continuity and reading
position on ordinary source copy, delete, insert and supported moves. Removing
the structural Candidate branch without a grant path would insert a copy that
cannot be edited: ADR 0065 seals the Runtime source-object set before author
scripts run, so a new DOM node cannot gain edit authority merely by carrying a
valid `data-pageroot-id`.

## Decision

Structure edits default to attempting an in-place Canvas projection. Only when
source identity, current node identity and the local update result are all
proven may the current iframe be reused. Source-legal operations that cannot
prove a safe local update still accept the semantic result and rebuild through
the existing Candidate path.

### A. In-place is a projection strategy, not a source channel

Every operation still runs:

SemanticOperationKernel → complete next HTML → existing source receipt and
history → existing persistence.

The Canvas only presents an already accepted source result. Runtime DOM is
never serialized as the save result. Local DOM mutation cannot bypass the
kernel. One accepted edit materializes HTML once; preparing an in-place plan
must not run a second source edit.

### B. Editor-created nodes may receive a controlled grant

Author code still cannot extend the trusted node set. Only PageRoot itself,
from one accepted semantic source transaction, may grant this generation's
edit authority to the exact nodes it created.

| Object | Authority |
| --- | --- |
| Author-script generated node | None. Display/comment-only. |
| Editor-created node from this accepted transaction | May be granted through the parent-owned `RuntimeSourceElements` owner after identity, frame and local-structure proofs. |

This is not a reopened initialization registry and not a scan of the live DOM
for legal IDs. Duplicate, stale-frame, old-Document, forged-ID and
author-created same-ID objects fail closed.

### C. Distinct failures stay distinct

| Situation | Outcome |
| --- | --- |
| Source preconditions fail, target identity is untrusted, or the operation is illegal | **Reject.** Source and history stay unchanged. |
| The source operation is legal but in-place proof is incomplete | **Accept** the source operation and use the existing **Candidate** rebuild. |
| Source is already accepted and later in-place projection fails | Keep accepted source and history; enter **Canvas recovery**. Do not claim the edit was rejected. |

Untrusted target identity must not become “rebuild and try again”. Rebuild
cannot launder a permission check.

### D. Conservative compatibility

In-place does not promise that arbitrary author JavaScript re-initializes
correctly. Ordinary, proven source regions prefer in-place. Regions that need
author-program re-init, cleanup, or currently unprovable behavior keep
rebuilding.

Do not add JavaScript dependency analysis, listener guessing, author-activity
freeze, Runtime snapshot restore, or per-node Runtime/source reconciliation.
Those mechanisms stay retired.

### Scope

In this round: element duplicate, delete, insert, supported same-parent and
cross-parent move, and the matching Undo/Redo. Duplicate continues to reuse
`insertElement`; there is no second public copy protocol.

Out of this round by default: `replaceSubtree`, whole-document source replace,
script/resource-closure/program-identity changes, and authority receipts.
Authority receipts still advance Canvas generation and reload the physical
frame, including same-byte authoritative reloads (ADR 0072).

### Projection plan

An operation-local `StructuralProjectionPlan` may exist only for the current
command. It is not a persistence model, history record, or public semantic
field. A `VerifiedStructuralProjectionPlan` is produced only by internal
verification; a caller cannot obtain in-place rights by passing `safe: true`.

### Product loop

For ordinary, source-traceable content the user can:

copy → edit the copy → move → delete → undo → redo → save

while keeping the current iframe `Document` identity whenever the proofs
succeed. New and restored objects remain legally editable. Delete keeps the
existing explicit confirmation. Selection after a confirmed delete lands on
the next eligible source sibling, else the previous, else a legal parent,
else clears. Comments on deleted IDs become orphaned by existing Stable ID
rules.

## Consequences

- Same-parent reorder keeps its current in-place end state.
- Proven structural local-edit and history receipts may reuse the physical
  frame; authority receipts do not.
- Tests must distinguish reject (no source/history/DOM change), accepted
  Candidate rebuild, and accepted-then-recover. Every rebuild has a recorded
  reason. #502's remaining 140 rebuilds are a baseline, not a requirement to
  zero every structural rebuild a priori.
