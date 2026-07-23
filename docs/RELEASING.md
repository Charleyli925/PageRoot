# Release guide

Releases are generated only from a reviewed commit on `main`.

## Prepare

1. Update `package.json` and `package-lock.json` to the same semantic version.
2. Move relevant `CHANGELOG.md` entries from Unreleased into that version.
3. Merge the change through a Pull Request and confirm CI is green.
4. On a clean checkout of `main`, run `npm ci`, install Playwright Chromium and run `npm run release:mac` if a local candidate is required.

## Publish

Create and push an annotated immutable tag:

```bash
git switch main
git pull --ff-only
git status --short
VERSION=0.8.5
git tag -a "v${VERSION}" -m "PageRoot ${VERSION}"
git push origin "v${VERSION}"
```

The GitHub `Release` workflow verifies that the tag matches `package.json`, runs the complete source and packaged-artifact gate on an Apple-silicon macOS runner, and publishes the DMG, checksum, update manifest and build provenance. `electron-builder` is forced to `--publish never`; only the final workflow step may publish assets after verification.

Do not move or reuse a published tag. Do not replace assets silently. If a released build is wrong, fix the source and publish a new patch version.

## Provenance

Packaging refuses uncommitted or untracked source changes. `build-info.json` records version, architecture, repository, commit SHA, tree SHA and build time. Artifact verification compares this record with the clean checkout and verifies the application bundle, embedded Bridge resources, schemas, signature and mounted DMG.

Current public builds use ad-hoc signing (`identity: "-"`) and are not notarized. Developer ID signing and notarization should be added before presenting the app as a frictionless production download; credentials must stay in GitHub encrypted secrets and must never enter the repository.
