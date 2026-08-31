# ADR 0068: Review source facts with visual enhancement

- Status: Accepted
- Date: 2026-08-31
- Amended: 2026-09-01
- Extends: ADR 0046 and ADR 0066

## Decision

Review source facts remain authoritative. Precise text differences, outermost
element addition/removal, Stable-ID movement and explicit authored attribute
changes enter the existing `全部 / 文字 / 元素` list, count, navigation and
projection as soon as source analysis completes. A runtime visual observation
may annotate those facts, but missing, stale, hidden, unsupported or
unreadable observation never deletes them.

Complete, valid and document-unique `data-pageroot-id` remains the required
binding for current-frame visual enhancement. Missing, partial, invalid or
duplicate identity makes only visual enhancement `unsupported`. It does not
cancel source Review: the existing semantic source matcher remains available
for historical documents, while Stable-ID continuity is used whenever the
document pair proves it. This PR does not add a migration, compatibility flag
or second source classifier.

`SourceEvidence` is an observation plan, not a replacement Review model. The
plan contains only hosts implicated by a source difference; identical common
Stable IDs are not observation candidates. One semantic `ReviewChange` carries
`evidenceStableIds[]`, so one change can span several hosts and several changes
can depend on one host without replacing precise character facts with generic
element changes. CSS and Script source aggregates remain visible source facts.

The current-frame bootstrap may provide best-effort `changed / unchanged /
unverified` observations for DOM presentation, pseudo content, images, SVG,
Canvas 2D and runtime descendants owned by a planned Stable-ID host. It uses a
challenge-bound `MessagePort`, source/session/generation labels and parser-time
host references to reject stale ports, duplicate claims and same-ID
replacement. It runs in the authored frame realm, however, and echoes the
parent-provided source label; it is not an isolated security oracle and must
not be described as a trusted proof against hostile authored code.

Observation is batched across animation frames and uses one Review-wide time,
node and pixel budget per sample. Every planned candidate receives an explicit
result; there is no `.slice(0, 1000)` or other silent truncation. Budget
exhaustion, WebGL, tainted pixels, live media, running animation, instability,
missing hosts and late/stale generations are `unverified`. Added, removed or
both-side-hidden source facts are also `unverified` visually while remaining
visible as source changes. Presence of an external Script, ECharts, timers or
network API never blanket-taints unrelated source facts.

A bounded DOM/style summary can establish a visible difference, but equality
cannot prove that arbitrary CSS or Script had no downstream effect. Equal
visual-only summaries therefore remain `unverified`; they do not suppress a
source fact. A pure visual candidate may be suppressed only if a future
observer can explicitly prove every linked host is unchanged without relying
on this bounded whitelist.

The Review UI exposes one inline state: `正在分析`, `已完成`, `有 N 项无法视觉验证`
or `不支持`. `unverified` source changes remain in filters, navigation and
markers. Adoption stays available because source validation and Candidate
integrity are separate authorities, but the confirmation dialog explicitly
states when visual enhancement is pending, unsupported or unverified.

Review comments remain trusted React UI outside authored HTML. The marker rail
is fixed to the right edge of the Before pane, nearby comments aggregate to
`评2`/`评3`, and active comment keys are owned by the parent. Marker unmount,
document replacement, frame reload and port closure broadcast inactive state
so one marker cannot clear another active highlight or leave a stale layer.

No Main/Preload/IPC/screenshot/PNG capture owner is restored. Existing Review
text geometry, structure facts, split/single-page views, panel reveal, linked
scrolling, zoom, comments and Candidate adoption remain the reused product
surface.

## Required tests

- a deterministic change after more than 1,000 unchanged Stable IDs;
- hidden Tab, `display:none`, `visibility:hidden` and `opacity:0` source facts;
- parent class/CSS-variable, positioning and cross-parent movement changes;
- delayed runtime mutation settling after the first sample;
- one semantic change spanning multiple Stable-ID hosts;
- external ECharts/Script pages with an ordinary text change;
- pending, unsupported and unverified inline state plus adoption confirmation;
- comment marker unmount, document replacement and port-rebind cleanup.
