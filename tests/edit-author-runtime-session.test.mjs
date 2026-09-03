import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
} from "../app/domain/edit-runtime-contract.js";
import {
  EditAuthorRuntimeSession,
} from "../app/application/edit-author-runtime-session.js";

const HTML = [
  "<!doctype html><html><body>",
  '<main id="chart-host" style="width:640px;height:360px"></main>',
  '<script>echarts.init(document.querySelector("#chart-host"))</script>',
  "</body></html>",
].join("");
const SOURCE_SHA = "sha256:" + "a".repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function success(request, overrides = {}) {
  return {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: "0123456789abcdef0123456789abcdef",
    executionId: "abcdefabcdefabcdefabcdef",
    sourceSha256: request.sourceSha256,
    resourceSha256: "sha256:" + "b".repeat(64),
    documentBasePath: "/",
    scriptCount: 1,
    byteLength: 96,
    canvasGeneration: request.canvasGeneration,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    html: HTML,
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
    sourcePath: "/Users/demo/report.html",
    sourceIsAuthoritative: true,
    ...overrides,
  };
}

let runtimeAttemptSequence = 0;
const runtimeAttempts = new WeakMap();

function beginRuntime(session, grant, overrides = {}) {
  const attempt = {
    candidateId: `runtime-test-${(++runtimeAttemptSequence).toString(36)}`,
    candidateGeneration: runtimeAttemptSequence,
    candidateSourceRevision: grant.sourceSha256,
    ...overrides,
  };
  runtimeAttempts.set(session, attempt);
  return session.beginRuntime({ ...grant, ...attempt });
}

function settleRuntime(
  session,
  grant,
  outcome,
  attempt = runtimeAttempts.get(session),
  settlement = {},
) {
  return session.settleRuntime({ ...grant, ...attempt, outcome, ...settlement });
}

test("one canvas generation prepares at most once despite source and autosave changes", async () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  assert.equal(session.snapshot.phase, "preparing");
  assert.equal(requests.length, 0, "preparation waits for the committed loading surface");
  assert.equal(session.startPreparation(input()), true);
  session.refresh(input({
    html: HTML + "<!-- autosave changed source -->",
    sourceSha256: "sha256:" + "c".repeat(64),
  }));
  session.refresh(input({
    html: HTML + "<!-- later autosave -->",
    sourceSha256: "sha256:" + "d".repeat(64),
  }));
  await flushAsync();

  assert.equal(requests.length, 1);
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.grant?.canvasGeneration, 4);
});

test("authority confirmation prepares once within the same source and canvas identity", async () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input({ sourceIsAuthoritative: false }));
  assert.equal(requests.length, 0);
  assert.equal(session.snapshot.phase, "static");
  assert.equal(session.snapshot.lastOutcome, "source-not-authoritative");

  session.refresh(input({ sourceIsAuthoritative: true }));
  assert.equal(session.snapshot.phase, "preparing");
  assert.equal(requests.length, 0);
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();

  assert.equal(requests.length, 1);
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.grant?.canvasGeneration, 4);

  session.refresh(input({
    html: HTML + "<!-- ordinary source echo -->",
    sourceSha256: "sha256:" + "c".repeat(64),
  }));
  await flushAsync();
  assert.equal(requests.length, 1);
});

test("macOS /var aliases preserve a started preparation identity", async () => {
  const pending = deferred();
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: (request) => {
        requests.push(request);
        return pending.promise;
      },
      revoke: async () => {},
    },
  });
  const temporaryPath = "/var/folders/example/pageroot/report-V1.html";
  const privateTemporaryPath = "/private/var/folders/example/pageroot/report-V1.html";

  session.refresh(input({ sourcePath: temporaryPath }));
  assert.equal(session.startPreparation(input({ sourcePath: temporaryPath })), true);
  assert.equal(requests.length, 1);

  // Main canonicalizes through realpath(), while renderer state can still
  // carry the /var spelling. This is the same file and canvas, not a retry.
  session.refresh(input({ sourcePath: privateTemporaryPath }));
  assert.equal(session.snapshot.phase, "preparing");
  assert.equal(
    session.startPreparation(input({ sourcePath: privateTemporaryPath })),
    false,
  );
  assert.equal(requests.length, 1);

  pending.resolve(success(requests[0]));
  await flushAsync();
  assert.equal(session.snapshot.phase, "ready");
});

test("a managed source transition publishes its distinct preparation path", () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async () => null,
      revoke: async () => {},
    },
  });
  const observedPreparationPaths = [];
  session.subscribe((snapshot) => {
    if (snapshot.phase === "preparing") {
      observedPreparationPaths.push(snapshot.sourcePath);
    }
  });
  const externalPath = "/Users/demo/report.html";
  const managedPath = "/var/folders/example/project-files/report/report-V1.html";

  session.refresh(input({ sourcePath: externalPath }));
  session.refresh(input({ sourcePath: managedPath }));

  assert.equal(session.snapshot.phase, "preparing");
  assert.equal(session.snapshot.sourcePath, managedPath);
  assert.deepEqual(observedPreparationPaths, [externalPath, managedPath]);
});

test("late preparation from an old generation is revoked and cannot publish", async () => {
  const oldRequest = deferred();
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: () => oldRequest.promise,
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  session.refresh(input({
    canvasGeneration: 5,
    sourceSha256: "sha256:" + "e".repeat(64),
  }));
  oldRequest.resolve(success({
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
    hosts: [{
      key: "edit-runtime-1",
      path: [1, 0],
      tagName: "main",
      identityAttributes: [["id", "chart-host"]],
    }],
  }));
  await flushAsync();

  assert.notEqual(session.snapshot.canvasGeneration, 4);
  assert.deepEqual(revoked, ["0123456789abcdef0123456789abcdef"]);
});

test("settled runtime grant can render another disposable frame", async () => {
  const requests = [];
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "ready"), true);
  assert.equal(session.snapshot.phase, "settled");
  session.refresh(input({
    html: HTML + "<!-- comment changed nothing in canvas key -->",
    sourceSha256: "sha256:" + "f".repeat(64),
  }));

  assert.equal(requests.length, 1);
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "ready"), true);
  assert.deepEqual(revoked, []);
});

test("a superseded disposable frame keeps the shared runtime grant alive", async () => {
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request),
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "ready"), true);
  assert.equal(session.snapshot.phase, "settled");

  assert.equal(beginRuntime(session, grant), true);
  assert.equal(
    settleRuntime(session, grant, "superseded", undefined, {
      preserveLastKnownGood: true,
    }),
    true,
  );
  assert.equal(session.snapshot.phase, "settled");
  assert.equal(session.snapshot.grant?.sessionId, grant.sessionId);
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "ready"), true);
  assert.equal(session.snapshot.phase, "settled");
  assert.deepEqual(revoked, []);
});

test("an old candidate callback cannot settle a newer running attempt", async () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request),
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  assert.equal(beginRuntime(session, grant), true);
  const oldAttempt = runtimeAttempts.get(session);
  assert.equal(beginRuntime(session, grant), true);
  const latestAttempt = runtimeAttempts.get(session);

  assert.notEqual(oldAttempt.candidateId, latestAttempt.candidateId);
  assert.equal(settleRuntime(session, grant, "failed", oldAttempt), false);
  assert.equal(session.snapshot.phase, "running");
  assert.equal(settleRuntime(session, grant, "ready", latestAttempt), true);
  assert.equal(session.snapshot.phase, "settled");
});

test("a real candidate failure after supersession preserves last-known-good", async () => {
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request),
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  beginRuntime(session, grant);
  settleRuntime(session, grant, "ready");
  beginRuntime(session, grant);
  settleRuntime(session, grant, "superseded", undefined, {
    preserveLastKnownGood: true,
  });
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "failed", undefined, {
    preserveLastKnownGood: true,
  }), true);
  assert.equal(session.snapshot.phase, "settled");
  assert.equal(session.snapshot.lastOutcome, "candidate-failed");
  assert.deepEqual(revoked, []);
});

test("a remounted controller cannot preserve a session-only last-known-good", async () => {
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request),
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  beginRuntime(session, grant);
  settleRuntime(session, grant, "ready");
  assert.equal(session.snapshot.phase, "settled");

  // A same-generation Canvas remount creates a fresh physical controller.
  // Its first candidate has no old iframe even though the application phase
  // previously observed a successful Runtime.
  beginRuntime(session, grant);
  assert.equal(settleRuntime(session, grant, "failed", undefined, {
    preserveLastKnownGood: false,
  }), true);

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "runtime-failed");
  assert.deepEqual(revoked, [grant.sessionId]);
});

test("an equivalent canvas generation carries runtime failure until explicit retry", async () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  beginRuntime(session, grant);
  settleRuntime(session, grant, "failed");
  assert.equal(session.snapshot.phase, "static-fallback");

  session.refresh(input({ canvasGeneration: 5 }));
  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.canvasGeneration, 5);
  assert.equal(session.snapshot.lastOutcome, "runtime-failed");
  assert.equal(requests.length, 1);
  assert.equal(session.startPreparation(input({ canvasGeneration: 5 })), false);

  assert.equal(session.retry(), true);
  assert.equal(session.startPreparation(input({ canvasGeneration: 5 })), true);
  await flushAsync();
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(requests.length, 2);
});

test("an equivalent canvas keeps runtime failure through an authority wait", async () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  beginRuntime(session, grant);
  settleRuntime(session, grant, "failed");

  session.refresh(input({ canvasGeneration: 5, sourceIsAuthoritative: false }));
  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.canvasGeneration, 5);
  session.refresh(input({ canvasGeneration: 5, sourceIsAuthoritative: true }));
  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "runtime-failed");
  assert.equal(requests.length, 1);
});

test("the first successful compatible runtime locks the canvas without recovery", async () => {
  let recoveries = 0;
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request, {
        resourceMode: "compatible",
        recoveryAvailable: true,
        libraryOrigins: ["bundled-compatible", "inline"],
      }),
      recover: async () => {
        recoveries += 1;
        return null;
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.equal(grant?.resourceMode, "compatible");
  assert.equal(beginRuntime(session, grant), true);
  assert.equal(settleRuntime(session, grant, "ready"), true);
  await flushAsync();

  assert.equal(session.snapshot.phase, "settled");
  assert.equal(session.snapshot.grant?.sessionId, grant.sessionId);
  assert.equal(recoveries, 0);
});

test("a failed compatible runtime consumes one exact recovery and then becomes the winner", async () => {
  const exact = deferred();
  const revoked = [];
  let recoveries = 0;
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request, {
        resourceMode: "compatible",
        recoveryAvailable: true,
        libraryOrigins: ["bundled-compatible", "inline"],
      }),
      recover: async () => {
        recoveries += 1;
        return exact.promise;
      },
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();
  const compatible = session.snapshot.grant;
  assert.ok(compatible);
  assert.equal(beginRuntime(session, compatible), true);
  assert.equal(settleRuntime(session, compatible, "failed"), true);
  assert.equal(session.snapshot.phase, "recovering");
  assert.equal(session.snapshot.grant, null);
  assert.equal(recoveries, 1);
  assert.equal(
    settleRuntime(session, compatible, "failed"),
    false,
  );

  exact.resolve(success({
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
  }, {
    sessionId: "11111111111111111111111111111111",
    executionId: "222222222222222222222222",
    resourceSha256: "sha256:" + "c".repeat(64),
    resourceMode: "exact",
    libraryOrigins: ["network", "inline"],
  }));
  await flushAsync();

  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.grant?.resourceMode, "exact");
  assert.equal(session.snapshot.lastOutcome, "recovery-ready");
  assert.deepEqual(revoked, [compatible.sessionId]);
  assert.equal(recoveries, 1);
});

test("a stale exact recovery is revoked after the canvas generation changes", async () => {
  const exact = deferred();
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request, {
        resourceMode: "compatible",
        recoveryAvailable: true,
      }),
      recover: async () => exact.promise,
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const compatible = session.snapshot.grant;
  beginRuntime(session, compatible);
  settleRuntime(session, compatible, "rejected");
  session.refresh(input({
    canvasGeneration: 5,
    sourceSha256: "sha256:" + "d".repeat(64),
  }));

  exact.resolve(success({
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
  }, {
    sessionId: "33333333333333333333333333333333",
    executionId: "444444444444444444444444",
    resourceMode: "exact",
  }));
  await flushAsync();

  assert.notEqual(session.snapshot.canvasGeneration, 4);
  assert.deepEqual(revoked, [
    compatible.sessionId,
    "33333333333333333333333333333333",
  ]);
});

test("an unavailable compatible recovery terminates in static fallback", async () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request, {
        resourceMode: "compatible",
        recoveryAvailable: true,
      }),
      recover: async () => {
        throw new Error("exact bytes unavailable");
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const compatible = session.snapshot.grant;
  beginRuntime(session, compatible);
  settleRuntime(session, compatible, "failed");
  await flushAsync();

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "recovery-failed");
});

test("failed preparation reaches an explicit static fallback", async () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async () => null,
      revoke: async () => {},
    },
  });

  session.refresh(input());
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.grant, null);
  assert.equal(session.snapshot.lastOutcome, "prepare-failed");
  assert.equal(session.snapshot.retryAvailable, true);
});

test("a deterministic runtime rejection does not offer an ineffective retry", async () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => success(request),
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  beginRuntime(session, grant);
  settleRuntime(session, grant, "rejected");

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "rejected");
  assert.equal(session.snapshot.retryAvailable, false);
  assert.equal(session.retry(), false);
});

test("static fallback can retry preparation and disappear after success", async () => {
  let attempts = 0;
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        attempts += 1;
        return attempts === 1 ? null : success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.startPreparation(input());
  await flushAsync();
  assert.equal(session.snapshot.phase, "static-fallback");

  assert.equal(session.retry(), true);
  assert.equal(session.snapshot.phase, "preparing");
  assert.equal(session.startPreparation(input()), true);
  await flushAsync();
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.lastOutcome, null);
});

test("an unsupported authored program publishes static fallback before preparation", () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input({ html: "<!doctype html><html><body><script>unfinished" }));

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "unsupported-program");
  assert.equal(session.snapshot.retryAvailable, false);
  assert.equal(session.retry(), false);
  assert.equal(requests.length, 0);
});

test("a relative module import is classified as unsupported before preparation", () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input({
    html: "<!doctype html><html><body><script type=\"module\">import value from './module.js';</script></body></html>",
  }));

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "unsupported-program");
  assert.equal(session.snapshot.retryAvailable, false);
  assert.deepEqual(requests, []);
});

test("desktop-unavailable static fallback does not offer an ineffective retry", () => {
  const session = new EditAuthorRuntimeSession();

  session.refresh(input());

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.lastOutcome, "desktop-unavailable");
  assert.equal(session.snapshot.retryAvailable, false);
  assert.equal(session.retry(), false);
});

test("ordinary, Canvas and SVG scripts use the same preparation owner", async () => {
  for (const visualProgram of [
    'document.querySelector("#chart-host").addEventListener("click", () => {})',
    'document.querySelector("#chart-host").append(document.createElement("canvas"))',
    'document.querySelector("#chart-host").setAttribute("viewBox", "0 0 10 10")',
  ]) {
    const requests = [];
    const session = new EditAuthorRuntimeSession({
      port: {
        prepare: async (request) => {
          requests.push(request);
          return success(request);
        },
        revoke: async () => {},
      },
    });
    const html = HTML.replace(
      '<main id="chart-host" style="width:640px;height:360px"></main>',
      visualProgram.includes("viewBox")
        ? '<svg id="chart-host" style="width:640px;height:360px"></svg>'
        : '<main id="chart-host" style="width:640px;height:360px"></main>',
    ).replace(
      'echarts.init(document.querySelector("#chart-host"))',
      visualProgram,
    );
    session.refresh(input({ html }));
    assert.equal(session.snapshot.phase, "preparing");
    assert.equal(session.startPreparation(input({ html })), true);
    await flushAsync();
    assert.equal(requests.length, 1);
    assert.equal(session.snapshot.phase, "ready");
  }
});
