export type ProjectPanelPortSnapshot = Readonly<{
  openRulesRevision: number;
  editorRestoreRequest: Readonly<{
    requestId: number;
    settle(): void;
  }> | null;
}>;

export type ProjectPanelPort = Readonly<{
  getSnapshot(): ProjectPanelPortSnapshot;
  subscribe(listener: () => void): () => void;
  requestOpenRules(): void;
  requestEditorRestore(settle: () => void): void;
  settleEditorRestore(requestId: number): boolean;
}>;

export function createProjectPanelPort(): ProjectPanelPort;
