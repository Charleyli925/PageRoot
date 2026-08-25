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
