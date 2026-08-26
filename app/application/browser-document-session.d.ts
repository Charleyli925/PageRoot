import type { ProjectWorkflowProject } from "./project-workflow.js";

export type BrowserDocumentAuthority = Readonly<{
  key: string;
  previous: ProjectWorkflowProject | null;
}>;

export class BrowserDocumentSession {
  readonly size: number;
  retain(project: ProjectWorkflowProject): BrowserDocumentAuthority;
  restore(authority: BrowserDocumentAuthority): boolean;
  resolve(projectId: string, documentId: string): ProjectWorkflowProject | null;
  remove(projectId: string, documentId: string): boolean;
  dispose(): void;
}
