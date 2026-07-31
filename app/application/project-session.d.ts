export type ProjectContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type ProjectLocator = {
  epoch: number;
  sourcePath: string | null;
};

export type ProjectSessionSnapshot = ProjectLocator & {
  projectId: string;
  documentId: string;
  registered: boolean;
};

export class ProjectSession {
  setObserver(
    observer: ((snapshot: ProjectSessionSnapshot) => void) | null,
  ): void;
  openLocator(sourcePath: string | null): ProjectLocator;
  register(value: ProjectContext): ProjectContext | null;
  transitionSource(value: {
    previousSourcePath?: string | null;
    sourcePath: string;
    projectId?: string;
    documentId?: string;
  }): ProjectContext | ProjectLocator | null;
  matches(context: ProjectContext): boolean;
  matchesLocator(locator: ProjectLocator): boolean;
  beginQuery(
    name: string,
    options?: { sourcePath?: string | null },
  ): unknown;
  isQueryCurrent(query: unknown): boolean;
  readonly locator: ProjectLocator;
  readonly context: ProjectContext | null;
  readonly snapshot: ProjectSessionSnapshot;
  readonly epoch: number;
  readonly sourcePath: string | null;
  readonly projectId: string;
  readonly documentId: string;
}
