import { assertTrustedRendererEvent } from "../project-ipc-security.mjs";
import { runProjectIpcOperation } from "../export-copy.mjs";
import { durationBucket } from "../usage-telemetry.mjs";

export function createTrustedIpc({
  getMainWindow,
  isTrustedRendererUrl,
  captureUsage,
}) {
  const assertTrustedEvent = (event) => assertTrustedRendererEvent(event, {
    mainWindow: getMainWindow(),
    isTrustedRendererUrl,
  });
  const trusted = (handler) => async (event, ...args) => {
    assertTrustedEvent(event);
    return handler(...args);
  };
  const trustedProject = (handler, operationOverride) => async (event, ...args) => {
    const startedAt = Date.now();
    const operation = operationOverride || String(handler.name || "desktop_operation")
      .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .toLowerCase();
    const result = await runProjectIpcOperation(
      async () => {
        assertTrustedEvent(event);
        return handler(...args);
      },
      {
        onError: (error, normalized) => {
          console.error(
            `[project-ipc:${normalized.code}]`,
            error instanceof Error ? error.stack || error.message : String(error),
          );
        },
      },
    );
    const projectId = args.find((argument) => (
      argument
      && typeof argument === "object"
      && !Array.isArray(argument)
      && typeof argument.projectId === "string"
    ))?.projectId;
    let operationResult = "failure";
    if (result.ok) {
      operationResult = result.value === null ? "cancelled" : "success";
    }
    captureUsage(
      "operation_finished",
      {
        operation,
        result: operationResult,
        ...(result.ok ? {} : { error_code: result.error.code }),
        duration_bucket: durationBucket(Date.now() - startedAt),
      },
      { projectId },
    );
    return result;
  };

  return { assertTrustedEvent, trusted, trustedProject };
}
