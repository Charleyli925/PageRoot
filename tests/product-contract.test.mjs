import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRODUCT_MAX_BRIDGE_BODY_BYTES,
  PRODUCT_MAX_HTML_BYTES,
  WORKING_COPY_COMPONENT_MAX_BYTES,
  isGeneratedWorkingCopyFileName,
  semanticVersionLabel,
  workingCopyFileName,
} from "../desktop/product-contract.mjs";
import {
  isPositionalSelector,
  isStalePositionalTarget,
  matchingFingerprintPrefixCount,
} from "../scripts/target-identity.mjs";

test("desktop and Bridge share one HTML budget with an explicit JSON envelope budget", async () => {
  const [main, projectFiles, bridge, packageText, afterPack] = await Promise.all([
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/project-files.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/workspace-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/after-pack.mjs", import.meta.url), "utf8"),
  ]);
  assert.equal(PRODUCT_MAX_HTML_BYTES, 25 * 1024 * 1024);
  assert.equal(PRODUCT_MAX_BRIDGE_BODY_BYTES, 64 * 1024 * 1024);
  assert.ok(PRODUCT_MAX_BRIDGE_BODY_BYTES > PRODUCT_MAX_HTML_BYTES * 2);
  for (const source of [main, projectFiles, bridge]) {
    assert.match(source, /product-contract\.mjs/u);
  }
  const packageJson = JSON.parse(packageText);
  assert.ok(packageJson.build.files.includes("desktop/product-contract.mjs"));
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.to === "bridge/product-contract.mjs",
    ),
  );
  assert.match(afterPack, /desktop["'],\s*["']product-contract\.mjs/u);
  assert.match(afterPack, /bridgeDirectory,\s*["']product-contract\.mjs/u);
});

test("frontend and ScopeValidator consume the same positional identity primitives", async () => {
  const [resolver, validator] = await Promise.all([
    readFile(new URL("../app/lib/target-resolver.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scope-validator.mjs", import.meta.url), "utf8"),
  ]);
  assert.equal(isPositionalSelector("section:nth-of-type(2)"), true);
  assert.equal(isPositionalSelector("#stable"), false);
  assert.equal(
    isStalePositionalTarget(
      {
        selector: "section:nth-of-type(2)",
        sourceAnchor: { sourceSha256: "sha256:aa" },
      },
      "sha256:bb",
    ),
    true,
  );
  assert.equal(
    matchingFingerprintPrefixCount(["main", "body"], ["main", "aside"]),
    1,
  );
  assert.match(resolver, /target-identity\.mjs/u);
  assert.match(validator, /target-identity\.mjs/u);
});

test("generated working-copy names retain the stable user name safely", () => {
  assert.equal(semanticVersionLabel(1), "V1.0");
  assert.equal(semanticVersionLabel(2), "V1.1");
  assert.equal(semanticVersionLabel(10), "V1.9");
  assert.throws(() => semanticVersionLabel(0));
  assert.equal(
    workingCopyFileName("复杂HTML综合测试页", "V1.2"),
    "复杂HTML综合测试页-V1.2.html",
  );
  assert.equal(
    workingCopyFileName("ai-metrics-system(1)-副本.html", "V1.2"),
    "ai-metrics-system(1)-副本-V1.2.html",
  );
  assert.equal(
    workingCopyFileName("report-V1.1", "V1.2"),
    "report-V1.2.html",
  );
  assert.equal(
    workingCopyFileName("  市场:策略/周报  ", "V1.2"),
    "市场-策略-周报-V1.2.html",
  );
  const longName = workingCopyFileName("研".repeat(300), "V1.123");
  assert.ok(Buffer.byteLength(longName) <= WORKING_COPY_COMPONENT_MAX_BYTES);
  assert.match(longName, /-V1\.123\.html$/u);
  assert.equal(isGeneratedWorkingCopyFileName("V1.2.html"), true);
  assert.equal(
    isGeneratedWorkingCopyFileName("复杂HTML综合测试页-V1.2.html"),
    true,
  );
  assert.equal(isGeneratedWorkingCopyFileName("../V1.2.html"), false);
  assert.equal(isGeneratedWorkingCopyFileName("bad\nname-V1.2.html"), false);
  assert.throws(() => workingCopyFileName("report", "V2"));
});

test("Prompt, protocol, helper, and finalizer agree on frozen input plus controlled supplements", async () => {
  const [bridge, lifecycle, protocol, interactionFlow, productRequirements] =
    await Promise.all([
      readFile(new URL("../scripts/workspace-bridge.mjs", import.meta.url), "utf8"),
      readFile(new URL("../scripts/lifecycle-core.mjs", import.meta.url), "utf8"),
      readFile(new URL("../docs/CHANGE_REQUEST_PROTOCOL.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/INTERACTION_FLOW.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/MVP_PRD.md", import.meta.url), "utf8"),
    ]);
  assert.match(bridge, /# PageRoot 通用执行规则/);
  assert.match(bridge, /严格按 input-manifest\.json 的 readOrder/);
  assert.match(
    bridge,
    /USER_SUPPLEMENT\.json 中尚未撤销的补充共同组成/,
  );
  assert.match(bridge, /只有记录成功后才能执行该条要求/);
  assert.match(bridge, /不得直接编辑 USER_SUPPLEMENT\.json/);
  assert.match(
    bridge,
    /不得修改 PROJECT\.md、冻结输入或协议文件，也不得直接编辑 USER_SUPPLEMENT\.json/,
  );
  assert.match(lifecycle, /expectedFileName = "index\.html"/);
  assert.match(lifecycle, /user-name-plus-version filename/);
  assert.match(bridge, /原用户文件名-V1\.x\.html/);
  assert.match(bridge, /不得写 output\/index\.html 或其他路径/);
  assert.match(protocol, /output 只有一个完整 HTML，不得创建 `PROJECT\.md`/);
  assert.match(protocol, /AI 输出文件命名/);
  assert.match(protocol, /`USER_SUPPLEMENT\.json` 只能由受控 helper 追加/);
  assert.match(protocol, /长期项目规则不得在本轮任务中修改/);
  assert.match(protocol, /^# PageRoot Change Request 协议$/m);
  assert.match(interactionFlow, /^# PageRoot 交互流程$/m);
  assert.match(productRequirements, /^# PageRoot MVP 产品需求$/m);
  assert.doesNotMatch(protocol, /output\/PROJECT\.md/);
});
