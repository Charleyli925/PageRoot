# ADR 0067: AI Candidate identity is validated before PageRoot assigns new IDs

- Status: Accepted
- Date: 2026-08-30
- Depends on: ADR 0059, ADR 0060 and ADR 0066

## Context

AI continues to read and return one complete HTML document because a comment can
request coordinated changes anywhere in the page. Persistent
`data-pageroot-id` makes those complete-document changes reviewable, but the AI
output is untrusted: accepting duplicated or invented IDs would
corrupt later editing, comments and Review.

## Decision

- The frozen complete HTML is the identity base. Comment locations and text
  ranges are context for the AI, not a write-scope boundary.
- Every retained source element must keep its existing unique
  `data-pageroot-id`. The same element may move within or across parents. An ID
  cannot be copied or invented. The same valid unique ID remains the sole
  element identity across tag, parent, order and content changes; those facts
  cannot become a second identity matcher.
- Candidate validation rejects malformed and duplicate IDs, IDs that do not
  exist in the frozen base, and a missing ID when deterministic exact-source or
  stable retained-neighbour evidence shows that the source element is still
  present. Equal-cardinality repeated exact-source or stable retained-neighbour
  groups also fail closed when the group proves IDs were stripped even though
  individual elements cannot be rebound without guessing. Suspicious identity
  loss fails closed; PageRoot does not heuristically rebind it.
- Only after those checks pass are identity-free output elements considered
  genuinely new. PageRoot allocates their IDs once, produces the complete
  normalized Candidate HTML, and seals an identity report with retained,
  deleted, added and assigned counts plus before/after binding hashes.
- The submitted AI-output Hash and normalized Candidate Hash are separate
  provenance facts. Review, adoption, immutable Version snapshot and the new
  Working Copy use the normalized complete HTML. Candidate never overwrites the
  current Working Copy before explicit adoption.
- Existing schema-v4 Candidate records without the new optional report remain
  readable and promotable under their old runtime seal. They are not rewritten
  or given invented identity evidence.

## Non-goals

- AI is not required to emit semantic operations.
- Runtime DOM, generated nodes, computed style and rendered pixels never
  participate in Candidate identity validation or persistence.
- The validator does not infer that a stripped ID belongs to the most similar
  element, and it does not use comments to limit changes to one subtree.

## Consequences

- AI can still change multiple distant regions, delete and move existing
  elements, and add new elements in one full-HTML Candidate.
- New Candidates are complete identity-v1 HTML before Review begins, so ADR
  0066 pairs retained elements and reports all supported source facts directly.
- Prompt, Candidate schema, Repository validation, identity report and real
  Electron adoption tests change together.
