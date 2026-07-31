export type ProjectRulesContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type ProjectRulesSnapshot = {
  open: boolean;
  path: "PROJECT.md";
  content: string;
  savedContent: string;
  loading: boolean;
  error: string;
  saving: boolean;
  saveError: string;
  compositionActive: boolean;
  editorGeneration: number;
};

export class ProjectRulesSession {
  constructor(options: {
    bridgeClient: {
      projectFile: (
        sourcePath: string,
        relativePath: string,
      ) => Promise<{ content?: unknown }>;
      updateProjectFile: (payload: {
        sourcePath: string;
        projectId: string;
        documentId: string;
        content: string;
      }) => Promise<unknown>;
    };
    errorMessage?: (cause: unknown, fallback: string) => string;
  });
  setObserver(observer: ((snapshot: ProjectRulesSnapshot) => void) | null): void;
  open(context: ProjectRulesContext): Promise<boolean>;
  close(): void;
  updateContent(content: string): boolean;
  beginComposition(target: unknown, baselineValue: string): number | null;
  finishComposition(target: unknown): boolean;
  leaveEditor(): boolean;
  restore(): number | null;
  settleRestore(compositionEpoch: number | null): boolean;
  readonly compositionActive: boolean;
  save(options?: { locked?: boolean }): Promise<boolean>;
  inspect(options?: { locked?: boolean }):
    | { state: "resolved" }
    | { state: "pending" | "blocked"; reason: string };
  readonly snapshot: ProjectRulesSnapshot;
}
