import assert from "node:assert/strict";
import test from "node:test";

import { createRecoveryStore } from "../app/application/recovery-store.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("recovery store writes one snapshot to each identity key", () => {
  const storage = memoryStorage();
  const store = createRecoveryStore(storage);

  assert.equal(store.write(["document", "source"], { revision: 106 }), true);
  assert.deepEqual(store.readRecords(["document", "source"]), [
    { key: "document", value: { revision: 106 } },
    { key: "source", value: { revision: 106 } },
  ]);
  assert.equal(store.remove(["document", "source"]), true);
  assert.deepEqual(store.readRecords(["document", "source"]), []);
});
test("recovery store contains malformed or unavailable browser storage", () => {
  const malformed = memoryStorage();
  malformed.values.set("broken", "{");
  const store = createRecoveryStore(malformed);
  assert.deepEqual(store.readRecords("broken"), []);

  const unavailable = createRecoveryStore(() => {
    throw new Error("storage disabled");
  });
  assert.equal(unavailable.write("key", { value: true }), false);
  assert.equal(unavailable.remove("key"), false);
  assert.deepEqual(unavailable.readRecords("key"), []);
});
