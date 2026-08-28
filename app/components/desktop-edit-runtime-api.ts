import type { EditRuntimePort } from "../domain/edit-runtime-contract.js";

/** The renderer receives only application-owned runtime preparation ports. */
export type DesktopEditRuntimeApi = EditRuntimePort & Readonly<{
  prewarmRegistered?: (projectId: string) => Promise<Readonly<{
    projectId: string;
    documentId: string;
    sourceSha256: string;
    resourceSha256: string;
    scriptCount: number;
    byteLength: number;
    libraryOrigins: readonly string[];
  }> | null>;
}>;

declare global {
  interface Window {
    htmlAIEditRuntime?: DesktopEditRuntimeApi;
  }
}
