# ADR 0069: PageRoot native OpenAI-compatible Agent

- Status: Accepted
- Date: 2026-09-02

## Context

ADR 0032 authorized trusted-local Qoder ACP. ADR 0053 added Codex ACP. ADR 0039
reserved `agent-native` for a future sandbox gate and registered no such
provider. ADR 0052 explicitly deferred Native Agent / BYOK.

Users who already have a vendor API Token (智谱、DeepSeek、阿里通义, or another
OpenAI-compatible HTTPS endpoint) cannot complete a PageRoot round without
installing those CLIs. Codex login is not a substitute for a user-owned key.

## Decision

Register one product provider `pageroot` with runtime `http` and
`securityProfile: client-mediated`.

- The Agent is PageRoot-owned. It never spawns a vendor CLI and never grants
  the model filesystem or terminal access.
- Settings selects 源页 Agent, then a vendor and an API Token on the existing
  connection card. There is no new dialog or notice. Anthropic is not
  registered.
- Shipped vendors are DeepSeek, 智谱, 阿里通义 and OpenAI, plus one
  `其他兼容接口` that requires an `https` base URL without credentials in the
  URL. Tokens stay in `AgentRuntimeCoordinator` process memory and are injected
  only as `PAGEROOT_API_*` for this provider's preflight and launch.
- Preflight lists models from `GET /models` (falling back to the vendor's
  default catalog, skipping vision-only ids). Execution reads the frozen
  Request files, calls `/chat/completions` with the selected model and
  thinking depth, writes one complete HTML document to the policy output
  path, and runs the official finalizer. Candidate authority is unchanged.
- Sidebar, not Settings, chooses the listed model and thinking depth
  (`none` / `low` / `high` / `max`). Unselected thinking depth stays
  provider-default in the catalog and is sent as `high` at launch.
- Qoder and Codex ACP remain installable CLI schemes. They do not accept a
  session API Key and do not expose thinking depth.

## Consequences

- A future Anthropic or non-HTTPS vendor is a new product/security decision.
- `agent-native` remains unregistered.
- Failed model output that is not complete HTML fails closed before finalizer
  publication.
- Tests may redirect this provider's HTTPS origin to `http://127.0.0.1` only
  when both `PAGEROOT_E2E=1` and `PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL=1`
  are present. Production ignores `PAGEROOT_HTTP_AGENT_BASE_URL`.
