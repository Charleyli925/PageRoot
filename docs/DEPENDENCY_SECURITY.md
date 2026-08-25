# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. `npm run audit:dependencies` fails on any advisory that has not been explicitly reviewed or whose exception has expired, and also proves the packaged-runtime dependency closure. A promoted PR runs this command in `baseline-policy` after branch policy and before any source build or macOS Electron job; it is deliberately independent of the final review wait so deterministic safety tests and review can overlap. `release-gate` refreshes the identical check immediately before exact-tree attestation so a delayed failed-job rerun cannot reuse stale advisory evidence. The read-only `CI Health` workflow repeats the same baseline daily even when no PR is promoted.

## Update automation

Dependabot checks monthly. Coupled React packages are updated together, and minor or patch development-tool updates are grouped to reduce noisy or internally inconsistent Pull Requests. Automated version-update Pull Requests exclude all major upgrades; major dependency changes require a separately planned migration and full compatibility review. Every dependency Pull Request still requires the complete `release-gate` before merge, while security advisories remain governed by the audit policy below.

## Temporary reviewed exceptions

There are no active exceptions. Each future exception needs its own mandatory
review date and must be removed in the same Pull Request that introduces a
verified compatible fix.

## Reviewed fixes

The 2026-08-26 Codex ACP integration exact-pins
`@agentclientprotocol/codex-acp` 1.6.2, `@openai/codex` 0.148.0 and the shared
`@agentclientprotocol/sdk` 1.3.0. The adapter override prevents its compatible
version ranges from selecting a different inner Codex or ACP SDK. A checked-in
runtime lock records npm integrity, upstream adapter commit, licenses, adapter
and binary hashes, and fingerprints produced by running both App Server schema
generators with that exact Codex. `npm run verify:codex-runtime` regenerates the
Schema trees and fails on dependency, binary or Schema drift. The supported
packaged target remains macOS arm64; other optional Codex platform packages are
lockfile inputs for source testing and are not silently presented as supported
Stemmio binaries.

The 2026-08-21 Qoder ACP Agent Bridge pins the official
`@agentclientprotocol/sdk` 1.3.0 and its direct `zod` 4.4.3 peer as production
dependencies. Electron Builder copies exactly those two packages into the
packaged Bridge resource closure; package tests, the artifact verifier and the
dependency audit reject a missing, nested or undeclared ACP runtime module.
They introduce no audit exception. The development-only synthetic probe reuses
the same restricted client but remains outside the packaged resource allowlist.

The 2026-08-14 security baseline moves the PostCSS-selected `nanoid` closure
to 3.3.18 and selects `vinext` 0.0.45 in place of 0.2.1. This is the
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

The macOS package includes the compiled desktop renderer, selected desktop and
Bridge modules, `parse5`, `entities`, `@agentclientprotocol/sdk`, `zod`, the
reviewed `electron-updater` closure, schemas and build provenance; it explicitly
excludes the general `node_modules` tree. `semver` is pinned at the package root
so the updater closure has no hidden nested runtime copy. The dependency audit
rejects missing, nested or undeclared modules in this exact packaged allowlist.
The artifact verifier also walks every PageRoot-owned Resources subtree with
`lstat`, rejects symlinks and all non-regular entries (including FIFOs and Unix
sockets), rejects ASAR link entries, and byte-compares each allowlisted package
against the clean source closure. A packaged Electron Helper then starts the
packaged Bridge and completes a fake ACP task through the packaged official
finalizer to a pending-review Candidate; import-only evidence is insufficient.
These exceptions do not authorize adding the affected packages to the packaged
runtime.

The Codex Developer Preview additionally packages only the exact
`@agentclientprotocol/codex-acp`, `@openai/codex` wrapper and
`@openai/codex-darwin-arm64` platform directory. The adapter entry is a
self-contained reviewed bundle whose exact hash is locked; its declared build
dependencies are not copied as an unused general-purpose runtime tree. The
separate ACP SDK remains the Bridge's allowlisted dependency. Artifact
verification byte-compares the JavaScript/package content and packages an exact
SPDX 2.3 runtime SBOM that inventories every package marker embedded in the
adapter bundle plus every shipped Codex package. The runtime-lock verifier derives
that bundle inventory from the locked adapter entry and checks every package,
checksum, license, document relationship and direct adapter relationship. macOS
re-signing may replace only the Mach-O signature
blob and its three dependent load-command sizes, so all four native executables
must also match the locked canonical code fingerprint, valid code signature,
arm64 architecture and executable bits. The packaged Electron Helper receives a
process-filtered read allowance for its containing `.app` bundle so it can load
Electron Framework; Codex and tool descendants do not inherit that allowance.
Other Codex platform aliases remain unsupported and absent.

Do not use `npm audit fix --force`: review every dependency update deliberately,
prefer compatible upstream fixes or narrow overrides, and rerun all source and
artifact gates after any dependency change.
