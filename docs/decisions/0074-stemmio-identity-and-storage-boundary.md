# ADR 0074: Stemmio identity and local-storage boundary

Status: Accepted.

## Decision

The current product identity is Stemmio (中文名“源页”), with npm name
`stemmio`, stable Bundle ID `com.stemmio.app`, and the independent Preview
identity `Stemmio Developer Preview` / `com.stemmio.app.developer-preview`.
Stable, Preview, source development and E2E each resolve their own explicit
data roots. Project control data uses `.stemmio`, the Registry uses
`.stemmio-registry.json`, and persistent source elements use
`data-stemmio-id` values with the `sm1_` UUID-v4 contract. Runtime schemes,
transient markers, conversation actor and current self-owned Schema IDs use the
corresponding Stemmio namespace.

`shared/product-identity.mjs` owns pure product constants;
`desktop/runtime-environment.mjs` is the desktop channel/path resolver; and
`shared/project-storage-contract.mjs` owns pure project-layout names. Existing
path-safety, Registry, transaction, recovery and save owners remain in place.
This decision does not upgrade dependencies, add a storage engine, or change
save/version semantics.

## Compatibility and import boundary

Stemmio does not read, migrate, take over or delete old PageRoot management
directories, Registries, Keychain entries or application data. A user-selected
legacy HTML file may be explicitly imported: the import creates a new Stemmio
project copy, leaves the original bytes and old control directory untouched,
and does not infer history from legacy metadata. Unsupported or malformed
current records fail closed. The GitHub source repository remains
`Charleyli925/PageRoot`; semantic page-root helper names, persisted HTML
metadata/source markers, historical records and negative compatibility tests
remain precise exceptions rather than current product namespaces.

## Rollout and acceptance

The identity, runtime, storage, element-identity, record/Schema and engineering
name changes are delivered as the reviewable batches 0–6 described in
`docs/STEMMIO_RENAME_PLAN.md`. Contracts change atomically across producers,
consumers, validators, fixtures and package resources. Intermediate test roots
are disposable; a new Stemmio package may carry formal data only after the
complete installation and isolation acceptance matrix passes. No merge,
release, repository rename or public publication is implied by this ADR.
