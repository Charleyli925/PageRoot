# ADR-0042: Codex App Server execution stops at Candidate authority

> Status: Accepted
> Date: 2026-08-26

## Context

Stemmio must let Codex modify a page without restoring pure Discussion turns or
replacing the existing Agent-conversation product structure. The durable
Conversation and the right sidebar remain the presentation for user intent,
Agent narration, execution progress and Candidate decisions. Qoder and Codex
share that product flow but do not need to share one transport or sandbox.

Codex App Server is agent-native. Reusing Qoder's client-mediated ACP file Host
would misstate the security boundary and add a second protocol. App Server
`turn/completed` is Provider evidence only and cannot create a Candidate.

## Decision

- `codexDiscussion` remains false. No Codex or Qoder message can create a
  read-only discussion turn.
- `codexExecution` is a source-owned hard gate. PR4 keeps it false in ordinary
  builds; it cannot be enabled by preferences, environment, project data or a
  Provider response. Tests inject the enabled composition explicitly.
- When enabled, the Provider Registry adds `codex` with runtime `app-server`
  and security profile `agent-native`. Qoder remains `acp` and
  `client-mediated`.
- Every modification uses one new ephemeral thread, one turn, approval `never`,
  network disabled, `/tmp` excluded, an empty MCP allowlist, all discovered
  Skills disabled, and Apps, Plugins, Browser, Computer Use and multi-agent
  features disabled.
- Codex runs from a private executable snapshot created from the exact
  preflight-verified native binary bytes. The snapshot is removed only after
  process-group cleanup is confirmed.
- The turn working directory and only writable root are the fresh Candidate
  output directory. After the process stops, that directory must contain
  exactly one single-link regular Candidate file.
- Codex never runs the finalizer. Stemmio invokes the existing fixed finalizer
  only after clean App Server termination, then reuses the existing Host proof
  to validate completion identity and Candidate bytes.
- Provider model and reasoning resolution returned by preflight replace the
  unresolved selection before Request creation. The durable Request, one-use
  ticket and runtime launch therefore name the same model.

## Product boundary

The Composer may switch among gated Provider descriptors in place. It does not
open a separate Codex surface. The Codex choice discloses that a trusted local
Codex Agent may read files on the Mac while modifying. Execution progress,
visible Agent text and the later Review/adoption decision remain in the existing
chat flow.

## Consequences

- A completed turn without the unique output, with extra output residue, with a
  permission request, with uncertain cleanup, or with failed finalization is an
  error and never a completed page modification.
- Candidate Review and explicit adoption are unchanged. Neither the Working
  Copy nor a Version is modified by Codex completion.
- PR4 packages the inert JavaScript Bridge closure so Qoder startup remains
  intact. The Codex native runtime, gate enablement and installed-app evidence
  remain PR5 work.
