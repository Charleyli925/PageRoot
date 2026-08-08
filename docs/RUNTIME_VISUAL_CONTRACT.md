# Runtime visual contract

Runtime visuals are disposable presentation evidence. They never become source,
TargetRef, review-diff, save, export, Version, or AI-input authority. When the
evidence cannot be tied to an exact source host, PageRoot shows no runtime-local
box.

## Shared limits and identity

`app/domain/runtime-visual-contract.js` is the only production declaration of
the cross-surface limits. Edit capture, review capture, and their consumers use
the same frozen values and the accompanying TypeScript declarations.

| Field | Contract |
| --- | --- |
| Contract version | `1` |
| Candidate limit | `128` exact source-empty hosts; directly referenced hosts are prioritized before conservative widening fills remaining slots |
| Identity-attribute limit | `24`; deterministic attributes are shared with the consumer, while an over-limit host without an explicit `id`/`name` anchor is omitted rather than truncated into an unsafe fingerprint |
| Owner deadline | `1500ms` for page-realm capture work and review-frame registration |
| Comparison deadline | `500ms` after both exact review frames register |
| Page budget | `8192` atoms, `8192` traversed nodes, `400000` value characters, `4194304` Canvas pixels, `32` bitmap visuals, `16000000` PNG bytes |
| Per-host budget | `4096` atoms and `200000` value characters |
| Source identity | Full lowercase `sha256:<64 hex>`; it is the first cache invalidator and is included in review evidence envelopes |
| Session identity | Validated `review-*` identity plus contract version and side-specific source SHA |

Computed selectors, computed `getElementById` calls, generic selectors, external
scripts, and broad DOM mutation are conservative dependencies. They may widen
the set of exact source-empty candidates and fold the complete source Hash into
the dependency, but they never authorize a guessed runtime node or a rebound
TargetRef. A source Hash change starts a new cache partition, clears the mounted
projection while capture is pending, and rejects late evidence from the old
source.

The main-process Edit owner bounds every page-realm evaluation and screenshot
operation. Timeout, navigation, instability, unsupported paint, budget
exhaustion, an ambiguous binding, or a source/session mismatch fails closed.

Formal review uses `ReviewRuntimeVisualCaptureAdapter` as its migration seam.
The current adapter emits the existing first-party page bootstrap; a later
capture implementation can replace that adapter without changing semantic
analysis or the review UI. The adapter receives only the frozen session,
side-specific source SHA, candidate bindings, and private comment bindings.

## Hostile-page closure matrix

Every still-applicable unresolved thread from PRs #100, #105, and #107 has one
minimal fixture in `tests/fixtures/runtime-visual-hostile-pages.mjs`.

| Thread / fixture | Explicit contract | Closure reason |
| --- | --- | --- |
| #100 `PRRT_kwDOTdtgh86W9A1Y` / `pr100-canvas-native-intrinsics` | Numeric and Canvas intrinsics are bound before authored scripts run. | Canvas sizing and sampling use captured `Number`, `Math.round`, and `Math.max`; the Electron hostile page replaces them and still produces the expected marker. |
| #100 `PRRT_kwDOTdtgh86W9A1b` / `pr100-single-painted-child` | One visible painted child plus one geometry atom is sufficient chart evidence. | Producer admission and consumer geometry comparison share the paint-plus-geometry rule. |
| #100 `PRRT_kwDOTdtgh86W9A1d` / `pr100-transparent-text` | Text with no visible color, shadow, decoration, or stroke has no visual authority. | Invisible text is removed before content, paint, and geometry hashing; its text churn produces no marker. |
| #105 `PRRT_kwDOTdtgh86XQhQi` / `pr105-generic-selector-host` | A generic selector conservatively retains every exact matching source-empty visual host. | `querySelector("canvas")` is an indirect query; the anonymous Canvas becomes a candidate without inventing identity. |
| #105 `PRRT_kwDOTdtgh86XQhQm` / `pr105-dynamic-id-dependency` | A computed element lookup depends on the complete source. | Computed `getElementById` widens candidates and changes the dependency Hash when referenced data changes. |
| #105 `PRRT_kwDOTdtgh86XQhQo` / `pr105-owner-deadline` | Page-owned clocks cannot extend capture ownership. | A never-resolving settle promise reaches the shared owner deadline, destroys the hidden window, and revokes its session. |
| #107 `PRRT_kwDOTdtgh86XW6Z8` / `pr107-parser-text-mutation` | Parser-added targets may use stable attributes to retain the exact inserted Element before mutable text is compared; fingerprintless comment targets may bind only to their unchanged frozen path. | Mutation records bind that exact Element; ignoring text requires at least one stable identity attribute. A same-tag observation at a shifted path invalidates a fingerprintless comment binding, while duplicates, replacement, or disconnection still invalidate the batch. |
| #107 `PRRT_kwDOTdtgh86XW6Z_` / `pr107-attribute-limit` | A host with more than 24 identity attributes and no explicit `id`/`name` anchor is not bindable. | The producer drops an over-limit fingerprint instead of allowing the retained prefix to guess a parser sibling; the bootstrap enforces the same shared ceiling. |

This contract does not add screenshot features, serialize new temporary DOM
attributes, or change the review UI.
