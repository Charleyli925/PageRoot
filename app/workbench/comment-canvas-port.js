const EMPTY_COMMENT_CANVAS_SNAPSHOT = Object.freeze({ selection: null });

/**
 * Stable, React-free adapter between HtmlCanvasEditor interaction events and
 * the comment capability container. It owns presentation signals only; the
 * CommentSession remains the sole owner of durable comment facts.
 */
export function createCommentCanvasPort() {
  let snapshot = EMPTY_COMMENT_CANVAS_SNAPSHOT;
  const listeners = new Set();
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSelection(selection) {
      if (snapshot.selection === selection) return;
      snapshot = Object.freeze({ selection });
      for (const listener of listeners) listener();
    },
  });
}
