import type { EditRuntimePort } from "../domain/edit-runtime-contract.js";

/** The renderer receives only application-owned runtime preparation ports. */
export type DesktopEditRuntimeApi = EditRuntimePort;

declare global {
  interface Window {
    htmlAIEditRuntime?: DesktopEditRuntimeApi;
  }
}
