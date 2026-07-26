#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const LEGACY_RENDERER_STATE =
  /["'](?:waiting|importing|result-ready|awaiting-check-decision|version-created|completed|canceled|waived)["']/;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ? [absolutePath]
      : [];
  }));
  return nested.flat();
}

function relative(filePath) {
  return path.relative(PRODUCT_ROOT, filePath).split(path.sep).join("/");
}

function importedSpecifiers(source) {
  return [
    ...source.matchAll(
      /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

export async function architectureViolations() {
  const files = await sourceFiles(path.join(PRODUCT_ROOT, "app"));
  const violations = [];
  for (const filePath of files) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    if (
      /\bfetch\s*\(/.test(source)
      && file !== "app/application/bridge-client.js"
    ) {
      violations.push(`${file}: raw fetch belongs to bridge-client`);
    }
    if (
      /\b(?:localStorage|sessionStorage)\b/.test(source)
      && file !== "app/application/recovery-store.js"
      && file !== "app/components/HtmlInteractionPreview.tsx"
    ) {
      violations.push(`${file}: browser persistence belongs to recovery-store`);
    }
    if (
      /BRIDGE_URL|127\.0\.0\.1:\$\{?bridgePort|["'`]\/(?:workspace|draft|autosave|request|attachment|status|source|version-file|project-file)["'`]/.test(
        source,
      )
      && file !== "app/application/bridge-client.js"
    ) {
      violations.push(`${file}: Bridge endpoint knowledge belongs to bridge-client`);
    }
    if (
      LEGACY_RENDERER_STATE.test(source)
      && file !== "app/domain/run-lifecycle.js"
    ) {
      violations.push(`${file}: legacy lifecycle aliases belong to run-lifecycle`);
    }
    if (
      /(?:bridgeClient|this\.\#bridgeClient)\.saveDraft\s*\(/.test(source)
      && file !== "app/application/draft-session.js"
    ) {
      violations.push(`${file}: draft mutations belong to DraftSession`);
    }

    const imports = importedSpecifiers(source);
    if (file.startsWith("app/domain/")) {
      for (const specifier of imports) {
        if (
          /(?:^|\/)(?:application|components|desktop)(?:\/|$)/.test(specifier)
          || specifier === "react"
        ) {
          violations.push(`${file}: domain code cannot import ${specifier}`);
        }
      }
    }
    if (file.startsWith("app/application/")) {
      for (const specifier of imports) {
        if (/(?:^|\/)(?:components|desktop)(?:\/|$)/.test(specifier)) {
          violations.push(`${file}: application code cannot import ${specifier}`);
        }
      }
    }
    if (file.startsWith("app/components/")) {
      for (const specifier of imports) {
        if (/(?:^|\/)application(?:\/|$)/.test(specifier)) {
          violations.push(`${file}: view components cannot import application services`);
        }
      }
    }
  }

  const scriptFiles = await sourceFiles(path.join(PRODUCT_ROOT, "scripts"));
  for (const filePath of scriptFiles) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      if (
        /(?:^|\/)app\/(?:application|components)(?:\/|$)/.test(specifier)
        || /(?:^|\/)app\/workbench(?:\.|\/|$)/.test(specifier)
      ) {
        violations.push(`${file}: Bridge and build scripts cannot import renderer code`);
      }
    }
    if (
      /DRAFT_REVISION_CONFLICT|INVALID_DRAFT_OPERATION_ID|INVALID_DELETED_COMMENT_ID/.test(
        source,
      )
      && ![
        "scripts/draft-service.mjs",
        "scripts/check-architecture.mjs",
      ].includes(file)
    ) {
      violations.push(`${file}: draft command policy belongs to draft-service`);
    }
  }

  const workbench = await readFile(
    path.join(PRODUCT_ROOT, "app", "workbench.tsx"),
    "utf8",
  );
  const registrationStart = workbench.indexOf(
    "const ensureProjectRegistered = useCallback",
  );
  const registrationEnd = workbench.indexOf(
    "const prepareProjectRecords = useCallback",
    registrationStart,
  );
  const registrationBoundary = registrationStart >= 0 && registrationEnd > registrationStart
    ? workbench.slice(registrationStart, registrationEnd)
    : "";
  if (
    !registrationBoundary.includes("draftSessionRef.current.replaceAuthority(")
    || !registrationBoundary.includes("draftAuthorityFromWorkspace(payload)")
  ) {
    violations.push(
      "app/workbench.tsx: project registration must bind authoritative DraftSession state",
    );
  }
  if (
    !/if \(!activeSource \|\| !activeProjectId \|\| !activeDocumentId\) return null;/.test(
      workbench,
    )
  ) {
    violations.push(
      "app/workbench.tsx: registered project contexts cannot contain empty identities",
    );
  }
  if (
    !workbench.includes("resolveRuntimeCapabilities({")
    || !workbench.includes(
      'runtimeCapabilitiesRef.current.sourceEditing !== "enabled"',
    )
    || !workbench.includes(
      'runtimeCapabilitiesRef.current.projectOpening === "browser-file"',
    )
    || !workbench.includes(
      "runtimeCapabilitiesRef.current.attachmentPersistence",
    )
  ) {
    violations.push(
      "app/workbench.tsx: runtime features must use the central capability manifest",
    );
  }
  if (/const previewOnly = !window\.htmlAIProjects/.test(workbench)) {
    violations.push(
      "app/workbench.tsx: project IPC presence cannot own renderer edit capability",
    );
  }
  for (const boundary of ["close", "switch", "submit", "history"]) {
    if (!new RegExp(`\\.drain\\("${boundary}"`).test(workbench)) {
      violations.push(
        `app/workbench.tsx: ${boundary} must use the shared DrainCoordinator`,
      );
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await architectureViolations();
  if (violations.length > 0) {
    process.stderr.write(`Architecture contract failed:\n- ${violations.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Architecture contract passed.\n");
  }
}
