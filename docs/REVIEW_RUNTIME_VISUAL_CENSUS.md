# Review runtime visual false-positive census

## Why this exists

Review kept reporting a confirmed 「视觉调整」 on charts that no edit had
touched. Every previous attempt tuned a number — the capture settle wait or the
raster tolerance — and every attempt moved the failure boundary instead of
removing it. The reason is structural: the false positives were never
attributed to a mechanism, so each fix was unfalsifiable and the next test round
found new edge cases.

This census exists to make that class of fix falsifiable. It measures; it does
not repair.

```
npm run census:review-runtime-visual -- --runs 10 --keep-pixels
```

## Method

`scripts/review-runtime-visual-census.mjs` runs under Electron because the
behaviour only exists in a real offscreen renderer: the settle wait, the
per-candidate `scrollIntoView` and `capturePage` are what produce the sampled
pair. A Node-level fake with canned PNG bytes cannot reproduce it. The census
drives the production capture owner and the production comparison functions
unmodified.

`tests/fixtures/review-runtime-chart-scenarios.mjs` generates synthetic page
pairs. Each pair declares what its charts must do, so the census measures both
directions and cannot be satisfied by a pipeline that reports nothing:

- `chartExpectation: "unchanged"` — identical chart pixels on both sides. A
  confirmed change is a **false positive**.
- `chartExpectation: "changed"` — genuinely different chart pixels. Missing it
  is a **false negative**. `chart-data-change` and `chart-host-resize` are the
  positive controls.

The fixture chart script is parameterized rather than a real library, so
`--animation-ms`, `--library-delay-ms`, `--settle-ms` and `--viewport-height`
can isolate one factor at a time. Both sides always receive identical
parameters. Each candidate row records the comparison step that decided the
verdict and the raw raster distance, so a failure is attributable rather than
merely counted.

`tests/review-runtime-chart-scenarios.test.mjs` guards the fixture bindings. A
drifted host path or a host that stopped being source-empty would make every
capture report `unavailable`, and the census would then pass by measuring
nothing.

## Baseline (before the scroll paint sync)

9 scenarios × 10 runs × 2 chart hosts = 180 candidate rows, default viewport
1280×900, default 1000 ms fixture animation, contract settle wait.

| Scenario | Expectation | False positives | False negatives |
| --- | --- | --- | --- |
| footer-only | unchanged | 1 / 20 | — |
| text-insert | unchanged | 3 / 20 | — |
| text-delete | unchanged | 5 / 20 | — |
| text-rewrite | unchanged | 5 / 20 | — |
| structure-add | unchanged | 1 / 20 | — |
| structure-remove | unchanged | 4 / 20 | — |
| chart-script-noop | unchanged | 2 / 20 | — |
| chart-data-change | changed | — | 0 / 20 |
| chart-host-resize | changed | — | 0 / 20 |

**21 of 140 unchanged-chart rows (15%) were reported as confirmed changes. No
real chart change was missed.**

Three properties of the baseline matter more than the rate:

1. **Every false positive came from the raster step.** None came from the
   dimension step or the rendered-text step, and no false positive had
   differing layout dimensions. Geometry and text evidence were correct
   throughout.
2. **Every false positive landed on the first-sampled candidate.** 21 of 70
   rows for the first chart, 0 of 70 for the second. Candidates are captured
   sequentially after a single page-level settle.
3. **The raster distances do not separate.** False positives ranged 7.56 to
   22.13 (median 10.58) against a 0.04 budget. Real chart changes ranged 0.80
   to 10.80. The distributions overlap, and the false-positive median exceeds
   the real-change median.

Property 3 is the decisive one: **no value of the raster budget can separate
noise from fact.** A threshold above the false positives (>22) suppresses every
real chart change; a threshold that catches real changes (<0.8) admits every
false positive. Tolerance tuning cannot work here, and this is why it never did.

## Attribution

Two factors were separated by holding one fixed and varying the other. Raising
the viewport until the whole page fits removes the per-candidate scroll;
shortening the fixture animation retires it long before the settle expires.

| Viewport | Scroll needed | Animation | False positives |
| --- | --- | --- | --- |
| 2000 | no | 300 ms (finished early) | **0 / 40** |
| 2000 | no | 1000 ms (marginal) | **0 / 40** |
| 900 | yes | 300 ms (finished early) | **9 / 40** |
| 900 | yes | 1000 ms (marginal) | 6 / 40 |

**The scroll is necessary and sufficient; the animation is neither.** Removing
the scroll eliminates every false positive even while the entrance animation is
still running. Keeping the scroll produces false positives even when the
animation finished long before the settle expired.

The mechanism is in `desktop/runtime-visual-capture-owner.mjs`: the isolated
probe scrolls each host to the viewport centre and measures it, and the owner
then calls `capturePage` with that rect without ever waiting for a frame that
reflects the scroll. The sampled pixels can belong to a pre-scroll frame. The
first candidate is the exposed one because it carries the largest scroll
distance — the page starts at the top, and later candidates are already near
the centre. The false-positive raster distances are discrete and repeating
(8.08, 10.58), which is the signature of a quantized content offset rather than
of raster noise.

Animation phase is a real but secondary factor with a distinct signature. At a
1600 ms fixture animation, which genuinely outlasts the settle, the second
candidate begins failing too, with small clustered distances (0.26) unlike the
6–22 range of the scroll failures.

## After the scroll paint sync

The probe now reports whether centring the host actually moved the page, and
the owner waits for the next offscreen frame before sampling a host that moved.
Re-running the identical census:

| | Before | After |
| --- | --- | --- |
| False positives | 21 / 140 | **0 / 140** |
| False negatives | 0 / 40 | **0 / 40** |
| Unverified | 0 / 180 | **0 / 180** |
| Unchanged rows deciding on `png-hash-equal` | 119 / 140 | **140 / 140** |

The last row matters most. Every unchanged chart now produces a **byte-identical
PNG pair**, so the raster comparison and its 0.04 budget are no longer reached
at all for this class. The observable became a function of the source instead
of a function of when it was sampled.

The residual animation factor is unchanged and out of scope for that fix: with
a 1600 ms fixture animation, which genuinely outlasts the settle, the census
still reports 9 / 40. It is a different signature — smaller distances, later
candidates — and needs its own change.

## Matrix results

The census covers two renderers, because the comparison steps do not treat
them alike: a canvas chart draws its labels as pixels and hides them from the
rendered-text step, while an svg chart exposes them there. Running the same
scenarios under both is what proves each step still earns its place.

2 renderers × 11 scenarios × 10 runs × 2 hosts = **440 candidate rows**, default
viewport, default 1000 ms animation, contract settle wait.

| Chart change | canvas | svg | Caught by |
| --- | --- | --- | --- |
| host resized | 20/20 | 20/20 | dimensions (step 1) |
| label text | 20/20 | 20/20 | **raster** on canvas, **rendered-text** on svg |
| series data | 20/20 | 20/20 | raster (step 3) |
| colour only | 20/20 | 20/20 | raster (step 3) |
| nothing (7 unrelated-edit scenarios) | 0 false | 0 false | — |

**440 rows: 0 false positives, 0 false negatives, 0 unverified.**

The separation is now categorical rather than marginal:

| | before the scroll fix | now |
| --- | --- | --- |
| unchanged chart raster distance | 7.56 – 22.13 (false positives) | **exactly 0** (280/280 byte-identical) |
| real chart change raster distance | 0.80 – 10.80 | 0.561 – 23.81 |
| overlap | **yes** — no threshold could separate them | **none** — 14× margin at the tightest point |

The tightest real signal is a canvas label rename (0.561, 14× the 0.04 budget);
the loudest is a full recolour (23.81). Nothing unchanged produces any raster
distance at all, so the budget is no longer the thing standing between noise
and fact.

## Reviewer-visible presentation

A verdict is not what a reviewer sees. The census also runs the real merge
rules over the real verdicts under all four combinations of the two dimensions
that decide presentation — whether the source diff also found a change in the
chart's section, and whether the user commented on the host:

| Variant | unchanged charts | real chart changes |
| --- | --- | --- |
| source changed + commented | 280 silent | 160 confirmed |
| source changed + uncommented | 280 silent | 160 confirmed |
| source unchanged + commented | 280 silent | 160 **suspected** |
| source unchanged + uncommented | 280 silent | 160 **suspected** |

No unchanged chart produces a frame in any variant, and no real change is ever
silent. Comment anchoring changes nothing here, which is the intended result
of making it a floor rather than a gate.

The last two rows are the designed trade-off, and the matrix shows it is the
common case rather than a corner: a chart driven by a `<script>` outside its
own section has no source change inside that section, so a genuine data or
colour edit surfaces as "疑似有改动" instead of a confirmed visual change. The
information is not lost — the host keeps its frame, caption and navigation
stop — but the label is weaker than the evidence deserves. Widening
corroboration to "the source of anything that can drive this host changed" is
the obvious follow-up; it is not implemented.

## Authored pages and the surface digest

`--pages` runs the same pipeline against arbitrary local HTML. The pages never
enter the repository; only their paths are passed in and only derived counts are
written out. Byte-level mutations cover the false-alarm side, and three probes
cover detection: a chart-library hook that recolours the palette or rescales the
series, and a library-independent `filter: invert(1)` on every host.

One earlier probe had to be retired. Inserting a `<section>` at the top of
`<body>` also changes which siblings match `:first-child` and `:nth-child`, so a
page using structural selectors legitimately repaints and the probe cannot tell
"moved" from "restyled". Displacement is now measured with `padding-top` on
`<body>`, which moves everything and edits no node.

That clean probe isolated the cause exactly:

| Page (comparable hosts) | integer 160px shift | **half-pixel 157.5px shift** |
| --- | --- | --- |
| ECharts, 12 hosts | 0 / 36 | **36 / 36** |
| ECharts, 8 hosts | 2 / 24 | **24 / 24** |
| inline SVG, 3 hosts | 0 / 9 | **9 / 9** |
| inline SVG, 2 hosts | 6 / 6 | 6 / 6 |

Snapping the host onto a whole device pixel before sampling was tried and
failed: Chromium lands scroll offsets on integer device pixels, so at a device
ratio of 1 no scroll can compensate half a device pixel. That is why the digest
replaces the window capture rather than correcting it.

After the digest, 4 authored pages × 7 mutations × 3 runs = 786 rows:

| | window pixels | surface digest |
| --- | --- | --- |
| False positives | 24 | **0** |
| Missed real changes | 21 | **0** |
| Suspected on an unchanged host | 0 | **0** |

The 21 remaining "missed" rows are the harness, not the pipeline, and the
report proves it: both sides' PNG hashes are identical in all 21, so those
pages genuinely rendered the same and `unchanged` is the correct answer. Fifteen
are an invalid expectation (a chart-library hook cannot change a page that has
no chart library) and six are charts whose colours are written into the data,
where the palette hook has nothing to override.

A larger run settled two questions the 786-row run could not. 2 ECharts pages
× 7 mutations × 15 runs = **2835 rows, 0 false positives**, including 300
comparable `real-noop` rows where both sides are the same bytes. The
intermittent false positive that used to appear there roughly once every three
runs is gone, so the residue previously attributed to animation phase was
window compositing too. All 30 remaining missed rows are the known probe gap on
two specific hosts whose colours live in their data, and both sides' PNG hashes
match in every one of them.

Raising the capture viewport from 900 to 2400 changed the unverified count by
exactly zero (91 → 91), so host-larger-than-viewport is **not** what makes hosts
unverifiable here; over-collection by this harness's discoverer is. On the one
page where the chart containers can be enumerated exactly, 12 of 16 discovered
elements are real `echarts.init` targets and exactly 12 are comparable. Treat
the unverified rate in this report as a property of the harness, not of the
pipeline.

Reading the surface alone was not sufficient. CSS that repaints at composite
time leaves a canvas byte-identical, so the first digest missed the invert
control on 100% of hosts; folding in resolved presentation values for the host,
each paint target and the ancestor chain restored it. Ancestor `transform` is
left out on purpose: a sticky ancestor resolves a scroll-dependent matrix, and
folding it in would put position sensitivity straight back.

## What this rules out

- **Raising `captureSettleMs`.** The dominant factor is not animation phase. A
  longer settle costs every review time and leaves the scroll race untouched.
- **Adjusting the raster budget.** The two distributions overlap; see property
  3 above.
- **Capturing each side twice and comparing the second pair.** Two unsynchronized
  samples do not make one synchronized observation.

## Reading a report

`output/<dir>/review-runtime-visual-census.json` holds the options, the
contract constants in force, per-scenario totals and one row per candidate.
Each row carries `step`, `rasterDifference`, both snapshot summaries and the
capture outcomes. `--keep-pixels` additionally writes the PNG pair for every
mismatch to `mismatch-pixels/`, so a disputed verdict can be inspected directly.

A run whose rows are entirely `unverified` measured nothing and prints a
warning; treat it as a broken census, never as a clean one.
