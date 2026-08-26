// Typed persistence failures for the Project File repository.
export class ProjectFileRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectFileRepositoryError";
    this.code = code;
    this.details = details;
  }
}

export function invalidRegisteredProjectError(cause) {
  return cause instanceof ProjectFileRepositoryError
    && new Set([
      "REGISTERED_PROJECT_IDENTITY_CHANGED",
      "REGISTERED_PROJECT_UNAVAILABLE",
      "PROJECT_IDENTITY_CHANGED",
      "UNREGISTERED_PROJECT_ROOT",
      "PROJECT_ROOT_NOT_FOUND",
      "PROJECT_CONTROL_NOT_FOUND",
      "UNSUPPORTED_PROJECT_SCHEMA",
      "INVALID_PROJECT_IDENTITY",
      "UNSUPPORTED_MANIFEST_SCHEMA",
      "MANIFEST_IDENTITY_MISMATCH",
      "INVALID_MANIFEST",
      "UNSUPPORTED_RUNTIME_SCHEMA",
      "RUNTIME_IDENTITY_MISMATCH",
      "INVALID_RUNTIME",
      "INVALID_JSON",
    ]).has(cause.code);
}

export function registeredProjectCatalogAvailability(cause) {
  if (!(cause instanceof ProjectFileRepositoryError)) return "invalid";
  return new Set([
    "REGISTERED_PROJECT_UNAVAILABLE",
    "PROJECT_ROOT_NOT_FOUND",
    "PROJECT_CONTROL_NOT_FOUND",
    "WORKING_COPY_UNAVAILABLE",
    "SOURCE_NOT_FOUND",
    "UNREGISTERED_PROJECT_ROOT",
    "PATH_ESCAPES_PROJECT",
    "UNSAFE_DIRECTORY",
  ]).has(cause.code)
    ? "unavailable"
    : "invalid";
}
