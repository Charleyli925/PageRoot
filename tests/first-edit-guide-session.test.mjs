import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_EDIT_GUIDE_PRESENT_DWELL_MS,
  FirstEditGuideSession,
  isFirstEditGuideEligible,
} from "../app/application/first-edit-guide-session.js";

function pendingPreferences(overrides = {}) {
  return {
    firstRealHtmlEditGuide: {
      status: "pending",
      generation: 1,
    },
    builtInWelcomeProjectId: "project_welcome",
    ...overrides,
  };
}

function eligibleInput(overrides = {}) {
  return {
    desktop: true,
    browserPreviewOnly: false,
    canvasMode: "edit",
    canvasVerified: true,
    viewMode: "current",
    blockingOverlay: false,
    interactionLocked: false,
    runInProgress: false,
    projectId: "project_user_html",
    ...overrides,
  };
}

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, fireAt: now + delayMs });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    flush(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.fireAt <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function createPort(initial = pendingPreferences()) {
  let state = initial;
  const records = [];
  return {
    records,
    async get() {
      return state;
    },
    async record(input) {
      records.push(input);
      const status = input.action;
      state = {
        ...state,
        firstRealHtmlEditGuide: {
          ...state.firstRealHtmlEditGuide,
          status,
        },
      };
      return state;
    },
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

test("welcome HTML is never eligible for the first-edit guide", () => {
  assert.equal(
    isFirstEditGuideEligible(
      eligibleInput({ projectId: "project_welcome" }),
      {
        loaded: true,
        available: true,
        status: "pending",
        generation: 1,
        builtInWelcomeProjectId: "project_welcome",
        visible: false,
      },
    ),
    false,
  );
});

test("pending eligible real HTML becomes visible and records presented after dwell", async () => {
  const scheduler = createScheduler();
  const port = createPort();
  const session = new FirstEditGuideSession({ port, scheduler });
  await session.load();
  session.evaluate(eligibleInput());
  assert.equal(session.snapshot.visible, true);
  assert.equal(session.snapshot.status, "pending");
  assert.equal(port.records.length, 0);

  scheduler.flush(FIRST_EDIT_GUIDE_PRESENT_DWELL_MS - 1);
  await flushAsync();
  assert.equal(session.snapshot.status, "pending");
  scheduler.flush(1);
  await flushAsync();
  await flushAsync();
  assert.equal(session.snapshot.status, "presented");
  assert.equal(session.snapshot.visible, true);
  assert.deepEqual(port.records, [{ action: "presented" }]);
});

test("leaving the eligible surface before dwell keeps the guide pending", async () => {
  const scheduler = createScheduler();
  const port = createPort();
  const session = new FirstEditGuideSession({ port, scheduler });
  await session.load();
  session.evaluate(eligibleInput());
  session.evaluate(eligibleInput({ canvasMode: "preview" }));
  scheduler.flush(FIRST_EDIT_GUIDE_PRESENT_DWELL_MS);
  await flushAsync();
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.status, "pending");
  assert.equal(port.records.length, 0);
});

test("dismiss hides the card and writes dismissed", async () => {
  const scheduler = createScheduler();
  const port = createPort();
  const session = new FirstEditGuideSession({ port, scheduler });
  await session.load();
  session.evaluate(eligibleInput());
  await session.dismiss();
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.status, "dismissed");
  assert.deepEqual(port.records, [{ action: "dismissed" }]);
  session.evaluate(eligibleInput());
  assert.equal(session.snapshot.visible, false);
});

test("welcome identity written after first load is refreshed before showing", async () => {
  let builtInWelcomeProjectId = null;
  let getCount = 0;
  const port = {
    records: [],
    async get() {
      getCount += 1;
      return pendingPreferences({ builtInWelcomeProjectId });
    },
    async record(input) {
      this.records.push(input);
      return pendingPreferences({ builtInWelcomeProjectId });
    },
  };
  const session = new FirstEditGuideSession({
    port,
    scheduler: createScheduler(),
  });
  await session.load();
  assert.equal(session.snapshot.builtInWelcomeProjectId, null);
  builtInWelcomeProjectId = "project_welcome";
  session.evaluate(eligibleInput({ projectId: "project_welcome" }));
  assert.equal(session.snapshot.visible, false);
  await session.load();
  assert.equal(getCount, 2);
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.builtInWelcomeProjectId, "project_welcome");
  assert.equal(port.records.length, 0);
});

test("welcome identity is refreshed only after a projectId exists", async () => {
  let builtInWelcomeProjectId = null;
  const port = {
    records: [],
    async get() {
      return pendingPreferences({ builtInWelcomeProjectId });
    },
    async record(input) {
      this.records.push(input);
      return pendingPreferences({ builtInWelcomeProjectId });
    },
  };
  const session = new FirstEditGuideSession({
    port,
    scheduler: createScheduler(),
  });
  await session.load();
  session.evaluate(eligibleInput({ projectId: "" }));
  await flushAsync();
  builtInWelcomeProjectId = "project_welcome";
  session.evaluate(eligibleInput({ projectId: "project_welcome" }));
  await session.load();
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.builtInWelcomeProjectId, "project_welcome");
  assert.equal(port.records.length, 0);
});

test("concurrent evaluate during welcome-identity refresh does not flash the card", async () => {
  let builtInWelcomeProjectId = null;
  let releaseSecondGet = null;
  let getCount = 0;
  const port = {
    records: [],
    async get() {
      getCount += 1;
      if (getCount === 2) {
        await new Promise((resolve) => {
          releaseSecondGet = resolve;
        });
      }
      return pendingPreferences({ builtInWelcomeProjectId });
    },
    async record(input) {
      this.records.push(input);
      return pendingPreferences({ builtInWelcomeProjectId });
    },
  };
  const session = new FirstEditGuideSession({
    port,
    scheduler: createScheduler(),
  });
  await session.load();
  builtInWelcomeProjectId = "project_welcome";
  session.evaluate(eligibleInput({ projectId: "project_welcome" }));
  await flushAsync();
  session.evaluate(eligibleInput({ projectId: "project_welcome" }));
  assert.equal(session.snapshot.visible, false);
  assert.equal(typeof releaseSecondGet, "function");
  releaseSecondGet();
  await flushAsync();
  await flushAsync();
  await flushAsync();
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.builtInWelcomeProjectId, "project_welcome");
  assert.equal(port.records.length, 0);
});

test("real HTML still appears after the welcome-identity refresh", async () => {
  let builtInWelcomeProjectId = null;
  const port = {
    records: [],
    async get() {
      return pendingPreferences({ builtInWelcomeProjectId });
    },
    async record(input) {
      this.records.push(input);
      builtInWelcomeProjectId = builtInWelcomeProjectId || "project_welcome";
      return pendingPreferences({
        builtInWelcomeProjectId,
        firstRealHtmlEditGuide: {
          status: input.action,
          generation: 1,
        },
      });
    },
  };
  const scheduler = createScheduler();
  const session = new FirstEditGuideSession({ port, scheduler });
  await session.load();
  builtInWelcomeProjectId = "project_welcome";
  session.evaluate(eligibleInput());
  await session.load();
  assert.equal(session.snapshot.visible, true);
  assert.equal(session.snapshot.builtInWelcomeProjectId, "project_welcome");
});

test("a previously presented install does not show the card again", async () => {
  const session = new FirstEditGuideSession({
    port: createPort(pendingPreferences({
      firstRealHtmlEditGuide: { status: "presented", generation: 1 },
    })),
    scheduler: createScheduler(),
  });
  await session.load();
  session.evaluate(eligibleInput());
  assert.equal(session.snapshot.visible, false);
  assert.equal(session.snapshot.status, "presented");
});
