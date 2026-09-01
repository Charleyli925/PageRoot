import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { parseModule } from "../scripts/architecture-ast-query.mjs";
import {
  extractSetToastCreates,
  loadNoticeLedger,
  noticeRatchetViolations,
} from "../scripts/notice-policy.mjs";

const execFileAsync = promisify(execFile);
const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function previousLedgerFromMain() {
  try {
    const { stdout } = await execFileAsync("git", [
      "show",
      "origin/main:scripts/notice-disposition-ledger.json",
    ], { cwd: PRODUCT_ROOT });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

test("generic setToast is retired; remaining ledger sites are N5 interruptions", async () => {
  const ledger = await loadNoticeLedger();
  const workbench = await readFile(path.join(PRODUCT_ROOT, "app/workbench.tsx"), "utf8");
  const creates = extractSetToastCreates(parseModule("app/workbench.tsx", workbench));
  assert.equal(creates.length, 0);
  assert.equal(creates.length, ledger.baseline.setToastCreateCalls);
  assert.equal(ledger.sites.length > 0, true);

  for (const site of ledger.sites) {
    assert.equal(site.class, "N5", `${site.id} has class ${site.class}`);
    assert.equal(site.file, "app/workbench.tsx");
    assert.ok(site.owner, `${site.id} needs an owner`);
    assert.ok(site.reason, `${site.id} needs a reason`);
    assert.ok(site.fingerprint, `${site.id} needs a fingerprint`);
    assert.ok(site.allowlistId, `${site.id} is N5 without allowlistId`);
  }
});

test("N5 allowlist entries have an owner and a removal condition", async () => {
  const ledger = await loadNoticeLedger();
  const allowIds = new Set();
  for (const entry of ledger.allowlist) {
    assert.ok(entry.id, "allowlist entry needs id");
    assert.ok(entry.owner, `${entry.id} needs owner`);
    assert.ok(entry.reason, `${entry.id} needs reason`);
    assert.ok(entry.removalCondition, `${entry.id} needs removalCondition`);
    assert.ok(Array.isArray(entry.siteIds) && entry.siteIds.length > 0, `${entry.id} needs siteIds`);
    allowIds.add(entry.id);
    for (const siteId of entry.siteIds) {
      const site = ledger.sites.find((item) => item.id === siteId);
      assert.ok(site, `${entry.id} lists unknown site ${siteId}`);
    }
  }
  for (const site of ledger.sites.filter((item) => item.class === "N5")) {
    assert.ok(allowIds.has(site.allowlistId), `${site.id} points at unknown allowlist`);
  }
});

test("notice baselines and allowlist can only shrink after landing on main", async () => {
  const current = await loadNoticeLedger();
  const previous = await previousLedgerFromMain();
  assert.deepEqual(noticeRatchetViolations(current, previous), []);
  assert.deepEqual(
    noticeRatchetViolations({
      ...current,
      baseline: { ...current.baseline, setToastCreateCalls: current.baseline.setToastCreateCalls + 1 },
    }, current),
    ["notice freeze: baseline.setToastCreateCalls can only decrease"],
  );
  assert.match(
    noticeRatchetViolations({
      ...current,
      allowlist: [...current.allowlist, {
        id: "new-notice",
        owner: "test",
        reason: "should fail",
        removalCondition: "never",
        siteIds: [],
      }],
    }, current).join("\n"),
    /allowlist id new-notice is new/u,
  );
  const [first] = current.sites;
  assert.match(
    noticeRatchetViolations({
      ...current,
      sites: current.sites.map((site, index) => (
        index === 0 ? { ...site, fingerprint: `${site.fingerprint}|changed` } : site
      )),
    }, current).join("\n"),
    new RegExp(`${first.id} changed without a class change or deletion`, "u"),
  );
});
