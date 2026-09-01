import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { PRODUCT_MAX_HTML_BYTES } from "./product-contract.mjs";

export const RECOVERY_JOURNAL_SCHEMA_VERSION = "1.0.0";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_ID_LENGTH = 160;
const MAX_PATH_LENGTH = 4096;

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertRecord(value, message = "恢复日志参数无效。") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
  return value;
}

function assertId(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_ID_LENGTH || text.includes("\0")) {
    throw new TypeError(`${label}无效。`);
  }
  return text;
}

function assertOptionalSha256(value, label) {
  const text = typeof value === "string" ? value : "";
  if (text && !SHA256.test(text)) throw new TypeError(`${label}无效。`);
  return text || null;
}

function assertRevision(value) {
  const next = Number(value);
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new TypeError("恢复日志 revision 无效。");
  }
  return next;
}

function assertSourcePath(value) {
  const text = typeof value === "string" ? value : "";
  if (!text || text.length > MAX_PATH_LENGTH || text.includes("\0")) {
    throw new TypeError("恢复日志源文件路径无效。");
  }
  return text;
}

function assertHtml(value) {
  if (typeof value !== "string" || !/<html(?:\s|>)/iu.test(value)) {
    throw new TypeError("恢复日志必须包含完整 HTML。");
  }
  if (Buffer.byteLength(value, "utf8") > PRODUCT_MAX_HTML_BYTES) {
    throw new RangeError("恢复 HTML 不能超过 25 MB。");
  }
  return value;
}

function locatorFrom(input) {
  const value = assertRecord(input);
  return Object.freeze({
    projectId: assertId(value.projectId, "projectId"),
    documentId: assertId(value.documentId, "documentId"),
  });
}

function locatorKey(locator) {
  return createHash("sha256")
    .update(`${locator.projectId}\0${locator.documentId}`)
    .digest("hex");
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function ensureOwnedDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const facts = await lstat(directory);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw recoveryError(
      "RECOVERY_JOURNAL_ROOT_UNSAFE",
      "恢复日志目录不安全，未写入恢复数据。",
    );
  }
}

async function atomicWrite(filePath, content) {
  const parent = path.dirname(filePath);
  await ensureOwnedDirectory(parent);
  const temporary = path.join(
    parent,
    `.pageroot-recovery-${process.pid}-${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    await syncDirectory(parent);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function normalizeEnvelope(value) {
  const raw = assertRecord(value, "恢复日志内容无效。");
  if (raw.schemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION) {
    throw recoveryError(
      "RECOVERY_JOURNAL_SCHEMA_UNSUPPORTED",
      "恢复日志版本不受支持。",
    );
  }
  const locator = locatorFrom(raw);
  const html = assertHtml(raw.html);
  const recoveryHtmlSha256 = assertOptionalSha256(
    raw.recoveryHtmlSha256,
    "recoveryHtmlSha256",
  );
  if (!recoveryHtmlSha256 || recoveryHtmlSha256 !== sha256(html)) {
    throw recoveryError(
      "RECOVERY_JOURNAL_HASH_MISMATCH",
      "恢复日志内容校验失败。",
    );
  }
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError("恢复日志 updatedAt 无效。");
  }
  return Object.freeze({
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    ...locator,
    sourcePath: assertSourcePath(raw.sourcePath),
    workingCopyId: typeof raw.workingCopyId === "string"
      ? raw.workingCopyId.slice(0, MAX_ID_LENGTH)
      : "",
    expectedSourceSha256: assertOptionalSha256(
      raw.expectedSourceSha256,
      "expectedSourceSha256",
    ),
    recoveryHtmlSha256,
    revision: assertRevision(raw.revision),
    updatedAt,
    html,
  });
}

function publicSummary(envelope, journalSha256) {
  return Object.freeze({
    schemaVersion: envelope.schemaVersion,
    projectId: envelope.projectId,
    documentId: envelope.documentId,
    sourcePath: envelope.sourcePath,
    workingCopyId: envelope.workingCopyId,
    expectedSourceSha256: envelope.expectedSourceSha256,
    recoveryHtmlSha256: envelope.recoveryHtmlSha256,
    journalSha256,
    revision: envelope.revision,
    updatedAt: envelope.updatedAt,
    byteLength: Buffer.byteLength(envelope.html, "utf8"),
  });
}

export function createRecoveryJournalStore({ rootPath, now = () => new Date() } = {}) {
  if (typeof rootPath !== "string" || !path.isAbsolute(rootPath)) {
    throw new TypeError("恢复日志目录必须是绝对路径。");
  }
  const root = path.resolve(rootPath);
  const queues = new Map();
  const entryPath = (locator) => path.join(root, `${locatorKey(locator)}.json`);
  const serialize = (envelope) => `${JSON.stringify(envelope)}\n`;

  const readEnvelope = async (locator) => {
    const filePath = entryPath(locator);
    let bytes;
    try {
      const facts = await lstat(filePath);
      if (!facts.isFile() || facts.isSymbolicLink()) {
        throw recoveryError(
          "RECOVERY_JOURNAL_ENTRY_UNSAFE",
          "恢复日志文件不安全。",
        );
      }
      bytes = await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw recoveryError("RECOVERY_JOURNAL_CORRUPT", "恢复日志已损坏。");
    }
    const envelope = normalizeEnvelope(parsed);
    if (
      envelope.projectId !== locator.projectId
      || envelope.documentId !== locator.documentId
    ) {
      throw recoveryError(
        "RECOVERY_JOURNAL_IDENTITY_MISMATCH",
        "恢复日志身份校验失败。",
      );
    }
    return Object.freeze({
      envelope,
      journalSha256: sha256(bytes),
    });
  };

  const serializeOperation = (locator, operation) => {
    const key = locatorKey(locator);
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    queues.set(key, current);
    current.finally(() => {
      if (queues.get(key) === current) queues.delete(key);
    }).catch(() => {});
    return current;
  };

  return Object.freeze({
    async initialize() {
      await ensureOwnedDirectory(root);
      return this.listRecoverable();
    },

    async commit(input) {
      const locator = locatorFrom(input);
      return serializeOperation(locator, async () => {
        const html = assertHtml(input.html);
        const incomingRevision = assertRevision(input.revision);
        const incomingHtmlSha256 = sha256(html);
        const expectedJournalSha256 = assertOptionalSha256(
          input.expectedJournalSha256,
          "expectedJournalSha256",
        );
        const current = await readEnvelope(locator);
        if (
          expectedJournalSha256
          && (!current || current.journalSha256 !== expectedJournalSha256)
        ) {
          throw recoveryError(
            "RECOVERY_JOURNAL_CAS_MISMATCH",
            "恢复日志已被更新，未覆盖较新的恢复副本。",
          );
        }
        if (current && current.envelope.revision > incomingRevision) {
          throw recoveryError(
            "RECOVERY_JOURNAL_STALE_REVISION",
            "较旧的恢复版本不能覆盖较新的恢复副本。",
          );
        }
        if (current && current.envelope.revision === incomingRevision) {
          if (
            current.envelope.recoveryHtmlSha256 !== incomingHtmlSha256
            || current.envelope.sourcePath !== assertSourcePath(input.sourcePath)
            || current.envelope.expectedSourceSha256 !== assertOptionalSha256(
              input.expectedSourceSha256,
              "expectedSourceSha256",
            )
          ) {
            throw recoveryError(
              "RECOVERY_JOURNAL_REVISION_CONFLICT",
              "同一恢复版本的内容或身份不一致。",
            );
          }
          return publicSummary(current.envelope, current.journalSha256);
        }
        const envelope = normalizeEnvelope({
          schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
          ...locator,
          sourcePath: input.sourcePath,
          workingCopyId: input.workingCopyId,
          expectedSourceSha256: input.expectedSourceSha256,
          recoveryHtmlSha256: incomingHtmlSha256,
          revision: incomingRevision,
          updatedAt: now().toISOString(),
          html,
        });
        await atomicWrite(entryPath(locator), serialize(envelope));
        const verified = await readEnvelope(locator);
        if (!verified) {
          throw recoveryError(
            "RECOVERY_JOURNAL_READBACK_FAILED",
            "恢复日志写入后无法读回校验。",
          );
        }
        return publicSummary(verified.envelope, verified.journalSha256);
      });
    },

    async readVerified(input) {
      const locator = locatorFrom(input);
      return serializeOperation(locator, async () => {
        await ensureOwnedDirectory(root);
        const verified = await readEnvelope(locator);
        if (!verified) return null;
        const expectedJournalSha256 = assertOptionalSha256(
          input.expectedJournalSha256,
          "expectedJournalSha256",
        );
        if (expectedJournalSha256 && verified.journalSha256 !== expectedJournalSha256) {
          throw recoveryError(
            "RECOVERY_JOURNAL_CAS_MISMATCH",
            "恢复日志凭证已过期。",
          );
        }
        return Object.freeze({
          ...publicSummary(verified.envelope, verified.journalSha256),
          html: verified.envelope.html,
        });
      });
    },

    async remove(input) {
      const locator = locatorFrom(input);
      return serializeOperation(locator, async () => {
        const verified = await readEnvelope(locator);
        if (!verified) return Object.freeze({ removed: false });
        const expectedJournalSha256 = assertOptionalSha256(
          input.expectedJournalSha256,
          "expectedJournalSha256",
        );
        if (!expectedJournalSha256) {
          throw recoveryError(
            "RECOVERY_JOURNAL_CAS_REQUIRED",
            "删除恢复日志必须提供最新校验凭证。",
          );
        }
        if (verified.journalSha256 !== expectedJournalSha256) {
          throw recoveryError(
            "RECOVERY_JOURNAL_CAS_MISMATCH",
            "恢复日志凭证已过期，未删除较新的恢复副本。",
          );
        }
        await rm(entryPath(locator));
        await syncDirectory(root);
        return Object.freeze({ removed: true });
      });
    },

    async listRecoverable() {
      await ensureOwnedDirectory(root);
      const entries = [];
      let invalidCount = 0;
      for (const name of await readdir(root)) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
        try {
          const bytes = await readFile(path.join(root, name));
          const envelope = normalizeEnvelope(JSON.parse(bytes.toString("utf8")));
          if (`${locatorKey(envelope)}.json` !== name) {
            throw recoveryError(
              "RECOVERY_JOURNAL_IDENTITY_MISMATCH",
              "恢复日志身份校验失败。",
            );
          }
          entries.push(publicSummary(envelope, sha256(bytes)));
        } catch {
          invalidCount += 1;
        }
      }
      entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return Object.freeze({ entries: Object.freeze(entries), invalidCount });
    },
  });
}
