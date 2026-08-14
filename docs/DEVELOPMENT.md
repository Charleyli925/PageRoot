# Development guide

## Requirements

- macOS 12 or newer for the Electron and packaging gates
- Node.js 22.13.0 or a compatible Node 22 release
- npm, Git and Chromium installed through Playwright
- Authenticated GitHub CLI (`gh`) for Pull Request-aware worktree audits

```bash
nvm use
npm ci
npx playwright install chromium
```

`npm ci` is the dependency source of truth. Change dependencies with npm so that `package.json` and `package-lock.json` remain synchronized.

Run `npm run audit:dependencies` after dependency changes. The policy and temporary reviewed upstream exceptions are documented in `docs/DEPENDENCY_SECURITY.md`.

## Running the application

```bash
npm run dev             # web development server
npm run desktop:dev     # build renderer and launch Electron
```

## Agent task lifecycle

```bash
npm run task:status
npm run task:start -- fix/short-description
# enter the reported .codex-worktrees/fix/short-description path, then edit
npm run task:finish
```

`task:start` requires the clean synchronized primary `main`, leaves it unchanged
and creates an isolated worktree under `.codex-worktrees/<prefix>/<name>`.
`task:finish` runs the task gate against `origin/main` and reports committed
plus uncommitted task files. Neither command commits, pushes, merges or
releases.

Use `npm run task:audit` for a read-only inventory. After a squash merge, preview
the exact local cleanup with `npm run task:retire -- <branch>` and add `--apply`
only after reviewing its actions. Use `task:attach` for an existing local branch
and `task:sync-main` to fast-forward the clean primary checkout. See `AGENTS.md`
and `docs/CODEX_WORKFLOW.md` for the complete automation and authorization
boundary.

## Test lanes

| Command | Purpose |
| --- | --- |
| `npm run gate:edit` | Fast, impact-selected feedback for uncommitted work |
| `npm run gate:task` | Static checks plus impacted Node/browser/Electron coverage |
| `npm run gate:main:auto` | Optional local/diagnostic Node/browser smoke; it is not part of the automatic post-merge path |
| `Release Dry Run` Actions workflow | Candidate-classified Ready packaging check: generate the stable application-update config, assemble an explicitly unsigned (`identity=null`) App, cross a clean-job checkpoint, rebuild metadata/renderer oracles and launch-check identity without credentials; source-only candidates skip it |
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run package:developer` | Optional arm64 developer preview requested explicitly: distinct app/Bundle identity, stable-tag-derived test version, ad-hoc DMG, packaged-content verification, one isolated startup, and an exact live PR/content delivery report; no notarization or publication |
| `npm run package:developer:x64` | The same optional developer preview and delivery report for Intel Macs |
| `npm run gate:candidate-app:auto` | Guarded internal formal-candidate preflight: assemble one ad-hoc App, verify contents, then run the complete packaged-runtime oracle before signing |
| `npm run gate:artifact-only:auto` | Guarded internal installer lane; it refuses to run without CI's fresh matching tree/version decision |
| `npm run release:mac` | Complete source gate, signed arm64 DMG/ZIP package, packaged runtime test, artifact verification and exact live PR/content delivery report; release credentials are required for notarization proof |
| `npm run test:electron:ci-preflight:prepared` | Synthetic hosted-macOS window, timer and animation-frame preflight used before Electron product suites |
| `npm run benchmark:persistence` | Build one Electron renderer, then serially collect frozen-main full-HTML persistence decision evidence: it rejects changed runtime inputs outside its explicit harness/report allowlist; each autosave, switch and close duration stops at that operation's own endpoint; and it measures memory, event-loop and safety oracles |

Every `gate:edit` or `gate:task` run writes its selected files, suites and reasons
to `output/test-runs/<run-id>/selection.json`; inspect that file when validating a
local ownership change instead of inferring selection from command duration. When
changing `tests/test-impact-map.json`, run
`node --test tests/test-gate-selection.test.mjs` before the ordinary gate. The
selection contract keeps direct-owner coverage narrow while the `release` lane
remains a fixed complete suite.

Node business tests use public Session/algorithm outcomes rather than scanning
Workbench, Canvas, JSX, CSS, or callback source. Explicit application
source-shape invariants are centralized in `scripts/check-architecture.mjs` and
executed by `tests/architecture-boundaries.test.mjs`; package, dependency,
security, and workflow scans remain with their dedicated owners. The one SSR
test, `tests/rendered-html.test.mjs`, imports the real `dist/server/index.js`, so
impact selection schedules `build-web` before running it.

The developer-preview, release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Test reports are written to the ignored `output/test-runs/` directory; successful installer lanes additionally write `package-delivery-report.json` and `.md` below `output/`. The final report step requires live GitHub PR metadata and fails the installer handoff if it cannot enumerate the exact tag-to-commit range. Package commands always build the exact current clean Tree; they do not discover or merge other PRs. For an unqualified "latest" package request, prepare the required `origin/main` plus non-excluded-PR integration Tree first as documented in `docs/GIT_WORKFLOW.md`. `package:developer` is never called by another lane: run it only after an explicit developer request. Its ad-hoc, unnotarized DMG is retained for short installation feedback and is never release-eligible. See `docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

Desktop development and Electron E2E disable live update checks. The pure
application-update controller is covered by Node tests; the Release Candidate
lane owns the installed-App, Developer ID, notarization, signed-App checkpoint,
ZIP/blockmap and `latest-mac.yml` evidence. It validates contents and full
packaged runtime against a pre-sign App, proves signed startup, then passes the
same notarized App to the final artifact job without rebuilding. That fresh job
restores the App's exact embedded build, telemetry and application-update
metadata, then builds only
the deterministic Electron renderer used to compare the restored App payload
against the identical source tree. It does not regenerate telemetry or
application-update configuration, or receive the project token. Formal local
packaging is a distribution build and therefore requires a valid Developer ID
identity; publication credentials remain in GitHub encrypted secrets. The
separate developer-preview profile removes those credentials from its child
environment and intentionally uses only an ad-hoc signature.

Final Ready candidates that touch packaging, release metadata, Electron, packaged
Bridge, Schema or bundled-resource paths run `Release Dry Run` through the
candidate classifier. Source-only candidates skip it successfully. Its first
macOS job builds the renderer, generates build metadata, the stable GitHub
application-update configuration, plus an enabled synthetic telemetry
configuration, assembles and verifies an explicitly unsigned
(`identity=null`) App, then
uploads a source-bound checkpoint. A second clean macOS job restores the
checkpoint and its exact metadata, rebuilds the renderer comparison oracle,
revalidates the payload and launches the App to compare `app.getName()`, the
runtime version and `CFBundleIdentifier` with `package.json`. The workflow does
not reference repository secrets, build a DMG or updater asset, sign with
Developer ID, notarize, tag or publish. Its checkpoint is always
`releaseEligible: false` and is structurally rejected by the formal Candidate
checkpoint verifier.

Desktop development and every automated test also leave live usage telemetry
disabled unless `PAGEROOT_TELEMETRY_DEV=1` is explicitly set. Telemetry tests
inject a fake fetch implementation and synthetic project token, so local test
runs never send product events. A distribution package embeds only the public
PostHog project ingestion token generated from `PAGEROOT_POSTHOG_TOKEN`; never
use a personal or project secret API key.

Electron product suites run their BrowserWindow hidden by default and keep
background timers and frame commits enabled, so local automation does not
activate PageRoot or cover other applications. Set `PAGEROOT_E2E_FOREGROUND=1`
only when explicitly debugging the native window. The hosted-macOS environment
preflight uses a visible inactive accessory window because that suite must
prove WindowServer painting without stealing keyboard focus.

Every ordinary Pull Request open, update or reopen runs the separate impact-selected `PR Feedback` workflow, whether the PR is Draft or Ready; returning to Draft alone starts no run. That workflow also runs a non-blocking `review-advisory` job that evaluates the live pair with the same evidence contract as `review-policy`, so Draft-phase Codex P0/P1 findings are visible before promotion. Keep implementation in Draft and batch accepted P0/P1 fixes. The Ready transition starts the single final `review-policy` check and is the sole automatic final-review trigger; no Draft marker or second review command is required. A PR opened directly as Ready does not create that transition, so create it as Draft and promote the frozen final head once. The job continuously revalidates both live SHAs and polls every 15 seconds for a substantive exact-commit Codex review or immutable exact-commit clean comment submitted after the frozen base commit existed (a review of the exact head written while Draft counts; without the base commit date the policy falls back to post-Ready), or a Codex Bot `+1` created after Ready on the Pull Request itself. The reaction carries no commit identity, so it is bound to the latest frozen Ready pair; old, human and non-`+1` reactions are ignored. The policy waits 30 seconds, blocks active P0/P1 findings or P0/P1 `CHANGES_REQUESTED` reviews, and records P2/P3/unclassified findings as debt regardless of reviewer. For same-head review history, each reviewer's latest explicit decision is authoritative: a later approval or dismissal supersedes an earlier change request, while a plain comment does not. `branch-policy` and `baseline-policy` remain deterministic; baseline runs independently of review, and Node, three-shard Chromium, real HTML, native Electron and deterministic AI start as soon as that baseline passes. `release-gate` joins those results, accepts a skipped dry run for source-only work, immediately revalidates review policy and refreshes the same baseline before attestation. A later exact-commit Codex result can recover a `review_wait_timed_out` run only when trusted default-branch code proves the live policy now passes, the original timeout artifact still binds the current Ready head/base, and every non-review job is green; the recovery calls GitHub's failed-job rerun on that original run, so it does not repeat successful source lanes. Any later commit or base update invalidates the pair; return the PR to Draft, batch only required P0/P1 corrections, then Ready the new final pair once. Linux builds and shares only the Web renderer used by Node and Browser. A dedicated macOS `electron-renderer` job builds the Electron renderer once per candidate run; the native lane then runs the hosted-window preflight plus the native Electron suite and the AI lane runs the deterministic AI suite, both downloading the run-ID-stable renderer artifact, so either lane can be rerun independently. Dependency, Playwright and Electron downloads are cached by lockfile identity.

After merge, `main-integrity` verifies the merged PR, exact Tree Hash and package/lockfile version against the fresh source-gate attestation. It does not rerun Node or Browser smoke; a mismatch fails closed instead of trying to manufacture new evidence on `main`.

Critical workflow commands write machine-readable evidence and normalized failure signatures under `output/ci-evidence/`. The full taxonomy, same-SHA rerun rule, two-strike policy and operating metrics are in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
The CI-evidence contract test enumerates every stage used by the active source,
developer-preview, candidate and publication workflows, so an unsupported stage
name fails during source review rather than after formal packaging begins.

The daily/manual read-only `CI Health` workflow first runs the dependency baseline, then computes a rolling 30-day report from `ci.yml`, `pr-feedback.yml`, `release-dry-run.yml`, `release-candidate.yml` and `release.yml` Actions history even when that baseline fails. In addition to exact-tree attempts, latency, repeated-green jobs and environment failures, it measures final-candidate-to-merge, Ready-to-review, Ready-to-gate, gate-to-merge, Ready-transition count and P0/P1/P2/P3 finding distribution. Review latency uses only the post-Ready, exact-final-head subset of the Codex completion contract that `review-policy` accepts; test completion is the last successful source/dry-run lane on that final SHA, not the later joined gate. Flow intervals must start (and, when merged, end) inside the report window, and an oversized Pull Request page set fails explicitly rather than returning a partial report. Its normal-path SLO is candidate-to-merge P50 under 40 minutes, including review P50 under 15 minutes, test completion P50 under 20 minutes and gate-to-merge wait P50 under 10 minutes. Complete-gate, latency, churn and cancellation-rate metrics accept only terminal workflow runs whose status is `completed` and whose conclusion is present. Active runs and the minutes from their already-completed jobs are reported separately, so a daily snapshot cannot turn a mutable partial run into a short completed gate. The Actions Summary marks every machine-measured report target as met, missed or lacking data. Reports are written under `output/ci-health/`.

## Design constraints

- Treat the current HTML bytes as authoritative.
- Route edits through SourcePatchEngine and preserve unrelated bytes.
- Derive Canvas history only from accepted SourcePatch forward/exact-inverse
  results; never add a preview-DOM or component-local snapshot stack.
- Fail closed on ambiguous mapping or patch scope for direct source edits. For AI
  candidates, keep protocol/identity/Hash/path/complete-HTML checks hard, but do
  not inspect or signal authored script changes; treat comment targets as review
  guidance and low page continuity as a mandatory-review signal rather than a
  failed Attempt.
- Keep local filesystem operations behind the Electron/Bridge boundary.
- Add schema fixtures and compatibility tests for protocol changes.
- Never include real user documents in tests.

See `tests/TEST_STRATEGY.md` for suite ownership and `docs/ARCHITECTURE.md` for component boundaries.
