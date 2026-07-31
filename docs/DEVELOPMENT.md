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
| `npm run gate:main:auto` | Internal post-merge Node/browser smoke after exact-tree PR provenance verification |
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run package:developer` | Optional arm64 developer preview requested explicitly: ad-hoc DMG, packaged-content verification and one isolated startup; no notarization or publication |
| `npm run package:developer:x64` | The same optional developer preview for Intel Macs |
| `npm run gate:candidate-app:auto` | Guarded internal formal-candidate preflight: assemble one ad-hoc App, verify contents, then run the complete packaged-runtime oracle before signing |
| `npm run gate:artifact-only:auto` | Guarded internal installer lane; it refuses to run without CI's fresh matching tree/version decision |
| `npm run release:mac` | Complete source gate, signed arm64 DMG/ZIP package, packaged runtime test and artifact verification; release credentials are required for notarization proof |
| `npm run test:electron:ci-preflight:prepared` | Synthetic hosted-macOS window, timer and animation-frame preflight used before Electron product suites |

The developer-preview, release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Reports are written to the ignored `output/test-runs/` directory. `package:developer` is never called by another lane: run it only after an explicit developer request. Its ad-hoc, unnotarized DMG is retained for short installation feedback and is never release-eligible. See `docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

Desktop development and Electron E2E disable live update checks. The pure
application-update controller is covered by Node tests; the Release Candidate
lane owns the installed-App, Developer ID, notarization, signed-App checkpoint,
ZIP/blockmap and `latest-mac.yml` evidence. It validates contents and full
packaged runtime against a pre-sign App, proves signed startup, then passes the
same notarized App to the final artifact job without rebuilding. Formal local
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

Draft Pull Requests run only impact-selected feedback. Marking a final PR tree ready runs parallel Node, three-shard Chromium, real HTML, native Electron and deterministic AI groups. Linux builds and shares only the Web renderer used by Node and Browser. Each macOS job builds the Electron renderer locally, runs the hosted-window preflight, then owns either the native Electron suite or the AI suite; those jobs can be rerun independently. Dependency, Playwright and Electron downloads are cached by lockfile identity.

Critical workflow commands write machine-readable evidence and normalized failure signatures under `output/ci-evidence/`. The full taxonomy, same-SHA rerun rule, two-strike policy and operating metrics are in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.

The weekly/manual read-only `CI Health` workflow computes a rolling 30-day report from GitHub Actions history. It measures complete-gate attempts, wall-time percentiles, repeated-green runner time, environment-preflight failures and candidate/publication conclusions; reports are written under `output/ci-health/`.

## Design constraints

- Treat the current HTML bytes as authoritative.
- Route edits through SourcePatchEngine and preserve unrelated bytes.
- Derive Canvas history only from accepted SourcePatch forward/exact-inverse
  results; never add a preview-DOM or component-local snapshot stack.
- Fail closed on ambiguous mapping, scope or identity.
- Keep local filesystem operations behind the Electron/Bridge boundary.
- Add schema fixtures and compatibility tests for protocol changes.
- Never include real user documents in tests.

See `tests/TEST_STRATEGY.md` for suite ownership and `docs/ARCHITECTURE.md` for component boundaries.
