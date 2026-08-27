export { launchPageRoot } from "./electron-app-launch.mjs";
export {
  closeObservationTimeout,
  closePageRootGracefully,
  createCloseFirstCleanup,
  removeValidatedTemporaryDirectory,
  stopPageRoot,
} from "./electron-safe-cleanup.mjs";
export {
  classifyRendererMount,
  collectProjectReadinessDiagnostics,
  describeRendererReadiness,
  ensureRendererMounted,
  loadedDiskFrame,
  observedRendererMount,
  pageHasRendererMount,
  recordRendererFaultLog,
  rendererFaultLog,
  rendererProbe,
  sendToMainRenderer,
  waitForMainBrowserWindow,
  waitForProjectReady,
} from "./electron-project-ready.mjs";
export {
  createSourceFixture,
  removeSourceFixture,
  seedActiveDiskProject,
  seedDismissedFirstEditGuide,
} from "./electron-project-fixture.mjs";
export { openRailGlobalCommentComposer } from "./electron-comment-driver.mjs";
export { seedLegacyV3Project } from "./electron-legacy-project-fixture.mjs";
