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
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run package:developer` | Optional arm64 developer preview requested explicitly: distinct app/Bundle identity, stable-tag-derived test version, ad-hoc DMG, packaged-content verification, one isolated startup, and an exact live PR/content delivery report; no notarization or publication |
| `npm run package:developer:x64` | The same optional developer preview and delivery report for Intel Macs |
| `npm run gate:candidate-app:auto` | Guarded internal formal-candidate preflight: assemble one ad-hoc App, verify contents, then run the complete packaged-runtime oracle before signing |
| `npm run gate:artifact-only:auto` | Guarded internal installer lane; it refuses to run without CI's fresh matching tree/version decision |
| `npm run release:mac` | Complete source gate, signed arm64 DMG/ZIP package, packaged runtime test, artifact verification and exact live PR/content delivery report; release credentials are required for notarization proof |
| `npm run test:electron:ci-preflight:prepared` | Synthetic hosted-macOS window, timer and animation-frame preflight used before Electron product suites |

The developer-preview, release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Test reports are written to the ignored `output/test-runs/` directory; successful installer lanes additionally write `package-delivery-report.json` and `.md` below `output/`. The final report step requires live GitHub PR metadata and fails the installer handoff if it cannot enumerate the exact tag-to-commit range. Package commands always build the exact current clean Tree; they do not discover or merge other PRs. For an unqualified "latest" package request, prepare the required `origin/main` plus non-excluded-PR integration Tree first as documented in `docs/GIT_WORKFLOW.md`. `package:developer` is never called by another lane: run it only after an explicit developer request. Its ad-hoc, unnotarized DMG is retained for short installation feedback and is never release-eligible. See `docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

Desktop development and Electron E2E disable live update checks. The pure
application-update controller is covered by Node tests; the Release Candidate
lane owns the installed-App, Developer ID, notarization, signed-App checkpoint,
ZIP/blockmap and `latest-mac.yml` evidence. It validates contents and full
packaged runtime against a pre-sign App, proves signed startup, then passes the
same notarized App to the final artifact job without rebuilding. That fresh job
restores the App's exact embedded build and telemetry metadata, then builds only
the deterministic Electron renderer used to compare the restored App payload
against the identical source tree. It does not regenerate telemetry
configuration or receive the project token. Formal local
packaging is a distribution build and therefore requires a valid Developer ID
identity; publication credentials remain in GitHub encrypted secrets. The
separate developer-preview profile removes those credentials from its child
environment and intentionally uses only an ad-hoc signature.

Desktop development and every automated test also leave live usage telemetry
disabled unless `PAGEROOT_TELEMETRY_DEV=1` is explicitly set. Telemetry tests
inject a fake fetch implementation and synthetic project token, so local test
runs never send product events. A distribution package embeds only the public
PostHog project ingestion token generated from `PAGEROOT_POSTHOG_TOKEN`; never
use a personal or project secret API key.

Every ordinary Pull Request update runs the separate impact-selected `PR Feedback` workflow, whether the PR is draft or ready. Only an explicit transition from draft to ready promotes the current head and runs parallel Node, three-shard Chromium, real HTML, native Electron and deterministic AI groups. Any later commit cancels an in-flight stale complete run and receives feedback only; the new SHA remains unmergeable until it is returned to draft and promoted again. Promote only one PR at a time so a merge cannot force several parallel candidates through the complete matrix again. Linux builds and shares only the Web renderer used by Node and Browser. Each macOS job builds the Electron renderer locally, runs the hosted-window preflight, then owns either the native Electron suite or the AI suite; those jobs can be rerun independently. Dependency, Playwright and Electron downloads are cached by lockfile identity.

After merge, `main-integrity` verifies the merged PR, exact Tree Hash and package/lockfile version against the fresh source-gate attestation. It does not rerun Node or Browser smoke; a mismatch fails closed instead of trying to manufacture new evidence on `main`.

Critical workflow commands write machine-readable evidence and normalized failure signatures under `output/ci-evidence/`. The full taxonomy, same-SHA rerun rule, two-strike policy and operating metrics are in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
The CI-evidence contract test enumerates every stage used by the active source,
developer-preview, candidate and publication workflows, so an unsupported stage
name fails during source review rather than after formal packaging begins.

The weekly/manual read-only `CI Health` workflow computes a rolling 30-day report from both PR-feedback and source-candidate Actions history. In addition to exact-tree attempts, latency, repeated-green jobs and environment failures, it measures complete gates per Pull Request and runner minutes spent on later candidate SHAs of the same PR. This exposes lifecycle churn that same-SHA rerun metrics cannot see. Reports are written under `output/ci-health/`.

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
