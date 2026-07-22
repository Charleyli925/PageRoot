import assert from "node:assert/strict";
import test from "node:test";

import {
  QODER_HANDOFF_MAX_BYTES,
  handoffToQoderWork,
  normalizeQoderHandoffPayload,
} from "../desktop/qoder-handoff.mjs";

test("QoderWork handoff only copies without opening or controlling QoderWork", async () => {
  const calls = [];
  const result = await handoffToQoderWork(
    { message: "请执行 /tmp/request/PROMPT.md" },
    {
      writeClipboard(message) {
        calls.push(["clipboard", message]);
      },
      readClipboard() {
        calls.push(["readback"]);
        return "请执行 /tmp/request/PROMPT.md";
      },
    },
  );

  assert.deepEqual(calls, [
    ["clipboard", "请执行 /tmp/request/PROMPT.md"],
    ["readback"],
  ]);
  assert.equal(result.status, "copied");
  assert.equal(result.copied, true);
  assert.equal(result.opened, false);
  assert.equal(result.pasted, false);
  assert.equal(result.reason, null);
});

test("QoderWork handoff validates its narrow IPC payload", () => {
  assert.deepEqual(
    normalizeQoderHandoffPayload({ message: "hello" }),
    { message: "hello", byteLength: 5 },
  );
  assert.throws(
    () => normalizeQoderHandoffPayload({ message: "hello", path: "/tmp" }),
    /未支持的字段/,
  );
  assert.throws(
    () => normalizeQoderHandoffPayload({ message: "" }),
    /不能为空/,
  );
  assert.throws(
    () => normalizeQoderHandoffPayload({
      message: "a".repeat(QODER_HANDOFF_MAX_BYTES + 1),
    }),
    /过长/,
  );
});

test("QoderWork handoff requires write plus exact clipboard readback", async () => {
  await assert.rejects(
    handoffToQoderWork({ message: "handoff" }),
    /缺少剪贴板写入能力/,
  );
  await assert.rejects(
    handoffToQoderWork(
      { message: "handoff" },
      { writeClipboard() {} },
    ),
    /缺少剪贴板校验能力/,
  );
  await assert.rejects(
    handoffToQoderWork(
      { message: "handoff" },
      {
        writeClipboard() {},
        readClipboard() {
          return "stale clipboard";
        },
      },
    ),
    /写入后校验失败/,
  );
});
