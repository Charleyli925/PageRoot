# ADR 0021: Review runtime visual comparison separates visible text from raster noise

- Status: Accepted
- Date: 2026-08-12
- Extends: ADR 0017

## Context

Review's runtime supplement previously treated a different PNG hash, byte
length or bitmap presentation as a changed chart host. The same generated chart
can move in document coordinates when unrelated content above it changes; the
offscreen Chromium capture can then produce tiny tile or sub-pixel edge
differences even though the chart content did not change. Exact PNG identity
therefore created false Review markers.

A broad changed-pixel percentage threshold is not safe. A one-character chart
label or numeric edit can alter far less than one percent of pixels, while
visible text must remain strict. Script causality, a second capture, OCR and
Canvas API instrumentation would add new authority or retry paths without
solving the source-independent comparison boundary.

## Decision

The one existing Review before/after owner pair remains the only evidence pair.
No user-facing text, display state or Review geometry is added or changed.

- In the owner-isolated world, each captured host derives a bounded normalized
  sequence of DOM/SVG text whose paint can be established and returns only its
  SHA-256 `renderedTextSha256`; raw text does not cross the owner boundary.
  Transparent/zero-opacity paint, fully or partially clipped runs, and any
  CSS/SVG mask are excluded from this strict summary. General mask grammars
  cannot be proved from computed style alone, so masked text uses the existing
  raster layer rather than producing a false marker from text with no pixels.
  Unresolved SVG paint servers are treated the same way; common
  background-clipped gradient text remains strict only when a nontransparent
  computed gradient stop proves paint. Runs subject to CSS `text-transform`
  use the raster layer because CSS owns their final glyph casing, while
  `pre`, `pre-wrap`, and `break-spaces` whitespace remains exact and
  `pre-line` retains its visible segment breaks.
- Matching captured hosts compare layout dimensions and `renderedTextSha256`
  strictly. Any DOM/SVG text or numeric-character change whose paint can be
  established emits the existing opaque runtime fact regardless of its pixel
  area.
- Only equal-text, equal-dimension PNG hash mismatches are decoded in trusted
  renderer memory. The existing bitmap pair is compared once by mean absolute
  RGB-channel error, and a value greater than `0.04` on the 0–255 channel scale
  is meaningful. PNG byte length or encoder output alone is not a difference.
- Decode failure, unavailable text summary, malformed data, timeout or any
  other boundary failure remains a static-only result. There is no retry,
  second capture, cache, OCR, script analysis or source authority change.

Canvas-internal glyphs have no DOM/SVG semantic representation after a page has
rendered, so they use the same calibrated raster path. This is an explicit
bounded limitation, not permission to inspect authored scripts or instrument
Canvas globally.

## Consequences

- Repeated captures of unchanged script-generated charts no longer acquire a
  Review marker solely from harmless rasterization variance.
- Textual SVG/DOM chart labels remain exact, including small numeric changes.
- The comparison stays local to the existing owner result: no project data,
  raw DOM/text, target binding or PNG enters authored Review frames, Source HTML
  or persistence.
- The only new owner payload field is a bounded digest. Contract version 2
  fences old producers and consumers from silently mixing schemas.

## Rejected alternatives

### A one-percent changed-pixel cutoff

Rejected because a small digit or one-character label mutation can affect much
less than one percent of a chart image and would be hidden.

### Re-capture until hashes agree

Rejected because it changes the evidence model, burns the owner deadline and
makes animation or hostile timing a new source of non-determinism.

### Script causality, OCR or Canvas instrumentation

Rejected because each broadens the trust boundary or adds disproportionate
complexity. The owner already has reliable DOM/SVG visible-text semantics and a
bounded bitmap fallback for Canvas.
