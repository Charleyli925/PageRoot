// Runs the whole product path against authored pages, which nothing else
// does. The census exercises capture and comparison with its own host
// discoverer and synthetic documents; here buildReviewDocuments produces the
// candidates, the real owner captures them, the real classifier and merger
// decide, and the report is what a reviewer would actually see. Two product
// defects were only ever visible from here: genuine chart edits downgraded to
// amber, and unverifiable hosts spending more than the review's suspicion
// budget.
//
// Pages are read from paths given on the command line and never enter the
// repository; only derived counts are written out.
//
//   npm run e2e:review-pages -- <page.html> [more.html ...]

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, app, nativeImage, net, protocol, session as electronSession } from "electron";
import { build } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const bundleRoot = path.join(repo, "output/review-runtime-e2e");

const {
  createPreviewProtocolController,
  registerPreviewProtocolScheme,
} = await import(`${repo}/desktop/preview-protocol.mjs`);
const { createReviewRuntimeFrozenScriptStore } = await import(`${repo}/desktop/review-runtime-frozen-scripts.mjs`);
const { createRuntimeSnapshotCaptureController } = await import(`${repo}/desktop/runtime-visual-capture-owner.mjs`);
const { RUNTIME_VISUAL_CONTRACT } = await import(`${repo}/app/domain/runtime-visual-contract.js`);
const {
  acceptRuntimeVisualSnapshots,
  classifyReviewRuntimeVisualCandidates,
  mergeReviewRuntimeVisualChanges,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualPixelsAreUniform,
  reviewRuntimeVisualSnapshotComparison,
} = await import(`${repo}/app/lib/review-runtime-visual.js`);
const { reviewRuntimePageMutations } = await import(`${repo}/scripts/review-runtime-page-candidates.mjs`);

const VIEWPORT = Object.freeze({ width: 1_280, height: 900 });
// One frame per page is actionable information; more than that is a shared
// cause and belongs in a page-level fact, so the review's budget is one.
const SUSPICION_BUDGET = 1;
const sha = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

async function buildBundle() {
  mkdirSync(bundleRoot, { recursive: true });
  await build({
    root: repo,
    logLevel: "error",
    configFile: false,
    build: {
      lib: {
        entry: path.join(repo, "tests/helpers/review-runtime-e2e-entry.ts"),
        name: "ReviewE2E",
        formats: ["iife"],
        fileName: () => "review-e2e.js",
      },
      outDir: bundleRoot,
      emptyOutDir: true,
      minify: false,
    },
  });
  return readFileSync(path.join(bundleRoot, "review-e2e.js"), "utf8");
}

function decodedPixels(snapshot) {
  if (snapshot?.state !== "captured" || !snapshot.pngBytes?.byteLength) return null;
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(snapshot.pngBytes));
    if (image.isEmpty()) return null;
    return image.toBitmap();
  } catch {
    return null;
  }
}

function rasterEvidence(candidates, before, after) {
  const byKey = (list) => new Map(list.map((snapshot) => [snapshot.key, snapshot]));
  const beforeByKey = byKey(before);
  const afterByKey = byKey(after);
  const differenceByKey = new Map();
  const uniformKeys = new Set();
  candidates.forEach((candidate) => {
    const first = beforeByKey.get(candidate.key);
    const second = afterByKey.get(candidate.key);
    if (reviewRuntimeVisualSnapshotComparison(first, second) !== "raster") return;
    const firstPixels = decodedPixels(first);
    const secondPixels = decodedPixels(second);
    if (!firstPixels || !secondPixels) return;
    const difference = reviewRuntimeVisualMeanRgbDifference(firstPixels, secondPixels);
    if (Number.isFinite(difference)) differenceByKey.set(candidate.key, difference);
    if (
      reviewRuntimeVisualPixelsAreUniform(firstPixels)
      && reviewRuntimeVisualPixelsAreUniform(secondPixels)
    ) uniformKeys.add(candidate.key);
  });
  return { differenceByKey, uniformKeys };
}

async function main() {
  const pages = process.argv.slice(process.argv.indexOf("--") + 1);
  if (!pages.length) throw new Error("Expected at least one page path.");
  registerPreviewProtocolScheme(protocol);
  app.on("window-all-closed", () => {});
  await app.whenReady();
  const bundle = await buildBundle();

  const previewController = createPreviewProtocolController({
    protocolApi: protocol,
    netFetch: (url, options) => net.fetch(url, options),
    maxHtmlBytes: RUNTIME_VISUAL_CONTRACT.pageBudget.htmlBytes,
  });
  previewController.install();
  const controller = createRuntimeSnapshotCaptureController({
    BrowserWindowClass: BrowserWindow,
    createSession: (payload) => previewController.createSession(payload),
    revokeSession: (sessionId) => Promise.resolve(previewController.revokeSession(sessionId)),
    createIsolatedSession: (partition) => {
      const isolated = electronSession.fromPartition(partition);
      previewController.installFor(isolated.protocol);
      return isolated;
    },
    releaseIsolatedSession: async (isolated) => {
      await Promise.all([
        Promise.resolve(isolated.clearStorageData?.()).catch(() => undefined),
        Promise.resolve(isolated.protocol?.unhandle?.("pageroot-preview")).catch(() => undefined),
        Promise.resolve(isolated.protocol?.unhandle?.("https")).catch(() => undefined),
      ]);
    },
    frozenChartScripts: createReviewRuntimeFrozenScriptStore({
      netFetch: (url, options) => net.fetch(url, options),
    }),
  });

  const analyst = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  await analyst.loadURL("about:blank");
  await analyst.webContents.executeJavaScript(bundle);

  let sequence = 0;
  const rows = [];
  for (const pagePath of pages) {
    const html = readFileSync(path.resolve(pagePath), "utf8");
    const label = path.basename(pagePath).slice(0, 30);
    for (const mutation of reviewRuntimePageMutations(html, [], [])) {
      sequence += 1;
      const sessionId = `review-e2e-${String(sequence).padStart(6, "0")}`;
      const documents = await analyst.webContents.executeJavaScript(`(() => {
        const docs = window.ReviewE2E.buildReviewDocuments(
          ${JSON.stringify(html)},
          ${JSON.stringify(mutation.after)},
          {
            sessionId: ${JSON.stringify(sessionId)},
            sourceSha256BySide: {
              before: ${JSON.stringify(sha(html))},
              after: ${JSON.stringify(sha(mutation.after))},
            },
            externalBootstrap: true,
            comments: [],
          },
        );
        window.__docs = docs;
        return {
          changes: docs.changes.map((change) => ({ id: change.id, helper: change.helper, types: change.types })),
          outlineCount: docs.outline.length,
          candidates: docs.runtimeVisualCandidates,
          captureCandidates: docs.runtimeVisualCaptureCandidates,
          sourceHtml: { before: docs.runtimeVisualSourceHtml.before.length, after: docs.runtimeVisualSourceHtml.after.length },
        };
      })()`);

      const captureSide = async (side) => {
        const candidates = documents.captureCandidates[side];
        if (!candidates.length) return [];
        const sideHtml = side === "before" ? html : mutation.after;
        const outcome = await controller.capture({
          contractVersion: RUNTIME_VISUAL_CONTRACT.version,
          captureSessionId: sessionId,
          sourceSha256: sha(sideHtml),
          side,
          html: sideHtml,
          candidates,
          viewport: VIEWPORT,
        });
        if (outcome?.outcome !== "captured") return [];
        return acceptRuntimeVisualSnapshots(
          outcome.envelope.runtimeVisualSnapshots,
          new Set(candidates.map((candidate) => candidate.key)),
        ) || [];
      };
      const before = await captureSide("before");
      const after = await captureSide("after");
      const { differenceByKey, uniformKeys } = rasterEvidence(documents.candidates, before, after);
      const verdicts = classifyReviewRuntimeVisualCandidates({
        candidates: documents.candidates,
        before,
        after,
        rasterMeanRgbDifferenceByKey: differenceByKey,
        uniformCandidateKeys: uniformKeys,
      });
      const merged = mergeReviewRuntimeVisualChanges(
        {
          changes: documents.changes,
          outline: await analyst.webContents.executeJavaScript("window.__docs.outline"),
          runtimeVisualCandidates: documents.candidates,
        },
        verdicts,
      );
      const confirmed = merged.markers.filter((marker) => marker.verdict === "changed").length;
      const suspected = merged.markers.filter((marker) => marker.verdict === "suspected").length;
      const capturedBoth = documents.candidates.filter((candidate) => (
        before.find((snapshot) => snapshot.key === candidate.key)?.state === "captured"
        && after.find((snapshot) => snapshot.key === candidate.key)?.state === "captured"
      )).length;
      // Navigation integrity: a marker whose change id appears nowhere in the
      // change list leaves the revision rail and "next change" pointing at
      // nothing. Strong evidence is allowed to open its own entry precisely so
      // this stays at zero.
      const changeIds = new Set(merged.changes.map((change) => change.id));
      const orphanMarkers = merged.markers
        .filter((marker) => !changeIds.has(marker.changeId))
        .map((marker) => marker.changeId);
      const expectation = mutation.chartExpectation;
      // A page where nothing could be captured proves nothing. Every "no false
      // positive" reading on such a row is empty, so it must never present as a
      // pass: an all-green report built from unverified hosts is worse than a
      // red one, because it invites trust it has not earned.
      const nothingVerified = documents.candidates.length > 0 && capturedBoth === 0;
      // A "must be reported" expectation is only valid when the mutation
      // actually reached the page. A chart-library hook cannot touch a page
      // that has no such library, and a palette override cannot move a chart
      // whose colours are written into its data. In those cases both sides
      // render the same bytes and "unchanged" is the correct answer, so the
      // probe is at fault rather than the pipeline. This is only decidable
      // where the pair was actually captured, which is why it is separate from
      // nothingVerified above.
      const renderedDifference = documents.candidates.some((candidate) => {
        const first = before.find((snapshot) => snapshot.key === candidate.key);
        const second = after.find((snapshot) => snapshot.key === candidate.key);
        if (first?.state !== "captured" || second?.state !== "captured") return false;
        return first.pngSha256 !== second.pngSha256
          || first.surfaceSha256 !== second.surfaceSha256;
      });
      const probeIneffective = expectation === "changed"
        && !nothingVerified
        && !renderedDifference;
      const failures = [];
      if (nothingVerified) {
        failures.push(`未核实任何宿主（候选 ${documents.candidates.length}）`);
      }
      if (expectation === "unchanged" && confirmed > 0) {
        failures.push(`假确认 ${confirmed}`);
      }
      if (expectation === "unchanged" && suspected > SUSPICION_BUDGET) {
        failures.push(`假疑似 ${suspected} > ${SUSPICION_BUDGET}`);
      }
      if (
        expectation === "changed"
        && !probeIneffective
        && capturedBoth > 0
        && confirmed === 0
        && suspected === 0
      ) {
        failures.push("真实改动完全静默");
      }
      if (expectation === "changed" && !probeIneffective && suspected > SUSPICION_BUDGET) {
        failures.push(`真实改动报疑似 ${suspected} > ${SUSPICION_BUDGET}`);
      }
      if (orphanMarkers.length) failures.push(`孤儿 changeId ${orphanMarkers.length}`);
      // A probe that also changes selector matching cannot support a
      // displacement conclusion, so its failures are recorded but not gating.
      const gating = mutation.structurallyContaminated !== true;
      rows.push({
        page: label,
        mutation: mutation.id,
        structurallyContaminated: mutation.structurallyContaminated === true,
        expectation,
        staticChanges: documents.changes.length,
        candidates: documents.candidates.length,
        capturedBoth,
        confirmed,
        suspected,
        renderedDifference,
        nothingVerified,
        probeIneffective,
        orphanMarkers,
        failures,
        gating,
      });
      process.stdout.write(
        `${label.padEnd(32)} ${mutation.id.padEnd(20)} `
        + `静态变化=${String(documents.changes.length).padStart(3)} `
        + `候选=${String(documents.candidates.length).padStart(2)} `
        + `两侧捕获=${String(capturedBoth).padStart(2)} `
        + `确认=${String(confirmed).padStart(2)} `
        + `疑似=${String(suspected).padStart(2)} `
        + `${failures.length
          ? (gating ? "✘ " + failures.join("，") : "(非门禁) " + failures.join("，"))
          : probeIneffective ? "○ 探针未生效（两侧渲染相同）" : "✓"}\n`,
      );
    }
  }
  analyst.destroy();
  controller.dispose();
  const gatingFailures = rows.filter((row) => row.gating && row.failures.length);
  const reportPath = path.join(bundleRoot, "review-runtime-e2e-pages.json");
  writeFileSync(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    suspicionBudget: SUSPICION_BUDGET,
    viewport: VIEWPORT,
    totals: {
      rows: rows.length,
      gatingFailures: gatingFailures.length,
      contaminatedRows: rows.filter((row) => row.structurallyContaminated).length,
      ineffectiveProbeRows: rows.filter((row) => row.probeIneffective).length,
    },
    rows,
  }, null, 2)}\n`);
  process.stdout.write(
    `\n行数 ${rows.length}，门禁失败 ${gatingFailures.length}\n`
    + `report: ${reportPath}\n`,
  );
  app.exit(gatingFailures.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
