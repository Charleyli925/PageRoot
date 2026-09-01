import type { DocumentWorkflowRecoveryJournal } from "../application/document-workflow.js";
import type {
  DesktopProjectsApi,
  DocumentRecoveryJournalCommit,
  DocumentRecoveryJournalLocator,
  DocumentRecoveryJournalRebase,
} from "./types";

export function createDesktopRecoveryJournalPort(
  api: DesktopProjectsApi | undefined,
): DocumentWorkflowRecoveryJournal | null {
  if (!api?.commitRecoveryJournal || !api.readRecoveryJournal || !api.removeRecoveryJournal) {
    return null;
  }
  return Object.freeze({
    commit: (input: Readonly<Record<string, unknown>>) => (
      api.commitRecoveryJournal!(input as DocumentRecoveryJournalCommit)
    ),
    readVerified: (input: Readonly<Record<string, unknown>>) => (
      api.readRecoveryJournal!(input as DocumentRecoveryJournalLocator)
    ),
    ...(api.rebaseRecoveryJournal ? {
      rebase: (input: Readonly<Record<string, unknown>>) => (
        api.rebaseRecoveryJournal!(input as DocumentRecoveryJournalRebase)
      ),
    } : {}),
    remove: (input: Readonly<Record<string, unknown>>) => (
      api.removeRecoveryJournal!(input as DocumentRecoveryJournalLocator)
    ),
  });
}
