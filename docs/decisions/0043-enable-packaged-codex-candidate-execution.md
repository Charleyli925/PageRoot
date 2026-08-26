# ADR-0043: Enable packaged Codex Candidate execution

> Status: Accepted
> Date: 2026-08-26

## Context

ADR-0042 established the direct App Server execution and Candidate authority
boundary behind `codexExecution=false`. The feature can be exposed only when an
installed Stemmio build carries the same pinned native runtime that preflight
and execution verify. The product remains an Agent conversation surface, but
pure Discussion stays out of scope.

## Decision

- Keep `codexDiscussion=false` and set the source-owned `codexExecution=true`.
  Preferences, environment variables, project files and Provider responses
  still cannot change either capability.
- Package `@openai/codex@0.149.1` plus only
  `@openai/codex-darwin-${arch}`. Electron Builder expands `${arch}` for the
  exact artifact; other operating systems and CPU packages are excluded.
- The artifact verifier requires the reviewed module allowlist to match source
  bytes. Because application signing legitimately rewrites Mach-O signatures,
  native executables are compared after both signatures are removed and
  deterministically normalized with the same entitlement; their executable
  content may not change. The verifier also revalidates wrapper/platform/runtime
  manifests, executes the packaged native binary with `--version`, and confirms
  the packaged feature-gate module exposes Execution while keeping Discussion
  disabled.
- The existing right-sidebar chooser remains the only Agent surface. Selecting
  a different Provider immediately runs that Provider's real preflight; a slow
  Qoder check cannot suppress a Codex check. Codex login/reinstall states do not
  route to Qoder settings, and the local-file-read disclosure remains beside
  the modification action.
- Installed-app evidence must prove selection, real preflight, one real page
  modification, pending-review Candidate authority, unchanged original and
  Working Copy bytes, unchanged official Version count, and confirmed process
  cleanup.

## Rollback

The immediate rollback is one source change: set `codexExecution=false` while
leaving `codexDiscussion=false`. That removes Codex from both renderer and
Bridge registries without deleting or migrating Requests, Conversations,
Candidates, Working Copies or Versions. The now-inert native resources may be
removed in a later packaging-only cleanup.

## Consequences

- A package that omits, changes or cannot execute the pinned Codex runtime fails
  artifact verification and cannot be called a usable Codex build.
- Codex remains a trusted local Agent that may read local files. Its write and
  authority boundary remains the unique Candidate output plus fixed Stemmio
  finalizer and explicit Review/adoption.
- Skills, MCP, Plugins, Apps, Web, subagents, network access and pure Discussion
  remain disabled for this execution profile.
