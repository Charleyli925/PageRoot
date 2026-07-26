const SOURCE_EDITING = new Set(["enabled", "read-only"]);
const PROJECT_OPENING = new Set(["desktop-dialog", "browser-file"]);
const ATTACHMENT_PERSISTENCE = new Set(["bridge", "memory", "none"]);
const CLOSE_COORDINATION = new Set(["electron-handshake", "browser-beforeunload"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCapabilityManifest(value) {
  return isRecord(value)
    && SOURCE_EDITING.has(value.sourceEditing)
    && PROJECT_OPENING.has(value.projectOpening)
    && ATTACHMENT_PERSISTENCE.has(value.attachmentPersistence)
    && CLOSE_COORDINATION.has(value.closeCoordination);
}

function freezeManifest(value) {
  return Object.freeze({
    sourceEditing: value.sourceEditing,
    projectOpening: value.projectOpening,
    attachmentPersistence: value.attachmentPersistence,
    closeCoordination: value.closeCoordination,
  });
}

export const BROWSER_RUNTIME_CAPABILITIES = freezeManifest({
  sourceEditing: "read-only",
  projectOpening: "browser-file",
  attachmentPersistence: "none",
  closeCoordination: "browser-beforeunload",
});

export const DESKTOP_RUNTIME_CAPABILITIES = freezeManifest({
  sourceEditing: "enabled",
  projectOpening: "desktop-dialog",
  attachmentPersistence: "bridge",
  closeCoordination: "electron-handshake",
});

export function resolveRuntimeCapabilities({
  runtimeConfig,
  projectsApi,
} = {}) {
  const declared = isRecord(runtimeConfig)
    ? runtimeConfig.capabilities
    : undefined;
  if (declared !== undefined) {
    return isCapabilityManifest(declared)
      ? freezeManifest(declared)
      : BROWSER_RUNTIME_CAPABILITIES;
  }

  // Compatibility for packaged renderers from before the capability manifest.
  // The preload and renderer ship together, so this branch can be removed after
  // the first release that requires an explicit manifest.
  return isRecord(projectsApi)
    && typeof projectsApi.openHtml === "function"
    && typeof projectsApi.listRecentProjects === "function"
    && typeof projectsApi.openRecent === "function"
    ? DESKTOP_RUNTIME_CAPABILITIES
    : BROWSER_RUNTIME_CAPABILITIES;
}
