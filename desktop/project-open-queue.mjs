/**
 * Serializes complete main-process project-open transitions. A transition may
 * read a source file and update the durable active/recent project state, so
 * its place in the queue is assigned when the IPC arrives, not when I/O
 * happens to finish.
 */
export function createProjectOpenQueue() {
  let tail = Promise.resolve();

  return Object.freeze({
    run(operation) {
      if (typeof operation !== "function") {
        throw new TypeError("项目打开操作必须是函数。");
      }
      const result = tail.then(operation, operation);
      // A failed read or a dismissed picker must not strand later requests.
      tail = result.catch(() => undefined);
      return result;
    },
  });
}
