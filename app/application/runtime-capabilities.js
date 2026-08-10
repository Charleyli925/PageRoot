const SOURCE_EDITING = new Set(["enabled", "read-only"]);
const PROJECT_OPENING = new Set(["desktop-dialog", "browser-file"]);
const ATTACHMENT_PERSISTENCE = new Set(["bridge", "memory", "none"]);
const CLOSE_COORDINATION = new Set(["electron-handshake", "browser-beforeunload"]);
const INTERACTIVE_PREVIEW = new Set(["independent-url", "srcdoc"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCapabilityManifest(value) {
  return isRecord(value)
    && SOURCE_EDITING.has(value.sourceEditing)
    && PROJECT_OPENING.has(value.projectOpening)
    && ATTACHMENT_PERSISTENCE.has(value.attachmentPersistence)
    && CLOSE_COORDINATION.has(value.closeCoordination)
    && INTERACTIVE_PREVIEW.has(value.interactivePreview);
}

function freezeManifest(value) {
  return Object.freeze({
    sourceEditing: value.sourceEditing,
    projectOpening: value.projectOpening,
    attachmentPersistence: value.attachmentPersistence,
    closeCoordination: value.closeCoordination,
    interactivePreview: value.interactivePreview,
  });
}

export const BROWSER_RUNTIME_CAPABILITIES = freezeManifest({
  sourceEditing: "read-only",
  projectOpening: "browser-file",
  attachmentPersistence: "none",
  closeCoordination: "browser-beforeunload",
  interactivePreview: "srcdoc",
});

export const DESKTOP_RUNTIME_CAPABILITIES = freezeManifest({
  sourceEditing: "enabled",
  projectOpening: "desktop-dialog",
  attachmentPersistence: "bridge",
  closeCoordination: "electron-handshake",
  interactivePreview: "independent-url",
});

export function resolveRuntimeCapabilities({
  runtimeConfig,
} = {}) {
  const declared = isRecord(runtimeConfig)
    ? runtimeConfig.capabilities
    : undefined;
  if (declared !== undefined) {
    return isCapabilityManifest(declared)
      ? freezeManifest(declared)
      : BROWSER_RUNTIME_CAPABILITIES;
  }

  return BROWSER_RUNTIME_CAPABILITIES;
}
