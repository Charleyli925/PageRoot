# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. CI runs `npm run audit:dependencies`, which fails on any advisory that has not been explicitly reviewed or whose exception has expired.

## Update automation

Dependabot checks monthly. Coupled React packages are updated together, and minor or patch development-tool updates are grouped to reduce noisy or internally inconsistent Pull Requests. Automated version-update Pull Requests exclude all major upgrades; major dependency changes require a separately planned migration and full compatibility review. Every dependency Pull Request still requires the complete `release-gate` before merge, while security advisories remain governed by the audit policy below.

## Temporary reviewed exceptions

There are no active exceptions. Each future exception needs its own mandatory
review date and must be removed in the same Pull Request that introduces a
verified compatible fix.

## Reviewed fixes

The 2026-08-08 security baseline moves the PostCSS-selected `nanoid` closure
to 3.3.17 and selects `vinext` 0.0.45 in place of 0.2.1. This is the
compatible remediation path identified by the audit; the release is verified
against this repository's Vite 8 and React 19.2 toolchain and does not depend
on `image-size`, removing
GHSA-2v37-7h3g-55p8, GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq without a
temporary exception. Vinext remains a development dependency and is not in the
packaged Electron runtime allowlist; that reduced reachability is not used as a
substitute for resolving the advisories.

The 2026-08-07 release patch moves the single hoisted `js-yaml` runtime and
tooling closure from 4.3.0 to the parent-compatible 4.3.1. This removes
GHSA-5p4m-2wfm-xmqj without adding an exception, changing Electron, or
introducing a nested packaged dependency.

The 2026-08-04 security convergence upgrades `next` and
`eslint-config-next` to 16.3.0, which refreshes the optional Sharp/libvips
closure to Sharp 0.35.3. It also resolves compatible `fast-uri`, PostCSS and
all affected `brace-expansion` lockfile entries. The separate `undici` fixes
stay within the parent-supported major: Miniflare receives 7.29.0 while
node-gyp receives 6.28.0. These constrained overrides keep the Cloudflare and
node-gyp toolchains compatible while removing their advisories. The audit now
returns zero vulnerabilities, so the prior Brace Expansion and Sharp
exceptions are removed from the executable allowlist.

The 2026-07-26 dependency convergence incorporates the complete contents of
open dependency PRs #9, #12 and #30, then verifies them with the current
architecture tree. React and `react-server-dom-webpack` are 19.2.8, parse5 is
8.0.1, and its shared runtime dependency `entities` is 8.0.0. Keeping one
hoisted `entities` version prevents the packaged Bridge from losing a nested
dependency that Electron Builder does not copy from inside another managed
module. The dependency audit rejects nested or incomplete packaged-runtime
closures before the artifact stage. The grouped development dependencies use
their reviewed patch or minor versions. The current same-major overrides select
PostCSS 8.5.25 and tar 7.5.22 for the build chain; related exceptions are
removed after `npm audit` no longer reports them.

The macOS package includes the compiled desktop renderer, selected desktop modules, `parse5`, `entities`, the reviewed `electron-updater` closure, schemas and build provenance; it explicitly excludes the general `node_modules` tree. `semver` is pinned at the package root so the updater closure has no hidden nested runtime copy. The dependency audit rejects missing, nested or undeclared modules in this exact packaged allowlist. These exceptions do not authorize adding the affected packages to the packaged runtime.

Do not use `npm audit fix --force`: review every dependency update deliberately,
prefer compatible upstream fixes or narrow overrides, and rerun all source and
artifact gates after any dependency change.
