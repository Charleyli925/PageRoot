# ADR 0032: Trusted-local Qoder ACP Agent Bridge

- Status: Accepted
- Date: 2026-08-21

## Context

PageRoot already owns the durable safety contract for AI work: it freezes one
Request/Attempt, accepts one complete output through the official finalizer,
creates a separate Candidate, validates it, and waits for explicit review and
adoption. [ADR 0056](archive/0056-qoder-acp-v1-spike.md) proved that Qoder CLI can execute a synthetic task over ACP,
but intentionally left the product clipboard-only.

The product now needs to remove copy/paste for Qoder without giving a driver
authority over Request, Candidate, Version or current HTML state.

## Decision

Add a Bridge-owned `AgentBridgeService` with one first product driver,
`qoder-acp`, while retaining clipboard as a per-task fallback.

- The user chooses “Qoder CLI” or “复制任务” in one delivery dialog before
  each submission. Choosing Qoder records explicit `trusted-local-agent-v1`
  consent; no global implicit trust is inferred. Expected installation,
  authentication and availability failures expand in place, while the copy
  path remains available and About is never a required detour.
- `RunWorkflow` publishes one shared five-state Qoder availability projection
  to delivery and About. Opening either surface runs a disk-only package and
  executable discovery that does not execute Qoder, connect to its service,
  create a Request or lock the Canvas. The result is never persisted across app
  processes; explicit recheck always reads the disk again.
- Selecting Qoder or “检查并继续” performs the full use-time preflight before
  registration/freeze/Request creation. A version, identity, authentication or
  static model-list failure creates no Request and leaves the current HTML
  editable. A successful short-lived ticket is reused by the immediately
  following submit, avoiding two consecutive probes. Every process-running
  preflight also performs bounded whole-process-group cleanup; an unconfirmed
  descendant establishes a non-prunable Bridge shutdown fence instead of
  becoming a retryable failure.
- Product discovery accepts only a protected standalone
  `@qoder-ai/qodercli` package at version 1.1.27 or newer. It rejects the CLI
  embedded in Qoder.app, validates the local package manifest/structure and
  protected executable identity, and rechecks that identity when consuming a
  short-lived one-use ticket and immediately before spawn.
  Discovery also covers Finder/Dock's sparse `PATH`, configured npm prefixes
  and common nvm, Volta, fnm, mise and asdf roots; finding a candidate never
  relaxes package verification. An unsupported or invalid candidate is reported
  as unusable, not absent.
  For the npm JavaScript bundle, PageRoot's trusted Node/Electron runtime reads
  the already-opened and hashed executable inode through an inherited file
  descriptor; it never reopens the mutable bundle pathname to obtain code.
  Arbitrary executable injection is allowed only behind two explicit E2E
  environment fences.
- After preflight, PageRoot creates exactly one normal Request whose durable
  metadata authorizes `qoder-acp` and the current trust-policy version. The
  renderer sends only registered task identity plus the opaque ticket.
  `AgentBridgeService` derives command, cwd, environment, Request paths,
  manifest, output and finalizer authority from Bridge/Repository state.
- The restricted ACP host may read only the manifest's exact frozen read order,
  write one Candidate path through same-directory atomic publication, and run
  the exact Node finalizer without a shell. Runtime authority is revalidated
  before ACP mutations and before/after Candidate publication.
- ACP events are bounded, sanitized presentation evidence. Agent stop or
  process exit can trigger status reconciliation but cannot create a Candidate.
  Only the official finalizer and `ProjectFileRepository` validation can move a
  Request to pending review. Adoption remains an explicit user action through
  the existing Version workflow.
- Before spawn the Bridge atomically owns a project-local launch lease. A
  normally settled task releases it only after process-group cleanup. A Bridge
  crash leaves the lease as an orphan fence: the Request is shown as
  interrupted and cannot restart or fall back to clipboard. Durable cancel
  fences that old Request without claiming the unknown process stopped; the
  next attempt must be a new Request. Existing unfinalized output/completion or
  unconfirmed cleanup applies the same fail-closed rule and is never overwritten.
- Ordinary cancellation closes the host mutation surface, requests ACP
  cancellation and performs bounded process-group cleanup before the Bridge
  persists Request cancellation. App/Bridge shutdown disposes every owned
  session. The Bridge exits only after every owned Agent confirms cleanup; an
  unconfirmed or timed-out cleanup keeps the Bridge and desktop app alive and
  aborts quit, relaunch or update installation.
- Public Agent status contains only driver, bounded state/phase, sanitized
  Agent name/version, timestamps, event count and stable safe error copy. It
  excludes executable paths, Request paths, prompt/HTML, account data, raw
  Agent output, stderr and stacks.

## Security boundary

This is a trusted-local-Agent integration, not an OS sandbox. The Qoder process
runs as the signed-in local user and can theoretically bypass ACP to access
other user files. ACP allowlists constrain cooperative protocol requests; they
do not isolate a hostile local process. The selection dialog keeps the concise
task disclosure; the packaged user statement preserves the complete local-user
permission and non-sandbox disclosure before product use. Product/security
documentation must preserve that boundary without filling the delivery flow
with protocol terminology.

This first phase of productization validates a locally installed npm package's
manifest/structure, protected filesystem identity, version and ACP behavior. It
does not attest npm-registry/lockfile provenance, Apple code signature or Team
ID for the independently installed CLI. A future OS sandbox or stronger binary
attestation is a separate decision.

## Ownership and packaging

`RunSession` remains the only renderer owner of active/background run and Agent
delivery projection. `RunWorkflow` owns the shared availability presentation,
guidance-copy fact, preflight-ticket reuse and preflight/start/retry/cancel
ordering. Both user surfaces reuse `QoderAvailabilityCard` and the same domain
presentation model rather than inferring readiness independently.
`AgentBridgeService` owns ephemeral command tickets and child sessions plus the
project-local crash lease; the lease is only a duplicate/orphan fence, not task
or Candidate authority.
`ProjectFileRepository` remains the sole durable Request/Candidate/Version
authority.

The packaged Bridge includes the Agent service, restricted ACP client,
`@agentclientprotocol/sdk` and `zod` as an exact allowlisted runtime closure.
The synthetic spike entry point and fake Agents remain development-only.

## Validation

- Restricted-host Node tests own path/manifest/Hash/session/terminal policy,
  authority drift, cancellation races, bounded events and process cleanup.
- Agent-service tests own explicit consent, discovery/preflight tickets,
  npm/nvm/Volta/fnm/mise discovery, same-process installation refresh, invalid
  installation classification, identity recheck, task-keyed idempotency,
  sanitized status, restart projection and unsafe retry refusal.
- Real Bridge integration starts a fake ACP subprocess and proves Candidate-only
  completion, stop-before-durable-cancel and crash-fenced same-Request refusal.
- Electron closed-loop coverage proves automatic mode avoids the clipboard,
  reaches the existing Review UI and never automatically changes Working Copy;
  authentication failure remains in the original dialog, creates no Request,
  keeps copy available and agrees with About.
- Package, artifact and dependency owners recursively reject special-file
  escapes and run a packaged Helper → packaged Bridge → fake ACP → packaged
  finalizer → pending-review Candidate closed loop.
  A real installed Qoder session remains additional developer evidence only;
  account/network outcomes are not deterministic release gates.

## Consequences

PageRoot can actively run and stop Qoder while preserving its strongest product
boundary: every Agent result is a separate Candidate until the user reviews and
adopts it. Other Agents continue to work through the clipboard driver. ACP or
native drivers may be added later behind the same Agent Bridge contract without
moving task-state ownership into a provider integration.
