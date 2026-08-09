export const LOCAL_USER_ACTION_KINDS = Object.freeze([
  "show-source-in-folder",
  "open-source-in-browser",
  "open-project-records",
  "reveal-request-folder",
  "reveal-version-file",
]);

const LOCAL_USER_ACTION_KIND_SET = new Set(LOCAL_USER_ACTION_KINDS);

/**
 * Executes exactly one user-authorized local side effect. Failure is reported
 * to the caller's presentation owner; it is never replayed on a timer.
 */
export async function runLocalUserAction({
  kind,
  invoke,
  onSuccess,
  onFailure,
} = {}) {
  if (!LOCAL_USER_ACTION_KIND_SET.has(kind)) {
    throw new TypeError("Unknown local user action.");
  }
  if (typeof invoke !== "function") {
    throw new TypeError("Local user action requires an invoke function.");
  }
  if (onSuccess !== undefined && typeof onSuccess !== "function") {
    throw new TypeError("Local user action success handler must be a function.");
  }
  if (onFailure !== undefined && typeof onFailure !== "function") {
    throw new TypeError("Local user action failure handler must be a function.");
  }

  try {
    const value = await invoke();
    onSuccess?.(value);
    return Object.freeze({ kind, status: "succeeded", value });
  } catch (cause) {
    onFailure?.(cause);
    return Object.freeze({ kind, status: "failed", cause });
  }
}
