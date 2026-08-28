# ADR 0053: Codex chooser uses ACP; App Server stays packaged-unregistered

- Status: Accepted
- Date: 2026-08-28
- Scope: Codex provider registration, managed npm closure and chooser security profile

## Context

ADR 0052 added a product ACP catalog, a managed installer and a shared ACP
runtime, but registered only Qoder as installable. The chooser still exposed a
single Codex item through the private App Server stack (`runtimeId:
"app-server"`, `securityProfile: "agent-native"`, bundled `@openai/codex`).

The product direction is one Codex selector that speaks ACP. Deleting the App
Server modules and packaged natives is a later iteration, after this ACP path
is proven.

`@agentclientprotocol/codex-acp` is not a fat CLI like Qoder's `bundle/qodercli.js`.
Its npm tarball only contains the adapter; production use requires a pinned
closure that also includes `@openai/codex` and the platform native package.

## Decision

The chooser Codex item (`providerId: "codex"`) now uses:

- `runtimeId: "acp"` (the existing shared ACP runtime; a second `acp` runtime is
  forbidden)
- `securityProfile: "client-mediated"`
- `installable: true`

`createDefaultProviderRegistry` registers `createCodexAcpProvider` when
`codexExecution` is true. It does **not** register `createCodexAppServerRuntime`
or `createCodexProvider`. Those modules and extraResources remain in the
package as packaged-unregistered until the next iteration deletes them.
Historical Requests with `runtimeId: "app-server"` stay readable and
cancellable; they are not a new-start authority.

Managed install writes a pinned npm closure under
`userData/agents/codex/<version>/package/` plus `node_modules/`. Each tarball
is exact version plus `dist.integrity`. The installer never spawns the user's
global npm, and never points `CODEX_PATH` at PageRoot's bundled `@openai/codex`.

Discovery still follows ADR 0032: valid user `codex-acp` → managed copy →
`not-installed`. An invalid user install is not treated as missing.

Login remains a copied CLI instruction (`codex login` / ChatGPT). There is no
in-app OAuth. Preflight runs ACP `initialize` then `session/new`. Codex always
advertises ChatGPT/API-key `authMethods` while logged in, so their presence is
not a login failure. Missing login is classified only when `session/new`
returns JSON-RPC `-32000` (`auth_required`) or process text matches the auth
failure pattern. PageRoot still does not send `authenticate`.

## Consequences

- Users with a valid independent `codex-acp` keep a PATH/prefix discovery path.
- Users with no CLI can one-click install the pinned adapter+native closure.
- Qoder ACP behavior is unchanged.
- Packaged-app size does not drop in this PR.
- The next increment deletes the private App Server stack and bundled
  `@openai/codex` extraResources.
