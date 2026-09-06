import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const AGENT_SESSION_CREDENTIAL_FILE_NAME = "agent-session-credential.v1.json";
const SCHEMA_VERSION = 1;
const MAX_BYTES = 16_384;
const PROVIDER_ID = "pageroot";
const SAFE_VENDOR = /^(?:deepseek|zhipu|dashscope|openai|custom)$/u;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,79}$/u;
const HTTPS_ORIGIN = /^https:\/\//u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function credentialPath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("Agent credential store requires an absolute userData path.");
  }
  return path.join(userDataPath, AGENT_SESSION_CREDENTIAL_FILE_NAME);
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 200 || !HTTPS_ORIGIN.test(text)) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

function publicStatus(record) {
  if (!record) {
    return Object.freeze({
      available: true,
      remembered: false,
      providerId: PROVIDER_ID,
      vendorId: null,
    });
  }
  return Object.freeze({
    available: true,
    remembered: true,
    providerId: PROVIDER_ID,
    vendorId: record.vendorId,
  });
}

async function atomicWrite(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (cause) {
    await unlink(temporaryPath).catch(() => {});
    throw cause;
  }
}

export function createAgentSessionCredentialStore({
  userDataPath,
  encryptString,
  decryptString,
  isEncryptionAvailable,
} = {}) {
  const filePath = credentialPath(userDataPath);
  const encrypt = typeof encryptString === "function" ? encryptString : null;
  const decrypt = typeof decryptString === "function" ? decryptString : null;
  const available = typeof isEncryptionAvailable === "function"
    ? () => isEncryptionAvailable() === true
    : () => false;

  async function readRecord() {
    let raw;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      return null;
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (parsed.providerId !== PROVIDER_ID || !SAFE_VENDOR.test(parsed.vendorId || "")) return null;
    if (typeof parsed.ciphertext !== "string" || !parsed.ciphertext) return null;
    return Object.freeze({
      providerId: PROVIDER_ID,
      vendorId: parsed.vendorId,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      modelId: SAFE_MODEL_ID.test(String(parsed.modelId || "")) ? String(parsed.modelId) : "",
      ciphertext: parsed.ciphertext,
      rememberedAt: typeof parsed.rememberedAt === "string" ? parsed.rememberedAt : null,
    });
  }

  return Object.freeze({
    status() {
      if (!available()) {
        return Object.freeze({
          available: false,
          remembered: false,
          providerId: PROVIDER_ID,
          vendorId: null,
          reason: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        });
      }
      return null;
    },
    async publicStatus() {
      const availability = this.status();
      if (availability) return availability;
      return publicStatus(await readRecord());
    },
    async persist({ apiKey, vendorId, baseUrl, modelId } = {}) {
      if (!available() || !encrypt) {
        return Object.freeze({
          ok: false,
          code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        });
      }
      const key = String(apiKey || "").trim();
      const vendor = String(vendorId || "").trim();
      if (!key || key.length > 8_192 || !SAFE_VENDOR.test(vendor)) {
        return Object.freeze({
          ok: false,
          code: "AGENT_SESSION_CREDENTIAL_INVALID",
        });
      }
      let ciphertext;
      try {
        const encrypted = encrypt(key);
        ciphertext = Buffer.isBuffer(encrypted)
          ? encrypted.toString("base64")
          : Buffer.from(String(encrypted || ""), "utf8").toString("base64");
      } catch {
        return Object.freeze({
          ok: false,
          code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        });
      }
      if (!ciphertext) {
        return Object.freeze({
          ok: false,
          code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        });
      }
      await atomicWrite(filePath, {
        schemaVersion: SCHEMA_VERSION,
        providerId: PROVIDER_ID,
        vendorId: vendor,
        baseUrl: vendor === "custom" ? normalizeBaseUrl(baseUrl) : "",
        modelId: vendor === "custom" && SAFE_MODEL_ID.test(String(modelId || ""))
          ? String(modelId)
          : "",
        ciphertext,
        rememberedAt: new Date().toISOString(),
      });
      return Object.freeze({ ok: true, remembered: true, vendorId: vendor });
    },
    async load() {
      if (!available() || !decrypt) return null;
      const record = await readRecord();
      if (!record) return null;
      let apiKey = "";
      try {
        apiKey = String(decrypt(Buffer.from(record.ciphertext, "base64")) || "").trim();
      } catch {
        return null;
      }
      if (!apiKey) return null;
      return Object.freeze({
        providerId: PROVIDER_ID,
        vendorId: record.vendorId,
        baseUrl: record.baseUrl,
        modelId: record.modelId || "",
        apiKey,
      });
    },
    async clear() {
      try {
        await unlink(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return Object.freeze({ ok: true, remembered: false });
    },
  });
}
