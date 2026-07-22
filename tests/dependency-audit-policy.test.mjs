import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAuditReport } from "../scripts/check-dependency-audit.mjs";

function report(...advisories) {
  return {
    vulnerabilities: {
      fixture: {
        via: advisories,
      },
    },
  };
}

test("dependency audit policy accepts reviewed advisories before expiry", () => {
  const result = evaluateAuditReport(report({
    source: 1,
    url: "https://example.test/advisory-1",
    severity: "high",
  }), {
    allowlist: {
      1: { url: "https://example.test/advisory-1", expiresOn: "2026-08-31" },
    },
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, true);
});

test("dependency audit policy rejects new and expired advisories", () => {
  const allowlist = {
    1: { url: "https://example.test/advisory-1", expiresOn: "2026-07-01" },
  };
  const result = evaluateAuditReport(report(
    { source: 1, url: "https://example.test/advisory-1", severity: "high" },
    { source: 2, url: "https://example.test/advisory-2", severity: "moderate" },
  ), {
    allowlist,
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.unexpected.map((item) => item.source), [2]);
  assert.deepEqual(result.expired.map((item) => item.source), ["1"]);
});
