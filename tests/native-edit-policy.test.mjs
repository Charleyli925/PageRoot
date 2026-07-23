import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseNativeEditHostMode,
  classifyNativeEventDelivery,
  isDisposableNativeInlineWrapperTag,
  NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS,
  NATIVE_EDIT_HOST_MODE,
} from "../app/lib/native-edit-policy.js";

test("prefers plaintext-only and uses controlled contenteditable only for exact fallback geometry", () => {
  assert.equal(
    chooseNativeEditHostMode({
      plaintextOnly: { layoutStable: true, styleStable: true },
      controlled: { layoutStable: true, styleStable: true },
    }),
    NATIVE_EDIT_HOST_MODE.PLAINTEXT_ONLY,
  );
  assert.equal(
    chooseNativeEditHostMode({
      plaintextOnly: { layoutStable: false, styleStable: true },
      controlled: { layoutStable: true, styleStable: true },
    }),
    NATIVE_EDIT_HOST_MODE.CONTROLLED,
  );
  assert.equal(
    chooseNativeEditHostMode({
      plaintextOnly: { layoutStable: false, styleStable: true },
      controlled: { layoutStable: true, styleStable: false },
    }),
    null,
  );
});

test("display contents requires the observer-guarded event lane", () => {
  assert.equal(
    classifyNativeEventDelivery({
      hasDisplayContents: false,
      observerReady: false,
    }),
    "native",
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

test("one wrapper policy is shared by controller, skeleton, and source patch", () => {
  assert.equal(isDisposableNativeInlineWrapperTag("strong"), true);
  assert.equal(isDisposableNativeInlineWrapperTag("a"), false);
  assert.equal(new Set(NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS).size, 11);
});
