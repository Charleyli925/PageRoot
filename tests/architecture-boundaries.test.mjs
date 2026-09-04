import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  architectureViolations,
  dialogPolicyViolations,
  escapeBoundaryViolations,
  layerBoundaryViolations,
  ownershipBoundaryViolations,
  retiredArtifactViolations,
  noticePolicyViolations,
} from "../scripts/check-architecture.mjs";
import { loadNoticeLedger } from "../scripts/notice-policy.mjs";
import {
  countReactHooks,
  hasLiteralComparison,
  jsxElementNames,
  moduleSpecifiers,
  newExpressionNames,
  parseModule,
} from "../scripts/architecture-ast-query.mjs";

test("the production graph satisfies the responsibility boundaries", async () => {
  assert.deepEqual(await architectureViolations(), []);
});

test("plain Node test modules never import TypeScript runtime files", async () => {
  const testsDirectory = new URL("./", import.meta.url);
  const testFiles = (await readdir(testsDirectory))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const violations = [];
  for (const name of testFiles) {
    const source = await readFile(new URL(name, testsDirectory), "utf8");
    if (/\b(?:from\s*|import\s*\()\s*["'][^"']+\.tsx?["']/u.test(source)) {
      violations.push(name);
    }
  }
  assert.deepEqual(violations, []);
});

async function fixture(name) {
  return readFile(
    new URL(`./fixtures/architecture-boundaries/${name}`, import.meta.url),
    "utf8",
  );
}

test("layer, ownership and escape checks reject the four forbidden boundaries", async () => {
  const [viewBridge, controllerReact, duplicateSession, domainImport, secondWriter] = await Promise.all([
    fixture("view-bridge-call.tsx"),
    fixture("controller-react-import.js"),
    fixture("duplicate-session-owner.js"),
    fixture("domain-imports-application.js"),
    fixture("second-persistence-writer.js"),
  ]);

  assert.match(
    layerBoundaryViolations({ file: "app/components/example.tsx", source: viewBridge }).join("\n"),
    /views cannot import the Bridge client/u,
  );
  assert.match(
    layerBoundaryViolations({ file: "app/application/example.js", source: controllerReact }).join("\n"),
    /application code cannot import react/u,
  );
  assert.match(
    ownershipBoundaryViolations({ file: "app/workbench/example.tsx", source: duplicateSession }).join("\n"),
    /may only be constructed by the composition root/u,
  );
  assert.match(
    layerBoundaryViolations({ file: "app/domain/example.js", source: domainImport }).join("\n"),
    /domain code cannot import/u,
  );
  assert.match(
    ownershipBoundaryViolations({ file: "app/application/example.js", source: secondWriter }).join("\n"),
    /persistence writes belong to an approved repository/u,
  );
});

test("renderer-local workspace preferences remain an explicit presentation owner", () => {
  const source = [
    'import { WorkspacePreferencesSession } from "../application/workspace-preferences-session.js";',
    "const session = new WorkspacePreferencesSession({ port: null });",
  ].join("\n");
  assert.deepEqual(
    ownershipBoundaryViolations({ file: "app/workbench/use-workspace-preferences.ts", source }),
    [],
  );
});

test("generic Bridge escapes remain forbidden without freezing implementation names", () => {
  assert.match(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "export function submit(input) { return input.executeBridge('request'); }",
    }).join("\n"),
    /generic Bridge command escapes are forbidden/u,
  );
  assert.match(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "export function load() { return fetch('/workspace'); }",
    }).join("\n"),
    /raw fetch belongs/u,
  );
  assert.deepEqual(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "const internalName = value; function submit(payload) { return payload.run(internalName); }",
    }),
    [],
  );
});

test("renaming private fields, methods, parameters and locals does not alter responsibility results", () => {
  const source = [
    'import { RunWorkflow } from "./run-workflow.js";',
    "export class WorkspaceController {",
    "  #renamedWorkflow = new RunWorkflow({});",
    "  #renamedGuard = null;",
    "  submitRenamed(requestBody) {",
    "    return this.#renamedWorkflow.submit(requestBody);",
    "  }",
    "}",
  ].join("\n");
  const handle = parseModule("app/application/workspace-controller.js", source);
  assert.deepEqual(layerBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(ownershipBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(escapeBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(newExpressionNames(handle), ["RunWorkflow"]);
  assert.deepEqual(moduleSpecifiers(handle), ["./run-workflow.js"]);
});

test("AST queries retain responsibility facts while ignoring member spelling", () => {
  const handle = parseModule(
    "fixture.tsx",
    [
      "function View() {",
      "  const [value, setValue] = useState(0);",
      "  const reference = useRef<HTMLDivElement>(null);",
      "  useEffect(() => {}, []);",
      "  return value;",
      "}",
    ].join("\n"),
  );
  assert.equal(countReactHooks(handle), 3);
  assert.deepEqual(jsxElementNames(handle), []);
  assert.equal(
    hasLiteralComparison(
      parseModule("fixture.js", 'const delivery = { mode: "managed-agent" };'),
      { literals: ["qoder"], propertyNames: ["mode"] },
    ),
    false,
  );
});

test("dialog policy forbids unregistered native alerts and window.confirm", async () => {
  const source = await fixture("unregistered-confirm.js");
  const violations = dialogPolicyViolations({
    file: "app/workbench/example.js",
    source,
  }).join("\n");
  assert.match(violations, /ordinary showMessageBox is forbidden/u);
  assert.match(violations, /showErrorBox is forbidden except the registered startup failure/u);
  assert.match(
    violations,
    /window.confirm is forbidden unless the copy is a registered delete\/overwrite\/abandon confirm/u,
  );
  assert.deepEqual(
    dialogPolicyViolations({
      file: "app/workbench/example.js",
      source: [
        'window.confirm("确定要用磁盘上的版本继续吗？未写入的编辑都会丢弃。");',
        'window.confirm("确定要用外部版本覆盖当前编辑吗？此操作不可撤销。");',
      ].join("\n"),
    }),
    [],
  );
});

test("notice freeze forbids unregistered setToast, NoticeBar, aliases and background-result", async () => {
  const ledger = await loadNoticeLedger();
  const noticeSource = await fixture("unregistered-notice.js");
  const noticeViolations = noticePolicyViolations({
    file: "app/workbench/example.js",
    source: noticeSource,
    ledger,
  }).join("\n");
  assert.match(noticeViolations, /setToast create calls are frozen/u);
  assert.match(noticeViolations, /background-result is frozen/u);
  assert.match(noticeViolations, /uncatalogued is frozen/u);
  assert.match(noticeViolations, /setToast aliases are forbidden/u);
  assert.match(
    noticePolicyViolations({
      file: "app/components/example.tsx",
      source: "export default function Example() { return <NoticeBar title=\"unregistered\" />; }",
      ledger,
    }).join("\n"),
    /NoticeBar is frozen to registered surfaces/u,
  );
  assert.deepEqual(
    noticePolicyViolations({
      file: "app/workbench.tsx",
      source: "setToast(null);",
      ledger,
    }),
    [],
  );
});

test("retired production modules and imports stay outside the graph", () => {
  assert.match(
    retiredArtifactViolations({
      file: "app/example.js",
      source: 'import Controller from "./NativeEditingController";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({ file: "app/lib/format-skeleton.js", source: "" }).join("\n"),
    /retired production modules/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/example.tsx",
      source: 'import ReviewAnalysisPrewarm from "./workbench/ReviewAnalysisPrewarm";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/example.tsx",
      source: 'import Pool from "./workbench/WorkbenchDocumentCanvasPool";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/application/example.js",
      source: 'export const endpoint = "/source-history/action";',
    }).join("\n"),
    /source-history compatibility literal/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "bridge/example.mjs",
      source: 'export const schema = "source-history.v1";',
    }).join("\n"),
    /source-history compatibility literal/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/page-view-context.js",
      source: 'const name = "data-p";',
    }).join("\n"),
    /retired page-view tab adapters/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench/review-document.ts",
      source: 'export const attr = "data-pageroot-review-source-node-id";',
    }).join("\n"),
    /Review cannot write parseKey identity/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/review-comment-source-map.js",
      source: "export function instrumentPreviewHtml() {}",
    }).join("\n"),
    /instrumentPreviewHtml cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/source-patch-core.js",
      source: "export function resolveFromPreview() {}",
    }).join("\n"),
    /resolveFromPreview cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/source-patch-engine.js",
      source: "export function liveExactCommandTarget() {}",
    }).join("\n"),
    /liveExactCommandTarget cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/application/document-workflow.js",
      source: 'this.#recoveryStore.write("html-ai-recovery:doc", {});',
    }).join("\n"),
    /document HTML recovery is Main journal only/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench/review/runtime-projection.ts",
      source: "const pattern = /^element:\\d+:\\d+:[a-z]/iu;",
    }).join("\n"),
    /parseKey cannot leave source-index/u,
  );
});

test("the architecture checker contains no implementation-shape assertions", async () => {
  const source = await readFile(new URL("../scripts/check-architecture.mjs", import.meta.url), "utf8");
  const privatePrefix = "#";
  const privateNames = ["drainCoordinator", "navigationPort"];
  const receiptName = ["application", "Receipt"].join("");
  const controllerReference = ["workspace", "Controller", "Ref"].join("");
  assert.doesNotMatch(source, new RegExp(`${privatePrefix}(?:${privateNames.join("|")})`, "u"));
  assert.doesNotMatch(source, new RegExp(`${receiptName}|${controllerReference}`, "u"));
  assert.doesNotMatch(source, /\.includes\(.*(?:drain|freeze|receipt)/su);
});
