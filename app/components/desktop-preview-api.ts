export type DesktopPreviewSession = {
  sessionId: string;
  url: string;
};

export type DesktopPreviewApi = {
  createSession: (payload: {
    html: string;
    bootstrapJavaScript: string;
    sourcePath?: string;
  }) => Promise<DesktopPreviewSession>;
  revokeSession: (sessionId: string) => Promise<{ revoked: boolean }>;
};

declare global {
  interface Window {
    htmlAIPreview?: DesktopPreviewApi;
  }
}
