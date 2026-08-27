import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  architectureViolations,
  canvasPointerLayerViolations,
  compositionBoundaryViolations,
  providerNeutralRendererViolations,
} from "../scripts/check-architecture.mjs";
import {
  parseModule,
  importsModule,
  exportsSymbol,
  classHasMember,
  classMemberConstructs,
  hasCall,
  constructsClass,
  hasObjectProperty,
  countReactHooks,
} from "../scripts/architecture-ast-query.mjs";

test("renderer, WorkspaceController, domain, and Bridge dependency boundaries stay enforced", async () => {
  assert.deepEqual(await architectureViolations(), []);
});

async function fixture(name) {
  return readFile(
    new URL(`./fixtures/architecture-boundaries/${name}`, import.meta.url),
    "utf8",
  );
}

test("final composition gate rejects each retired boundary escape", async () => {
  const [viewBridge, controllerReact, genericBridge, duplicateSession, missingDrain] =
    await Promise.all([
      fixture("view-bridge-call.tsx"),
      fixture("controller-react-import.js"),
      fixture("generic-bridge-escape.js"),
      fixture("duplicate-session-owner.js"),
      fixture("missing-drain-command.js"),
    ]);

  assert.match(
    compositionBoundaryViolations({ workbench: viewBridge }).join("\n"),
    /View code cannot import or call the Bridge client/,
  );
  assert.match(
    compositionBoundaryViolations({ workspaceController: controllerReact }).join("\n"),
    /Controller cannot import React, presentation, or desktop code/,
  );
  assert.match(
    compositionBoundaryViolations({ workspaceController: genericBridge }).join("\n"),
    /generic Bridge command escapes are forbidden/,
  );
  assert.match(
    compositionBoundaryViolations({
      applicationSources: [{
        file: "app/application/unapproved-owner.js",
        source: duplicateSession,
      }],
    }).join("\n"),
    /runtime Session construction belongs only to WorkspaceController factory/,
  );
  assert.match(
    compositionBoundaryViolations({ projectWorkflow: missingDrain }).join("\n"),
    /switch, close, history, and request boundaries must use typed DrainCoordinator commands/,
  );
});

test("composition gate rejects tabs and navigation business construction in Workbench", () => {
  assert.match(compositionBoundaryViolations({
    workbench: [
      'import { WorkbenchTabsSession } from "./application/workbench-tabs-session.js";',
      'import { WorkbenchNavigationWorkflow } from "./application/workbench-navigation-workflow.js";',
      "const tabs = new WorkbenchTabsSession();",
      "const navigation = new WorkbenchNavigationWorkflow({ session: tabs, controller });",
    ].join("\n"),
  }).join("\n"), /cannot own runtime Session\/Workflow construction/u);

  assert.match(compositionBoundaryViolations({
    workbench: 'const tabs = createWorkbenchTabsSession();',
  }).join("\n"), /cannot own runtime Session\/Workflow construction/u);

  assert.match(compositionBoundaryViolations({
    workbench: "const workbenchTabsSessionRef = useRef(tabs);",
  }).join("\n"), /cannot own runtime Session\/Workflow construction/u);

  assert.match(compositionBoundaryViolations({
    workbench: [
      "const browserDocuments = new BrowserDocumentSession();",
      "const persistence = new WorkbenchTabsPersistenceCoordinator({ port });",
    ].join("\n"),
  }).join("\n"), /cannot own runtime Session\/Workflow construction/u);
});

test("provider-neutral renderer gate rejects provider branches and workflow implementation imports", () => {
  assert.match(providerNeutralRendererViolations({
    file: "app/workbench/example.tsx",
    source: 'const selected = providerId === "qoder";',
  }).join("\n"), /descriptor data/u);
  assert.match(providerNeutralRendererViolations({
    file: "app/workbench/example.tsx",
    source: 'const selected = request.selection.providerId === "codex";',
  }).join("\n"), /descriptor data/u);
  assert.match(providerNeutralRendererViolations({
    file: "app/application/run-workflow.js",
    source: 'const legacy = delivery?.mode === "qoder-acp";',
  }).join("\n"), /descriptor data/u);
  assert.match(providerNeutralRendererViolations({
    file: "app/application/run-workflow.js",
    source: 'import value from "../domain/qoder-availability.js";',
  }).join("\n"), /cannot import provider implementations/u);
  assert.deepEqual(providerNeutralRendererViolations({
    file: "app/application/run-workflow.js",
    source: 'const managed = delivery.mode === "managed-agent";',
  }), []);
});

test("pointer capability files cannot approximate editability from native-edit tag roots", () => {
  assert.match(canvasPointerLayerViolations({
    file: "app/components/html-canvas-pointer-capability.ts",
    source: 'import { isNativeDirectEditRoot } from "../lib/native-edit-capability.js";',
  }).join("\n"), /native-edit tag roots/u);
  assert.match(canvasPointerLayerViolations({
    file: "app/components/html-canvas-pointer-proof.js",
    source: "if (isNativeDirectEditRoot(tagName)) return true;",
  }).join("\n"), /native-edit tag roots/u);
  assert.deepEqual(canvasPointerLayerViolations({
    file: "app/components/html-canvas-pointer-capability.ts",
    source: "export function resolveCanvasPointerCapability(input) { return input; }",
  }), []);
  assert.deepEqual(canvasPointerLayerViolations({
    file: "app/lib/native-edit-capability.js",
    source: "export function isNativeDirectEditRoot(tagName) { return false; }",
  }), []);
});

// The gate proves runtime coordination through structure, not source strings.
// A rename, reflow, or comment insertion is a semantically equivalent refactor:
// the AST queries must keep passing, while a genuine removal must still fail.
test("AST structural queries survive rename, reflow and comments", () => {
  const baseline = parseModule(
    "controller.js",
    [
      'import { RunWorkflow } from "./run-workflow.js";',
      "export class WorkspaceController {",
      "  #runWorkflow = new RunWorkflow({});",
      "  #registrationPromise = null;",
      "  submitRequest(input) {",
      "    return this.#runWorkflow.submit(input);",
      "  }",
      "  getSnapshot() {",
      "    return { run: this.#runSnapshot };",
      "  }",
      "}",
    ].join("\n"),
  );

  assert.equal(importsModule(baseline, "./run-workflow.js"), true);
  assert.equal(exportsSymbol(baseline, "WorkspaceController", { kind: "class" }), true);
  assert.equal(classHasMember(baseline, "WorkspaceController", "#registrationPromise"), true);
  assert.equal(classHasMember(baseline, "WorkspaceController", "submitRequest"), true);
  assert.equal(classMemberConstructs(baseline, "WorkspaceController", "#runWorkflow", "RunWorkflow"), true);
  assert.equal(constructsClass(baseline, "RunWorkflow"), true);
  assert.equal(hasCall(baseline, { path: "this.#runWorkflow.submit" }), true);
  assert.equal(hasObjectProperty(baseline, "run"), true);

  // Same module, refactored: parameter renamed, call reflowed across lines,
  // a comment inserted, and whitespace changed. A substring/order gate would
  // break on several of these; the structural gate must not.
  const refactored = parseModule(
    "controller.js",
    [
      'import { RunWorkflow } from "./run-workflow.js";',
      "export class WorkspaceController {",
      "  // registration single-flight guard",
      "  #registrationPromise = null;",
      "  #runWorkflow = new RunWorkflow(",
      "    {},",
      "  );",
      "  submitRequest(payload) {",
      "    return this.#runWorkflow",
      "      .submit(payload);",
      "  }",
      "  getSnapshot() {",
      "    return {",
      "      run: this.#runSnapshot,",
      "    };",
      "  }",
      "}",
    ].join("\n"),
  );

  assert.equal(importsModule(refactored, "./run-workflow.js"), true);
  assert.equal(exportsSymbol(refactored, "WorkspaceController", { kind: "class" }), true);
  assert.equal(classHasMember(refactored, "WorkspaceController", "#registrationPromise"), true);
  assert.equal(classHasMember(refactored, "WorkspaceController", "submitRequest"), true);
  assert.equal(classMemberConstructs(refactored, "WorkspaceController", "#runWorkflow", "RunWorkflow"), true);
  assert.equal(constructsClass(refactored, "RunWorkflow"), true);
  assert.equal(hasCall(refactored, { path: "this.#runWorkflow.submit" }), true);
  assert.equal(hasObjectProperty(refactored, "run"), true);
});

test("AST structural queries still fail on genuine removals", () => {
  const removed = parseModule(
    "controller.js",
    [
      "export class WorkspaceController {",
      "  getSnapshot() {",
      "    return {};",
      "  }",
      "}",
    ].join("\n"),
  );

  assert.equal(importsModule(removed, "./run-workflow.js"), false);
  assert.equal(classHasMember(removed, "WorkspaceController", "submitRequest"), false);
  assert.equal(classMemberConstructs(removed, "WorkspaceController", "#runWorkflow", "RunWorkflow"), false);
  assert.equal(constructsClass(removed, "RunWorkflow"), false);
  assert.equal(hasCall(removed, { path: "this.#runWorkflow.submit" }), false);
  assert.equal(hasObjectProperty(removed, "run"), false);
});

// The complexity budget ratchet measures hooks structurally so that
// generic-typed calls such as useState<T>() are counted; a regex on "useState("
// would undercount them and let complexity drift in unseen.
test("countReactHooks counts generic-typed hook calls a regex would miss", () => {
  const sample = parseModule(
    "component.tsx",
    [
      "function Component() {",
      "  const [a, setA] = useState(0);",
      "  const [b, setB] = useState<string | null>(null);",
      "  const ref = useRef<HTMLDivElement>(null);",
      "  useEffect(() => {}, []);",
      "  const value = useMemo<number>(() => 1, []);",
      "  return null;",
      "}",
    ].join("\n"),
  );
  // 2 useState (one plain, one generic) + useRef + useEffect + useMemo = 5.
  assert.equal(countReactHooks(sample), 5);
});

// Deliberately no budget-enforcement test: the ratchet is advisory, so growth
// never blocks CI or merge (see ARCHITECTURE_CONTRACT.md > Complexity budget
// ratchet). Advisory notices are printed by scripts/check-architecture.mjs
// alongside the gate output.
