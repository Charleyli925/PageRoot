import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadState() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/project-sidebar-state.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "project-sidebar-state.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`,
  );
}

const {
  createProjectExpansionState,
  reconcileProjectExpansionState,
  toggleProjectExpansion,
} = await loadState();

function expanded(state) {
  return Object.keys(state.expandedProjectIds).sort();
}

test("current and imported projects can remain expanded independently", () => {
  let state = createProjectExpansionState("current");
  state = toggleProjectExpansion(state, "imported-a");
  state = toggleProjectExpansion(state, "imported-b");
  assert.deepEqual(expanded(state), ["current", "imported-a", "imported-b"]);

  state = toggleProjectExpansion(state, "imported-a");
  assert.deepEqual(expanded(state), ["current", "imported-b"]);
});

test("identity changes preserve project expansion and default-expand an untouched new current project", () => {
  let state = createProjectExpansionState("project-a");
  state = toggleProjectExpansion(state, "project-b");
  state = reconcileProjectExpansionState(state, ["project-a", "project-b"], "project-b");
  assert.deepEqual(expanded(state), ["project-a", "project-b"]);

  state = toggleProjectExpansion(state, "project-a");
  state = reconcileProjectExpansionState(state, ["project-a", "project-b"], "project-a");
  assert.deepEqual(expanded(state), ["project-b"]);
});

test("removed projects are pruned without affecting retained projects", () => {
  let state = createProjectExpansionState("project-a");
  state = toggleProjectExpansion(state, "project-b");
  state = toggleProjectExpansion(state, "project-c");
  state = reconcileProjectExpansionState(state, ["project-a", "project-c"], "project-a");
  assert.deepEqual(expanded(state), ["project-a", "project-c"]);
  assert.deepEqual(Object.keys(state.touchedProjectIds).sort(), ["project-c"]);
});
