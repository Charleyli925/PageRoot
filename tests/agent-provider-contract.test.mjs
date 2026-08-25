import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentBridgeService,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../scripts/agent-bridge-service.mjs";
import { createProviderRegistry } from "../scripts/agent/providers/provider-registry.mjs";
import { createRuntimeRegistry } from "../scripts/agent/runtimes/runtime-registry.mjs";
import {
  classifyQoderRunFailure,
  normalizedQoderPreflightError,
} from "../scripts/agent/providers/qoder-provider.mjs";
import { createSyntheticQoderProviderFixture } from "./fixtures/agent-provider/qoder-provider.mjs";

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_provider_contract_001",
  attemptId: "attempt_provider_contract_001",
  sourcePath: "/synthetic/project/page.html",
});

function fixtureRegistry(options) {
  const fixture = createSyntheticQoderProviderFixture(options);
  return {
    fixture,
    registry: createProviderRegistry({
      providers: [fixture.provider],
      runtimeRegistry: createRuntimeRegistry([fixture.runtime]),
    }),
  };
}

test("legacy qoder-acp dispatch resolves once to the qoder provider and ACP runtime", async () => {
  const { fixture, registry } = fixtureRegistry();
  const prepared = await registry.preflight({ driver: "qoder-acp", environment: {} });

  assert.equal(prepared.driver, "qoder-acp");
  assert.equal(prepared.providerId, "qoder");
  assert.equal(prepared.runtimeId, "acp");
  assert.match(prepared.installationDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(prepared.capabilities, fixture.capabilities);
  assert.deepEqual(prepared.evidence.models, [
    { id: "Synthetic-Model", displayName: "Synthetic-Model" },
  ]);

  const ticket = Object.freeze({
    ...prepared,
    preflightId: "preflight_fixture",
    createdAt: 1,
    expiresAt: 2,
  });
  await registry.verifyTicket(ticket);
  await registry.run(ticket, {
    policy: Object.freeze({ requestRoot: "/synthetic/request" }),
    prompt: "Synthetic prompt",
    baseEnvironment: {},
    onEvent: () => {},
  });
  assert.deepEqual(fixture.calls, [
    "provider:resolve-installation",
    "provider:preflight",
    "provider:verify-installation",
    "provider:verify-installation",
    "provider:create-launch",
    "runtime:run",
  ]);
});

test("unknown provider, runtime, and legacy driver fail closed", async () => {
  const { fixture, registry } = fixtureRegistry();
  assert.throws(
    () => registry.resolveDriver("unknown-driver"),
    (error) => error?.code === "AGENT_DRIVER_UNSUPPORTED",
  );
  assert.throws(
    () => createRuntimeRegistry([fixture.runtime]).resolve("unknown-runtime"),
    (error) => error?.code === "AGENT_RUNTIME_UNSUPPORTED",
  );
  assert.throws(
    () => registry.resolveTicket({
      driver: "qoder-acp",
      providerId: "unknown-provider",
      runtimeId: "acp",
      installationDigest: `sha256:${"a".repeat(64)}`,
      capabilities: fixture.capabilities,
    }),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
});

test("Bridge keeps the legacy HTTP projection while tickets remain provider/runtime bound", async (t) => {
  const { fixture, registry } = fixtureRegistry();
  const service = new AgentBridgeService({
    providerRegistry: registry,
    resolveTask: async () => ({
      run: {
        ...IDENTITY,
        status: "processing",
        requestPath: "/synthetic/project/.pageroot/requests/req_provider_contract_001",
        promptPath: "/synthetic/request/PROMPT.md",
        outputPath: "/synthetic/request/output/candidate.html",
        completionPath: "/synthetic/request/completion.json",
      },
      request: {
        request: {
          agentDelivery: {
            mode: "qoder-acp",
            trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
          },
        },
      },
    }),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "synthetic-lease", ownerToken }),
      release: async () => true,
    },
  });
  t.after(() => service.dispose());

  assert.deepEqual(await service.availability(), {
    ok: true,
    status: "ready",
    driver: "qoder-acp",
  });
  const ready = await service.preflight({
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal(ready.driver, "qoder-acp");
  assert.equal(ready.agentVersion, "1.1.27");
  assert.equal(ready.modelCount, 1);
  for (const internal of ["providerId", "runtimeId", "installation", "installationDigest", "capabilities"]) {
    assert.equal(internal in ready, false, `${internal} must stay Bridge-internal`);
  }

  const started = await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ready.preflightId,
  });
  assert.equal(started.accepted, true);
  assert.equal(started.session.driver, "qoder-acp");
  for (const internal of ["providerId", "runtimeId", "installation", "installationDigest", "capabilities"]) {
    assert.equal(internal in started.session, false, `${internal} must stay out of session status`);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "completed");
  assert.ok(fixture.calls.includes("runtime:run"));
});

test("Qoder raw failures retain the golden authentication and capacity classes", () => {
  assert.equal(
    normalizedQoderPreflightError(Object.assign(new Error("private install detail"), {
      code: "ENOENT",
    })).code,
    "QODER_COMMAND_UNTRUSTED",
  );
  assert.equal(
    classifyQoderRunFailure({ qoderStderr: "Please sign in before continuing" }),
    "QODER_AUTH_REQUIRED",
  );
  assert.equal(
    classifyQoderRunFailure({ qoderStderr: "Credit usage limit. Upgrade your subscription plan." }),
    "QODER_ACCOUNT_CAPACITY_UNAVAILABLE",
  );
});
