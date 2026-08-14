# Release pipeline governance

PageRoot keeps the release standard high while avoiding repeated proof of the same source tree. The unit of reusable evidence is an exact Git Tree Hash and package version, not a branch name, a local checkout or a previous green-looking run.

## Delivery boundaries

| Boundary | Trigger | Evidence | What it must not do |
| --- | --- | --- | --- |
| PR feedback | Pull Request opens, updates or reopens | Impact-selected Node/compiler feedback for the current head | Report `release-gate` or run the complete Browser/Electron matrix |
| Review policy | A frozen Pull Request transitions to Ready once | Live head/base equality, post-Ready exact-commit Codex completion, 30-second settle window, active P0/P1 and P0/P1 `CHANGES_REQUESTED` blocking, P2/P3/unclassified debt artifact | Reuse an old review, make review priority weaken deterministic safety checks or block a candidate solely for P2/P3 debt |
| Dependency baseline | Branch policy pass | Unchanged advisory threshold plus exact packaged-runtime closure | Start a complete source lane or macOS runner while the global baseline is red |
| Source candidate | Dependency baseline pass for one promoted head; final review runs in parallel | Full Node, three Browser shards, real HTML, native Electron and deterministic AI; exact-tree attestation | Automatically rerun on later commits, package or publish an installer |
| Release dry run | `candidate-context` identifies packaging/release metadata/Electron/Bridge/Schema/resource risk on a Ready candidate | Credential-free unsigned App, non-release checkpoint, clean-job renderer/metadata revalidation and startup identity | Read signing/Apple secrets, create distributables or enter Candidate/publication; reject a PR merely because it is large |
| Review debt | Trusted weekly default-branch scheduled/manual run | Rolling P2/P3/unclassified review issue, machine-readable snapshot and carried-forward state for unresolved aged findings | Check out PR code, modify a PR, merge or turn debt into a required check |
| Main integrity | Source candidate is merged | Match merged PR, Tree Hash, version and fresh PR attestation | Repeat any Node, Browser or Electron source test |
| Developer preview | Explicit manual request only | Clean Tree, ad-hoc DMG, packaged-content audit, isolated startup and non-release attestation | Sign/notarize, create updater assets, become a prerequisite, tag or publish |
| Release candidate | Manual `Release Candidate` dispatch on current `main` | Pre-sign content/runtime proof, signed-App checkpoint, final DMG/ZIP/update checks, release asset hashes and candidate attestation | Rebuild the verified App after checkpoint, create a tag or GitHub Release |
| Publication | Manual `Release` dispatch for the exact version on current `main` | Fresh matching candidate, downloaded byte hashes and provenance | Rebuild, replace or silently mutate candidate bytes |

The publication workflow creates the annotated tag only after the pre-tag candidate has passed. It publishes the exact downloaded candidate files. A failed candidate therefore does not consume a version tag.

The `Developer Preview` workflow exists only to move cheap package-content and
startup feedback ahead of an optionally requested installation check. No
push, Pull Request, schedule, formal candidate or publication event triggers
it. Its seven-day artifact cannot be promoted; formal release evidence starts
independently from reviewed `main`.

`candidate-context` is a narrow deterministic path classifier. It reports
packaging risk, changed-file count and advisory scope, but never rejects a Pull
Request for size. When it finds packaging risk, `ci.yml` calls the reusable
`Release Dry Run` workflow for that exact candidate head. It uses two clean
macOS jobs and a synthetic public-format telemetry token, but no repository
secret. Its checkpoint says `releaseEligible: false` and has a separate kind,
directory and filename that the formal signed-App restore will not accept. A
source-only candidate skips it successfully. It is deterministic pre-merge
feedback, not reusable release evidence.

`PR Feedback` and the source-candidate workflow share a per-PR concurrency key.
A new commit therefore cancels an in-flight complete run for the stale head but
does not create a `release-gate` job for the new SHA. Returning to Draft alone
starts no Feedback workflow; a still-running `review-policy` poll re-reads that
state and fails closed. The required check stays absent until the new head is
batched and promoted Ready again. Keep parallel PR scope a judgement call, not
a fixed capacity rule: use the CI Health Ready-count and candidate-churn data to
coordinate real congestion, while allowing coherent large changes when their
review and rollback boundary is clear.

## CI ownership and isolation

- `review-policy` is a final-candidate barrier that runs in parallel with deterministic work. It revalidates live head/base and the latest Ready event, accepts only a post-Ready exact-commit Codex review with `Reviewed commit` evidence or an unedited exact-commit clean Codex comment, then waits 30 seconds. It blocks active non-outdated P0/P1 threads and P0/P1 `CHANGES_REQUESTED` reviews; GitHub review history is reduced to each reviewer's latest explicit decision on the final head, so only a later approval or dismissal retracts an earlier request. P2/P3/unclassified findings are written to non-blocking debt regardless of reviewer. `release-gate` repeats the evidence check in immediate revalidation mode after all source lanes and before exact-tree attestation. `PR Feedback` mirrors this contract as a non-blocking single-snapshot advisory; Codex reviews only Ready transitions, so the snapshot never polls and cannot invent completion.
- `review-gate-recovery.yml` owns one narrow `actions: write` exception from trusted default-branch code. A late Codex event can request GitHub's failed-job rerun only when the live final-review policy now passes, the PR remains Ready on the exact head/base, the original attempt artifact says `review_wait_timed_out`, all required source jobs succeeded and no job other than `review-policy` plus `release-gate` failed. It never checks out PR bytes, grants the rerun new permissions, changes code or merges; every other failure shape is recorded as ignored.
- The promotion workflow remains a read-only `pull_request` workflow. It grants no write permission, never uses `pull_request_target` to execute checked-out PR code and never merges a Pull Request.
- `branch-policy`, `review-policy` and `candidate-context` have no dependency on one another. `baseline-policy` waits only for branch policy and runs `audit:dependencies`, whose single command owns both advisory policy and packaged-runtime closure. `source-build`, Native Electron and AI Electron depend on this job, so a red global baseline consumes no macOS runner while a review wait no longer serializes the test matrix.
- Linux builds and shares only the Web renderer used by Node and Browser lanes.
- Each macOS Electron lane builds the Electron renderer locally. The build is normally sub-second and removes Linux-to-macOS build output as a variable.
- Native Electron and deterministic AI run as separate jobs. A failure can be rerun independently.
- Each macOS job first runs a product-independent synthetic Electron environment preflight. It proves that the hosted window is visible and that renderer timers and animation frames advance before PageRoot code or assertions begin, so an environment failure on either runner stays classified as deterministic `ci_environment` rather than degrading to `source-test/needs_triage`.
- Browser shards and real HTML keep retries at zero. The native Electron lane retries a test once in CI only, to absorb a transient Electron launch/hydration stall; local runs stay retry-free. Retry evidence is never lost with the runner: the lane's diagnostics artifact uploads on `always()`, the config records trace, video and screenshot per failed attempt, and `scripts/playwright-flaky-summary.mjs` writes machine-readable flaky/retry counts from the JSON reporter into `output/ci-evidence/` and the step summary. Reliability remains anchored in deterministic readiness and better evidence, not blanket retrying.
- Release Dry Run has two sequential macOS jobs. The first builds metadata and an explicitly unsigned App, runs the shared packaged verifier with the dry-run signature policy and freezes a non-release checkpoint. The second restores the checkpoint in a fresh checkout, restores its exact metadata, rebuilds `dist-desktop`, reruns the same verifier, then launches the App to compare runtime name/version and Bundle ID with the source package contract. Neither job builds a DMG or sees signing/notarization inputs. Formal Candidate profiles keep their ad-hoc pre-sign and Developer ID signature gates unchanged.
- `review-debt.yml` runs from scheduled/manual trusted default-branch code with `contents: read`, `pull-requests: read` and `issues: write`. It only refreshes one rolling issue from active non-blocking findings; its hidden state retains a finding when its PR is outside the seven-day activity scan, and removes it only after a later scan of that PR confirms it is absent. It has no `pull_request` trigger, no PR-head checkout and no merge permission.
- Release Candidate has two sequential macOS jobs. `preflight-sign-and-notarize-app` first assembles an ad-hoc App, checks packaged contents, runs the complete packaged-runtime oracle, signs it and proves signed startup before the App is submitted to Apple. Only after App acceptance does it upload an archive/hash/source-bound checkpoint.
- `package-and-verify-candidate` downloads and revalidates that checkpoint, restores the exact embedded build and telemetry metadata as comparison inputs, rebuilds only the deterministic Electron renderer as a source-comparison oracle, uses electron-builder `--prepackaged` to avoid rebuilding the App, creates updater assets, submits only the final DMG to Apple and performs final mounted/extracted verification. The fresh job never regenerates telemetry configuration or receives its project token. The jobs have 90- and 75-minute guards; App and DMG Apple steps have 45- and 50-minute limits. All non-Apple steps keep explicit 2–10 minute limits.
- The formal Candidate checkpoint transfer is its only added normal-path handoff. Its ZIP is uploaded without redundant Actions compression. This small fixed cost prevents content/runtime failures from consuming Apple queue time and lets a failed second job resume without rebuilding, rerunning packaged runtime, resigning or renotarizing the App.

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

1. Update the version/change PR onto current `main`, promote that frozen head from Draft to Ready, and merge only after its exact `release-gate` passes.
2. Confirm `main-integrity` is green for the merge commit. It reuses the exact source evidence and does not rerun source smoke.
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
| Complete source-gate runs per Pull Request | Average at most `1.25` |
| Ready-PR full gate wall time | P50 under `6 min`, P95 under `10 min` |
| Final candidate to merge | P50 under `40 min` |
| Ready to final review completion | P50 under `15 min` |
| Ready candidate test completion | P50 under `20 min` |
| Required gate to merge wait | P50 under `10 min` |
| Ready transitions per Pull Request | Average at most `1.25` |
| CI-environment false-failure rate | Under `2%` of critical jobs |
| Repeated green runner share | Under `20%` of runner minutes |
| Later candidate-SHA churn | Under `20%` of all PR runner minutes |
| Candidate App rebuilds after signed checkpoint | `0` |
| Time to assign a failure category | Under `10 min` |
| Publication rebuilds after candidate approval | `0` |

Runner minutes and wall time are different signals. Splitting Electron lanes may use similar total macOS minutes while reducing critical-path time and allowing only the failed lane to rerun. The goal is less repeated evidence, not simply fewer tests.

The read-only `CI Health` workflow runs daily and can also be dispatched manually. Its first job runs the same dependency advisory and packaged-runtime closure baseline even when no PR is promoted; the report job still runs with `always()` so a red baseline is recorded rather than hiding the thirty-day metrics. `scripts/ci-health-report.mjs` reads paginated Actions history plus Pull Request Ready events, reviews, review comments and issue comments for the requested window and fails explicitly rather than silently truncating an exceptional oversized window. Its review latency accepts only the same post-Ready, exact-final-head Codex completion that `review-policy` accepts; its test-completion latency ends at the last successful source/dry-run lane rather than the gate that also waits for review. It filters flow intervals to their relevant Ready/merge timestamps, and binds each gate to the final candidate SHA. It reports candidate-to-merge, Ready-to-review, Ready-to-gate, gate-to-merge, Ready count and P0/P1/P2/P3/unclassified distributions alongside tree attempts, repeated-green work, churn, runner minutes and cancellation rates. The five external workflow inputs live in one exported contract shared by report collection and test-ownership selection, so adding an input without mapping it to CI Health coverage fails the source gate. A run is terminal only when Actions reports `status=completed` and a conclusion; active runs cannot contribute attempts, wall latency, churn or cancellation-rate denominators. Their counts and the minutes from already-completed jobs remain visible as separate active workload, while assessment shares use terminal-workflow minutes. Review-only, baseline-only and still-running promotions are therefore not miscounted as complete gates. Publication rebuild attempts are derived only from successful Release runs whose `Publish immutable GitHub Release` step also succeeded; a period with no proven publication or missing job evidence reports `NO DATA`, never a synthetic zero. The Actions Summary gives every machine-measured report target an explicit `MET`, `MISSED` or `NO DATA` result plus an overall status; `output/ci-health/ci-health.json` retains the same assessment for 90 days. Empty periods remain `null`/`n/a`; they are never reported as a false zero failure rate.

## Change control

Changes to workflow topology, test ownership, provenance, retention or publication update this document, `docs/DEVELOPMENT.md`, `tests/TEST_STRATEGY.md` and `docs/RELEASING.md` in the same PR. Changes that weaken an oracle or remove a protected source/artifact boundary require an explicit rationale and replacement evidence.
