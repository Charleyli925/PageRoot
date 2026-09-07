const succeeded = (value) => Object.freeze({ status: "succeeded", value });
const rejected = (code, reason) => Object.freeze({ status: "rejected", code, reason });
const stale = (identity) => Object.freeze({ status: "stale", ...identity });

// A query procedure for the existing controller-owned catalog. No state lives
// here: Session publication and identity changes advance the same generation.
export async function loadCatalogVersionSummaries({ projectId, refresh = false,
  getSnapshot, generations, publish, read, decode, isDisposed,
}) {
    const id = String(projectId || "");
    const current = getSnapshot().versionSummaries[id];
    const documentId = getSnapshot().registered.find((row) => row.projectId === id)?.documentId || current?.documentId;
    const retained = current?.documentId === documentId ? current : null;
    if (!refresh && retained?.status === "loading") {
      return Object.freeze({ status: "blocked", code: "PROJECT_SUMMARIES_LOADING", reason: "正在读取版本摘要。" });
    }
    if (!refresh && retained?.status === "ready") {
      return succeeded({ projectId: id, documentId, versions: retained.versions });
    }
    const generation = (generations.get(id) || 0) + 1;
    generations.set(id, generation);
    publish(id, { documentId, versions: retained?.versions || [], status: "loading", reason: "" });
    let outcome;
    try { outcome = await read(id); }
    catch (cause) { outcome = rejected("PROJECT_VERSION_SUMMARIES_REJECTED", cause.message); }
    if (isDisposed() || generations.get(id) !== generation) return stale({ projectId: id });
    if (outcome.status === "succeeded") {
      try {
        if (outcome.value.projectId !== id || (documentId && outcome.value.documentId !== documentId)) throw new TypeError("项目摘要身份已变化。");
        const versions = decode(outcome.value);
        publish(id, { documentId: outcome.value.documentId, versions, status: "ready", reason: "" });
        return succeeded({ ...outcome.value, versions });
      } catch (cause) {
        outcome = rejected("PROJECT_VERSION_SUMMARIES_REJECTED", cause.message);
      }
    }
    publish(id, { documentId, versions: retained?.versions || [], status: "error", reason: outcome.reason || "版本摘要未更新。" });
    return outcome;
}
