# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. CI runs `npm run audit:dependencies`, which fails on any advisory that has not been explicitly reviewed or whose exception has expired.

## Update automation

Dependabot checks monthly. Coupled React packages are updated together, and minor or patch development-tool updates are grouped to reduce noisy or internally inconsistent Pull Requests. Automated version-update Pull Requests exclude all major upgrades; major dependency changes require a separately planned migration and full compatibility review. Every dependency Pull Request still requires the complete `release-gate` before merge, while security advisories remain governed by the audit policy below.

## Temporary reviewed exceptions

Reviewed on 2026-07-23; mandatory review date: 2026-08-31.

| Advisory | Dependency path | Current assessment |
| --- | --- | --- |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | Next.js -> PostCSS | The current latest compatible Next.js still pins the affected PostCSS. PageRoot does not accept remote CSS into a deployed Next.js server. |
| [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | Next.js -> PostCSS | Next.js 16.2.11 pins PostCSS 8.4.31 while PageRoot's direct build toolchain uses patched PostCSS 8.5.22. Imported user HTML and CSS are rendered as document content and never processed by Next.js/PostCSS; that build path only receives trusted, checked-in application CSS. |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | Next.js/Miniflare -> Sharp/libvips | The current latest compatible parents still select Sharp 0.34.x. Sharp, Next.js and Miniflare are not included in the Electron package allowlist. |

The macOS package includes the compiled desktop renderer, selected desktop modules, `parse5`, `entities`, schemas and build provenance; it explicitly excludes the general `node_modules` tree. These exceptions do not authorize adding the affected packages to the packaged runtime.

Do not use `npm audit fix --force`: npm currently proposes an incompatible Next.js downgrade. Remove each exception as soon as a compatible upstream release resolves it, and rerun all source and artifact gates after any dependency change.
