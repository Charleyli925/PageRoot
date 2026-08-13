import type { EditRuntimePort } from "../domain/edit-runtime-contract.js";

/** The preload exposes exactly the renderer owner's probe/revoke port. */
export type DesktopEditRuntimeApi = EditRuntimePort;

declare global {
  interface Window {
    htmlAIEditRuntime?: DesktopEditRuntimeApi;
  }
}
