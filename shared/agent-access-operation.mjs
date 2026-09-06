const SAFE_PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_-]{1,80}$/u;

export const ACCESS_OPERATION_KINDS = Object.freeze([
  "install",
  "login",
  "config-validate",
  "disconnect",
  "logout",
  "delete-credential",
]);

export const ACCESS_OPERATION_STATES = Object.freeze([
  "running",
  "waiting",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ACCESS_OPERATION_TERMINAL_STATES = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
]);

export function accessOperationId({ providerId, kind, generation }) {
  return `access_${providerId}_${kind}_${generation}`;
}

export function createAccessOperation({
  providerId,
  kind,
  generation,
  state = kind === "login" ? "waiting" : "running",
  startedAt = null,
  errorCode = null,
} = {}) {
  if (!SAFE_PROVIDER_ID.test(String(providerId || ""))) {
    throw new TypeError("Access operation providerId is invalid.");
  }
  if (!ACCESS_OPERATION_KINDS.includes(kind)) {
    throw new TypeError(`Access operation kind ${JSON.stringify(kind)} is unsupported.`);
  }
  const gen = Number(generation);
  if (!Number.isSafeInteger(gen) || gen < 1) {
    throw new TypeError("Access operation generation is invalid.");
  }
  if (!ACCESS_OPERATION_STATES.includes(state)) {
    throw new TypeError("Access operation state is invalid.");
  }
  return Object.freeze({
    operationId: accessOperationId({ providerId, kind, generation: gen }),
    providerId,
    kind,
    state,
    generation: gen,
    startedAt: typeof startedAt === "string" && startedAt ? startedAt : null,
    errorCode: SAFE_ERROR_CODE.test(String(errorCode || "")) ? String(errorCode) : null,
    cancellable: state === "running" || state === "waiting",
  });
}

export function publicAccessOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return createAccessOperation(value);
  } catch {
    return null;
  }
}

export function finishAccessOperation(operation, { state, errorCode = null } = {}) {
  if (!operation) throw new TypeError("Access operation is missing.");
  if (!ACCESS_OPERATION_TERMINAL_STATES.includes(state)) {
    throw new TypeError("Access operation must finish in a terminal state.");
  }
  return createAccessOperation({
    ...operation,
    state,
    errorCode,
  });
}

export function requestCancelAccessOperation(operation) {
  const current = publicAccessOperation(operation);
  if (!current) return null;
  if (ACCESS_OPERATION_TERMINAL_STATES.includes(current.state) || current.state === "cancelling") {
    return current;
  }
  return createAccessOperation({
    ...current,
    state: "cancelling",
  });
}

export function isStaleAccessOperation(operation, generation) {
  const current = publicAccessOperation(operation);
  return !current || current.generation !== Number(generation);
}

const CREDENTIAL_FIELD_BY_CODE = Object.freeze({
  AGENT_AUTH_REQUIRED: "apiKey",
  AGENT_SESSION_CREDENTIAL_INVALID: "apiKey",
  AGENT_SELECTION_UNSUPPORTED: "modelId",
  AGENT_MODEL_ACCESS_DENIED: "modelId",
  AGENT_ENDPOINT_REGION_MISMATCH: "baseUrl",
});

export function credentialErrorField(code) {
  return CREDENTIAL_FIELD_BY_CODE[String(code || "")] || null;
}

const INSTALL_STATE_TO_ACCESS = Object.freeze({
  installing: "running",
  cancelling: "cancelling",
  failed: "failed",
});

export function accessOperationFromInstallSnapshot(snapshot) {
  if (!snapshot?.providerId) return null;
  const state = INSTALL_STATE_TO_ACCESS[snapshot.installState];
  if (!state) return null;
  const generation = Number(snapshot.generation);
  return publicAccessOperation({
    providerId: snapshot.providerId,
    kind: "install",
    generation: Number.isSafeInteger(generation) && generation >= 1 ? generation : 1,
    state,
    startedAt: snapshot.startedAt || null,
    errorCode: snapshot.errorCode || null,
  });
}

const LOGIN_STATE_TO_ACCESS = Object.freeze({
  waiting: "waiting",
  cancelling: "cancelling",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
});

export function accessOperationFromLoginSnapshot(snapshot) {
  if (!snapshot?.providerId) return null;
  const state = LOGIN_STATE_TO_ACCESS[snapshot.loginState];
  if (!state) return null;
  const generation = Number(snapshot.generation);
  return publicAccessOperation({
    providerId: snapshot.providerId,
    kind: "login",
    generation: Number.isSafeInteger(generation) && generation >= 1 ? generation : 1,
    state,
    startedAt: snapshot.startedAt || null,
    errorCode: snapshot.errorCode || null,
  });
}
