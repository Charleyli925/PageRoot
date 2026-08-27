function initialSnapshot() {
  return Object.freeze({
    openRulesRevision: 0,
    editorRestoreRequest: null,
  });
}

export function createProjectPanelPort() {
  let snapshot = initialSnapshot();
  let requestSequence = 0;
  const listeners = new Set();

  const publish = (next) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Project-panel presentation cannot affect workflow authority.
      }
    }
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("ProjectPanelPort listener must be a function.");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestOpenRules() {
      publish({
        ...snapshot,
        openRulesRevision: snapshot.openRulesRevision + 1,
      });
    },
    requestEditorRestore(settle) {
      if (typeof settle !== "function") return;
      if (listeners.size === 0) {
        settle();
        return;
      }
      snapshot.editorRestoreRequest?.settle();
      publish({
        ...snapshot,
        editorRestoreRequest: Object.freeze({
          requestId: ++requestSequence,
          settle,
        }),
      });
    },
    settleEditorRestore(requestId) {
      const request = snapshot.editorRestoreRequest;
      if (!request || request.requestId !== requestId) return false;
      request.settle();
      publish({ ...snapshot, editorRestoreRequest: null });
      return true;
    },
  });
}
