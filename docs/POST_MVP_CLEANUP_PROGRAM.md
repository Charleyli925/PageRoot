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
| **P0-B** Remove legacy Bridge stack | Split the remaining v3 Bridge so persistence and IPC have one current owner | Done on `main` (#190) |
| **P1-B** Save-pipeline CAS | Content-addressed save pipeline; depends on P0-B | Done on `main` (#192) |
| **P1-A** Editable fail-open | The only user-visible relaxation: enter native editing and validate after, not before. Layout fingerprints, style-boundary carets and source-projection drift no longer refuse entry. Checkpoint scope, stale hashes and MutationObserver rollback still fail closed. | Done on `main` (#191) |

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

**Why `scope-validator.mjs` left the installer, then left the tree.** The
packaged Bridge no longer called it. P0-A moved `rawStartTagAttributes` to
`html-source-parser.mjs` and kept the module in source for direct-patch
contract tests. The follow-through PR deletes the source module: live island
bytes are still checked by `source-patch-engine` at commit time, and the
retired AI-version scope report is not an acceptance gate.

**Why the preflight file is split, not deleted wholesale.**
`HtmlCanvasEditor` still uses `nativeLayoutFingerprint`, `sameNativeLayout`,
and `sameNativeTextStyle` to observe post-entry geometry or text-style drift.
P0-A moved those three helpers to `native-layout-fingerprint.ts` with
byte-stable behavior. P1-A stopped using them as an entry gate.
`nativeRuntimePreflight`, `buildRuntimeDomMap`, and
`RuntimeDomSourceMap` had no production callers, so they are deleted instead
of remaining as a fake safety net.

**Why `isNativeDirectEditRoot` stays.** `source-patch-engine` still uses it to
decide whether a tag can host a native text island. P1-A relaxes entry for
layout fingerprints, style-boundary carets, source-projection remounts and
complex-parent text fragments; it does not widen this predicate to script,
style, form roots or immutable atoms.
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

## What P1-B changes, and why

P1-B sits on P0-B. It does not change the four save-status strings, island
undo granularity, or the conflict-panel copy.

**Why the second 700ms wait is gone.** Native-edit checkpoints already wait
`NATIVE_EDIT_CHECKPOINT_DELAY_MS = 700` before producing a source patch.
`DocumentWorkflow` then waited another 700ms before flush, so keypress-to-disk
p50 sat near 1.4s. Checkpoint writes now flush immediately, matching Cmd+S.
Non-checkpoint writes keep a short ~100ms debounce. `PROJECT.md` still uses
700ms.

**Why the save journal is two-state CAS.** The eight-state park journal
re-checked the expected hash five times and realpath'd three times per atomic
write. New saves write recovery bytes (`prepared`), then one same-directory
tmp + expected-hash CAS rename, one post-write hash reread, and `committed`.
Crash recovery still reads legacy park journals and finishes complete old or
complete new bytes, never a mix. A clean Working Copy silently adopts an
external disk change; dirty editor bytes plus an external change stay
`WORKING_COPY_CONFLICT`.

## What P1-A changes, and why

P1-A is the only user-visible relaxation. Native editing enters first and
validates after. Layout fingerprints, style-boundary carets, source-projection
remounts and complex-parent text fragments no longer refuse entry.
Checkpoint scope, stale hashes and MutationObserver rollback still fail
closed. `isNativeDirectEditRoot` is unchanged: script, style, form roots and
immutable atoms stay out of native text islands.

The installed-app editability census
(`scripts/run-installed-text-editability-census.mjs`) still needs a packed
`.app` of the exact tree. This follow-through does not invent before/after
percentages. C03 and C04 no longer refuse entry; C05 and C06 still fail closed
when a unique text node or a reliable caret map cannot be proved.

## Follow-through after #188–#192

These leftovers were not merge blockers. They exist so the five P0/P1 PRs stay
honest against the original plan.

**Why this follow-through is one PR.** Each leftover is a small deletion or
cache, not a new product decision. Splitting them would repeat the same
packaging-closure and impact-map edits. Behavior that users can see is only
narrower: old appData Recent files are no longer auto-imported, and the
retired scope validator can no longer be imported by mistake.

| Leftover | Why | What this PR does |
| --- | --- | --- |
| `scope-validator.mjs` source | P0-A left it for direct-patch contract tests. Those tests now belong to `source-patch-engine`. Keeping a 2,500-line unused module invites re-wiring it as an AI gate. | Delete the module and `tests/scope-validator.test.mjs`. Keep island-outside checks on the live patch engine. Restore current AI-candidate policy tests in `tests/candidate-assessment.test.mjs` and `createCandidate` persistence. |
| `lifecycle-core` `project-registry.json` | P0-B stopped the Bridge from reading the v3 registry. `recordUserSupplement` still resolved projects through it. | CLI and helper take `--project-root` / `projectRoot`. Identity is `project.json` vs the directory name. No registry read. |
| `html-projects.json` appData probes | P0-B dropped Documents workspace roots. Recent-file UI still opened `PageRootV2` / `YuanYe` / `HTML AI 工作台` state files. | Read only current `userData/html-projects.json`. Do not delete user directories. |
| `#serial()` verified-root cache | P1-B already cached `realpath()` per serial turn. The project-root lstat + non-symlink check still ran on every nested write. | Cache one verified root per `#serial()` turn. Re-check on the next turn so a symlink swap still fails. |
| P1-A table still said `Yes` | #191 had already merged. | Mark Done on `main` (#191). |
| npm scripts 54 vs ~45 | Public aliases (`test`, `gate:*`, `task:*`, `package:developer`, `release:mac`) are the supported CLI in `AGENTS.md`. Collapsing them would break the documented workflow. | Keep 54. Document this as the accepted remainder. |
| Two governance docs | `CODEX_WORKFLOW.md` is task/authorization; `RELEASE_PIPELINE_GOVERNANCE.md` is CI/release evidence. Concatenating them would mix audiences. | Delete the duplicated Candidate/Release paragraphs from `CODEX_WORKFLOW.md` and point at the governance doc. |
| Editability census numbers | The script requires `--app` pointing at a packed `.app` of this tree. | Do not invent percentages. Run the census against a Developer Preview of this exact tree when packing. |

The 22 uncommitted files in the primary `product` checkout were discarded, not
ported. Diffing them against `origin/main` showed they would revert #186 copy,
#187 dedicated-surface hits, and #191 fail-open tests, and one test used a
personal `/Users/lizexuan/` path. Unique work from that tree was already on
`main` (#186, #193). A recoverable patch is local only
(`/tmp/pageroot-product-22-dirty-20260815.patch`) and is not committed.

