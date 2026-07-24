# Development guide

## Requirements

- macOS 12 or newer for the Electron and packaging gates
- Node.js 22.13.0 or a compatible Node 22 release
- npm, Git and Chromium installed through Playwright

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
# edit
npm run task:finish
```

`task:start` requires clean synchronized `main`. `task:finish` runs the task gate against `origin/main` and reports committed plus uncommitted task files. Neither command commits, pushes, merges or releases. See `AGENTS.md` and `docs/CODEX_WORKFLOW.md` for the complete automation and authorization boundary.

## Test lanes

| Command | Purpose |
| --- | --- |
| `npm run gate:edit` | Fast, impact-selected feedback for uncommitted work |
| `npm run gate:task` | Static checks plus impacted Node/browser/Electron coverage |
| `npm run gate:main:auto` | Internal post-merge Node/browser smoke after exact-tree PR provenance verification |
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run gate:artifact-only:auto` | Guarded internal installer lane; it refuses to run without CI's fresh matching tree/version decision |
| `npm run release:mac` | Complete source gate, arm64 package, packaged runtime test and artifact verification |

The release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Reports are written to the ignored `output/test-runs/` directory.

GitHub runs the final PR source gate as parallel Node, three-shard Chromium and macOS Electron groups. Web and desktop renderers are built once and shared between those groups. Node and Chromium use Linux runners; macOS remains responsible for Electron behavior and installer creation. Dependency, Playwright and Electron downloads are cached by lockfile identity.

## Design constraints

- Treat the current HTML bytes as authoritative.
- Route edits through SourcePatchEngine and preserve unrelated bytes.
- Fail closed on ambiguous mapping, scope or identity.
- Keep local filesystem operations behind the Electron/Bridge boundary.
- Add schema fixtures and compatibility tests for protocol changes.
- Never include real user documents in tests.

See `tests/TEST_STRATEGY.md` for suite ownership and `docs/ARCHITECTURE.md` for component boundaries.
