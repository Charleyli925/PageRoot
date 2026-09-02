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

## Product ACP Agent Bridge

The packaged Bridge owns the product session through
`bridge/agent/agent-runtime-coordinator.mjs`; the old Service exports only
delegate existing routes. Its provider registry maps legacy `qoder-acp` to
`qoder-provider.mjs` and registers both Qoder and Codex through the single
`acp` runtime in `bridge/agent/runtimes/acp-runtime.mjs`; unknown
provider/runtime IDs fail closed. The restricted Host Ports now live in
`bridge/agent/hosts/`, while frozen execution policy lives in
`bridge/agent/policies/`.
`bridge/qoder-acp-client.mjs` retains the legacy transport façade and exact
compatibility exports without a second policy brand. The
renderer can request `POST /agent/preflight` and `POST /agent/start` with
registered task identity, the fixed `qoder-acp` driver, explicit
`trusted-local-agent-v1` consent and an opaque short-lived ticket. When Qoder
is not installed it may also `POST /agent/install` for the catalog-pinned
managed copy. It cannot provide a command, cwd, environment or filesystem path
policy.

`GET /agent/availability` is the separate disk-only status route used whenever
delivery or About opens. It re-runs protected package discovery without
executing Qoder, contacting the service, creating a Request or freezing the
Canvas. Finder/Dock sparse-PATH discovery includes configured npm prefixes plus
common nvm, Volta, fnm, mise and asdf roots, but every candidate still passes
the same package identity checks.

Discussion is retired. The renderer and Bridge expose no discussion start,
status or cancel route; only execution-purpose tickets are accepted. Historical
Conversation records remain readable through the ordinary conversation routes.

Product discovery accepts a protected standalone `@qoder-ai/qodercli` package
at version 1.1.27 or newer. It intentionally rejects the executable embedded in
Qoder.app and ordinary `PAGEROOT_QODER_ACP_COMMAND` overrides. Tests may inject
a synthetic executable only with both `PAGEROOT_E2E=1` and
`PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND=1`. The 源页 HTTP Agent may use a
loopback `127.0.0.1` chat endpoint only with both `PAGEROOT_E2E=1` and
`PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL=1`. The readiness probe runs before
Request creation; a failed CLI/version/login/model-list check must leave no new
Request, and a successful ticket is reused by the immediately following
submission instead of probing twice. Same-Request retry is allowed only while the current
Bridge has confirmed its process group stopped and no output/completion remains.
A crash lease, unknown cleanup or residue requires cancelling the old Request as
an authority fence and submitting a new one. Candidate completion remains owned
by the official finalizer plus Repository polling.

The purpose-bound one-use ticket stores provider/runtime IDs, a frozen security
profile, an opaque installation digest
and frozen capabilities only inside the Bridge. The renderer and Electron
preload never receive those fields or an executable, command, spawn or path
capability. Provider/runtime contract fixtures must be synthetic and must not
contain a real home directory, account output or secret.

Run the deterministic owners directly while developing this boundary:

```bash
node --test tests/qoder-acp-spike-client.test.mjs
node --test tests/codex-acp-provider.test.mjs
node --test tests/codex-candidate-authority.test.mjs
node --test tests/agent-provider-contract.test.mjs
node --test tests/agent-bridge-service.test.mjs
node --test tests/agent-bridge-workspace.test.mjs
```

ACP is not an OS sandbox. The product presents and records an explicit
trusted-local-Agent choice; see `docs/SECURITY_MODEL.md`, ADR 0032 and ADR 0039.

## Qoder ACP v1 synthetic spike

`npm run spike:qoder-acp` is a development-only compatibility probe. It
requires an independently installed, signed-in Qoder CLI with ACP v1 support;
set `PAGEROOT_QODER_ACP_COMMAND` to an absolute executable path when it is not
on `PATH`. The command creates a synthetic v4 Request under an isolated
temporary Project File, drives Qoder over ACP, runs the official finalizer and
verifies that the result is a pending-review Candidate while the Working Copy
and Version remain unchanged.

The command never accepts a real user HTML path. Its sanitized result is written
to ignored `output/qoder-acp-spike/report.json`; Agent text, account details,
credentials and temporary paths are not retained. A Qoder login, model-capacity
or network failure is a blocked live probe, not release evidence and not a test
pass. The current harness constrains ACP calls but does not OS-sandbox the local
Qoder process, so it must not be repurposed for real user Requests. See
`docs/decisions/archive/0056-qoder-acp-v1-spike.md`.

## Test lanes

| Command | Purpose |
| --- | --- |
| `npm run gate:edit` | Fast, impact-selected feedback for uncommitted work |
| `npm run gate:plan -- --base origin/main` | Compact JSON of the task-lane selection: owners, Node tests, capability canaries and estimated fan-out |
| `npm run gate:task` | Static checks plus impacted Node tests and capability-level Browser/Electron/AI canaries |
| `npm run gate:task -- --resume <run-id>` | Replay a failed task gate on the identical source hash; reuse passed suites only when fingerprints match |
| `npm run gate:main:auto` | Optional local/diagnostic Node/browser smoke; it is not part of the automatic post-merge path |
| `Release Dry Run` Actions workflow | Candidate-classified Ready packaging check: generate the stable application-update config, assemble an explicitly unsigned (`identity=null`) App, cross a clean-job checkpoint, rebuild metadata/renderer oracles and launch-check identity without credentials; source-only candidates skip it |
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run package:developer` | Optional arm64 developer preview requested explicitly: distinct app/Bundle identity, stable-tag-derived test version, ad-hoc DMG, packaged-content verification, one isolated startup, and an exact live PR/content delivery report; no notarization or publication |
| `npm run gate:candidate-app:auto` | Guarded internal formal-candidate preflight: assemble one ad-hoc App, verify contents, then run the complete packaged-runtime oracle before signing |
| `npm run release:mac` | Complete source gate, signed arm64 DMG/ZIP package, packaged runtime test, artifact verification and exact live PR/content delivery report; release credentials are required for notarization proof |
| `npm run test:electron:ci-preflight` | Synthetic hosted-macOS window, timer and animation-frame preflight used before Electron product suites |
| `npm run benchmark:persistence` | Build one Electron renderer, then serially collect frozen-main full-HTML persistence decision evidence: it rejects changed runtime inputs outside its explicit harness/report allowlist; each autosave, switch and close duration stops at that operation's own endpoint; and it measures memory, event-loop and safety oracles |

Every `gate:edit` or `gate:task` run writes its selected files, suites and reasons
to `output/test-runs/<run-id>/selection.json`, including which rule matched each
file, which owner selected each test, rule-to-production coverage and width
warnings. `gate:plan` prints the compact subset of that record to stdout. Inspect
these files when validating a local ownership change instead of inferring
selection from command duration. When changing `tests/test-impact-map.json`, run
`node --test tests/test-gate-selection.test.mjs` before the ordinary gate. The
selection contract keeps direct-owner coverage narrow while the `release` lane
remains a fixed complete suite. Canvas pointer/selection/overlay, Review
algorithm files, Agent provider/runtime leaves, Repository internals and
Desktop IPC modules each have their own owner so a leaf change does not
reselect the old wide union. Task canaries are Playwright tags such as
`@smoke-editing`; the original global `@gate-smoke` union remains the `main`
lane smoke. Ready PRs still run `node-full`, `browser-full`, `electron-full`,
`ai-closed-loop` and `real-html`.

Node business tests use public Session/algorithm outcomes rather than scanning
Workbench, Canvas, JSX, CSS, or callback source. Explicit application
source-shape invariants are centralized in `scripts/check-architecture.mjs` and
run by `typecheck`. `tests/architecture-boundaries.test.mjs` owns the checker's
AST fixtures and is selected only when the checker, its AST query, budget/config
or those fixtures change. Package, dependency,
security, and workflow scans remain with their dedicated owners. The one SSR
test, `tests/rendered-html.test.mjs`, imports the real `dist/server/index.js`, so
impact selection schedules `build-web` before running it.

The developer-preview, release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Test reports are written to the ignored `output/test-runs/` directory; successful installer lanes additionally write `package-delivery-report.json` and `.md` below `output/`. The final report step requires live GitHub PR metadata and fails the installer handoff if it cannot enumerate the exact tag-to-commit range. Package commands always build the exact current clean Tree; they do not discover or merge other PRs. For an unqualified "latest" package request, prepare the required `origin/main` plus non-excluded-PR integration Tree first as documented in `docs/GIT_WORKFLOW.md`. `package:developer` is never called by another lane: run it only after an explicit developer request. Its ad-hoc, unnotarized DMG is retained for short installation feedback and is never release-eligible. See `docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

The package delivery report resolves commit-to-PR metadata with at most eight
concurrent requests and an in-run response cache. It prints the current item
and completed/total count to stderr, stops after an eight-minute overall
deadline by default, and accepts `--deadline-ms` for a deliberately chosen
override. Before writing the report it rechecks the exact source HEAD and Tree
so a slow metadata scan cannot silently describe a different package.

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
activate PageRoot or cover other applications. Background mode still keeps the
macOS Dock icon: click it to bring the window forward, inspect the run, and
minimize it again. Every E2E mode suppresses automatically triggered native
dialogs and logs them instead of popping up, including
`PAGEROOT_E2E_FOREGROUND=1` visual debugging. Ordinary `PAGEROOT_E2E=1`
launches also omit the UI-preferences renderer port; set
`PAGEROOT_E2E_FIRST_EDIT_GUIDE=1` only when a test needs the real first-open
card. The hosted-macOS environment
preflight uses a visible inactive accessory window because that suite must
prove WindowServer painting without stealing keyboard focus.

Draft Pull Request opens, updates and reopens run only the impact-selected `pr-feedback` job in `ci.yml` (`gate:edit`). Returning to Draft skips the full matrix. Ready, a PR opened already Ready, or the `full-gate` label starts the complete source matrix: `branch-policy`, `candidate-context`, `baseline-policy`, Linux Node/Browser, both macOS Electron lanes, optional credential-free Release Dry Run, and `release-gate`. `codex-review` posts at most one `@codex review` comment for the current head and writes an informational thread snapshot; it is `continue-on-error` and is not a merge hard gate. Linux builds and shares only the Web renderer used by Node and Browser. Each macOS job builds the Electron renderer locally, runs the hosted-window preflight, then owns either the native Electron suite or the AI suite. Dependency, Playwright and Electron downloads are cached by lockfile identity. The native Electron and AI lanes retry a test once in CI only; their diagnostics artifacts are always uploaded, and `scripts/playwright-flaky-summary.mjs` records machine-readable flaky/retry counts from the JSON reporter so a retry-succeeded run cannot silently discard first-attempt evidence.

After merge, `main-integrity` verifies the merged PR, exact Tree Hash and package/lockfile version against the fresh source-gate attestation, resolving the pull request from the squash subject’s trailing `(#N)` before the commit association lookup. It does not rerun Node or Browser smoke; a named pull request that does not match the commit fails closed, while a completely absent association only warns, because rerunning cannot recover platform association data.

Critical workflow commands write machine-readable evidence and normalized failure signatures under `output/ci-evidence/`. The full taxonomy, same-SHA rerun rule, two-strike policy and operating metrics are in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
The CI-evidence contract test enumerates every stage used by the active source,
developer-preview, candidate and publication workflows, so an unsupported stage
name fails during source review rather than after formal packaging begins.

`npm run ci:health` is a local/manual summary of recent `ci.yml` conclusions and retry-recovered jobs. It is not a scheduled workflow and not a merge gate. Reports are written under `output/ci-health/`.

The native HTTP Agent has a credential-backed protocol smoke that is intentionally
outside the synthetic test suite. Before a release candidate that changes vendor
adapters, run `npm run smoke:agent-vendors:real` with the four
`PAGEROOT_SMOKE_<VENDOR>_API_KEY` secrets (and optional matching `_MODEL`
overrides). It calls each real `/models` and `/chat/completions` endpoint, never
prints a Token, and must pass for DeepSeek, 智谱, 阿里通义, and OpenAI.

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
