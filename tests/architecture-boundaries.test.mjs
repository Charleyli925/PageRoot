import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  architectureViolations,
  escapeBoundaryViolations,
  layerBoundaryViolations,
  ownershipBoundaryViolations,
  retiredArtifactViolations,
} from "../scripts/check-architecture.mjs";
import {
  countReactHooks,
  hasLiteralComparison,
  moduleSpecifiers,
  newExpressionNames,
  parseModule,
} from "../scripts/architecture-ast-query.mjs";

test("the production graph satisfies the four responsibility boundaries", async () => {
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
  assert.equal(
    hasLiteralComparison(
      parseModule("fixture.js", 'const delivery = { mode: "managed-agent" };'),
      { literals: ["qoder"], propertyNames: ["mode"] },
    ),
    false,
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
