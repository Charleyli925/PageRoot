# Open-source boundary

This repository is the complete public source boundary required to build and test PageRoot.

## Included

- Application and desktop runtime source
- Bridge and validation scripts
- JSON Schemas and synthetic protocol fixtures
- Automated tests and synthetic HTML fixtures
- Public architecture, development, security and release documentation
- Product artwork required to build the application

## Excluded

- Real user HTML, attachments and project records
- Local backups, previous workspace copies and internal design-review notes
- Developer home-directory paths, credentials, signing certificates and notarization secrets
- The production PostHog Project token and generated
  `output/release-metadata/usage-telemetry-config.json`; packaging receives the
  public ingestion token from repository Actions secrets
- `node_modules/`, build caches, test output, `.app`, DMG and other generated release files
- Private operational logs and unpublished research material

The excluded material is neither required nor permitted for a source build. A clean clone followed by `npm ci` must contain everything needed to run the automated source gates. Release artifacts are generated from an immutable, clean Git commit and carry `build-info.json` identifying that commit.

Before every public push, review `git diff --cached`, run a secret scan appropriate to the change and confirm that no user-controlled files were added.
