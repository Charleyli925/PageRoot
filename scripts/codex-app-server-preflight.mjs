import {
  codexInstallationDigest,
  createCodexProvider,
} from "../bridge/agent/providers/codex-provider.mjs";

const provider = createCodexProvider();

try {
  const installation = await provider.resolveInstallation({ environment: process.env });
  const evidence = await provider.preflight(installation, { environment: process.env });
  await provider.assertInstallationUnchanged(installation);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    providerId: provider.providerId,
    runtimeId: provider.runtimeId,
    securityProfile: provider.securityProfile,
    executionEnabled: provider.capabilities.execution,
    version: evidence.version,
    protocol: evidence.protocol,
    authMode: evidence.authMode,
    installationDigest: codexInstallationDigest(installation),
    models: evidence.models.map((model) => ({
      id: model.id,
      reasoningEfforts: model.reasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      isDefault: model.isDefault,
    })),
  }, null, 2)}\n`);
} catch (cause) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: String(cause?.code || "CODEX_PREFLIGHT_FAILED"),
    message: provider.preflightFailureMessage(cause?.code),
  })}\n`);
  process.exitCode = 1;
}
