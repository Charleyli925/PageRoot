import {
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const USAGE_TELEMETRY_STATE_VERSION = 1;
export const USAGE_TELEMETRY_CONFIG_VERSION = 1;
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const MAX_STATE_BYTES = 512 * 1024;
const MAX_QUEUE_LENGTH = 500;
const MAX_BATCH_LENGTH = 50;
const FLUSH_INTERVAL_MS = 15_000;
const AGGREGATE_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const INSTALL_ID_PATTERN =
  /^install_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROJECT_ID_PATTERN = /^project_[A-Za-z0-9_-]{1,180}$/u;
const PROJECT_KEY_PATTERN = /^project_[a-f0-9]{24}$/u;
const INSERT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8,16}$/u;

const MODULES = new Set([
  "about",
  "canvas_edit",
  "canvas_preview",
  "handoff",
  "history",
  "project_files",
  "project_menu",
  "project_rules",
]);
const PERSIST_STATES = new Set([
  "idle",
  "preview-dirty",
  "queued",
  "writing",
  "failed",
  "conflict",
]);
const RUN_STATES = new Set([
  "none",
  "editing",
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "ready",
  "no-change",
  "complete",
  "cancelled",
  "error",
]);
const NOTICE_CODES = new Set([
  "ai_run_cancelled",
  "attachment_batch",
  "attachment_cleanup",
  "attachment_download",
  "attachment_preview",
  "autosave_recovery",
  "background_version",
  "browser_file_error",
  "canvas_c01_source_map",
  "canvas_c02_edit_blocked",
  "canvas_c03_style_boundary",
  "canvas_c04_empty_formatting",
  "canvas_c05_complex_structure",
  "canvas_c06_special_layout",
  "canvas_c09_structure_delete",
  "canvas_c10_ime_incomplete",
  "canvas_c11_target_drift",
  "canvas_c12_edit_in_progress",
  "current_version_result",
  "export",
  "history_navigation",
  "project_open_error",
  "project_registration",
  "qoder_handoff",
  "reveal_request_folder",
  "reveal_version_file",
  "show_project_in_folder_error",
  "show_project_records_error",
  "source_reload",
  "submit_blocked",
  "unfinished_comment_draft",
  "unsafe_comment_targets",
  "uncatalogued",
]);
const NOTICE_TONES = new Set(["success", "info", "warning", "error"]);
const NOTICE_DISPOSITIONS = new Set([
  "silent-recover",
  "defer-and-resume",
  "direct-action",
  "user-choice",
  "background-result",
  "inform-in-place",
]);
const NOTICE_SURFACES = new Set(["canvas", "global", "native", "panel"]);
const NOTICE_INTERACTIONS = new Set(["action", "dismiss", "auto-dismiss"]);
const INTERRUPTION_CODES = new Set([
  "ai_conflict_resolution",
  "close_safety",
  "project_load_failure",
  "source_conflict",
  "startup_recovery",
  "update_restart_confirmation",
  "workspace_unavailable",
]);
const INTERRUPTION_PHASES = new Set(["started", "resolved"]);
const INTERRUPTION_RESULTS = new Set([
  "cancelled",
  "continued",
  "dismissed",
  "failed",
  "recovered",
  "unknown",
]);
const EDIT_KINDS = new Set(["text", "style", "reorder", "structure"]);
const EDIT_PROPERTY_GROUPS = new Set([
  "background",
  "border",
  "color",
  "font",
  "layout",
  "spacing",
  "text",
  "unknown",
]);
const TARGET_LEVELS = new Set(["insertion", "module", "part"]);
const COUNT_BUCKETS = new Set(["0", "1", "2-5", "6-20", "21+"]);
const RENDERER_FAULT_KINDS = new Set([
  "react_caught",
  "react_recoverable",
  "react_uncaught",
  "unhandled_rejection",
  "window_error",
]);
const RUNTIME_PROCESSES = new Set(["bridge", "main", "renderer"]);
const RUNTIME_FAULT_KINDS = new Set([
  "bridge_exit",
  "bridge_start",
  "main_uncaught",
  "renderer_gone",
  "renderer_unresponsive",
  "renderer_responsive",
  "startup_failure",
]);
const OPERATION_RESULTS = new Set(["cancelled", "failure", "success"]);
const DURATION_BUCKETS = new Set([
  "<100ms",
  "100-499ms",
  "500ms-1.9s",
  "2-9s",
  "10-59s",
  "1m+",
]);
const EXIT_REASONS = new Set(["quit", "relaunch", "update", "unknown"]);

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function enumValue(values) {
  return (value) => (
    typeof value === "string" && values.has(value) ? value : undefined
  );
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}

function boundedInteger(minimum, maximum) {
  return (value) => (
    Number.isInteger(value) && value >= minimum && value <= maximum
      ? value
      : undefined
  );
}

function fingerprintValue(value) {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value)
    ? value
    : undefined;
}

function internalCode(value) {
  return typeof value === "string"
    && /^[A-Z][A-Z0-9_]{1,79}$/u.test(value)
    ? value
    : undefined;
}

function operationName(value) {
  return typeof value === "string"
    && /^[a-z][a-z0-9_]{1,63}$/u.test(value)
    ? value
    : undefined;
}

const RENDERER_EVENT_SCHEMAS = Object.freeze({
  module_viewed: Object.freeze({
    module: enumValue(MODULES),
  }),
  project_context_opened: Object.freeze({
    registered: booleanValue,
    view_mode: enumValue(new Set(["current", "history"])),
  }),
  direct_edit_committed: Object.freeze({
    edit_kind: enumValue(EDIT_KINDS),
    property_group: enumValue(EDIT_PROPERTY_GROUPS),
  }),
  source_persistence_changed: Object.freeze({
    from_state: enumValue(PERSIST_STATES),
    to_state: enumValue(PERSIST_STATES),
  }),
  comment_saved: Object.freeze({
    target_level: enumValue(TARGET_LEVELS),
    has_text: booleanValue,
    attachment_count: enumValue(COUNT_BUCKETS),
    has_image: booleanValue,
    has_file: booleanValue,
  }),
  ai_run_state_changed: Object.freeze({
    from_state: enumValue(RUN_STATES),
    to_state: enumValue(RUN_STATES),
    comment_count: enumValue(COUNT_BUCKETS),
    edit_count: enumValue(COUNT_BUCKETS),
  }),
  notification_presented: Object.freeze({
    notice_code: enumValue(NOTICE_CODES),
    tone: enumValue(NOTICE_TONES),
    disposition: enumValue(NOTICE_DISPOSITIONS),
    surface: enumValue(NOTICE_SURFACES),
    has_action: booleanValue,
  }),
  notification_interacted: Object.freeze({
    notice_code: enumValue(NOTICE_CODES),
    interaction: enumValue(NOTICE_INTERACTIONS),
    surface: enumValue(NOTICE_SURFACES),
  }),
  interruption_changed: Object.freeze({
    interruption_code: enumValue(INTERRUPTION_CODES),
    phase: enumValue(INTERRUPTION_PHASES),
    result: enumValue(INTERRUPTION_RESULTS),
    surface: enumValue(NOTICE_SURFACES),
  }),
  renderer_fault: Object.freeze({
    kind: enumValue(RENDERER_FAULT_KINDS),
    fingerprint: fingerprintValue,
    fatal: booleanValue,
  }),
});

const INTERNAL_EVENT_SCHEMAS = Object.freeze({
  app_launched: Object.freeze({
    launch_reason: enumValue(new Set(["normal", "second_instance"])),
  }),
  app_session_ended: Object.freeze({
    reason: enumValue(EXIT_REASONS),
    duration_bucket: enumValue(DURATION_BUCKETS),
  }),
  direct_edit_batch: Object.freeze({
    edit_kind: enumValue(EDIT_KINDS),
    property_group: enumValue(EDIT_PROPERTY_GROUPS),
    edit_count: boundedInteger(1, 10_000),
  }),
  source_save_batch: Object.freeze({
    save_count: boundedInteger(1, 10_000),
  }),
  operation_finished: Object.freeze({
    operation: operationName,
    result: enumValue(OPERATION_RESULTS),
    error_code: internalCode,
    duration_bucket: enumValue(DURATION_BUCKETS),
  }),
  runtime_fault: Object.freeze({
    process: enumValue(RUNTIME_PROCESSES),
    kind: enumValue(RUNTIME_FAULT_KINDS),
    reason_code: internalCode,
    fingerprint: fingerprintValue,
    exit_code: boundedInteger(-1, 255),
  }),
});

const ALL_EVENT_SCHEMAS = Object.freeze({
  ...RENDERER_EVENT_SCHEMAS,
  ...INTERNAL_EVENT_SCHEMAS,
});

function sanitizeProperties(schema, value) {
  if (!isPlainRecord(value)) return {};
  const sanitized = {};
  for (const [key, validator] of Object.entries(schema)) {
    const next = validator(value[key]);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

function requiredPropertiesPresent(event, properties) {
  switch (event) {
    case "module_viewed":
      return Boolean(properties.module);
    case "project_context_opened":
      return typeof properties.registered === "boolean"
        && Boolean(properties.view_mode);
    case "direct_edit_committed":
      return Boolean(properties.edit_kind && properties.property_group);
    case "source_persistence_changed":
      return Boolean(properties.from_state && properties.to_state);
    case "comment_saved":
      return Boolean(
        properties.target_level
        && properties.attachment_count
        && typeof properties.has_text === "boolean"
        && typeof properties.has_image === "boolean"
        && typeof properties.has_file === "boolean",
      );
    case "ai_run_state_changed":
      return Boolean(
        properties.from_state
        && properties.to_state
        && properties.comment_count
        && properties.edit_count,
      );
    case "notification_presented":
      return Boolean(
        properties.notice_code
        && properties.tone
        && properties.disposition
        && properties.surface,
      ) && typeof properties.has_action === "boolean";
    case "notification_interacted":
      return Boolean(
        properties.notice_code
        && properties.interaction
        && properties.surface,
      );
    case "interruption_changed":
      return Boolean(
        properties.interruption_code
        && properties.phase
        && properties.result
        && properties.surface,
      );
    case "renderer_fault":
      return Boolean(properties.kind && properties.fingerprint)
        && typeof properties.fatal === "boolean";
    case "app_launched":
      return Boolean(properties.launch_reason);
    case "app_session_ended":
      return Boolean(properties.reason && properties.duration_bucket);
    case "direct_edit_batch":
      return Boolean(
        properties.edit_kind
        && properties.property_group
        && properties.edit_count,
      );
    case "source_save_batch":
      return Boolean(properties.save_count);
    case "operation_finished":
      return Boolean(
        properties.operation
        && properties.result
        && properties.duration_bucket,
      );
    case "runtime_fault":
      return Boolean(properties.process && properties.kind);
    default:
      return true;
  }
}

export function normalizePostHogHost(value) {
  const candidate = typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_POSTHOG_HOST;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError("PostHog host must be a valid HTTPS origin.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new TypeError("PostHog host must be an HTTPS origin without credentials or a path.");
  }
  return url.origin;
}

export function normalizePostHogProjectToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) return "";
  if (!/^phc_[A-Za-z0-9_-]{12,256}$/u.test(token)) {
    throw new TypeError("PostHog project token must use the phc_ project-token format.");
  }
  return token;
}

export function createTelemetryBuildConfig(environment = process.env) {
  const projectToken = normalizePostHogProjectToken(
    environment.PAGEROOT_POSTHOG_TOKEN,
  );
  return Object.freeze({
    version: USAGE_TELEMETRY_CONFIG_VERSION,
    enabled: Boolean(projectToken),
    host: normalizePostHogHost(environment.PAGEROOT_POSTHOG_HOST),
    projectToken,
  });
}

export async function readTelemetryBuildConfig(filePath) {
  const information = await stat(filePath);
  if (!information.isFile() || information.size > 16 * 1024) {
    throw new TypeError("Packaged telemetry configuration is invalid.");
  }
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (
    !isPlainRecord(parsed)
    || parsed.version !== USAGE_TELEMETRY_CONFIG_VERSION
    || typeof parsed.enabled !== "boolean"
  ) {
    throw new TypeError("Packaged telemetry configuration has an unsupported schema.");
  }
  const projectToken = normalizePostHogProjectToken(parsed.projectToken);
  return Object.freeze({
    version: USAGE_TELEMETRY_CONFIG_VERSION,
    enabled: parsed.enabled && Boolean(projectToken),
    host: normalizePostHogHost(parsed.host),
    projectToken,
  });
}

export function durationBucket(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "1m+";
  if (durationMs < 100) return "<100ms";
  if (durationMs < 500) return "100-499ms";
  if (durationMs < 2_000) return "500ms-1.9s";
  if (durationMs < 10_000) return "2-9s";
  if (durationMs < 60_000) return "10-59s";
  return "1m+";
}

function newTelemetryState() {
  return {
    version: USAGE_TELEMETRY_STATE_VERSION,
    installId: `install_${randomUUID()}`,
    projectKeySecret: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(),
    queue: [],
  };
}

function validStateIdentity(value) {
  return isPlainRecord(value)
    && value.version === USAGE_TELEMETRY_STATE_VERSION
    && typeof value.installId === "string"
    && INSTALL_ID_PATTERN.test(value.installId)
    && typeof value.projectKeySecret === "string"
    && /^[A-Za-z0-9_-]{40,60}$/u.test(value.projectKeySecret)
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt));
}

function restoreQueueItem(value) {
  if (
    !isPlainRecord(value)
    || typeof value.event !== "string"
    || !Object.hasOwn(ALL_EVENT_SCHEMAS, value.event)
    || typeof value.timestamp !== "string"
    || !Number.isFinite(Date.parse(value.timestamp))
    || typeof value.insertId !== "string"
    || !INSERT_ID_PATTERN.test(value.insertId)
    || typeof value.sessionId !== "string"
    || !INSERT_ID_PATTERN.test(value.sessionId)
    || (
      value.projectKey !== undefined
      && (
        typeof value.projectKey !== "string"
        || !PROJECT_KEY_PATTERN.test(value.projectKey)
      )
    )
  ) return null;
  const properties = sanitizeProperties(
    ALL_EVENT_SCHEMAS[value.event],
    value.properties,
  );
  if (!requiredPropertiesPresent(value.event, properties)) return null;
  return {
    event: value.event,
    timestamp: new Date(value.timestamp).toISOString(),
    insertId: value.insertId,
    sessionId: value.sessionId,
    properties,
    ...(value.projectKey ? { projectKey: value.projectKey } : {}),
  };
}

async function loadTelemetryState(statePath) {
  try {
    const information = await stat(statePath);
    if (!information.isFile() || information.size > MAX_STATE_BYTES) {
      return newTelemetryState();
    }
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    if (!validStateIdentity(parsed)) return newTelemetryState();
    return {
      version: USAGE_TELEMETRY_STATE_VERSION,
      installId: parsed.installId,
      projectKeySecret: parsed.projectKeySecret,
      createdAt: new Date(parsed.createdAt).toISOString(),
      queue: Array.isArray(parsed.queue)
        ? parsed.queue
          .slice(-MAX_QUEUE_LENGTH)
          .map(restoreQueueItem)
          .filter(Boolean)
        : [],
    };
  } catch {
    return newTelemetryState();
  }
}

function postHogEventName(event) {
  return `pageroot ${event.replaceAll("_", " ")}`;
}

function batchPayload({ token, state, appMetadata, items }) {
  return {
    api_key: token,
    historical_migration: false,
    batch: items.map((item) => ({
      event: postHogEventName(item.event),
      timestamp: item.timestamp,
      properties: {
        distinct_id: state.installId,
        $insert_id: item.insertId,
        $process_person_profile: false,
        $geoip_disable: true,
        $is_server: false,
        $session_id: item.sessionId,
        telemetry_schema: USAGE_TELEMETRY_STATE_VERSION,
        app_version: appMetadata.version,
        app_platform: appMetadata.platform,
        app_architecture: appMetadata.architecture,
        ...(item.projectKey ? { project_key: item.projectKey } : {}),
        ...item.properties,
      },
    })),
  };
}

function timeoutSignal(timeoutMs) {
  if (typeof globalThis.AbortSignal?.timeout === "function") {
    return globalThis.AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export function createUsageTelemetry({
  userDataPath,
  projectToken = "",
  host = DEFAULT_POSTHOG_HOST,
  enabled = true,
  appVersion = "0.0.0",
  platform = process.platform,
  architecture = process.arch,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  onDiagnostic = () => {},
} = {}) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("Usage telemetry requires an absolute userData path.");
  }
  const token = normalizePostHogProjectToken(projectToken);
  const normalizedHost = normalizePostHogHost(host);
  const active = Boolean(enabled && token && typeof fetchImpl === "function");
  const statePath = path.join(userDataPath, "usage-telemetry.json");
  const sessionId = randomUUID();
  const startedAt = now();
  const appMetadata = Object.freeze({
    version: String(appVersion || "0.0.0").slice(0, 40),
    platform: ["darwin", "linux", "win32"].includes(platform)
      ? platform
      : "other",
    architecture: ["arm64", "x64"].includes(architecture)
      ? architecture
      : "other",
  });

  let state = null;
  let started = false;
  let stopped = false;
  let flushPromise = null;
  let flushTimer = null;
  let aggregateTimer = null;
  let retryDelayMs = 1_000;
  let persistQueue = Promise.resolve();
  let lastImmediateIdentity = "";
  let lastImmediateAt = 0;
  const editAggregates = new Map();
  const saveAggregates = new Map();

  const projectKeyFor = (projectId) => {
    if (
      !state
      || typeof projectId !== "string"
      || !PROJECT_ID_PATTERN.test(projectId)
    ) return null;
    const digest = createHmac(
      "sha256",
      Buffer.from(state.projectKeySecret, "base64url"),
    ).update(projectId, "utf8").digest("hex");
    return `project_${digest.slice(0, 24)}`;
  };

  const persist = () => {
    if (!state) return persistQueue;
    const snapshot = JSON.stringify({
      version: USAGE_TELEMETRY_STATE_VERSION,
      installId: state.installId,
      projectKeySecret: state.projectKeySecret,
      createdAt: state.createdAt,
      queue: state.queue.slice(-MAX_QUEUE_LENGTH),
    });
    persistQueue = persistQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(userDataPath, { recursive: true, mode: 0o700 });
        const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, statePath);
      })
      .catch((error) => {
        onDiagnostic("state-write-failed", error);
      });
    return persistQueue;
  };

  const scheduleFlush = (delayMs = FLUSH_INTERVAL_MS) => {
    if (!active || stopped || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, delayMs);
    flushTimer.unref?.();
  };

  const queueSanitized = (event, properties, projectKey = null) => {
    if (!active || !state || stopped) return false;
    const identity = JSON.stringify([event, properties, projectKey]);
    const currentTime = now();
    if (
      identity === lastImmediateIdentity
      && currentTime - lastImmediateAt < 500
    ) return false;
    lastImmediateIdentity = identity;
    lastImmediateAt = currentTime;
    state.queue.push({
      event,
      properties,
      timestamp: new Date(currentTime).toISOString(),
      insertId: randomUUID(),
      sessionId,
      ...(projectKey ? { projectKey } : {}),
    });
    if (state.queue.length > MAX_QUEUE_LENGTH) {
      state.queue.splice(0, state.queue.length - MAX_QUEUE_LENGTH);
    }
    void persist();
    if (state.queue.length >= 20) void flush();
    else scheduleFlush();
    return true;
  };

  const flushAggregates = () => {
    if (aggregateTimer) {
      clearTimeout(aggregateTimer);
      aggregateTimer = null;
    }
    for (const aggregate of editAggregates.values()) {
      queueSanitized(
        "direct_edit_batch",
        {
          edit_kind: aggregate.editKind,
          property_group: aggregate.propertyGroup,
          edit_count: Math.min(10_000, aggregate.count),
        },
        aggregate.projectKey,
      );
    }
    editAggregates.clear();
    for (const aggregate of saveAggregates.values()) {
      queueSanitized(
        "source_save_batch",
        { save_count: Math.min(10_000, aggregate.count) },
        aggregate.projectKey,
      );
    }
    saveAggregates.clear();
  };

  const scheduleAggregateFlush = () => {
    if (aggregateTimer || stopped) return;
    aggregateTimer = setTimeout(flushAggregates, AGGREGATE_INTERVAL_MS);
    aggregateTimer.unref?.();
  };

  const aggregateRendererEvent = (event, properties, projectKey) => {
    if (event === "direct_edit_committed") {
      const key = [
        projectKey || "none",
        properties.edit_kind,
        properties.property_group,
      ].join(":");
      const current = editAggregates.get(key) || {
        projectKey,
        editKind: properties.edit_kind,
        propertyGroup: properties.property_group,
        count: 0,
      };
      current.count += 1;
      editAggregates.set(key, current);
      if ([...editAggregates.values()].reduce(
        (total, item) => total + item.count,
        0,
      ) >= 25) {
        flushAggregates();
      } else {
        scheduleAggregateFlush();
      }
      return true;
    }
    if (
      event === "source_persistence_changed"
      && properties.to_state === "idle"
    ) {
      const key = projectKey || "none";
      const current = saveAggregates.get(key) || {
        projectKey,
        count: 0,
      };
      current.count += 1;
      saveAggregates.set(key, current);
      scheduleAggregateFlush();
      return true;
    }
    if (
      event === "source_persistence_changed"
      && !["failed", "conflict"].includes(properties.to_state)
    ) {
      return true;
    }
    return false;
  };

  const captureWithSchema = (
    schemas,
    event,
    properties = {},
    { projectId } = {},
  ) => {
    if (!active || !started || stopped || !Object.hasOwn(schemas, event)) {
      return false;
    }
    const sanitized = sanitizeProperties(schemas[event], properties);
    if (!requiredPropertiesPresent(event, sanitized)) return false;
    const projectKey = projectKeyFor(projectId);
    if (
      schemas === RENDERER_EVENT_SCHEMAS
      && aggregateRendererEvent(event, sanitized, projectKey)
    ) return true;
    return queueSanitized(event, sanitized, projectKey);
  };

  async function flush() {
    if (!active || !started || !state || state.queue.length === 0) {
      return { sent: 0, pending: state?.queue.length ?? 0 };
    }
    if (flushPromise) return flushPromise;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const items = state.queue.slice(0, MAX_BATCH_LENGTH);
    const payload = batchPayload({
      token,
      state,
      appMetadata,
      items,
    });
    flushPromise = (async () => {
      try {
        const response = await fetchImpl(`${normalizedHost}/batch/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: timeoutSignal(REQUEST_TIMEOUT_MS),
        });
        if (!response?.ok) {
          throw new Error(`PostHog batch rejected with status ${response?.status ?? 0}.`);
        }
        const sentInsertIds = new Set(items.map((item) => item.insertId));
        state.queue = state.queue.filter(
          (item) => !sentInsertIds.has(item.insertId),
        );
        retryDelayMs = 1_000;
        await persist();
        if (state.queue.length > 0) scheduleFlush(0);
        return { sent: items.length, pending: state.queue.length };
      } catch (error) {
        onDiagnostic("batch-send-failed", error);
        scheduleFlush(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        return { sent: 0, pending: state.queue.length };
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  return Object.freeze({
    async start({ launchReason = "normal" } = {}) {
      if (started) return active;
      state = await loadTelemetryState(statePath);
      started = true;
      await persist();
      if (active) {
        captureWithSchema(
          INTERNAL_EVENT_SCHEMAS,
          "app_launched",
          { launch_reason: launchReason },
        );
        if (state.queue.length > 0) scheduleFlush(0);
      }
      return active;
    },
    capture(event, properties = {}, context = {}) {
      return captureWithSchema(
        ALL_EVENT_SCHEMAS,
        event,
        properties,
        context,
      );
    },
    captureFromRenderer(payload) {
      if (
        !isPlainRecord(payload)
        || Object.keys(payload).some(
          (key) => !["event", "properties", "projectId"].includes(key),
        )
        || typeof payload.event !== "string"
        || (
          payload.projectId !== undefined
          && (
            typeof payload.projectId !== "string"
            || !PROJECT_ID_PATTERN.test(payload.projectId)
          )
        )
      ) return false;
      return captureWithSchema(
        RENDERER_EVENT_SCHEMAS,
        payload.event,
        payload.properties,
        { projectId: payload.projectId },
      );
    },
    async flush() {
      flushAggregates();
      return flush();
    },
    async shutdown({ reason = "unknown", timeoutMs = 1_500 } = {}) {
      if (!started || stopped) return;
      captureWithSchema(
        INTERNAL_EVENT_SCHEMAS,
        "app_session_ended",
        {
          reason: EXIT_REASONS.has(reason) ? reason : "unknown",
          duration_bucket: durationBucket(now() - startedAt),
        },
      );
      flushAggregates();
      if (flushTimer) clearTimeout(flushTimer);
      if (aggregateTimer) clearTimeout(aggregateTimer);
      flushTimer = null;
      aggregateTimer = null;
      await persist();
      await Promise.race([
        flush(),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, timeoutMs));
          timer.unref?.();
        }),
      ]).catch(() => {});
      stopped = true;
      await persistQueue.catch(() => {});
    },
    inspect() {
      return Object.freeze({
        active,
        started,
        stopped,
        installId: state?.installId ?? null,
        sessionId,
        pending: state?.queue.length ?? 0,
        statePath,
      });
    },
  });
}
