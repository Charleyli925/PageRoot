# Release guide

Official releases use two explicit GitHub Actions stages from reviewed `main`:

1. `Release Candidate` builds and verifies the installer before a tag exists.
2. `Release` verifies those frozen bytes, creates the annotated immutable tag and publishes the same files.

Do not push a release tag manually. A tag is an output of successful candidate verification, not the input that starts packaging.

## Prepare the source

1. Update `package.json` and the package-lock root to the same semantic version.
2. Move relevant `CHANGELOG.md` entries from Unreleased into that version.
3. Open a draft Pull Request while iterating. Draft updates run impact-selected feedback.
4. Mark the final intended tree ready and wait for the required complete `release-gate`.
5. Merge only with authorization, then confirm `main-integrity` and `main-smoke` pass for the exact merge commit.

Local `npm run release:mac` remains available when a complete local source-and-installer proof is useful. It is not publication and does not replace the reviewed GitHub flow.

## Build the pre-tag candidate

Before the first signed candidate, configure these GitHub Actions secrets
directly in the repository settings:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12`.
- `MAC_CSC_KEY_PASSWORD`: the export password for that `.p12`.
- `APPLE_ID`: the Apple ID used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: a current app-specific password created for
  CI notarization.
- `PAGEROOT_POSTHOG_TOKEN`: the `phc_…` Project token from the PageRoot
  PostHog project. Do not use a project secret API key.

Never paste those values into source, issues, Pull Requests, logs or chat. The
public Team ID is fixed to `RNK9RB969G` in the release workflow so a candidate
cannot silently switch signing teams.

In GitHub Actions:

1. Select the `Release Candidate` workflow.
2. Choose `main`.
3. Run the workflow and wait for `build-and-verify-candidate`.

The workflow allows up to 110 minutes specifically for the combined
build/sign/notarize/install-verification operation, within a 120-minute outer
job guard. The App and the final DMG are submitted to Apple independently; the
DMG is stapled and validated after its own acceptance. All other steps have
explicit 2–10 minute limits, so an unrelated checkout, dependency, metadata,
provenance or upload stall still fails quickly.

The workflow:

- refuses any ref other than current `main`;
- requires a successful PR source-gate attestation for the exact Tree Hash and package/lockfile version, no older than seven days;
- packages on macOS with `electron-builder --publish never`, Developer ID
  signing, Hardened Runtime, App notarization, and final DMG
  notarization/stapling;
- requires the PostHog Project token and embeds a generated public ingestion
  configuration whose host is fixed to the selected cloud region;
- launches the packaged App with isolated data;
- verifies the App bundle, Bridge resources, schemas, expected Team ID,
  packaged user notice, notarization ticket, Gatekeeper assessment, DMG
  integrity, update ZIP, blockmap, `latest-mac.yml` and read-only mount;
- creates checksums for every public payload and metadata file, retains the
  legacy `update-manifest.json`, and copies `build-info.json`;
- freezes those files with `release-candidate.json` in an artifact named for the exact Tree Hash, version, architecture and workflow run attempt.

It does not create a tag or GitHub Release. A failed build or verification therefore leaves the version namespace untouched.

Candidate artifacts are retained for 14 days. Publication accepts only a successful matching candidate no older than 72 hours. If the source changes for any reason, build a new candidate for the new Tree Hash.

## Publish the candidate

After reviewing the candidate run:

1. Select the `Release` workflow.
2. Choose `main`.
3. Enter the exact version from `package.json`, without the `v` prefix.
4. Run `publish-verified-candidate`.

The workflow:

1. verifies the requested version against `package.json` and the package-lock root;
2. resolves a fresh successful `Release Candidate` run for the exact current commit, Tree Hash, version and `arm64` architecture;
3. downloads the frozen candidate;
4. verifies the candidate attestation, build provenance, expected file set, sizes and SHA-256 of every asset;
5. checks that no published Release already exists;
6. creates an annotated `v<version>` tag at that exact commit;
7. publishes the candidate DMG, ZIP, ZIP blockmap, `latest-mac.yml`, checksum,
   legacy update manifest, build provenance and candidate attestation without
   rebuilding.

If publication fails after the tag push but before the GitHub Release exists, rerun the same `Release` workflow from the same `main` commit and version. It may resume only when the existing tag is annotated and resolves to the identical commit. If a Release already exists, the workflow refuses to replace its assets.

## Provenance

Packaging refuses committed-source drift or untracked source files. `build-info.json` records version, architecture, repository, commit SHA, Tree SHA and build time. `release-candidate.json` additionally binds the source-gate run, candidate run/attempt and SHA-256 plus size of every public asset.

Publication resolves only the artifact whose name matches the successful run attempt, then revalidates all of that information after downloading it. This keeps a failed-job rerun distinct from bytes uploaded by an earlier attempt of the same workflow run. The Release includes both provenance files, so the published installer can be traced to the reviewed source tree and the exact successful candidate run and attempt.

The public build is signed with a Developer ID Application certificate,
notarized and stapled before it is frozen. If electron-builder lists the DMG in
`latest-mac.yml`, its digest and size are refreshed after stapling so every
listed artifact describes final bytes. The compatibility path continues to
describe the signed ZIP and its blockmap; electron-updater validates the release
metadata and application signature, uses a cached prior ZIP for differential
transfer when available, and falls back to a full ZIP on the first migration or
if a differential request cannot be completed.

The first signed release is a trust-boundary migration. Existing ad-hoc clients
show the legacy manual update entry and require one manual DMG install. Once the
signed build is installed, later stable releases download automatically and
prompt for an explicit safe restart.

## Failures

Use the machine evidence under `output/ci-evidence/` and the procedure in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.

- Rerun only a failed job when the exact SHA and failure signature indicate a hosted-environment incident.
- Do not make no-op commits, enable blanket retries or restart a green matrix.
- After the same environment signature fails twice on one SHA without local reproduction, freeze the candidate and open a CI incident.
- Never move or reuse a published tag. If released source is wrong, fix it through a new PR and publish a new patch version.
