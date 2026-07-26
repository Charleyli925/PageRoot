export type RuntimeCapabilities = Readonly<{
  sourceEditing: "enabled" | "read-only";
  projectOpening: "desktop-dialog" | "browser-file";
  attachmentPersistence: "bridge" | "memory" | "none";
  closeCoordination: "electron-handshake" | "browser-beforeunload";
}>;

export const BROWSER_RUNTIME_CAPABILITIES: RuntimeCapabilities;
export const DESKTOP_RUNTIME_CAPABILITIES: RuntimeCapabilities;

export function resolveRuntimeCapabilities(options?: {
  runtimeConfig?: {
    capabilities?: unknown;
  } | null;
  projectsApi?: unknown;
}): RuntimeCapabilities;
