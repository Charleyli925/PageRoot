# Report HTML Profile v0.1

- Status: frozen source-only contract; it does not enable a runtime visual.
- Owner: source author; PageRoot only validates supplied bytes.
- Implemented by: `app/domain/inline-visual-profile.js`.

## Scope

Report HTML Profile answers one narrow question: does the supplied source contain
an explicit, source-backed fixed visual-slot candidate? It does not execute
author JavaScript, inspect a runtime DOM, evaluate a full CSS cascade, inject
markup, mutate source bytes, create a session, or alter Edit/Preview/Review.

`profile-fixed` is therefore a **static compatibility tier**, not a promise
that PageRoot currently renders a dynamic visual in Edit. PR-1 deliberately
ships no production runtime path. A future runtime implementation would still
need an exact identity and geometry admission check for every generation.

## Minimal source contract

```html
<meta name="pageroot-report-profile" content="0.1">

<figure data-report-key="search-volume-trend">
  <div
    id="search-volume-chart"
    data-report-visual-slot="fixed"
    data-report-visual-kind="chart"
    role="img"
    aria-label="搜索量趋势图"
    style="width: 100%; aspect-ratio: 16 / 9"
  ></div>
  <figcaption>图表结论仍保留为源码文字。</figcaption>
</figure>
```

The profile declaration must appear exactly once and use `content="0.1"`.
Each `data-report-visual-slot="fixed"` slot must have:

- a unique `id` in the source document;
- one nearest self-or-ancestor `data-report-key`, unique across v0.1 slots and
  matching `[a-z0-9][a-z0-9-]{0,127}`;
- `data-report-visual-kind="chart"`;
- a supported source host: `div`, `figure`, `canvas`, or `svg`;
- a nonempty `aria-label`, or an `aria-labelledby` whose source IDs are unique;
- source-declared fixed geometry; and
- no nested fixed slot or source `table`/form control descendants.

## Deliberately narrow geometry rule

v0.1 accepts only an inline, mechanically readable geometry declaration:

- positive `height`;
- equal positive `min-height` and `max-height`; or
- positive `width` plus an `aspect-ratio`, with no `height` declaration.

Supported units are `px`, `%`, `rem`, `em`, `vw`, `vh`, `vmin`, and `vmax`.
The validator does not infer a slot's geometry from an arbitrary stylesheet,
utility class, computed style, browser layout, script, library version, or
filename. This restriction is intentional: trying to prove the entire CSS
cascade in PR-1 would reintroduce the open-ended compatibility complexity this
project is meant to avoid.

External CSS may still style the page, but it is not enough to qualify a slot
for this Profile tier. Authors should add the explicit source declaration when
they want the page to be a future runtime candidate.

Static validation can mechanically reject nesting. It cannot prove every
possible CSS overlap from source alone; any future runtime surface must measure
and reject overlap, overflow, replacement, and layout drift before showing a
visual. It must fail closed rather than treat this Profile as a bypass.

## Result contract

`validateInlineVisualProfile(html, { maximumSlots })` returns a frozen report:

```text
{
  contractVersion: "0.1",
  sourceSha256: "sha256:...",
  tier: "profile-fixed" | "legacy-candidate" | "preview-only" | "static-only",
  declaredVersion: "0.1" | null,
  maximumSlots: 32,
  slots: [{ nodeId, tagName, reportKey, id, sourceRange, diagnostics }],
  legacyCandidates: [{ nodeId, tagName, sourceRange }],
  diagnostics: [{ code, location, reportKey? }]
}
```

The source is read only. `sourceSha256` is calculated from the supplied exact
bytes; the validator never normalizes or serializes HTML back to the caller.

## Compatibility tiers

| Tier | Meaning in PR-1 | Current product behavior |
| --- | --- | --- |
| `profile-fixed` | Explicit Profile v0.1 candidate passes all static checks | No change; Edit stays static |
| `legacy-candidate` | A direct source Canvas/SVG has unique `id` and narrow inline fixed geometry | No automatic support or runtime path |
| `preview-only` | Profile exists but cannot be admitted from source alone | No change; Preview remains the interaction surface |
| `static-only` | No runtime candidate was found | No change |

No tier writes Version data, Candidate Assessment, AI input, source history,
telemetry, or user-visible status. `legacy-candidate` is particularly not a
support commitment; it exists only to make a later, separately reviewed
compatibility decision explicit.

## Diagnostic codes

| Code family | Meaning |
| --- | --- |
| `source-parse-invalid` | The supplied source parser reported an unstable source range; validation fails closed |
| `profile-*` | Missing, duplicate, or unsupported Profile declaration |
| `slot-missing-*`, `slot-invalid-*`, `slot-duplicate-*` | Ambiguous or unstable source identity |
| `slot-unsupported-*` | Unsupported host or visual kind |
| `slot-dynamic-or-unknown-geometry` | Geometry cannot be proven from v0.1 source declaration |
| `slot-nested-or-overlapping` | A nested slot is proven; other overlap remains runtime admission work |
| `slot-non-visual-runtime-content` | The slot contains source table or form content |
| `slot-budget-exceeded` | More than the validated maximum of 32 slots by default |

Diagnostics contain only stable codes, report keys, and source line/column
ranges. They contain no HTML, CSS, JavaScript, file path, URL, page title, or
business text. `summarizeInlineVisualProfileForTelemetry()` is a separate,
non-sending helper that intentionally omits source SHA, keys, IDs, and source
locations; it exists to prevent future telemetry code from reusing the richer
source-facing report accidentally.

## Migration guidance

Keep charts, titles, captions, and conclusions in source-backed HTML. Mark only
the fixed chart mount element, not a dynamic table, card list, report section,
or whole page. Do not add a Profile declaration automatically to existing user
documents. Any migration UI must be a future explicit, source-reviewed action.
