import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseNativeEditHostMode,
  classifyNativeEventDelivery,
} from "../app/lib/native-edit-policy.js";

test("native host and display-contents decisions are explicit policy outcomes", () => {
  assert.equal(
    chooseNativeEditHostMode({
      plaintextOnly: { layoutStable: false, styleStable: true },
      controlled: { layoutStable: true, styleStable: true },
    }),
    "true",
  );
  assert.equal(
    classifyNativeEventDelivery({
      hasDisplayContents: true,
      observerReady: true,
    }),
    "observer-guarded",
  );
  assert.equal(
    classifyNativeEventDelivery({
      hasDisplayContents: true,
      observerReady: false,
    }),
    "unsafe",
  );
});
