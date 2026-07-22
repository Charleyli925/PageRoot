export const QODER_HANDOFF_MAX_BYTES = 256 * 1024;

export function normalizeQoderHandoffPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("QoderWork 交接参数无效。");
  }
  if (Object.keys(payload).some((key) => key !== "message")) {
    throw new TypeError("QoderWork 交接参数包含未支持的字段。");
  }
  if (typeof payload.message !== "string" || !payload.message.trim()) {
    throw new TypeError("QoderWork 交接消息不能为空。");
  }
  const byteLength = Buffer.byteLength(payload.message, "utf8");
  if (byteLength > QODER_HANDOFF_MAX_BYTES) {
    throw new RangeError("QoderWork 交接消息过长。");
  }
  return {
    message: payload.message,
    byteLength,
  };
}

export async function handoffToQoderWork(payload, {
  writeClipboard,
  readClipboard,
} = {}) {
  const { message, byteLength } = normalizeQoderHandoffPayload(payload);
  if (typeof writeClipboard !== "function") {
    throw new TypeError("QoderWork 交接缺少剪贴板写入能力。");
  }
  if (typeof readClipboard !== "function") {
    throw new TypeError("QoderWork 交接缺少剪贴板校验能力。");
  }

  await writeClipboard(message);
  const copiedMessage = await readClipboard();
  if (copiedMessage !== message) {
    throw new Error("剪贴板写入后校验失败，请重试。");
  }
  return {
    status: "copied",
    copied: true,
    opened: false,
    pasted: false,
    byteLength,
    reason: null,
  };
}
