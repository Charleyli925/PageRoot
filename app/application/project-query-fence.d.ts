export type ProjectQueryIdentity = {
  epoch: number;
  projectId?: string;
  documentId?: string;
  sourcePath: string;
};

export type ProjectQueryTicket = Readonly<{
  key: string;
  sequence: number;
}>;

export class ProjectQueryFence {
  begin(identity: ProjectQueryIdentity, queryName: string): ProjectQueryTicket;
  isCurrent(ticket: ProjectQueryTicket): boolean;
  retire(identity: ProjectQueryIdentity): void;
  clear(): void;
}
