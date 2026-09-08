# ADR 0053: Codex chooser uses ACP; App Server stays packaged-unregistered

- Status: Accepted
- Date: 2026-08-28
- Scope: Codex provider registration, managed npm closure and chooser security profile

> Implementation note (2026-08-29): The private Codex App Server provider,
> runtime, root dependency and packaged native copies described by the former
> implementation have been removed. Codex remains available through the
> shared ACP runtime and the catalog-managed installation closure.

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

## 2026-09-08 real-account compatibility finding

The installed 1.7.0 adapter exposes model IDs as `base[effort]`, not plain base
IDs. Public catalog normalization groups these into base model / effort choices;
the frozen runtime launch applies the advertised composite ID before prompting.
Authenticated diagnosis now checks the same session catalog as preflight.
Initialize-only fallback without verified native authentication stays unverified.

Real synthetic execution also revealed a separate unresolved boundary: the
adapter's native tools can write the candidate, but do not expose the client's
ACP `terminal/create` tool to the model. The model reported that it could not run
the required finalizer. The execution host correctly refused completion without
one observed, successful restricted finalizer invocation. Model catalog repair
alone is therefore **not** evidence of a working Codex adoption loop.

Do not bypass `assertTurnCompleted`, accept a candidate from agent prose, or
switch the registration to `agent-native` as a compatibility shortcut. Completing
this path needs a separately reviewed tool adapter that retains the existing
restricted finalizer and filesystem contract, or explicit authorization for a
changed native execution authority. Until then the real Codex closure is a
release blocker; synthetic provider fixtures cannot clear it.

已对经受管包校验的已知不兼容 1.7.0 版本增加预检阻断：`CODEX_EXECUTION_CONTRACT_UNSUPPORTED`，不再重复产生服务用量；要求记录仍保留。该阻断是诚实的兼容性状态，不代表 Codex 完整闭环已经修复。
