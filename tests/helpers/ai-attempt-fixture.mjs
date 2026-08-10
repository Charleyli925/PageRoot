import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const finalizerScript = join(productRoot, "scripts", "finalize-attempt.mjs");
const attemptOutputPathPattern = /^output\/(?:V1\.\d+|[^\u0000-\u001f\u007f/\\\\]+-V1\.\d+)\.html$/u;

function assertRunIdentity(run) {
  for (const key of ["projectId", "requestId", "attemptId"]) {
    if (!run?.[key] || typeof run[key] !== "string") {
      throw new TypeError(`Attempt fixture requires a string ${key}`);
    }
  }
}

/**
 * Sends an explicit Request body without adding targets, identity, assertions,
 * retries, or any completion metadata on the test's behalf.
 */
export function submitRequest(bridge, request, requestOptions) {
  return bridge.postJson("/request", request, undefined, requestOptions);
}

/**
 * Writes only the product-selected Attempt HTML artifact under output/.
 * Historic Attempts use output/index.html; current Attempts use the frozen
 * original-name-plus-Version file selected by PageRoot.
 */
export async function writeAttemptOutput(run, html) {
  assertRunIdentity(run);
  if (typeof run.attemptPath !== "string" || typeof run.outputPath !== "string") {
    throw new TypeError("Attempt fixture requires attemptPath and outputPath");
  }
  const outputRelativePath = relative(run.attemptPath, run.outputPath);
  if (
    outputRelativePath !== join("output", "index.html")
    && !attemptOutputPathPattern.test(outputRelativePath)
  ) {
    throw new Error(
      `Attempt fixture may only write the product-selected output HTML, received ${outputRelativePath}`,
    );
  }
  await writeFile(run.outputPath, html, "utf8");
  return run.outputPath;
}

/**
 * Invokes the product's official finalizer. It never creates or edits a
 * completion record itself, so malformed/missing-finalizer tests stay real.
 */
export function runOfficialFinalizer(workspace, run, overrides = {}) {
  assertRunIdentity(run);
  return execFileAsync(
    process.execPath,
    [
      finalizerScript,
      "--workspace",
      workspace,
      "--project-id",
      overrides.projectId ?? run.projectId,
      "--request-id",
      overrides.requestId ?? run.requestId,
      "--attempt-id",
      overrides.attemptId ?? run.attemptId,
    ],
    {
      env: {
        ...process.env,
        ...(overrides.environment || {}),
      },
    },
  );
}

export function readStatus(bridge, { sourcePath, requestId, attemptId }, requestOptions) {
  if (!sourcePath || !requestId || !attemptId) {
    throw new TypeError("Attempt status requires sourcePath, requestId, and attemptId");
  }
  return bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${encodeURIComponent(requestId)}&attemptId=${encodeURIComponent(attemptId)}`,
    undefined,
    requestOptions,
  );
}
