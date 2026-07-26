# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. CI runs `npm run audit:dependencies`, which fails on any advisory that has not been explicitly reviewed or whose exception has expired.

## Update automation

Dependabot checks monthly. Coupled React packages are updated together, and minor or patch development-tool updates are grouped to reduce noisy or internally inconsistent Pull Requests. Automated version-update Pull Requests exclude all major upgrades; major dependency changes require a separately planned migration and full compatibility review. Every dependency Pull Request still requires the complete `release-gate` before merge, while security advisories remain governed by the audit policy below.

## Temporary reviewed exceptions

Each exception has its own mandatory review date. An exception is removed in
the same Pull Request that introduces a verified compatible fix.

| Advisory | Review by | Dependency path | Current assessment |
| --- | --- | --- | --- |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | 2026-08-15 | ESLint/electron-builder -> minimatch -> brace-expansion | Reviewed 2026-07-26. The available fixed brace-expansion is a new major while several build-only parents require older majors; forcing one global override would replace their parser contract without upstream compatibility evidence. PageRoot passes only repository-owned glob patterns to these lint and packaging tools, and none of this dependency tree is shipped in the Electron package. Upgrade or remove the parent chains as soon as compatible releases exist. |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | 2026-08-31 | Next.js -> Sharp/libvips | Reviewed 2026-07-23. The current latest compatible parent still selects Sharp 0.34.x. Sharp and Next.js are not included in the Electron package allowlist. |

## Reviewed fixes

The 2026-07-26 dependency convergence incorporates the complete contents of
open dependency PRs #9, #12 and #30, then verifies them with the current
architecture tree. React and `react-server-dom-webpack` are 19.2.8, parse5 is
8.0.1, and the grouped development dependencies use their reviewed patch or
minor versions. A same-major override selects PostCSS 8.5.23 for Next.js and tar
7.5.22 for the build chain; the former PostCSS and tar exceptions were removed
after `npm audit` no longer reported them.

The macOS package includes the compiled desktop renderer, selected desktop modules, `parse5`, `entities`, schemas and build provenance; it explicitly excludes the general `node_modules` tree. These exceptions do not authorize adding the affected packages to the packaged runtime.

Do not use `npm audit fix --force`: npm currently proposes an incompatible Next.js downgrade. Remove each exception as soon as a compatible upstream release resolves it, and rerun all source and artifact gates after any dependency change.
