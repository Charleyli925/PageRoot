export function createBrowserFileTabIdentity(input: {
  name: string;
  size: number;
  lastModified: number;
  sourceSha256: string;
  sha256: (value: string) => Promise<string>;
}): Promise<Readonly<{
  projectId: string;
  documentId: string;
}>>;
