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
