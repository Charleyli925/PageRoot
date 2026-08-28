import { agentProviderError } from "../providers/agent-provider-contract.mjs";

export const QODER_MANAGED_RELEASE = Object.freeze({
  providerId: "qoder",
  runtimeId: "acp",
  displayName: "Qoder",
  securityProfile: "client-mediated",
  installable: true,
  distribution: Object.freeze({
    type: "npm",
    packageName: "@qoder-ai/qodercli",
    minVersion: "1.1.27",
    executableRelativePath: "package/bundle/qodercli.js",
    managedRelease: Object.freeze({
      version: "1.1.27",
      integrity: "sha512-3rWp/L831HRqVhWWiWPXL+VZr7PYjH8aFnVWhHJI6G7Yp8s97zfGlyNCUJd0OIO/LJIo9gb4gFy4eLShRQcZtA==",
      tarballUrl: "https://registry.npmjs.org/@qoder-ai/qodercli/-/qodercli-1.1.27.tgz",
    }),
  }),
});

export const SHIPPED_ACP_CATALOG = Object.freeze([QODER_MANAGED_RELEASE]);

export function catalogEntryByProviderId(providerId, entries = SHIPPED_ACP_CATALOG) {
  return entries.find((entry) => entry.providerId === providerId) || null;
}

export function assertInstallableCatalogEntry(entry, providerId) {
  if (!entry) {
    throw agentProviderError(
      "AGENT_PROVIDER_UNSUPPORTED",
      "The selected Agent is not in PageRoot's ACP catalog.",
      { status: 404 },
    );
  }
  if (entry.installable !== true || entry.distribution?.type !== "npm") {
    throw agentProviderError(
      "AGENT_INSTALL_UNSUPPORTED",
      "This Agent cannot be installed from PageRoot.",
      { status: 409 },
    );
  }
  if (entry.providerId !== providerId) {
    throw agentProviderError(
      "AGENT_SELECTION_UNSUPPORTED",
      "The requested Agent provider selection is unsupported.",
      { status: 409 },
    );
  }
  return entry;
}
