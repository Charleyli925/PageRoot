import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = fileURLToPath(new URL("..", import.meta.url));
const SCANNED_DIRECTORIES = ["scripts", "shared", "desktop", "app"];
const SCANNED_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "dist-desktop",
  ".next",
]);

// Generating `ver_0007` from an ordinal is fine and is how the identifier is
// minted. Recovering the ordinal by taking the identifier apart is not: it
// turns the identifier into a data carrier, and every such site has to be
// undone before Version identifiers can become globally unique instead of a
// zero-padded local counter. Nothing validates that a Working Copy identifier
// even agrees with its Version's ordinal, so the manifest is the only truthful
// source. `versionOrdinalFor` in bridge/project-file-repository/identity.mjs is the
// supported way to obtain it.
const ORDINAL_RECOVERY_PATTERNS = [
  {
    label: "slicing the identifier prefix off",
    pattern: /\.slice\(\s*["'`](?:work_)?ver_["'`]\s*\.length\s*\)/u,
  },
  {
    label: "parsing an integer out of the identifier",
    pattern: /parseInt\([^)]*(?:work_)?ver_/u,
  },
  {
    label: "stripping the identifier prefix",
    pattern: /\.replace\(\s*(?:["'`](?:work_)?ver_["'`]|\/\^?\(\?:\)?(?:work_)?ver_)/u,
  },
  {
    // A validator such as /^ver_\d{4,}$/ only proves the shape and is fine.
    // A capturing group around the digits is how a caller takes the number out.
    label: "capturing the digits out of the identifier",
    pattern: /(?:work_)?ver_\(\\d/u,
  },
];

// One decoder is allowed to read the ordinal out of an identifier, and only
// because it never uses it as data. `shared/direct-edit-compatibility.mjs`
// decodes immutable historical direct-edit records whose Version identifiers
// are, permanently, the zero-padded form that produced them. It extracts the
// number solely to fail closed on an out-of-range Version
// (`DIRECT_EDIT_VERSION_OUT_OF_RANGE`) and then returns the identifier
// unchanged. Archived bytes cannot be reissued under a new identifier scheme,
// so this reader stays as it is; see docs/COMPATIBILITY.md.
const HISTORICAL_DECODER_EXCEPTIONS = new Set([
  "shared/direct-edit-compatibility.mjs",
]);

async function sourceFiles(directory) {
  const absolute = path.join(productRoot, directory);
  const found = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(next);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue;
      found.push(next);
    }
  };
  await walk(absolute);
  return found;
}

test("no module recovers a Version ordinal by taking an identifier apart", async () => {
  const offenders = [];
  const seenExceptions = new Set();
  for (const directory of SCANNED_DIRECTORIES) {
    for (const filePath of await sourceFiles(directory)) {
      const relative = path.relative(productRoot, filePath);
      const contents = await readFile(filePath, "utf8");
      for (const { label, pattern } of ORDINAL_RECOVERY_PATTERNS) {
        if (!pattern.test(contents)) continue;
        if (HISTORICAL_DECODER_EXCEPTIONS.has(relative)) {
          seenExceptions.add(relative);
          continue;
        }
        offenders.push(`${relative}: ${label}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "read the ordinal from the manifest with versionOrdinalFor instead of "
    + "recovering it from an identifier",
  );
  // An exception that stopped matching is an exception that should be deleted.
  assert.deepEqual(
    [...seenExceptions].sort(),
    [...HISTORICAL_DECODER_EXCEPTIONS].sort(),
    "a documented historical decoder no longer reads an ordinal; remove it "
    + "from the exception list",
  );
});
