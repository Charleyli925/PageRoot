# Post-MVP cleanup program

This program removes leftover complexity that no longer earns its keep after
MVP. It does not change PageRoot's product invariants: current HTML bytes stay
authoritative, preview DOM is never the persistence source, visual edits remain
minimal source patches, AI output stays untrusted until protocol checks pass,
and release evidence still binds an exact Git Tree.

## Why this order

The original exploration order was P0-A → P0-B → P1-B → P1-A → P1-C. The
chosen order is **P1-C first**, then the remaining items from a clean
`origin/main` that already contains the new CI.

P1-C is first because later cleanup PRs would otherwise pay the old CI cost:
separate Feedback and Ready workflows, a blocking `review-policy` wait, Draft
probe markers, review-gate recovery, and a weekly debt issue. Collapsing that
surface now makes every following PR cheaper and removes a merge-blocker that
is not a product invariant.

## Items

| ID | Purpose | This PR |
| --- | --- | --- |
| **P1-C** CI consolidation | One `ci.yml` for Draft feedback and Ready full-gate; Codex review is shown, never a merge hard gate; arm64-only packaging scripts; delete review-debt and retired review workflows | Done on `main` (#188) |
| **P0-A** Remove retired validators | Delete dead packaged `scope-validator` wiring and extract the live native-layout fingerprint helpers so later refactors do not keep carrying unused contracts | Done on `main` (#189) |
| **P0-B** Remove legacy Bridge stack | Split the remaining v3 Bridge so persistence and IPC have one current owner | Yes |
| **P1-B** Save-pipeline CAS | Content-addressed save pipeline; depends on P0-B | Follow-up |
| **P1-A** Editable fail-open | The only user-visible relaxation; keep it in its own PR so it cannot hide inside governance or dead-code cleanup | Follow-up |

## Governance decisions locked by P1-C

1. **Codex review is informational.** Ready (or the `full-gate` label) requests
   one `@codex review` for the current head. Findings appear on the PR. They
   never fail `release-gate`. Merge protection should require `release-gate`
   only.
2. **Packaging is arm64-only.** npm scripts, Developer Preview workflow
   choices, and gate `--arch` no longer expose x64. The low-level packer may
   still parse `--arch x64` for fixture tests; product entry points do not.
3. **Review debt is deleted.** There is no weekly rolling issue, no
   `review-debt.yml`, and no carry-forward machine state. P2/P3 comments remain
   ordinary review text.

## What P1-C changed in CI

`ci.yml` is the only Pull Request workflow.

- Draft without `full-gate` runs only `pr-feedback` (`gate:edit`).
- Ready, or a PR opened already Ready, or the `full-gate` label, runs the
  complete source matrix and `release-gate`.
- `codex-review` uses `continue-on-error` and is not listed in
  `release-gate.needs`.
- `release-dry-run.yml` stays as a reusable helper called from `ci.yml`; it is
  not a sixth product workflow.
- Deleted: `pr-feedback.yml`, `draft-review.yml`, `draft-review-auto.yml`,
  `review-gate-recovery.yml`, `review-debt.yml`, `ci-health.yml`.
- Local `npm run ci:health` still exists as a manual summary script.

These changes exist so later cleanup PRs iterate on a smaller, cheaper CI
surface without weakening source, dependency, packaging or publication gates.

## What P0-A removes, and why

P0-A is dead-code removal. It does not change edit entry, patch scope, or
packaging-closure mechanics.

**Why `scope-validator.mjs` leaves the installer.** The packaged Bridge no
longer calls it. The only live helper it still needed is
`rawStartTagAttributes`, which now lives in `html-source-parser.mjs` so
identity checks keep authored duplicate attributes. The module itself stays in
source for direct source-patch contract tests; putting it in
`resources/bridge/` only forced every installer to carry an unused file.

**Why the preflight file is split, not deleted wholesale.**
`HtmlCanvasEditor` still uses `nativeLayoutFingerprint`, `sameNativeLayout`,
and `sameNativeTextStyle` to refuse an island that would change geometry or
text style. Those three helpers move to `native-layout-fingerprint.ts` with
byte-stable behavior. `nativeRuntimePreflight`, `buildRuntimeDomMap`, and
`RuntimeDomSourceMap` had no production callers, so they are deleted instead
of remaining as a fake safety net.

**Why `isNativeDirectEditRoot` stays.** `source-patch-engine` still uses it to
decide whether a tag can host a native text island. Widening that predicate
is a user-visible fail-open change and belongs in P1-A, not here.
The unused `classifyNativeEditCapability` classifier is deleted.

The impact-selected gate used to pass deleted `tests/*.test.mjs` paths to
`node --test`, which fails closed. `omitMissingNodeTests` drops those missing
files from the executable plan so deleting a retired test is a valid cleanup.

`--mode advisory` for review policy is already gone after P1-C. CI
`advisory_scope` / `advisory_size` are PR-size hints and are not this item.

## What P0-B removes, and why

P0-B is the desktop open-boundary cutover to v4-only. It does not migrate,
recover, or delete user disk data. `.pageroot` and `.pageroot-registry.json`
keep their current format.

**Why the Bridge no longer reads `project-registry.json`.** Opening an HTML
file that is not a registered v4 Project File must import as a new v4 V1.
Keeping a v3 registry read fallback would reopen old projects as live state.
GET `/workspace` and GET `/source` therefore return unmanaged state on a miss.
Mutation routes fail closed with `PROJECT_NOT_FOUND` instead of falling into
v3 `loadContextBySource`.

**Why historical Documents workspace probes leave `workspacePath()`.** Desktop
startup no longer searches `HTML AI 工作台/项目记录`, `YuanYe/项目记录`, or
`PageRootV2/项目记录`. `HTML_AI_WORKSPACE` remains the test override;
otherwise the leftover default is `Documents/PageRoot/项目记录`. v4 projects
still live under `HTML_AI_PROJECT_FILES_ROOT` / `Documents/PageRoot/项目`.

**What stays.** Attachment, conflict, and source-history HTTP routes remain.
They now resolve a v4 project root (or 404). Attachments still use
`draft/attachments/...` under that root. A v4 project has no v3 conflict or
source-history store, so conflict reads return an empty payload and history
actions return current source bytes plus empty history. The v3 Attempt
finalizer CLI `--workspace` / `--project-id` is gone; `--project-root` remains.
