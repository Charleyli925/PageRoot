import { createHash } from "node:crypto";

const MACHO_64_LE = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const MACHO_HEADER_64_BYTES = 32;
const MAX_LOAD_COMMANDS = 4_096;
const MAX_LOAD_COMMAND_BYTES = 16 * 1024 * 1024;

function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${label} exceeds the safe integer range.`);
  }
  return Number(value);
}

function zeroUInt64(buffer, offset) {
  buffer.writeBigUInt64LE(0n, offset);
}

export function machoCodeFingerprint(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < MACHO_HEADER_64_BYTES) {
    throw new TypeError("Codex Mach-O bytes are missing or truncated.");
  }
  if (bytes.readUInt32LE(0) !== MACHO_64_LE || bytes.readUInt32LE(4) !== CPU_TYPE_ARM64) {
    throw new TypeError("Codex runtime must be a thin arm64 Mach-O executable.");
  }
  const commandCount = bytes.readUInt32LE(16);
  const commandBytes = bytes.readUInt32LE(20);
  if (commandCount === 0 || commandCount > MAX_LOAD_COMMANDS
    || commandBytes === 0 || commandBytes > MAX_LOAD_COMMAND_BYTES
    || MACHO_HEADER_64_BYTES + commandBytes > bytes.byteLength) {
    throw new TypeError("Codex Mach-O load commands are invalid.");
  }
  let offset = MACHO_HEADER_64_BYTES;
  let codeSignature = null;
  let linkEdit = null;
  for (let index = 0; index < commandCount; index += 1) {
    if (offset + 8 > MACHO_HEADER_64_BYTES + commandBytes) {
      throw new TypeError("Codex Mach-O load command header is truncated.");
    }
    const command = bytes.readUInt32LE(offset);
    const commandSize = bytes.readUInt32LE(offset + 4);
    if (commandSize < 8 || commandSize % 4 !== 0
      || offset + commandSize > MACHO_HEADER_64_BYTES + commandBytes) {
      throw new TypeError("Codex Mach-O load command size is invalid.");
    }
    if (command === LC_SEGMENT_64 && commandSize >= 72) {
      const name = bytes.subarray(offset + 8, offset + 24)
        .toString("ascii").replace(/\0.*$/u, "");
      if (name === "__LINKEDIT") {
        if (linkEdit) throw new TypeError("Codex Mach-O has duplicate __LINKEDIT segments.");
        linkEdit = Object.freeze({
          commandOffset: offset,
          fileOffset: safeNumber(bytes.readBigUInt64LE(offset + 40), "__LINKEDIT file offset"),
          fileSize: safeNumber(bytes.readBigUInt64LE(offset + 48), "__LINKEDIT file size"),
        });
      }
    }
    if (command === LC_CODE_SIGNATURE) {
      if (commandSize !== 16 || codeSignature) {
        throw new TypeError("Codex Mach-O code-signature command is invalid.");
      }
      codeSignature = Object.freeze({
        commandOffset: offset,
        dataOffset: bytes.readUInt32LE(offset + 8),
        dataSize: bytes.readUInt32LE(offset + 12),
      });
    }
    offset += commandSize;
  }
  if (offset !== MACHO_HEADER_64_BYTES + commandBytes || !linkEdit || !codeSignature
    || codeSignature.dataOffset <= offset || codeSignature.dataSize === 0
    || codeSignature.dataOffset + codeSignature.dataSize !== bytes.byteLength
    || linkEdit.fileOffset >= codeSignature.dataOffset
    || linkEdit.fileOffset + linkEdit.fileSize !== bytes.byteLength) {
    throw new TypeError("Codex Mach-O signature or __LINKEDIT boundary is invalid.");
  }
  const canonical = Buffer.from(bytes.subarray(0, codeSignature.dataOffset));
  // Re-signing changes only the signature blob and these three load-command
  // sizes. Zero them so npm's Developer-ID binary and the packaged ad-hoc or
  // release-signed binary retain one code-content fingerprint.
  zeroUInt64(canonical, linkEdit.commandOffset + 32);
  zeroUInt64(canonical, linkEdit.commandOffset + 48);
  canonical.writeUInt32LE(0, codeSignature.commandOffset + 12);
  return Object.freeze({
    architecture: "arm64",
    codeLimit: codeSignature.dataOffset,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  });
}
