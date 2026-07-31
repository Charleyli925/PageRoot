# ADR 0004: PageRoot 0.9.0 uses one controlled editable-island route

- Status: Accepted
- Date: 2026-07-28

## Context

The V1 route tried to preserve every authored source byte inside an actively
edited text host while also delegating caret gravity, deletion, rich DOM
mutation and composition placement to Chromium. Paragraph ends, inline-style
boundaries, controls and composition recovery therefore accumulated separate
fallbacks whose contracts disagreed.

PageRoot 0.9.0 instead prioritizes:

1. exact source bytes outside the edited element;
2. visual, semantic and structural safety inside it;
3. document-like input, deletion, line-break and IME behavior at every safe
   logical position;
4. the smallest island-local normalization needed to satisfy those rules.

## Decision

PageRoot 0.9.0 has one production text engine, `IslandEditingController`.

- `contenteditable="true"` provides focus, caret, Selection and platform IME
  composition only. The controller prevents and owns ordinary mutations.
- One explicit-end-tag HTML element is the transaction island. SourcePatch
  replaces only its parsed content range.
- Safe inline semantics remain editable. Authored comments, protected
  attributes and embedded/foreign atoms remain immutable.
- Paragraph visual starts inherit right; every other collapsed style boundary
  inherits left.
- Composition freezes island DOM and logical Selection, then replays one final
  string at that source affinity.
- Unknown or unowned mutations restore the last validated draft and fail
  closed.
- Preview DOM is never serialized as a document.

The V1 `NativeEditingController` and its implementation-specific tracker,
shadow draft, FormatSkeleton, structural planner and ignored browser suites
were removed after the V2 source-byte, Selection, composition and structural
fixtures became authoritative. The architecture gate prevents production
files or imports from reintroducing that parallel route.

## Consequences

- Start, middle, end and inline boundaries share one mutation path across safe
  text hosts.
- Edited markup may receive small parse5 normalization, such as canonical
  attribute quoting or equivalent inline serialization. Users comparing source
  should expect this only within the edited element.
- Complex block restructuring, script/style editing, form values and embedded
  document roots still require a dedicated editor or a comment.
- V2 gates use editable-island source oracles and a full host operation matrix;
  V1 state-machine implementation tests do not define V2 product behavior.
