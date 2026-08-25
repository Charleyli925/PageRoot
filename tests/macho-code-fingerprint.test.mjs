import assert from "node:assert/strict";
import test from "node:test";

import { machoCodeFingerprint } from "../scripts/agent/macho-code-fingerprint.mjs";

function signedMachO({ signatureBytes = 16, codeByte = 0x5a } = {}) {
  const commandsEnd = 120;
  const codeLimit = 152;
  const bytes = Buffer.alloc(codeLimit + signatureBytes, 0);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(88, 20);

  const segment = 32;
  bytes.writeUInt32LE(0x19, segment);
  bytes.writeUInt32LE(72, segment + 4);
  bytes.write("__LINKEDIT", segment + 8, "ascii");
  bytes.writeBigUInt64LE(BigInt(codeLimit - commandsEnd + signatureBytes), segment + 32);
  bytes.writeBigUInt64LE(BigInt(commandsEnd), segment + 40);
  bytes.writeBigUInt64LE(BigInt(codeLimit - commandsEnd + signatureBytes), segment + 48);

  const signature = segment + 72;
  bytes.writeUInt32LE(0x1d, signature);
  bytes.writeUInt32LE(16, signature + 4);
  bytes.writeUInt32LE(codeLimit, signature + 8);
  bytes.writeUInt32LE(signatureBytes, signature + 12);
  bytes.fill(codeByte, commandsEnd, codeLimit);
  bytes.fill(0xa5, codeLimit);
  return bytes;
}

test("Mach-O code fingerprint survives re-signing but changes with executable content", () => {
  const developerSigned = signedMachO({ signatureBytes: 64 });
  const adHocSigned = signedMachO({ signatureBytes: 16 });
  assert.equal(
    machoCodeFingerprint(developerSigned).sha256,
    machoCodeFingerprint(adHocSigned).sha256,
  );
  const changedCode = signedMachO({ signatureBytes: 16, codeByte: 0x5b });
  assert.notEqual(
    machoCodeFingerprint(developerSigned).sha256,
    machoCodeFingerprint(changedCode).sha256,
  );
});

test("Mach-O code fingerprint rejects another architecture or malformed signature bounds", () => {
  const wrongArchitecture = signedMachO();
  wrongArchitecture.writeUInt32LE(0x01000007, 4);
  assert.throws(() => machoCodeFingerprint(wrongArchitecture), /thin arm64/u);

  const malformed = signedMachO();
  malformed.writeUInt32LE(8, 32 + 72 + 12);
  assert.throws(() => machoCodeFingerprint(malformed), /signature or __LINKEDIT boundary/u);
});
