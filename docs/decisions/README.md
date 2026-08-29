# Architecture Decision Records

<!-- adr-history-max: 0058 -->
<!-- adr-history-gaps: 0020 -->

This is the default reading path for decisions that still constrain PageRoot.
Historical and superseded decisions remain available from the archive index.

## Numbering notes

The repository has one historical gap, `0020`, which is intentionally never
reused. The four collisions found in the first curation pass were assigned
`0055` through `0058`; future ADRs must use the next number above `0058`.

## Active decisions

| # | Title | Status |
| --- | --- | --- |
| 0001 | [GitHub main is the source of truth](0001-single-source-of-truth.md) | Living |
| 0003 | [Session ownership and mutation outcomes](0003-session-ownership-and-mutation-outcomes.md) | Living |
| 0004 | [PageRoot 0.9.0 uses one controlled editable-island route](0004-v2-editable-islands.md) | Living |
| 0006 | [Usage telemetry uses random installation identity and a strict event allowlist](0006-pseudonymous-usage-telemetry.md) | Living |
| 0007 | [Interactive preview uses an independent document and source-backed edit context](0007-independent-interactive-preview.md) | Living; one presentation handoff is historical |
| 0008 | [Edit mode exposes only source-backed presentation actions](0008-safe-presentation-actions-in-edit-mode.md) | Living |
| 0009 | [Canvas undo uses one persistent exact-Patch journal](0009-persistent-source-patch-history.md) | Living |
| 0010 | [Short-lived branches use managed isolated worktrees](0010-worktree-branch-lifecycle.md) | Living |
| 0011 | [Workbench is a composition root over explicit sessions and views](0011-workbench-session-decomposition.md) | Living |
| 0012 | [Registered project mutations resolve identity before path](0012-id-first-project-context.md) | Living |
| 0014 | [AI candidate acceptance does not classify authored script content](0014-user-authority-over-ai-script-content.md) | Living |
| 0015 | [Safe host fallback and exact direct-text-node editing](0015-safe-host-fallback-and-direct-text-nodes.md) | Living |
| 0018 | [Autosave and source history share one SourceTransaction kernel](0018-source-transaction-kernel.md) | Living |
| 0019 | [WorkspaceController orchestrates application workflows without owning facts](0019-workspace-controller-orchestration.md) | Living |
| 0022 | [v4 Registry-authorized project roots and promotion paths](0022-user-owned-project-root-identity.md) | Living |
| 0024 | [Registry catalog and AI-task projection authority](0024-registry-catalog-and-ai-task-projections.md) | Living |
| 0025 | [Edit runs the author program once in the final visible iframe](0025-edit-direct-one-shot-runtime.md) | Living |
| 0026 | [External source to project binding is a long-lived lookup](0026-external-source-project-binding.md) | Living |
| 0027 | [Prepared open intent, Canvas-verified finalize, and out-of-root trash](0027-prepared-open-intent.md) | Living |
| 0028 | [Unrecognized project Registry shapes fail closed, with no migration](0028-unrecognized-registry-fails-closed.md) | Living |
| 0032 | [Trusted-local Qoder ACP Agent Bridge](0032-qoder-acp-agent-bridge.md) | Living |
| 0033 | [Records carry an authored actor and device, and the device identity is separate from telemetry](0033-record-provenance-actor-and-device.md) | Living |
| 0034 | [The project manifest stays portable by classification, and its one device-scoped member stays put](0034-portable-project-record-boundary.md) | Living |
| 0035 | [A Version ordinal is read from the manifest, and full identifier globalisation is deferred](0035-version-ordinal-from-manifest.md) | Living |
| 0037 | [执行轮次的可见文本与过程消息](0037-execution-visible-text.md) | Living |
| 0038 | [A changed original may be imported as a second project, but only by explicit choice, and the path binding transfers instead of forking](0038-changed-original-rebind.md) | Proposed |
| 0039 | [Provider-neutral Agent runtime boundary](0039-provider-neutral-agent-runtime.md) | Living |
| 0040 | [Provider-neutral persistence and Conversation v2](0040-provider-neutral-persistence-and-conversation-v2.md) | Living |
| 0044 | [HTML opening commits at display readiness](0044-visible-first-html-open.md) | Living |
| 0045 | [Byte-bounded display caches accelerate tabs and review](0045-byte-bounded-tab-and-review-display-caches.md) | Living |
| 0046 | [Review keeps text and element presence only](0046-review-core-text-and-element-diff.md) | Living |
| 0047 | [Project open publishes Core before fenced Supplemental projections](0047-core-supplemental-project-open.md) | Living |
| 0048 | [Tab display cache uses a measured Hot/Warm/Cold resource budget](0048-hot-warm-cold-tab-resource-budget.md) | Living |
| 0049 | [Desktop loads the real renderer shell before Bridge readiness](0049-desktop-shell-first-startup.md) | Living |
| 0051 | [HTML readiness is progressive and scroll never waits for Canvas verification](0051-progressive-scrollable-html-readiness.md) | Living |
| 0052 | [Product ACP catalog and managed installer](0052-acp-catalog-installer.md) | Living |
| 0053 | [Codex chooser uses ACP; App Server stays packaged-unregistered](0053-codex-acp-adapter.md) | Living; implementation metadata records the completed removal |
| 0054 | [bundle common ECharts bytes and retain five exact frozen Canvases](0054-bundled-echarts-and-five-canvas-residency.md) | Living |
| 0057 | [Mutable records preserve unknown members instead of dropping or refusing them](0057-forward-compatible-record-members.md) | Living |
| 0058 | [Bounded Canvas and SVG programs may complete the visible Edit document](0058-bounded-canvas-svg-edit-runtime.md) | Living |

## Reading guide

- Implementing a change: read the Living row that touches the subsystem.
- Investigating why a subsystem was built this way: use the historical archive.
- A superseded decision is context, not a current implementation contract.
