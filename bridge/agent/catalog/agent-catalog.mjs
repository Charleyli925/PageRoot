import { lstat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { agentProviderError } from "../providers/agent-provider-contract.mjs";
import { createAgentInstaller } from "./agent-installer.mjs";
import { createAgentAccessAuth } from "./agent-access-auth.mjs";
import {
  ACCESS_OPERATION_TERMINAL_STATES,
  accessOperationFromInstallSnapshot,
  pickActiveAccessOperation,
  publicAccessOperation,
} from "../../../shared/agent-access-operation.mjs";
import {
  SHIPPED_ACP_CATALOG,
  assertInstallableCatalogEntry,
  catalogEntryByProviderId,
} from "./qoder-managed-release.mjs";

export const INSTALL_SOURCES = Object.freeze(["user", "managed", "none"]);
export const INSTALL_STATES = Object.freeze(["idle", "installing", "failed", "cancelling"]);

export function defaultAgentsRoot(environment = process.env) {
  const configured = String(environment.HTML_AI_AGENTS_ROOT || "").trim();
  if (configured) return path.resolve(configured);
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "PageRoot", "agents");
  }
  return path.join(os.homedir(), ".pageroot", "agents");
}

function publicInstallState(snapshot) {
  if (!snapshot) return "idle";
  return INSTALL_STATES.includes(snapshot.installState) ? snapshot.installState : "failed";
}

export function createAgentCatalog({
  agentsRoot = defaultAgentsRoot(),
  entries = SHIPPED_ACP_CATALOG,
  installer,
  installerOptions = {},
  authenticator,
} = {}) {
  if (typeof agentsRoot !== "string" || !path.isAbsolute(agentsRoot)) {
    throw new TypeError("Agent catalog requires an absolute agentsRoot.");
  }
  const catalogEntries = Object.freeze([...entries]);
  const agentInstaller = installer || createAgentInstaller({
    agentsRoot,
    ...installerOptions,
  });
  const agentAuth = authenticator || createAgentAccessAuth();
  let loginExecutor = null;
  let logoutExecutor = null;

  function entryFor(providerId) {
    return catalogEntryByProviderId(providerId, catalogEntries);
  }

  return {
    agentsRoot,
    bindLoginExecutor(executor) {
      loginExecutor = executor;
    },
    bindLogoutExecutor(executor) {
      logoutExecutor = executor;
    },
    entries() {
      return catalogEntries;
    },
    entry(providerId) {
      return entryFor(providerId);
    },
    installerSnapshot(providerId) {
      return agentInstaller.snapshot(providerId);
    },
    loginSnapshot(providerId) {
      return agentAuth.snapshot(providerId);
    },
    loginUrl(providerId) {
      return agentAuth.loginUrl(providerId);
    },
    accessOperation(providerId) {
      return agentAuth.accessOperation(providerId);
    },
    publicProvider(provider, {
      installSource = "none",
    } = {}) {
      const entry = entryFor(provider.providerId);
      const snapshot = agentInstaller.snapshot(provider.providerId);
      const login = agentAuth.snapshot(provider.providerId);
      const loginOperation = agentAuth.accessOperation(provider.providerId);
      const installOperation = accessOperationFromInstallSnapshot(snapshot);
      const activeOperation = pickActiveAccessOperation(installOperation, loginOperation);
      const lastOperation = [loginOperation, installOperation]
        .map((operation) => publicAccessOperation(operation))
        .filter(Boolean)
        .find((operation) => ACCESS_OPERATION_TERMINAL_STATES.includes(operation.state));
      return Object.freeze({
        providerId: provider.providerId,
        displayName: provider.displayName,
        runtimeId: provider.runtimeId,
        capabilities: provider.capabilities,
        installable: entry?.installable === true,
        installSource: INSTALL_SOURCES.includes(installSource) ? installSource : "none",
        installState: publicInstallState(snapshot),
        connection: login.loginState === "succeeded" && login.authSource
          ? Object.freeze({
            authSource: login.authSource,
            authScope: login.authScope,
            accountSummary: null,
          })
          : null,
        loginUrlPresent: login.loginUrlPresent === true,
        activeOperation,
        lastOperation: activeOperation ? null : lastOperation || null,
      });
    },
    async managedCommandCandidates(providerId) {
      const entry = entryFor(providerId);
      if (!entry?.installable) return [];
      const providerRoot = path.join(agentsRoot, providerId);
      const versions = await readdir(providerRoot).catch((cause) => {
        if (cause?.code === "ENOENT") return [];
        throw cause;
      });
      const candidates = [];
      for (const version of versions) {
        const command = path.join(providerRoot, version, entry.distribution.executableRelativePath);
        const information = await lstat(command).catch(() => null);
        if (information?.isFile()) candidates.push(command);
      }
      return candidates;
    },
    async install(providerId, options) {
      const entry = assertInstallableCatalogEntry(entryFor(providerId), providerId);
      return agentInstaller.install(entry, options);
    },
    cancelInstall(providerId) {
      if (!entryFor(providerId)) {
        throw agentProviderError(
          "AGENT_PROVIDER_UNSUPPORTED",
          "The selected Agent is not in PageRoot's ACP catalog.",
          { status: 404 },
        );
      }
      return agentInstaller.cancel(providerId);
    },
    login(providerId) {
      if (typeof loginExecutor !== "function") {
        throw agentProviderError(
          "AGENT_LOGIN_UNSUPPORTED",
          "This Agent cannot start an official login.",
          { status: 409 },
        );
      }
      return agentAuth.login(providerId, (context) => loginExecutor(providerId, context));
    },
    waitLogin(providerId) {
      return agentAuth.wait(providerId);
    },
    cancelLogin(providerId) {
      return agentAuth.cancel(providerId);
    },
    async logout(providerId) {
      if (typeof logoutExecutor !== "function") {
        throw agentProviderError(
          "AGENT_LOGOUT_UNSUPPORTED",
          "This Agent cannot sign out from the official account.",
          { status: 409 },
        );
      }
      await agentAuth.cancel(providerId);
      const result = await logoutExecutor(providerId);
      agentAuth.clearAuth(providerId);
      return result;
    },
    drain(options) {
      return Promise.all([
        agentInstaller.drain(options),
        agentAuth.drain(options),
      ]).then(([installOk, authOk]) => installOk === true && authOk === true);
    },
  };
}
