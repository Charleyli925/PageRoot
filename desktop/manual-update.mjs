export const UPDATE_REPOSITORY = Object.freeze({
  owner: "Charleyli925",
  name: "PageRoot",
});

export const UPDATE_MANIFEST_URL =
  "https://github.com/Charleyli925/PageRoot/releases/latest/download/update-manifest.json";
export const PROJECT_REPOSITORY_URL =
  "https://github.com/Charleyli925/PageRoot";
export const LATEST_RELEASE_PAGE_URL =
  "https://github.com/Charleyli925/PageRoot/releases/latest";

export const UPDATE_MANIFEST_SCHEMA_VERSION = 1;
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
export const UPDATE_MANIFEST_MAX_BYTES = 32 * 1024;

const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MINIMUM_MACOS_VERSION = /^(1[2-9]|[2-9]\d)(?:\.\d+){0,2}$/;

export class ManualUpdateError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ManualUpdateError";
    this.code = code;
  }
}

function parseStrictVersion(value, label = "版本号") {
  if (typeof value !== "string") {
    throw new ManualUpdateError("INVALID_VERSION", `${label}无效。`);
  }
  const match = STRICT_VERSION.exec(value);
  if (!match) {
    throw new ManualUpdateError(
      "INVALID_VERSION",
      `${label}必须使用 x.y.z 格式。`,
    );
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

export function compareStrictVersions(left, right) {
  const leftParts = parseStrictVersion(left, "当前版本");
  const rightParts = parseStrictVersion(right, "远程版本");
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function validateUpdateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManualUpdateError("INVALID_MANIFEST", "更新清单必须是对象。");
  }
  const allowedKeys = new Set([
    "schemaVersion",
    "version",
    "minimumMacOS",
    "architectures",
    "publishedAt",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new ManualUpdateError("INVALID_MANIFEST", "更新清单包含未支持的字段。");
  }
  if (value.schemaVersion !== UPDATE_MANIFEST_SCHEMA_VERSION) {
    throw new ManualUpdateError("INVALID_MANIFEST", "更新清单版本不受支持。");
  }
  try {
    parseStrictVersion(value.version, "更新清单版本");
  } catch (cause) {
    throw new ManualUpdateError(
      "INVALID_MANIFEST",
      "更新清单版本无效。",
      { cause },
    );
  }
  if (
    typeof value.minimumMacOS !== "string"
    || !MINIMUM_MACOS_VERSION.test(value.minimumMacOS)
  ) {
    throw new ManualUpdateError("INVALID_MANIFEST", "最低 macOS 版本无效。");
  }
  if (
    !Array.isArray(value.architectures)
    || value.architectures.length === 0
    || value.architectures.length > SUPPORTED_ARCHITECTURES.size
    || new Set(value.architectures).size !== value.architectures.length
    || value.architectures.some(
      (architecture) => !SUPPORTED_ARCHITECTURES.has(architecture),
    )
  ) {
    throw new ManualUpdateError("INVALID_MANIFEST", "更新架构列表无效。");
  }
  if (
    typeof value.publishedAt !== "string"
    || Number.isNaN(Date.parse(value.publishedAt))
  ) {
    throw new ManualUpdateError("INVALID_MANIFEST", "更新时间无效。");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    version: value.version,
    minimumMacOS: value.minimumMacOS,
    architectures: Object.freeze([...value.architectures]),
    publishedAt: value.publishedAt,
  });
}

async function readManifestBody(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > UPDATE_MANIFEST_MAX_BYTES
  ) {
    throw new ManualUpdateError("MANIFEST_TOO_LARGE", "更新清单过大。");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > UPDATE_MANIFEST_MAX_BYTES) {
    throw new ManualUpdateError("MANIFEST_TOO_LARGE", "更新清单过大。");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new ManualUpdateError(
      "INVALID_MANIFEST",
      "更新清单不是有效 JSON。",
      { cause },
    );
  }
}

export async function checkForManualUpdate({
  currentVersion,
  architecture,
  fetchImpl,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
}) {
  parseStrictVersion(currentVersion, "当前版本");
  if (!SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new ManualUpdateError("UNSUPPORTED_ARCH", "当前设备架构不受支持。");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new RangeError("timeoutMs must be between 1 and 60000.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(UPDATE_MANIFEST_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new ManualUpdateError(
        "UPDATE_HTTP_ERROR",
        `更新服务返回 ${response?.status || "未知"}。`,
      );
    }
    const manifest = validateUpdateManifest(await readManifestBody(response));
    const comparison = compareStrictVersions(currentVersion, manifest.version);
    const supportsArchitecture = manifest.architectures.includes(architecture);
    return Object.freeze({
      status: comparison < 0
        ? supportsArchitecture
          ? "available"
          : "unsupported"
        : "current",
      currentVersion,
      latestVersion: manifest.version,
      minimumMacOS: manifest.minimumMacOS,
      architecture,
      publishedAt: manifest.publishedAt,
    });
  } catch (cause) {
    if (cause instanceof ManualUpdateError) throw cause;
    if (controller.signal.aborted) {
      throw new ManualUpdateError(
        "UPDATE_TIMEOUT",
        "检查更新超时。",
        { cause },
      );
    }
    throw new ManualUpdateError(
      "UPDATE_UNAVAILABLE",
      "暂时无法连接更新服务。",
      { cause },
    );
  } finally {
    clearTimeout(timeout);
  }
}
