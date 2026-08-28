# ADR 0046: Review keeps text and element presence only

- Status: Accepted
- Date: 2026-08-27
- Supersedes: ADR 0017, ADR 0021, ADR 0029, ADR 0030 and the Review portion of ADR 0031

## Context

Review accumulated movement detection, authored-style analysis, layout and
runtime bitmap capture in an attempt to explain every visible difference. The
result required a second Electron page owner, dedicated IPC, source-host
binding, PNG envelopes, pixel thresholds, frozen chart scripts and a large
failure matrix. Those signals were still noisy enough that users could not
reliably decide whether a reported visual change was meaningful.

Text differences and element presence have a narrower, explainable contract.
They can be derived from the two frozen HTML inputs without executing the
candidate or granting the review page additional capabilities.

## Decision

- Review reports precise text insertion, deletion and replacement evidence.
- Review reports a real element that exists on only one side as `新增元素` or
  `删除元素`. Only the outermost unmatched subtree is marked; descendant
  elements and descendant text do not repeat the same fact.
- A one-sided logical text unit that is not an element, such as one authored
  `<br>` line, remains text evidence. A completely rewritten singleton with
  the same parent, element kind and own structural signature remains paired so
  it can produce text evidence instead of a false delete/add pair.
- Sibling order, movement, attributes, CSS, layout, wrapping, computed style,
  Canvas/SVG pixels and other runtime presentation are outside Review.
- The toolbar exposes exactly `全部 / 文字 / 元素`. Comments, split/single-page
  viewing, context visibility, navigation, linked scrolling, zoom and explicit
  adoption remain unchanged.
- Remove the Review runtime-capture owner, preload API, IPC, contracts,
  adapters, frozen scripts, measurement commands and packaged resources. Edit
  Author Runtime and ordinary Preview remain separate accepted capabilities.

## Restore path

Do not keep dormant flags or copied source in production. The last complete
pre-downgrade implementation is the parent baseline
`9dbb1322393aeffdab86dd4f01d13791a17c0756`; ADR 0017, 0021, 0029, 0030 and
0031 describe its security and comparison decisions. A future proposal can
recover selected code from Git and must re-establish an independently reliable
product contract before restoring any runtime or visual category.

## Consequences

- Review has one static analysis path and no Review-specific main-process or
  preload capability.
- Pure style, movement, layout and runtime drawing changes intentionally show
  zero Review changes.
- Element deletion is visible and navigable with the same confidence and
  top-level de-duplication as element addition.
- Tests protect both positive evidence and the negative boundary: style,
  movement and layout facts fail closed, while real Electron coverage proves
  precise text marks, single element marks and the adoption flow.
