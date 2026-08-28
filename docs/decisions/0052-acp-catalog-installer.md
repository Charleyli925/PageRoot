# ADR 0052: Product ACP catalog and managed installer

- Status: Accepted
- Date: 2026-08-28
- Scope: Bridge Agent discovery, on-demand ACP installation and shared ACP runtime

## Context

PageRoot already had a provider-neutral coordinator, a Qoder ACP path and a
bundled Codex App Server path. Renderer `AgentCatalogState` was a chooser plus
preflight cache, not an ACP registry. Qoder "install" copied an npm instruction.
The ACP runtime still defaulted to Qoder-specific task execution.

The product direction is a shared ACP client over a product allowlist, with
optional one-click install into a PageRoot-managed directory. This decision
does not introduce Native Agent / BYOK, `codex-acp`, a live public ACP Registry,
or deletion of the bundled Codex App Server.

## Decision

The Bridge owns the product ACP catalog. Shipped entries freeze `providerId`,
`runtimeId: "acp"`, `securityProfile`, distribution, `minVersion`,
`expectedAgentName` and a managed npm release (exact version plus
`dist.integrity`). This PR registers only Qoder as installable. Codex App
Server remains a bundled chooser item with `installable: false`.

Installation resolution is:

1. a user-installed CLI discovered by the existing PATH / npm prefix / version
   manager scan that passes current identity checks (`source: "user"`);
2. a verified layout already present under the PageRoot-managed agents root
   (`source: "managed"`);
3. no candidate → `not-installed`, which the UI may one-click install;
4. a discovered candidate that fails identity checks stays
   `invalid-installation`. It is not treated as missing and must not silently
   fall through to a managed copy (ADR 0032).

On-demand install writes only under Electron `userData/agents/<providerId>/<version>/`
(overridable with `HTML_AI_AGENTS_ROOT`). The installer fetches the catalog-pinned
tarball, checks `dist.integrity`, unpacks atomically, re-runs the existing
package layout/permission/name checks, and never spawns the user's global npm.
A failed install keeps the previous managed version. Abort and shutdown drain
must confirm cleanup. Renderer / preload still never see command, path or stderr.

`AgentCatalog` / `AgentInstaller` own the installed inventory, in-flight install
jobs and shutdown drain. The coordinator does not own install. Public HTTP adds
`installable`, `installSource` and `installState` to `GET /agent/providers`, plus
`POST /agent/install` (202) and `POST /agent/install/cancel`. Existing
preflight/start/cancel/availability shapes stay compatible.

The ACP runtime is the shared protocol plus process supervisor. Qoder retains
discovery, `--acp` launch, expected agent name and verified JS identity. Codex
now also uses this catalog/runtime (`docs/decisions/0053-codex-acp-adapter.md`);
the private App Server remains packaged-unregistered until it is deleted.

## Consequences

- Users who already have a valid independent Qoder CLI keep today's path.
- Users with no CLI can install a pinned managed copy without copying npm
  instructions. Login remains an interactive CLI copied into an Agent.
- Invalid local installations remain fail-closed.
- Package size does not drop in this PR; removing the bundled App Server is a
  later iteration.
