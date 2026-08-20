# ADR 0031: Qoder ACP v1 synthetic spike

> Status: Superseded by [ADR-0032](0032-qoder-acp-agent-bridge.md)

- Status: Experimental
- Date: 2026-08-21

## Context

PageRoot already freezes an immutable Request, requires one Attempt output,
runs the official finalizer, creates a Candidate, and waits for explicit review
before adoption. The production QoderWork handoff currently copies one message
and does not start or control an Agent. We need to prove that Qoder CLI can be
driven over ACP without changing the Request/Candidate/Review contract.

## Decision

Add a development-only ACP v1 harness using the official
`@agentclientprotocol/sdk`:

- `scripts/qoder-acp-spike.mjs` creates only a synthetic v4 Project File and
  Request in an isolated temporary root, starts an independently installed
  Qoder CLI with the hidden `--acp` mode, and writes a sanitized report below
  ignored `output/qoder-acp-spike/`.
- `scripts/qoder-acp-spike-client.mjs` derives a one-session policy from the
  current Request layout and the externally sealed input-manifest Hash. ACP
  filesystem handlers can read only the exact current manifest/readOrder and
  write only `attempts/<attemptId>/output/candidate.html`; Candidate writes use
  a same-directory single-link staging file and atomic rename.
- ACP terminal handlers accept only the absolute current Node executable plus
  PageRoot's exact `finalize-attempt.mjs` arguments, Request cwd, empty env, and
  `shell: false`. Shell wrappers and arbitrary commands are rejected.
- A clean ACP stop is insufficient. The harness independently requires a
  zero-exit, untruncated finalizer, exact completion identity and Candidate
  Hash, then asks `ProjectFileRepository` to seal the Candidate. It verifies
  the complete Working Copy projection, manifest bytes, base identities and
  every Version snapshot remain unchanged.
- ACP request abort signals feed an explicit active/cancelling/finalized/
  disposed host lifecycle. Timeout cancellation closes the mutation surface
  before notifying the Agent, and late writes or finalizer launches fail
  closed. Agent early exit/process errors fail immediately; cleanup signals
  the detached process group even after the direct child has exited.
- The existing `desktop/qoder-handoff.mjs`, renderer flow, Bridge routes,
  package allowlists and clipboard-only product behavior remain unchanged.

## Security boundary

This is a cooperative protocol host, not an OS sandbox. ACP requests are
strictly allowlisted, the Qoder child receives a reduced environment, protocol
frames are byte/UTF-8 bounded, and child processes are terminated as a process
group. Nevertheless, Qoder CLI itself still runs as the signed-in local user
and could access local files without going through ACP. Therefore this spike:

- accepts synthetic task data only;
- is not packaged or reachable from PageRoot UI;
- is not release, privacy, or hostile-Agent isolation evidence;
- must not be promoted to real user tasks until PageRoot either establishes an
  OS-level sandbox or adopts an explicit trusted-local-Agent product policy and
  threat model.

## Validation

The Node integration owner uses an in-process fake ACP Agent, isolated real v4
Repository, real official finalizer and deterministic Candidate oracle. It
covers manifest/identity/Hash drift, symlinks, exact read/write/terminal
surface, atomic output publication, session binding, completion verification,
late mutation rejection, process errors/orphan cleanup and timeout cancellation.
The live command is additional developer evidence only: authentication,
account capacity and network availability can block it, and such a block is
recorded explicitly rather than treated as a passing test.

## Consequences

The spike proves the Agent-Bridge seam without changing PageRoot state
ownership. A later product phase can place an `AgentBridge.submit(task)` owner
above Clipboard, ACP and native-provider drivers while retaining
freeze → Candidate → validation → review → explicit adoption.
