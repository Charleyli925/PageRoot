# ADR 0051: HTML readiness is progressive and scroll never waits for Canvas verification

- Status: Accepted
- Date: 2026-08-28
- Scope: HTML open, tab activation, restart restoration and display-cache handoff

## Context

The first cache milestone measured pixels, not usability. A cached projection
could appear in roughly tens of milliseconds while a full Canvas generation and
author runtime still required more than a second. The cache iframe rejected all
pointer input, so the user saw content but could not scroll it. Restart restored
only tab identities and activated the current tab without prewarming the others.

## Decision

Readiness is split into independently observable stages:

1. `ContentScrollable`: safe HTML is visible and accepts native scrolling.
2. `SourceCurrent`: Registry, OpenTarget, path and source Hash are current.
3. `EditCapable`: the sole editable Canvas owns the exact source generation.
4. `VisualComplete`: optional author Canvas, SVG and ECharts output has settled.
5. `SupplementalReady`: versions, AI records, rules and other non-first-view facts are ready.

Display projections are script-disabled and cannot edit, submit forms or
activate authored navigation. They do accept scrolling and text selection. The
projection scroll coordinate is mirrored into the authoritative editor or
Preview during handoff.

A clean validation lease may skip the leave-side full Canvas drain only when
all switch obligations are resolved, no native input or history action exists,
the document is fully persisted, and Canvas authority has verified the exact
source SHA. Any mismatch uses the original full switch path.

Restart persistence remains identity-only. Once Registry identities are
reconciled, the active tab receives a trusted read-only projection before normal
activation. Inactive tabs are then read sequentially into the Warm cache, nearest
to the active tab first. User navigation and Canvas interaction cancel or defer
that background work. Prewarming never owns Session, operation IDs, commit,
rollback, save or Version authority.

## Required proof

- cached HTML exposes a native scroll viewport before Canvas handoff and mirrors
  its scroll coordinate into the authoritative surface;
- active restart projection is visible before the first Canvas verification;
- inactive restored tabs become Warm without activating their projects;
- dirty, pending, conflicted or SHA-mismatched documents use the full switch path;
- `firstScrollableMs`, first-scroll response and chart/full-content readiness are
  reported separately in the real 20-tab benchmark;
- source, edit, save, Review and Version authority remain unchanged.
