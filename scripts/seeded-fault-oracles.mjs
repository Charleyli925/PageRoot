export const SEEDED_FAULTS = Object.freeze([
  {
    id: "active-iframe-cleared",
    owner: "runtime-continuity",
    killer: "electron-editing-smoke",
    productionFile: "app/components/HtmlCanvasEditor.tsx",
    detection: "electron-live-canary",
  },
  {
    id: "candidate-created-during-edit",
    owner: "runtime-continuity",
    killer: "electron-editing-smoke",
    productionFile: "app/components/HtmlCanvasEditor.tsx",
    detection: "electron-live-canary",
  },
  {
    id: "working-html-skipped-before-save",
    owner: "document-workflow",
    killer: "electron-recovery-smoke",
    productionFile: "app/application/document-workflow.js",
    detection: "production-module",
  },
  {
    id: "duplicate-stable-id",
    owner: "source-editing-core",
    killer: "browser-editing-smoke",
    productionFile: "app/lib/source-index.js",
    detection: "production-module",
  },
]);
