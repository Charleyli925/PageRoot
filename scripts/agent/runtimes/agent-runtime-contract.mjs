const SAFE_COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/u;

export function defineAgentRuntime(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent runtime must be an object.");
  }
  if (typeof value.runtimeId !== "string" || !SAFE_COMPONENT_ID.test(value.runtimeId)) {
    throw new TypeError("runtimeId must be a lower-case component identifier.");
  }
  if (typeof value.run !== "function") {
    throw new TypeError(`Agent runtime ${value.runtimeId} requires run().`);
  }
  for (const method of ["probe", "authenticate"]) {
    if (value[method] !== undefined && typeof value[method] !== "function") {
      throw new TypeError(`Agent runtime ${value.runtimeId} ${method} must be a function.`);
    }
  }
  return Object.freeze({ ...value });
}
