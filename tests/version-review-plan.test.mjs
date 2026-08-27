import assert from "node:assert/strict";
import test from "node:test";

import {
  planVersionActivate,
  planVersionPrepareReview,
} from "../app/application/version/review-plan.js";

test("version review plans fail-close disposed, missing candidate and hydrating project", () => {
  assert.equal(planVersionPrepareReview({ disposed: true }).code, "VERSION_WORKFLOW_DISPOSED");
  assert.equal(planVersionPrepareReview({ ready: false }).code, "VERSION_REVIEW_PRECONDITION");
  assert.equal(
    planVersionPrepareReview({ ready: true, baseHashOk: false }).code,
    "VERSION_REVIEW_BASE_HASH_INVALID",
  );
  assert.equal(planVersionPrepareReview({ ready: true, baseHashOk: true }).kind, "ready");
  assert.equal(planVersionActivate({ ready: false }).code, "VERSION_ACTIVATION_PRECONDITION");
  assert.equal(
    planVersionActivate({ ready: true, projectHydrating: true }).code,
    "VERSION_ACTIVATION_PROJECT_UNAVAILABLE",
  );
  assert.equal(planVersionActivate({ ready: true }).kind, "ready");
});
