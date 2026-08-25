# ADR 0040: Provider-neutral persistence and Conversation v2

## Status

Accepted.

## Decision

New Requests persist one canonical `managed-agent` provider/runtime/model and
reasoning selection, or exact clipboard mode. A shared codec is the only legacy
`qoder-acp` read boundary. Preflight tickets freeze the same selection and a
fingerprint; start must match the ticket and durable Request.

New conversation and draft writers use schema v2. Agent turns record selection,
nullable validated binding and capability fingerprint. Replies use generic
actor `agent`, provider id and actual provider-namespaced model. v1 remains
read-only and is projected without rewriting bytes or dropping unknown members.

## Consequences

Unknown-provider history can be read, reviewed and cancelled but not restarted.
The renderer never gains command, path, permission or security-profile input.
Candidate and Version schemas remain unchanged.
Read normalization therefore accepts future bindings, while new Request writes
must resolve to a provider/runtime registered in the current build before any
Request directory or runtime authority is published.

## Renderer ownership follow-up

`AgentCatalogState` is the renderer owner for installed descriptor projections,
selected `AgentSelection` and preflight cache. Cache identity contains provider,
runtime, both model ids, reasoning, installation digest, trust-policy version
and purpose. Concurrent identities never share a promise; generation fences
drop late presentation results, and ticket consumption deletes the exact entry.

Execution and discussion freeze selection synchronously before their first
await. Execution persists it into the Request, then start, retry, reconciliation
and recovery read only that durable value. Discussion keeps its frozen selection
in `DiscussionTurnSession`. Qoder remains the only registered renderer provider
and uses `client-mediated`; no Codex descriptor or entry point is introduced.
