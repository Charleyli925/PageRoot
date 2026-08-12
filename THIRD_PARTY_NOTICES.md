# Third-party notices

PageRoot uses third-party open-source software. The authoritative dependency versions are pinned in `package-lock.json`; each installed package retains its own license and notice files.

Primary runtime dependencies include:

| Project | License |
| --- | --- |
| React and React DOM | MIT |
| Next.js | MIT |
| Electron | MIT; bundled Chromium components carry their own notices |
| parse5 | MIT |
| entities | BSD-2-Clause |
| @noble/hashes | MIT |
| @phosphor-icons/react | MIT |
| Apache ECharts | Apache-2.0; zrender is BSD-3-Clause and tslib is 0BSD |

Build and test dependencies include TypeScript, Vite, Playwright, ESLint, Tailwind CSS, electron-builder, Wrangler and their transitive dependencies under their respective licenses. The packaged Electron application includes Electron and Chromium license material. Some transitive build-only packages use Apache-2.0, BSD, ISC, MPL-2.0, LGPL, CC-BY or other OSI-compatible terms.

This file is informational and does not replace any dependency's license text. Before redistributing a modified binary, review the exact dependency closure created by `npm ci` and preserve all required license and notice files.
