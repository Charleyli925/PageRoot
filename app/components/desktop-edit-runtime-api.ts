import type { EditRuntimePort } from "../domain/edit-runtime-contract.js";

/** The renderer receives only the application-owned prepare/revoke port. */
export type DesktopEditRuntimeApi = EditRuntimePort;

declare global {
  interface Window {
    htmlAIEditRuntime?: DesktopEditRuntimeApi;
  }
}
