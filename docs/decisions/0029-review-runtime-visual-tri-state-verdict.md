# ADR 0029: Review runtime visual comparison uses a tri-state verdict

- Status: Superseded by ADR 0046
- Date: 2026-08-20
- Extends: ADR 0021

## Context

ADR 0021 calibrated the one Review before/after capture pair so that visible
text stays strict while raster noise is tolerated. It kept a binary outcome:
either a candidate emitted a changed fact, or the host was presented as
unchanged and dimmed as context.

That binary output silently converted every verification failure into an
"unchanged" claim. Concrete failure modes observed with script-driven charts
(ECharts and similar Canvas hosts):

- The isolated capture session correctly blocks all non-`pageroot-preview:`
  network, so a chart library loaded from a CDN never renders in the capture
  window. Both sides sample the same blank canvas, PNG hashes match, and a
  genuinely changed chart dims as "unchanged".
- Capture used to sample right after the first offscreen paint, before an
  asynchronously initialized chart finished drawing.
- An unavailable snapshot, an undecodable PNG, or an exhausted pixel/byte
  budget contributed no fact, which rendered visually as "no change".

Users repeatedly reported changed charts that Review dimmed. Tightening the
raster threshold cannot fix this class of failure because the evidence itself
is missing; every future failure mode would default into the same silent
false-unchanged presentation.

## Decision

Dimming a runtime host as unchanged context now requires positive pixel
evidence. The single capture pair, the noise budget and the strict text rule
from ADR 0021 are unchanged; what changes is the meaning of "no fact":

- Each candidate resolves to one of three verdicts: `changed` (a fact per
  ADR 0021), `verified unchanged` (both sides captured, pixels identical or
  within the raster budget, and not near-uniform), or `unverified` (anything
  the pipeline could not prove: unavailable captures, undecodable PNGs, or two
  near-uniform surfaces whose per-channel spread is at most 3 — the signature
  of a chart that never rendered).
- Only `verified unchanged` hosts dim. An `unverified` host surfaces as
  suspected **only when a user comment anchors on it or an enclosing element**
  — comments mark the regions the user explicitly asked AI to change, so
  P(changed | commented) is high while an unconditional amber frame on every
  unverifiable chart (for example a whole page of network-blocked CDN charts)
  would drown the review in noise. A global page comment anchors on `<body>`
  and never marks hosts as commented. Uncommented unverified hosts keep the
  plain dimmed presentation, which is exactly the pre-change behavior.
- A suspected host keeps full visibility on both pages through a dim-mask
  exemption; the after page draws an amber dashed "疑似有改动" frame, and the
  change list gains a synthetic suspected entry (`suspected-<outlineId>`) that
  never folds into or overwrites a confirmed change or its outline slot.
- Runtime markers carry an explicit `verdict` (`changed` or `suspected`); the
  bootstrap rejects a whole marker batch containing any other verdict.
- The owner waits one bounded `captureSettleMs` (1,200 ms) after the first
  offscreen paint before measuring, under a raised 4-second owner deadline.
  The settle must outlast the default one-second chart entrance animation:
  sampling mid-animation on two sides at different phases would fabricate a
  changed verdict for an unchanged chart.
- Host enumeration may look beyond the 32-capture budget (up to
  `candidateLimit`) so comment-anchored hosts are captured first; user comments
  mark the regions whose verification matters most.

## Consequences

- A changed, commented chart that the pipeline cannot verify is no longer
  hidden by dimming; the reader sees both renderings side by side plus an
  explicit uncertainty hint instead of a false "unchanged" claim.
- Genuinely unchanged charts on pages whose scripts render locally still dim
  exactly as before, because their captures produce real, non-uniform,
  matching pixels.
- An uncommented chart that changed but cannot be verified still dims — the
  accepted residual of the noise trade-off; the user's comment is the signal
  that opts a region into the suspected presentation.
- Pages that load chart libraries from the network keep their capture
  isolation; commented hosts among them land in the suspected presentation,
  the rest dim as before. Relaxing capture-session network policy remains out
  of scope as a security boundary decision.
- Authored scripts are still never parsed, classified or compared; the verdict
  is derived from owner-captured pixels only.
- Losing the capture capability entirely (no owner route) leaves every
  commented runtime host suspected instead of silently unchanged.

## Alternatives rejected

- Tuning the raster threshold again: cannot recover evidence that was never
  captured; keeps the silent false-unchanged default for new failure modes.
- Marking every unverifiable chart as suspected regardless of comments:
  a network-blocked chart library floods the page with amber frames on
  unchanged charts and desensitizes the marker.
- Marking every commented chart as suspected regardless of verification:
  overrides real pixel evidence and desensitizes the marker.
- Script byte-diff as a change signal: deferred; it classifies authored
  scripts by change, which the product boundary forbids for acceptance
  decisions, and per-chart attribution is unreliable.
