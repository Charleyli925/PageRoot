import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";

async function writeSyntheticBridge(root) {
  const script = join(root, "synthetic-bridge.mjs");
  await writeFile(
    script,
    `import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const token = process.env.HTML_AI_BRIDGE_AUTH_TOKEN || "";
const mutationLog = process.env.BRIDGE_TEST_MUTATION_LOG || "";
const label = process.env.BRIDGE_TEST_LABEL || "default";
process.stdout.write("synthetic bridge " + label + "\\n");
const respond = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
const server = createServer((request, response) => {
  if (token && request.headers["x-html-ai-bridge-token"] !== token) {
    respond(response, 401, { error: "missing token" });
    return;
  }
  if (request.url === "/health") {
    respond(response, 200, { status: "ok" });
    return;
  }
  if (request.url === "/mutation") {
    appendFileSync(mutationLog, "mutation\\n");
    respond(response, 409, { error: "rejected once" });
    return;
  }
  respond(response, 404, { error: "not found" });
});
server.listen(Number(process.env.HTML_AI_BRIDGE_PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    "utf8",
  );
  return script;
}

test("Bridge test environments isolate roots, ports, logs, auth, and cleanup", async (t) => {
  const first = await createBridgeTestEnvironment(t, {
    environment: {
      HTML_AI_BRIDGE_AUTH_TOKEN: "first-synthetic-token",
    },
  });
  const second = await createBridgeTestEnvironment(t, {
    environment: {
      HTML_AI_BRIDGE_AUTH_TOKEN: "second-synthetic-token",
    },
  });
  const [firstScript, secondScript] = await Promise.all([
    writeSyntheticBridge(first.root),
    writeSyntheticBridge(second.root),
  ]);
  const mutationLog = join(first.root, "mutation.log");
  const [firstBridge, secondBridge] = await Promise.all([
    first.start({
      bridgeScript: firstScript,
      environment: {
        BRIDGE_TEST_MUTATION_LOG: mutationLog,
        BRIDGE_TEST_LABEL: "first",
      },
    }),
    second.start({
      bridgeScript: secondScript,
      environment: { BRIDGE_TEST_LABEL: "second" },
    }),
  ]);

  assert.notEqual(first.root, second.root);
  assert.notEqual(first.workspace, second.workspace);
  assert.notEqual(firstBridge.baseUrl, secondBridge.baseUrl);
  assert.notStrictEqual(firstBridge.logs, secondBridge.logs);
  assert.match(firstBridge.logs.stdout, /synthetic bridge first/);
  assert.doesNotMatch(firstBridge.logs.stdout, /synthetic bridge second/);
  assert.match(secondBridge.logs.stdout, /synthetic bridge second/);
  assert.doesNotMatch(secondBridge.logs.stdout, /synthetic bridge first/);
  assert.deepEqual((await firstBridge.requestJson("/health")).body, { status: "ok" });
  assert.deepEqual((await secondBridge.requestJson("/health")).body, { status: "ok" });

  const unauthenticated = await firstBridge.requestJson(
    "/health",
    undefined,
    { auth: false },
  );
  assert.equal(unauthenticated.response.status, 401);
  const wrongToken = await firstBridge.requestJson("/health", {
    headers: { "x-html-ai-bridge-token": "second-synthetic-token" },
  });
  assert.equal(wrongToken.response.status, 401);

  const mutation = await firstBridge.postJson("/mutation", { value: "once" });
  assert.equal(mutation.response.status, 409);
  assert.equal(await readFile(mutationLog, "utf8"), "mutation\n");

  await firstBridge.stop();
  await firstBridge.stop();
  await first.cleanup();
  await assert.rejects(access(first.root));
  assert.deepEqual((await secondBridge.requestJson("/health")).body, { status: "ok" });
});

test("Bridge test environment reports captured logs when a child exits before health", async (t) => {
  const environment = await createBridgeTestEnvironment(t);
  const script = join(environment.root, "early-exit-bridge.mjs");
  await writeFile(
    script,
    'process.stdout.write("synthetic stdout\\n"); process.stderr.write("synthetic stderr\\n"); process.exit(17);\n',
    "utf8",
  );

  await assert.rejects(
    environment.start({ bridgeScript: script }),
    /Bridge exited with 17[\s\S]*synthetic stdout[\s\S]*synthetic stderr/,
  );
});
