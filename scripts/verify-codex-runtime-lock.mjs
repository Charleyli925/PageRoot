import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveBundledCodexInstallation } from "../bridge/agent/providers/codex-provider.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyCodexRuntimeLock({
  root = repositoryRoot,
  environment = process.env,
} = {}) {
  const runtimeLock = JSON.parse(await readFile(
    path.join(root, "schemas", "codex-app-server.runtime-lock.json"),
    "utf8",
  ));
  const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const packageRecord = packageLock?.packages?.["node_modules/@openai/codex"];
  if (
    runtimeLock.schemaVersion !== 1
    || runtimeLock.package !== "@openai/codex"
    || packageRecord?.version !== runtimeLock.version
    || packageRecord?.integrity !== runtimeLock.npmIntegrity
  ) {
    throw new Error("Codex package lock does not match the reviewed runtime lock.");
  }
  const installation = await resolveBundledCodexInstallation({ resourcesRoot: root });
  if (
    installation.version !== runtimeLock.version
    || !runtimeLock.supportedTargets.includes(installation.target)
  ) {
    throw new Error("Bundled Codex runtime target does not match the reviewed runtime lock.");
  }
  const output = await mkdtemp(path.join(os.tmpdir(), "codex-schema-verification-"));
  const childEnvironment = { ...environment };
  delete childEnvironment.APP_SERVER_LOGS;
  delete childEnvironment.CODEX_APP_SERVER_LOGS;
  let schema;
  let completeSchema;
  try {
    await execFileAsync(
      installation.command,
      ["app-server", "generate-json-schema", "--out", output],
      {
        cwd: installation.packageRoot,
        env: childEnvironment,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    [schema, completeSchema] = await Promise.all([
      readFile(path.join(output, "codex_app_server_protocol.v2.schemas.json")),
      readFile(path.join(output, "codex_app_server_protocol.schemas.json")),
    ]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
  const actualSchema = digest(schema);
  const actualCompleteSchema = digest(completeSchema);
  if (
    actualSchema !== runtimeLock.schemaSha256
    || actualCompleteSchema !== runtimeLock.completeSchemaSha256
  ) {
    throw new Error("Generated Codex App Server schema differs from the reviewed fingerprint.");
  }
  return Object.freeze({
    version: installation.version,
    target: installation.target,
    schemaSha256: actualSchema,
    completeSchemaSha256: actualCompleteSchema,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyCodexRuntimeLock();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
