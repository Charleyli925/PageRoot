// Public preference values only. Credentials, endpoints and resolved runtime
// evidence do not belong in UI preferences.
export function normalizeAgentConfigurations(value) {
  const result = {};
  for (const id of ["pageroot", "qoder", "codex"]) {
    const entry = value?.[id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const modelId = entry.modelId === null ? null : entry.modelId;
    const reasoning = entry.reasoning === null ? null : entry.reasoning;
    if (modelId !== null && (typeof modelId !== "string" || modelId.length > 160
      || !modelId.startsWith(`${id}:`) || !/^[A-Za-z0-9._/:+-]+$/u.test(modelId))) continue;
    if (reasoning !== null && (typeof reasoning !== "string"
      || !/^[A-Za-z0-9_-]{1,40}$/u.test(reasoning))) continue;
    result[id] = Object.freeze({ modelId, reasoning });
  }
  return Object.freeze(result);
}

export function validAgentConfigurations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const normalized = normalizeAgentConfigurations(value);
  return Object.keys(value).every((id) => normalized[id]
    && Object.keys(value[id]).every((key) => key === "modelId" || key === "reasoning"));
}

// Document choice is a preference, never execution authorization. Keep its
// bounded identity-only map separate from the application default.
export function normalizeDocumentAgentSelections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([id, provider]) => (
    /^doc_[a-f0-9]{16,64}$/u.test(id) && ["pageroot", "qoder", "codex"].includes(provider)
  )).slice(-128)));
}

export function validDocumentAgentSelections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(normalizeDocumentAgentSelections(value)).length === Object.keys(value).length;
}
