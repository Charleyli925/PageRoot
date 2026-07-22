import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

let controllerBundle = "";

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: path.join(productRoot, "app/components/NativeEditingController.ts"),
        name: "PageRootNativeController",
        formats: ["iife"],
        fileName: () => "native-editing-controller.js",
      },
    },
  });
  const output = (Array.isArray(result)
    ? result.flatMap((entry) => entry.output)
    : result.output
  ).find((entry) => entry.type === "chunk");
  if (!output || output.type !== "chunk") {
    throw new Error("NativeEditingController test bundle was not generated.");
  }
  controllerBundle = output.code;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="native-host">hello</div>');
  await page.addScriptTag({ content: controllerBundle });
  await page.evaluate(() => {
    const host = document.querySelector("#native-host");
    if (!(host instanceof HTMLElement)) throw new Error("Native test host is missing.");
    const initialLease = {
      sessionId: "controller-policy-session",
      domGeneration: 4,
      sourceRevision: "revision-1",
      hostId: "native-host",
    };
    const leaseMatches = (left, right) => Boolean(
      left
      && right
      && left.sessionId === right.sessionId
      && left.domGeneration === right.domGeneration
      && left.sourceRevision === right.sourceRevision
      && left.hostId === right.hostId,
    );
    const setCaret = (offset) => {
      const text = host.firstChild;
      if (!(text instanceof Text)) throw new Error("Native test text is missing.");
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    setCaret(5);

    const harness = {
      currentLease: { ...initialLease },
      errors: [],
      pendingReadyCount: 0,
      setCaret,
    };
    const nativeControllerModule = window.PageRootNativeController;
    if (!nativeControllerModule?.NativeEditingController) {
      throw new Error("NativeEditingController test module is missing.");
    }
    const controller = new nativeControllerModule.NativeEditingController({
      hostElement: host,
      baseline: {
        revision: initialLease.sourceRevision,
        text: "hello",
        selection: { anchor: 5, focus: 5, affinity: "right" },
      },
      lease: {
        stamp: initialLease,
        isCurrent: (candidate) => leaseMatches(candidate, harness.currentLease),
        advance: (expected, next) => {
          if (!leaseMatches(expected, harness.currentLease)) return false;
          harness.currentLease = { ...next };
          return true;
        },
      },
      onError: (error) => harness.errors.push(error.message),
      onPendingCommandReady: () => {
        harness.pendingReadyCount += 1;
      },
    });
    window.__PAGEROOT_CONTROLLER_POLICY__ = { controller, harness, host };
  });
});

test("the strict transaction remains the first checkpoint authority", async ({ page }) => {
  const checkpoint = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "!",
      inputType: "insertText",
    }));
    host.firstChild.data = "hello!";
    harness.setCaret(6);
    host.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "!",
      inputType: "insertText",
    }));
    return controller.captureCheckpoint("automatic");
  });

  expect(checkpoint).toMatchObject({
    ok: true,
    checkpoint: {
      authority: "strict",
      previousText: "hello",
      nextText: "hello!",
      replacements: [{
        startOffset: 5,
        endOffset: 5,
        beforeText: "",
        nextText: "!",
      }],
    },
  });
});

test("automatic checkpoint cannot authorize a stable missing-terminal composition", async ({ page }) => {
  const immediate = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello你";
    harness.setCaret(6);
    host.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
    return {
      queued: controller.queuePendingCommand({
        kind: "save",
        authority: "user-explicit",
      }),
      checkpoint: controller.captureCheckpoint("save"),
      taken: controller.takePendingCommand(),
      guard: controller.getBlockDraftSnapshot().compositionGuard,
    };
  });

  expect(immediate).toMatchObject({
    queued: { queued: true, sequence: 1 },
    checkpoint: { ok: false, reason: "composing" },
    taken: null,
    guard: {
      phase: "settling",
      stableObservationCount: 0,
      fallbackAuthorized: false,
    },
  });

  await expect.poll(() => page.evaluate(() => {
    const { controller } = window.__PAGEROOT_CONTROLLER_POLICY__;
    return controller.getBlockDraftSnapshot().compositionGuard;
  })).toMatchObject({
    phase: "stable",
    stableObservationCount: 2,
    fallbackAuthorized: true,
  });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.harness.pendingReadyCount
  ))).toBe(1);

  const automatic = await page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller.captureCheckpoint("automatic")
  ));
  expect(automatic).toEqual({ ok: false, reason: "composing" });

  const explicit = await page.evaluate(() => {
    const { controller } = window.__PAGEROOT_CONTROLLER_POLICY__;
    return {
      command: controller.takePendingCommand(),
      checkpoint: controller.captureCheckpoint("save"),
    };
  });
  expect(explicit).toMatchObject({
    command: {
      sequence: 1,
      kind: "save",
      authority: "user-explicit",
      compositionId: "composition_1",
    },
    checkpoint: {
      ok: true,
      checkpoint: {
        authority: "composition-fallback",
        previousText: "hello",
        nextText: "hello你",
        requiresCanonicalReconcile: true,
        replacements: [{
          startOffset: 5,
          endOffset: 5,
          beforeText: "",
          nextText: "你",
        }],
        formatEditRange: {
          startOffset: 5,
          endOffset: 5,
        },
      },
    },
  });
});

test("a system command restores stable provisional DOM without fallback authority", async ({ page }) => {
  await page.evaluate(() => {
    const { harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello你";
    harness.setCaret(6);
    host.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller
      .getBlockDraftSnapshot().compositionGuard?.phase
  ))).toBe("stable");

  const result = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    const queued = controller.queuePendingCommand({
      kind: "external-refresh",
      authority: "system",
    });
    const command = controller.takePendingCommand();
    const checkpoint = controller.captureCheckpoint("project-switch");
    return {
      queued,
      command,
      checkpoint,
      text: host.textContent,
      guard: controller.getBlockDraftSnapshot().compositionGuard,
      errors: harness.errors,
    };
  });

  expect(result).toMatchObject({
    queued: { queued: true, sequence: 1 },
    command: {
      sequence: 1,
      kind: "external-refresh",
      authority: "system",
      compositionId: "composition_1",
    },
    checkpoint: { ok: true, checkpoint: null },
    text: "hello",
    guard: null,
    errors: [],
  });
  expect(result.checkpoint.checkpoint?.authority).not.toBe("composition-fallback");
});

test("a user command preserves prior strict input and discards only stable provisional marked text", async ({ page }) => {
  await page.evaluate(() => {
    const { harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "!",
      inputType: "insertText",
    }));
    host.firstChild.data = "hello!";
    harness.setCaret(6);
    host.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "!",
      inputType: "insertText",
    }));

    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello!你";
    harness.setCaret(7);
    host.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller
      .getBlockDraftSnapshot().compositionGuard?.phase
  ))).toBe("stable");

  const result = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    const queued = controller.queuePendingCommand({
      kind: "save",
      authority: "user-explicit",
    });
    const command = controller.takePendingCommand();
    const draftAfterTake = controller.getBlockDraftSnapshot();
    const checkpoint = controller.captureCheckpoint("save");
    return {
      queued,
      command,
      draftAfterTake,
      checkpoint,
      text: host.textContent,
      errors: harness.errors,
    };
  });

  expect(result).toMatchObject({
    queued: { queued: true, sequence: 1 },
    command: {
      sequence: 1,
      kind: "save",
      authority: "user-explicit",
      compositionId: "composition_1",
    },
    draftAfterTake: {
      currentText: "hello!",
      compositionGuard: null,
    },
    checkpoint: {
      ok: true,
      checkpoint: {
        authority: "strict",
        previousText: "hello",
        nextText: "hello!",
        replacements: [{
          startOffset: 5,
          endOffset: 5,
          beforeText: "",
          nextText: "!",
        }],
      },
    },
    text: "hello!",
    errors: [],
  });
});

test("a late composition input revokes stability and must settle again", async ({ page }) => {
  await page.evaluate(() => {
    const { harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello你";
    harness.setCaret(6);
    host.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller
      .getBlockDraftSnapshot().compositionGuard?.phase
  ))).toBe("stable");

  const reset = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    // Some macOS bridges provide only the late input tail. The controller must
    // create a fresh owned mutation window for this exact delivery.
    host.firstChild.data = "hello你好";
    harness.setCaret(7);
    host.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertCompositionText",
      isComposing: false,
    }));
    return controller.getBlockDraftSnapshot().compositionGuard;
  });
  expect(reset).toMatchObject({
    phase: "settling",
    stableObservationCount: 0,
    fallbackAuthorized: false,
  });

  await expect.poll(() => page.evaluate(() => {
    const { controller } = window.__PAGEROOT_CONTROLLER_POLICY__;
    return controller.getBlockDraftSnapshot().compositionGuard;
  })).toMatchObject({
    phase: "stable",
    candidateText: "hello你好",
    stableObservationCount: 2,
    fallbackAuthorized: true,
  });
  expect(await page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller.captureCheckpoint("automatic")
  ))).toEqual({ ok: false, reason: "composing" });
});

test("command timeout cancels only marked text and drains the latest command", async ({ page }) => {
  const queued = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello拼";
    harness.setCaret(6);
    host.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "拼",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    return {
      first: controller.queuePendingCommand({ kind: "save" }),
      second: controller.queuePendingCommand({ kind: "export" }),
    };
  });
  expect(queued).toEqual({
    first: { queued: true, sequence: 1, replacedSequence: null },
    second: { queued: true, sequence: 2, replacedSequence: 1 },
  });

  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.harness.pendingReadyCount
  )), { timeout: 2_500 }).toBe(1);
  const afterTimeout = await page.evaluate(() => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    return {
      text: host.textContent,
      guard: controller.getBlockDraftSnapshot().compositionGuard,
      command: controller.takePendingCommand(),
      checkpoint: controller.captureCheckpoint("export"),
      errors: harness.errors,
    };
  });
  expect(afterTimeout).toMatchObject({
    text: "hello",
    guard: { phase: "cancelled", fallbackAuthorized: false },
    command: { sequence: 2, kind: "export", compositionId: "composition_1" },
    checkpoint: { ok: true, checkpoint: null },
    errors: [],
  });
});

test("a fenced lease drops the queued callback and command", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { controller, harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    const queued = controller.queuePendingCommand({ kind: "save" });
    controller.fenceDispose();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      queued,
      readyCount: harness.pendingReadyCount,
      taken: controller.takePendingCommand(),
      checkpoint: controller.captureCheckpoint("save"),
      draft: controller.getBlockDraftSnapshot(),
      contentEditable: host.getAttribute("contenteditable"),
    };
  });

  expect(result).toMatchObject({
    queued: { queued: true, sequence: 1 },
    readyCount: 0,
    taken: null,
    checkpoint: { ok: false, reason: "disposed" },
    draft: { expired: true, mutationState: "poisoned" },
    contentEditable: null,
  });
});

test("redo cancels stable marked text before the command can replay", async ({ page }) => {
  await page.evaluate(() => {
    const { harness, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    host.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    host.firstChild.data = "hello你";
    harness.setCaret(6);
    host.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_CONTROLLER_POLICY__.controller
      .getBlockDraftSnapshot().compositionGuard?.phase
  ))).toBe("stable");

  const result = await page.evaluate(() => {
    const { controller, host } = window.__PAGEROOT_CONTROLLER_POLICY__;
    const queued = controller.queuePendingCommand({
      kind: "redo",
      authority: "user-explicit",
    });
    const command = controller.takePendingCommand();
    return {
      queued,
      command,
      text: host.textContent,
      guard: controller.getBlockDraftSnapshot().compositionGuard,
      checkpoint: controller.captureCheckpoint("history"),
    };
  });
  expect(result).toMatchObject({
    queued: { queued: true, sequence: 1 },
    command: {
      sequence: 1,
      kind: "redo",
      authority: "user-explicit",
      compositionId: "composition_1",
    },
    text: "hello",
    guard: null,
    checkpoint: { ok: true, checkpoint: null },
  });
});
