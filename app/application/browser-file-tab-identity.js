const SOURCE_SHA256 = /^sha256:[a-f0-9]{64}$/u;

export async function createBrowserFileTabIdentity({
  name,
  size,
  lastModified,
  sourceSha256,
  sha256,
}) {
  const normalizedName = String(name || "").normalize("NFC");
  const normalizedSize = Number(size);
  const normalizedLastModified = Number(lastModified);
  if (
    !normalizedName
    || normalizedName.length > 255
    || !Number.isSafeInteger(normalizedSize)
    || normalizedSize < 0
    || !Number.isSafeInteger(normalizedLastModified)
    || normalizedLastModified < 0
    || !SOURCE_SHA256.test(String(sourceSha256 || ""))
    || typeof sha256 !== "function"
  ) throw new TypeError("valid browser file metadata and Hash are required");

  const digest = await sha256(JSON.stringify([
    "browser-file-tab-identity-v1",
    normalizedName,
    normalizedSize,
    normalizedLastModified,
    sourceSha256,
  ]));
  if (!SOURCE_SHA256.test(String(digest || ""))) {
    throw new TypeError("browser file identity digest is invalid");
  }
  const hex = digest.slice("sha256:".length);
  return Object.freeze({
    projectId: `project_browser_${hex}`,
    documentId: `doc_browser_${hex}`,
  });
}
