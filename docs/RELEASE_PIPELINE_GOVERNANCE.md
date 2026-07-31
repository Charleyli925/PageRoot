# Release pipeline governance

PageRoot keeps the release standard high while avoiding repeated proof of the same source tree. The unit of reusable evidence is an exact Git Tree Hash and package version, not a branch name, a local checkout or a previous green-looking run.

## Delivery boundaries

| Boundary | Trigger | Evidence | What it must not do |
| --- | --- | --- | --- |
| Draft feedback | Draft Pull Request open or update | Impact-selected Node/compiler feedback | Run the complete browser and Electron matrix |
| Source candidate | Pull Request becomes ready or its ready head changes | Full Node, three Browser shards, real HTML, native Electron and deterministic AI; exact-tree attestation | Package or publish an installer |
| Main integrity | Source candidate is merged | Match merge commit, Tree Hash, version and fresh PR attestation; fixed Node/Browser smoke | Repeat the complete source gate |
| Developer preview | Explicit manual request only | Clean Tree, ad-hoc DMG, packaged-content audit, isolated startup and non-release attestation | Sign/notarize, create updater assets, become a prerequisite, tag or publish |
| Release candidate | Manual `Release Candidate` dispatch on current `main` | Pre-sign content/runtime proof, signed-App checkpoint, final DMG/ZIP/update checks, release asset hashes and candidate attestation | Rebuild the verified App after checkpoint, create a tag or GitHub Release |
| Publication | Manual `Release` dispatch for the exact version on current `main` | Fresh matching candidate, downloaded byte hashes and provenance | Rebuild, replace or silently mutate candidate bytes |

The publication workflow creates the annotated tag only after the pre-tag candidate has passed. It publishes the exact downloaded candidate files. A failed candidate therefore does not consume a version tag.

The `Developer Preview` workflow exists only to move cheap package-content and
startup feedback ahead of an optionally requested installation check. No
push, Pull Request, schedule, formal candidate or publication event triggers
it. Its seven-day artifact cannot be promoted; formal release evidence starts
independently from reviewed `main`.

## CI ownership and isolation

- Linux builds and shares only the Web renderer used by Node and Browser lanes.
- Each macOS Electron lane builds the Electron renderer locally. The build is normally sub-second and removes Linux-to-macOS build output as a variable.
- Native Electron and deterministic AI run as separate jobs. A failure can be rerun independently.
- Each macOS job first runs a product-independent synthetic Electron environment preflight. It proves that the hosted window is visible and that renderer timers and animation frames advance before PageRoot code or assertions begin.
- Browser shards, real HTML, native Electron and AI keep retries at zero. Reliability is obtained from deterministic readiness and better evidence, not blanket retrying.
- Release Candidate has two sequential macOS jobs. `preflight-sign-and-notarize-app` first assembles an ad-hoc App, checks packaged contents, runs the complete packaged-runtime oracle, signs it and proves signed startup before the App is submitted to Apple. Only after App acceptance does it upload an archive/hash/source-bound checkpoint.
- `package-and-verify-candidate` downloads and revalidates that checkpoint, rebuilds only the deterministic Electron renderer as a source-comparison oracle, uses electron-builder `--prepackaged` to avoid rebuilding the App, creates updater assets, submits only the final DMG to Apple and performs final mounted/extracted verification. The jobs have 90- and 75-minute guards; App and DMG Apple steps have 45- and 50-minute limits. All non-Apple steps keep explicit 2–10 minute limits.
- The checkpoint transfer is the only added normal-path handoff. Its ZIP is uploaded without redundant Actions compression. This small fixed cost prevents content/runtime failures from consuming Apple queue time and lets a failed second job resume without rebuilding, rerunning packaged runtime, resigning or renotarizing the App.

## Failure evidence and classification

Every critical CI command runs through `scripts/ci-evidence.mjs`. It writes:

```text
output/ci-evidence/<suite>.json
output/ci-evidence/<suite>.log
```

The JSON binds the suite, stage, command, commit, Tree Hash, GitHub run/job/attempt, duration, exit state and a normalized failure signature. Volatile timestamps, runner temporary paths and commit SHAs are removed before the signature is calculated so repeated failure shapes can be grouped.

Use exactly one final category after triage:

| Category | Meaning | Normal owner |
| --- | --- | --- |
| `product` | Production behavior or source invariant is wrong | Product change |
| `test_script` | Oracle, readiness condition, locator, fixture or test timing is wrong | Test change |
| `ci_environment` | Hosted runner/window/network/tooling state failed before a product assertion | CI change or rerun |
| `packaged_artifact` | App bundle, packaged runtime, signature, DMG, checksum or release manifest is wrong | Packaging/release change |

`environment-preflight` failures are deterministically marked `ci_environment`. Source-suite failures remain `needs_triage` with candidate categories; a test failure must not be called a product bug merely because the assertion failed. Artifact-stage failures carry a `packaged_artifact` hint but still require checking whether the runner itself failed.

Use the CI incident issue template to record the final category, signature, exact SHA, run URL and local reproduction result. Never commit real user HTML, local paths, credentials or private logs.

## Rerun and two-strike policy

1. Freeze the failing SHA while triaging. Do not create a no-op commit to obtain another run.
2. Inspect the failed job's CI evidence, Playwright trace and first failed assertion.
3. If evidence points to the CI environment, rerun only the failed job for the same SHA.
   When only `package-and-verify-candidate` failed, use **Re-run failed jobs** so
   the successful signed-App checkpoint is retained. Do not use **Re-run all
   jobs**, which deliberately rebuilds the checkpoint under a new attempt.
4. If the same normalized signature occurs twice on the same SHA without a local reproduction, stop the release candidate. Classify it as a CI incident and fix or quarantine the environment contract in a reviewed PR.
5. If the signature changes, or local reproduction succeeds, return to product/test-script triage. Do not count it as the same strike.
6. Any source change invalidates the old source and candidate evidence. Run the appropriate gate for the new Tree Hash.

Do not raise global timeouts, enable blanket retries or rerun an entire green matrix to hide one unstable job. A narrowly justified timeout change must identify the measured operation and retain a deterministic oracle.

## Release procedure

1. Merge the version/change PR after its final ready-state `release-gate` passes.
2. Confirm `main-integrity` and `main-smoke` are green for the merge commit.
3. Confirm the signing `.p12` and fresh notarization credentials are present in GitHub encrypted secrets, then dispatch `Release Candidate` from `main`. It requires a source-gate attestation no older than 168 hours and fails before assembly when a required credential is missing.
4. Confirm the pre-sign content/runtime gate passed before App notarization and that the final job consumed the matching signed-App checkpoint. Candidate/checkpoint artifacts are retained for 14 days; the completed candidate is reusable for publication for 72 hours. A failed-job rerun creates a distinct final candidate identity and publication resolves only the successful attempt.
5. Dispatch `Release` from `main` with the exact package version. It verifies and publishes the candidate, then creates the annotated immutable tag and GitHub Release.
6. If publication fails after the exact tag was created but before the Release exists, rerun the same publication workflow. It may resume only when the existing annotated tag resolves to the identical commit.

Manual tag pushes are outside the governed path. Never move an existing tag or replace published assets.

## Operating metrics

Review these metrics per release and as a rolling 30-day view:

| Metric | Target |
| --- | --- |
| Complete source-gate attempts per released Tree Hash | P50 `1`, average at most `1.5` |
| Ready-PR full gate wall time | P50 under `6 min`, P95 under `10 min` |
| CI-environment false-failure rate | Under `2%` of critical jobs |
| Repeated green runner share | Under `20%` of runner minutes |
| Candidate App rebuilds after signed checkpoint | `0` |
| Time to assign a failure category | Under `10 min` |
| Publication rebuilds after candidate approval | `0` |

Runner minutes and wall time are different signals. Splitting Electron lanes may use similar total macOS minutes while reducing critical-path time and allowing only the failed lane to rerun. The goal is less repeated evidence, not simply fewer tests.

The read-only `CI Health` workflow runs weekly and can also be dispatched manually. `scripts/ci-health-report.mjs` reads Actions run/job history, writes the metric table to the workflow summary and retains `output/ci-health/ci-health.json` for 90 days. Empty periods remain `null`/`n/a`; they are never reported as a false zero failure rate.

## Change control

Changes to workflow topology, test ownership, provenance, retention or publication update this document, `docs/DEVELOPMENT.md`, `tests/TEST_STRATEGY.md` and `docs/RELEASING.md` in the same PR. Changes that weaken an oracle or remove a protected source/artifact boundary require an explicit rationale and replacement evidence.
