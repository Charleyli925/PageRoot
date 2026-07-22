# ADR 0001: GitHub main is the source of truth

- Status: Accepted
- Date: 2026-07-23

## Context

The project previously existed as a working source folder, local backups, build output and separately uploaded release assets. That made it difficult to prove which source produced an installation package.

## Decision

The public PageRoot repository is self-contained. Its `main` branch is the only authoritative source line. Work happens on short-lived branches and reaches `main` through reviewed Pull Requests. Generated builds remain ignored. Every release is built from a clean tagged commit and embeds that commit and Git tree identity.

## Consequences

- A fresh clone can install, test and package without reading parent directories.
- Backups and installed applications are recovery aids or outputs, never editing sources.
- Any source change invalidates earlier release-gate evidence and requires a complete rerun.
- Published tags and assets are immutable; corrections use a new version.
