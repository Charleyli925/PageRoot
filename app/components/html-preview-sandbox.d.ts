export const EDITOR_STYLE_ATTRIBUTE: string;
export const FRAME_VERIFICATION_ATTRIBUTE: string;

export function disableExecutableMarkup(source: string): string;
export function sanitizePreviewDocument(
  source: string,
  baseUrl?: string,
): string;
export function prepareVerifiedFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    baseUrl?: string;
    editorStyles?: string;
  },
): string;
export function prepareStaticRuntimeSnapshotFrameDocument(
  source: string,
  verificationToken: string,
  options: {
    hosts: readonly {
      key: string;
      path: readonly number[];
      tagName: string;
      identityAttributes: readonly (readonly [string, string])[];
    }[];
    baseUrl?: string;
    editorStyles?: string;
  },
): string | null;
export function prepareCanvasFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    mode?: "static";
    baseUrl?: string;
    editorStyles?: string;
  } | {
    mode: "static-runtime-snapshot";
    hosts: readonly {
      key: string;
      path: readonly number[];
      tagName: string;
      identityAttributes: readonly (readonly [string, string])[];
    }[];
    baseUrl?: string;
    editorStyles?: string;
  },
): string | null;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
