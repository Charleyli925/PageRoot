# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. CI runs `npm run audit:dependencies`, which fails on any advisory that has not been explicitly reviewed or whose exception has expired.

## Temporary reviewed exceptions

Reviewed on 2026-07-23; mandatory review date: 2026-08-31.

| Advisory | Dependency path | Current assessment |
| --- | --- | --- |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | Next.js -> PostCSS | The current latest compatible Next.js still pins the affected PostCSS. PageRoot does not accept remote CSS into a deployed Next.js server. |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | Next.js/Miniflare -> Sharp/libvips | The current latest compatible parents still select Sharp 0.34.x. Sharp, Next.js and Miniflare are not included in the Electron package allowlist. |

The macOS package includes the compiled desktop renderer, selected desktop modules, `parse5`, `entities`, schemas and build provenance; it explicitly excludes the general `node_modules` tree. These exceptions do not authorize adding the affected packages to the packaged runtime.

Do not use `npm audit fix --force`: npm currently proposes an incompatible Next.js downgrade. Remove each exception as soon as a compatible upstream release resolves it, and rerun all source and artifact gates after any dependency change.
