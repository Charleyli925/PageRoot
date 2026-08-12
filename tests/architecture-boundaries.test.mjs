import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  architectureViolations,
  compositionBoundaryViolations,
} from "../scripts/check-architecture.mjs";

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
