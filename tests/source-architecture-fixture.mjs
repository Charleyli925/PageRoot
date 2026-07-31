import { readFile } from "node:fs/promises";

async function readSources(relativePaths) {
  return Promise.all(relativePaths.map((relativePath) => (
    readFile(new URL(relativePath, import.meta.url), "utf8")
  )));
}

export async function readCanvasArchitecture() {
  const sources = await readSources([
    "../app/components/HtmlCanvasEditor.types.ts",
    "../app/components/html-canvas-dom.ts",
    "../app/components/html-canvas-interaction.ts",
    "../app/components/html-canvas-internal-types.ts",
    "../app/components/html-canvas-page-view.ts",
    "../app/components/html-canvas-preview-sync.ts",
    "../app/components/html-canvas-selection.ts",
    "../app/components/html-canvas-style-inspector.ts",
    "../app/components/HtmlCanvasEditor.tsx",
  ]);
  return sources.join("\n");
}

export async function readWorkbenchArchitecture() {
  const sources = await readSources([
    "../app/application/comment-session.js",
    "../app/application/document-session.js",
    "../app/application/project-session.js",
    "../app/application/project-rules-session.js",
    "../app/application/run-session.js",
    "../app/application/version-session.js",
    "../app/workbench/comment-model.ts",
    "../app/workbench/project-model.ts",
    "../app/workbench/record-model.ts",
    "../app/workbench/version-model.ts",
    "../app/workbench/browser-io.ts",
    "../app/workbench/types.ts",
    "../app/workbench/presentation.tsx",
    "../app/workbench/handoff-view.tsx",
    "../app/workbench.tsx",
  ]);
  return sources.join("\n");
}
