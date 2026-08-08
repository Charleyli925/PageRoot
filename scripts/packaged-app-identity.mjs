import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

function requiredString(value, label) {
  assert.equal(typeof value, "string", `${label} must be configured`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  return value;
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function plistString(xml, key, filePath) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`),
  );
  assert.ok(match, `${key} is missing from ${filePath}`);
  return decodeXml(match[1].trim());
}

export function expectedPackagedAppIdentity({
  packageJson,
  environment = process.env,
}) {
  return Object.freeze({
    name: requiredString(
      environment.PAGEROOT_EXPECTED_PRODUCT_NAME ?? packageJson?.build?.productName,
      "expected packaged product name",
    ),
    version: requiredString(
      environment.PAGEROOT_EXPECTED_APP_VERSION ?? packageJson?.version,
      "expected packaged app version",
    ),
    bundleId: requiredString(
      environment.PAGEROOT_EXPECTED_BUNDLE_ID ?? packageJson?.build?.appId,
      "expected packaged bundle id",
    ),
  });
}

export function assertPackagedAppIdentity(actual, expected) {
  assert.equal(
    actual?.name,
    expected.name,
    "runtime application name does not match build.productName",
  );
  assert.equal(
    actual?.version,
    expected.version,
    "runtime application version does not match package version",
  );
  assert.equal(
    actual?.bundleId,
    expected.bundleId,
    "running application Bundle ID does not match build.appId",
  );
  return Object.freeze({ ...actual });
}

export async function readPackagedPlistIdentity(appPath) {
  const resolvedAppPath = path.resolve(appPath);
  assert.equal(path.extname(resolvedAppPath), ".app", "packaged identity requires an app path");
  const infoPlistPath = path.join(resolvedAppPath, "Contents", "Info.plist");
  const xml = await readFile(infoPlistPath, "utf8");
  return Object.freeze({
    version: plistString(xml, "CFBundleShortVersionString", infoPlistPath),
    bundleVersion: plistString(xml, "CFBundleVersion", infoPlistPath),
    bundleId: plistString(xml, "CFBundleIdentifier", infoPlistPath),
  });
}
