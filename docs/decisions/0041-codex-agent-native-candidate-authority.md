# ADR 0041: Codex uses an agent-native sandbox and Bridge-owned finalization

## Status

Accepted on 2026-08-26.

## Context

The pinned Codex ACP adapter starts Codex App Server, whose tools execute inside
the Agent process rather than through Stemmio's Qoder Client Host. Reusing the
Qoder permission model would therefore confuse protocol permissions with an OS
isolation boundary. At the same time, Candidate, Review and adoption must retain
the existing source-preserving authority chain.

## Decision

Codex Discussion and Execution use separate short-lived macOS sandbox
workspaces and process groups. Discussion is command-free and read-only.
Execution receives frozen Request copies and one writable temporary output
directory. Model transport and auth state belong only to the verified Codex
binary; allowlisted tool descendants cannot use network, auth state or relaunch
privileged runtimes. Adapter, Codex binary and code-mode host identities are
exact-pinned and reverified.

The sandbox boundary treats the pinned adapter, Codex descendants and authored
page content as untrusted. It does not claim to isolate Stemmio from another
process already running as the same macOS account: such a process can also
replace the installed app, rewrite that account's auth state and alter user
projects outside this runtime. Private staged executable copies, retained file
descriptors and live identity checks close runtime-controlled path drift; they
are defense in depth, not a same-account malware boundary.

Codex cannot invoke the finalizer. After process cleanup, the Bridge collects
the unique complete HTML output, then enters one uncancellable finalization
drain. Inside that drain it rechecks frozen inputs, publishes the bytes to the
canonical Attempt path and invokes the repository's fixed finalizer through a
verified file descriptor. Cancellation and app shutdown either win before this
drain or wait for it; they cannot split publication from completion evidence.
Repository completion evidence, not Agent text, stop reason or exit status, is
the sole Candidate authority. Existing Review and explicit adoption are
unchanged.

## Consequences

- macOS arm64 is the only packaged Codex target in this change; other platforms
  fail closed.
- The two Codex capabilities have independent build gates and can be rolled back
  without deleting provider history or affecting Qoder and clipboard delivery.
- Codex upgrades require refreshed binary/helper hashes, App Server Schema
  fingerprints, SPDX SBOM, sandbox attacks and packaged closed-loop evidence.
- Unconfirmed cleanup or finalization never publishes a Candidate or releases
  the Attempt for unsafe retry.
