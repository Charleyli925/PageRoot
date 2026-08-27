import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import test from "node:test";

import { freezeLocalAttachment } from "../bridge/attachment-storage.mjs";

test("attachment snapshots prefer an exclusive APFS copy-on-write clone", async () => {
  const calls = [];
  const result = await freezeLocalAttachment({
    sourcePath: "/project/draft/reference.png",
    destinationPath: "/project/request/reference.png",
    copyFileImpl: async (...args) => calls.push(args),
    removeImpl: async () => assert.fail("successful clones must not be removed"),
    syncFileImpl: async () => {},
  });

  assert.deepEqual(result, { materialization: "copy-on-write" });
  assert.deepEqual(calls, [[
    "/project/draft/reference.png",
    "/project/request/reference.png",
    fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE_FORCE,
  ]]);
});

test("attachment snapshots safely fall back when the filesystem cannot clone", async () => {
  const copyCalls = [];
  const removeCalls = [];
  const result = await freezeLocalAttachment({
    sourcePath: "/project/draft/reference.pdf",
    destinationPath: "/project/request/reference.pdf",
    copyFileImpl: async (...args) => {
      copyCalls.push(args);
      if (copyCalls.length === 1) {
        const error = new Error("clone is unavailable");
        error.code = "ENOTSUP";
        throw error;
      }
    },
    removeImpl: async (...args) => removeCalls.push(args),
    syncFileImpl: async () => {},
  });

  assert.deepEqual(result, { materialization: "full-copy" });
  assert.equal(copyCalls.length, 2);
  assert.equal(
    copyCalls[0][2],
    fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE_FORCE,
  );
  assert.equal(copyCalls[1][2], fsConstants.COPYFILE_EXCL);
  assert.deepEqual(removeCalls, [[
    "/project/request/reference.pdf",
    { force: true },
  ]]);
});

test("attachment snapshots never hide permission or storage failures", async () => {
  const expected = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  await assert.rejects(
    freezeLocalAttachment({
      sourcePath: "/project/draft/reference.png",
      destinationPath: "/project/request/reference.png",
      copyFileImpl: async () => {
        throw expected;
      },
      removeImpl: async () => {},
      syncFileImpl: async () => {},
    }),
    (error) => error === expected,
  );
});

test("attachment snapshots propagate durability sync failures", async () => {
  const expected = Object.assign(new Error("sync failed"), {
    code: "EIO",
  });
  await assert.rejects(
    freezeLocalAttachment({
      sourcePath: "/project/draft/reference.png",
      destinationPath: "/project/request/reference.png",
      copyFileImpl: async () => {},
      removeImpl: async () => {},
      syncFileImpl: async () => {
        throw expected;
      },
    }),
    (error) => error === expected,
  );
});
