import assert from "node:assert/strict";
import test from "node:test";

import {
  adrViolations,
  parseAdrDocument,
  validateAdrIndex,
} from "../scripts/check-adrs.mjs";

test("the repository ADR inventory has unique monotonic numbers and complete indexes", async () => {
  assert.deepEqual(await adrViolations(), []);
});

test("ADR validation rejects numbering collisions and incomplete coverage", () => {
  const records = [
    parseAdrDocument("docs/decisions/0001-current.md", "# ADR 0001: Current\n- Status: Accepted\n", "active"),
    parseAdrDocument(
      "docs/decisions/archive/0001-old.md",
      "# ADR 0001: Old\n- Status: Superseded by [ADR 0001](../0001-current.md)\n",
      "archive",
    ),
  ];
  const violations = validateAdrIndex({
    records,
    activeIndexText: "<!-- adr-history-max: 0001 -->\n<!-- adr-history-gaps: 0020 -->\n",
    archiveIndexText: "",
  });
  assert.ok(violations.some((entry) => /ADR 0001 is duplicated/u.test(entry)));
  assert.ok(violations.some((entry) => /appears 0 times/u.test(entry)));
});
