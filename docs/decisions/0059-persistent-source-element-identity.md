# ADR 0059: source elements use a persistent PageRoot identity

## Status

Accepted.

## Context

PageRoot currently locates authored elements through source offsets, selectors,
text quotes and structural fingerprints. Those facts are useful compatibility
evidence, but ordinary text edits, sibling insertion and element movement can
change them. Comments, semantic editing and Review therefore cannot share one
simple identity contract without repeating heuristic rebinding.

The new contract must remain compatible with arbitrary HTML, SVG, `template`
content and custom elements. It also must not turn the disposable Runtime DOM
into source authority or silently rewrite an old project merely because it was
opened.

## Decision

1. The only persistent PageRoot-owned HTML attribute is
   `data-pageroot-id`. Every other `data-pageroot-*` attribute is ephemeral
   instrumentation and must not be treated as a saved source fact.
2. Identity schema v1 values use `pr1_` followed by the 32 lowercase
   hexadecimal digits of a cryptographically generated UUID v4. The version is
   explicit, the value carries no tag, path, source offset, project or user
   meaning, and matching is case-sensitive.
3. An identity is unique within one complete HTML document. Text, attribute,
   style and move operations preserve it. A true insert or clone receives a new
   identity. A deleted identity is not deliberately reused. Repairing a
   malformed or duplicated identity is a future explicit transaction, never an
   inference made while parsing.
4. `SourceIndex` reads the attribute from exact start-tag ranges and exposes a
   `pagerootId -> source element` map only for valid, unique values. Missing IDs
   are reported as absent or partial compatibility state. Repeated attributes,
   malformed values and duplicate values are reported with exact source ranges
   and never guessed into the map.
5. Parsing and indexing are read-only. This decision does not authorize ID
   injection, Working Copy migration, historical Version rewriting, target
   conversion, Runtime serialization or save-path changes. Those require later
   dependent decisions and transactions.

## Consequences

- Old HTML remains byte-for-byte unchanged when opened or indexed and continues
  to use the existing TargetRef compatibility path.
- A fully identified document has a constant-time authoritative lookup for each
  source element, including SVG, `template` descendants and custom elements.
- A partial or invalid identity set is explicit. Callers can fail closed instead
  of mixing stable and heuristic identity without noticing.
- ID values are intentionally opaque and are not ordered. Version ordering,
  document lineage and source position remain separate facts.
- The follow-up Working Copy migration must use CAS, atomic writing and recovery,
  and must not rewrite immutable historical Versions.

## Rejected alternatives

- **Use source offsets or DOM paths as IDs.** Ordinary edits and moves change
  both, which preserves the current rebinding problem under a new name.
- **Use author `id` attributes.** They are optional, author-controlled and often
  duplicated; PageRoot must not change their CSS or script meaning.
- **Derive deterministic IDs from element content.** Editing the content changes
  the identity, while repeated content creates collisions.
- **Inject IDs while rendering.** Opening a file would silently change its
  persistence contract and would mix Runtime instrumentation with source facts.
