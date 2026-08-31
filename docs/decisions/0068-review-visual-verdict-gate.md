# ADR 0068: Review visual verdict gate

- Status: Accepted
- Date: 2026-08-31
- Supersedes: ADR 0066's static source-fact visibility rule

## Decision

Formal modern Review accepts only two complete, valid and document-unique
`data-pageroot-id` source indexes. The same valid ID is the only pairing key:
tag and parent changes retain continuity, while missing, partial, invalid and
duplicate identity is explicitly `unsupported`. There is no semantic matcher,
title/class/id/text similarity, sibling, relocation, singleton, weighted or
fuzzy recovery in this path.

Source text, add/remove, move, attribute/style, CSS and script differences are
`SourceEvidence`: private pending candidates bound to the exact before/after
source SHA and Review session. They are not Review changes. The pre-authored
bootstrap captures native DOM capability and establishes a one-shot,
challenge-bound `MessagePort` per frame side. The port observes the matching
stable-ID host after load and is invalidated by document/session/frame reload
generation replacement. No Main/Preload/IPC/screenshot/PNG owner is added.
The bootstrap also captures each source-declared Stable-ID host reference while
the parser constructs the document. A disconnected host, changed/removed ID,
duplicate claimant or later same-ID replacement is unverified; current-DOM
lookup can never reacquire identity. Any iframe `load` after its initial load
immediately clears the old verdict generation before a new port may settle.

Common Stable IDs require a matching trusted observation from both sides;
added/removed roots require the trusted present side plus the source-proven
absence. Equal stable visible summaries are `unchanged`; a visible difference
with SourceEvidence is `changed`; stale, missing, unstable or unreadable
observation is `unverified`. Added/removed roots are changed only if their
present side is visible, own their descendants, and inherit dynamic-source
pollution. Pending and unverified
candidates never enter changes, markers, counts, navigation or context dimming.

The bounded summary excludes absolute page coordinates and scroll position. It
includes visible direct text, a computed-presentation whitelist, pseudo-element
content, visible image dimensions, normalized SVG drawing attributes and
resolved paint, Canvas 2D backing-store hashes and runtime-generated descendants
owned by the nearest Stable-ID host. Stable descendants remain independent
targets. Two samples across animation frames must agree. WebGL, tainted Canvas,
running animation, video/audio, time/random/network-dependent output, hidden
unsynchronized content, node/pixel/time budget overflow and generation changes
are `unverified`; no threshold or source fallback upgrades them.

Existing text wrappers and element projection facts are serialized as pending.
The frame projection owns an empty confirmed-ID set until the parent combines
both observations. Only confirmed IDs can draw character dots/strikes, element
boxes, mask holes or revision bars. This preserves `全部 / 文字 / 元素`, split
and single-page modes, linked scrolling, zoom, first-change navigation and
whole-Candidate adoption without a new category or explanation panel.

Review comments remain trusted React UI. Their marker is fixed to the right
edge of the Before pane rather than authored document coordinates; vertical
position follows the target and nearby markers aggregate to `评2`/`评3` without
large displacement. Hover and keyboard focus use the same private frame ports
to highlight the Before target and the After element with the same Stable ID.
A deleted target highlights Before only. Comment text and attachments never
enter authored HTML.

Tests must assert non-zero candidates, the pure three-state reducer and final
projection activation. The browser matrix covers position/class no-ops, text,
computed style, runtime DOM, SVG, Canvas, WebGL, real taint, animation, media,
budgets and generation invalidation. Electron Review verifies the fixed comment
track, horizontal-scroll independence, paired hover/focus highlighting and the
unchanged adoption contract.
