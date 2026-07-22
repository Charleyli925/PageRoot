import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const unusedPrivacyKeys = [
  "NSMicrophoneUsageDescription",
  "NSAudioCaptureUsageDescription",
  "NSCameraUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
];

export default async function removeUnusedPrivacyPrompts(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const infoPlist = path.join(context.appOutDir, appName, "Contents", "Info.plist");
  const bridgeDirectory = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
    "bridge",
  );
  const productRoot = context.packager.projectDir || process.cwd();

  // electron-builder excludes a file from app.asar when the same source is
  // declared as an extraResource. Keep the canonical contract in app.asar and
  // replace the local-development shim with its exact bytes for Bridge runtime.
  await mkdir(bridgeDirectory, { recursive: true });
  await copyFile(
    path.join(productRoot, "desktop", "product-contract.mjs"),
    path.join(bridgeDirectory, "product-contract.mjs"),
  );

  for (const key of unusedPrivacyKeys) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, infoPlist], {
        stdio: "ignore",
      });
    } catch {
      // Electron versions differ in their default Info.plist keys.
    }
  }
}
