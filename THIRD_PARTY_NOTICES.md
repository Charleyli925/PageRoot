# Third-party notices

PageRoot uses third-party open-source software. The authoritative dependency versions are pinned in `package-lock.json`; each installed package retains its own license and notice files.

Primary runtime dependencies include:

| Project | License | PageRoot distribution |
| --- | --- | --- |
| React and React DOM | MIT | Application build |
| Next.js | MIT | Application build |
| Electron | MIT; bundled Chromium components carry their own notices | Application package |
| parse5 | MIT | Application package |
| entities | BSD-2-Clause | Application package |
| @noble/hashes | MIT | Application build |
| @phosphor-icons/react | MIT | Application build |
| @agentclientprotocol/sdk | Apache-2.0 | Application package |
| @openai/codex | Apache-2.0 | Codex ACP managed install only; not bundled |
| Zod | MIT | Application package |

Build and test dependencies include TypeScript, Vite, Playwright, ESLint, Tailwind CSS, electron-builder, Wrangler and their transitive dependencies under their respective licenses. The packaged Electron application includes Electron and Chromium license material. Some transitive build-only packages use Apache-2.0, BSD, ISC, MPL-2.0, LGPL, CC-BY or other OSI-compatible terms.

This file is informational and does not replace any dependency's license text. The
managed Codex ACP closure is downloaded only after the user requests installation;
its package and native notices remain part of that managed installation even
though they are not included in the PageRoot application package. Before
redistributing a modified binary, review the exact dependency closure created by
`npm ci` and preserve all required license and notice files.
