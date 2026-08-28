export type WorkbenchInspector = "comments" | "ai" | "review" | "none";

export function deriveWorkbenchInspector(input?: {
  canvasMode?: "edit" | "preview";
  aiVisible?: boolean;
  reviewVisible?: boolean;
  commentsAvailable?: boolean;
}): WorkbenchInspector;
