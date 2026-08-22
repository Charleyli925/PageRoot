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
const { reviewRuntimeAdversarialScenarios } = await import(
  `${repo}/tests/fixtures/review-runtime-adversarial-pages.mjs`
);

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

// Whether a candidate is a chart at all can only be answered by the loaded
// page: a charting library creates its canvas at runtime, and a source-empty
// container that a script fills with table rows is not a chart even though it
// looks like a host to any static discoverer. Counting the drawn surfaces
// inside each candidate is what makes the report's denominator real chart hosts
// instead of guesses, which is the difference between "verified nothing" being
// a gap and being the correct answer.
async function drawnHostCount(previewController, html, candidates) {
  // Identity is not always an id — an inline vector graphic is often bound by
  // tag and another attribute — so the selector is rebuilt from whatever the
  // binding actually carries.
  const selectors = candidates.map((candidate) => {
    const tag = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "*";
    const attributes = Array.isArray(candidate.identityAttributes)
      ? candidate.identityAttributes
      : [];
    const filters = attributes
      .filter(([name, value]) => typeof name === "string" && typeof value === "string")
      .map(([name, value]) => `[${name}="${value.replace(/"/gu, '\\"')}"]`)
      .join("");
    return filters ? `${tag}${filters}` : "";
  }).filter((selector) => selector);
  // A measurement that quietly returns zero would switch the gate off while
  // looking like a clean page, so an unusable input is an error rather than a
  // count.
  if (!selectors.length) throw new Error("drawnHostCount: no identifiable candidates supplied");
  const session = await previewController.createSession({
    html,
    bootstrapJavaScript: "",
  });
  if (!session?.sessionId || !session?.url) {
    throw new Error("drawnHostCount: preview session unavailable");
  }
  const probe = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await probe.loadURL(session.url);
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_VISUAL_CONTRACT.captureSettleMs));
    return await probe.webContents.executeJavaScript(`(() => {
      const selectors = ${JSON.stringify(selectors)};
      const drawn = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 1 && rect.height >= 1;
      };
      return {
        // The ratio the capture actually measured at. Every sub-pixel conclusion
        // depends on it, so a report that does not state it cannot be checked
        // against the machine a reviewer really uses.
        devicePixelRatio: window.devicePixelRatio,
        drawn: selectors.filter((selector) => {
          const host = document.querySelector(selector);
          if (!host) return false;
          if (host.tagName === "CANVAS" || host.tagName === "svg") return drawn(host);
          return [...host.querySelectorAll("canvas,svg")].some(drawn);
        }).length,
      };
    })()`);
  } finally {
    probe.destroy();
    await Promise.resolve(previewController.revokeSession(session.sessionId)).catch(() => undefined);
  }
}

async function main() {
  const separator = process.argv.indexOf("--");
  const args = separator === -1 ? [] : process.argv.slice(separator + 1);
  const adversarial = args.includes("--adversarial");
  const pages = args.filter((value) => !value.startsWith("--"));
  if (!adversarial && !pages.length) {
    throw new Error("Expected at least one page path, or --adversarial.");
  }
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
  // One flat case list so an authored page mutation and an adversarial page are
  // measured, gated and reported by exactly the same code. A case that only the
  // harness knows how to score is a case nobody can trust.
  const cases = [];
  if (adversarial) {
    reviewRuntimeAdversarialScenarios().forEach((scenario) => cases.push({
      label: `对抗/${scenario.id}`,
      mutationId: scenario.property,
      before: scenario.before,
      after: scenario.after,
      expectation: scenario.expectation,
      drawsAtRuntime: true,
      structurallyContaminated: false,
      // Each adversarial page is authored to produce exactly one host, so a case
      // that yields none tested nothing at all and must not read as a pass.
      expectedCandidates: scenario.expectedCandidates === undefined
        ? 1
        : scenario.expectedCandidates,
    }));
  }
  for (const pagePath of pages) {
    const html = readFileSync(path.resolve(pagePath), "utf8");
    const label = path.basename(pagePath).slice(0, 30);
    // Charting libraries draw into a canvas they create at runtime, so the
    // source rarely contains one. The library reference, or an inline vector
    // graphic, is what says this page has a runtime visual at all.
    const drawsAtRuntime = /echarts|chart\.js|plotly|highcharts|<svg|<canvas/iu.test(html);
    reviewRuntimePageMutations(html, [], []).forEach((mutation) => cases.push({
      label,
      mutationId: mutation.id,
      before: html,
      after: mutation.after,
      expectation: mutation.chartExpectation,
      drawsAtRuntime,
      structurallyContaminated: mutation.structurallyContaminated === true,
    }));
  }

  const drawnHostsByPage = new Map();
  let devicePixelRatio = null;
  {
    for (const testCase of cases) {
      const html = testCase.before;
      const label = testCase.label;
      const pageDrawsAtRuntime = testCase.drawsAtRuntime;
      const mutation = {
        id: testCase.mutationId,
        after: testCase.after,
        chartExpectation: testCase.expectation,
        structurallyContaminated: testCase.structurallyContaminated,
      };
      const expectedCandidates = testCase.expectedCandidates;
      let drawnHosts = drawnHostsByPage.has(label) ? drawnHostsByPage.get(label) : null;
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
        const outlineIds = new Set(docs.outline.map((item) => item.id));
        return {
          changes: docs.changes.map((change) => ({ id: change.id, helper: change.helper, types: change.types })),
          outlineCount: docs.outline.length,
          // Where candidates vanish matters: an annotator that found none is a
          // different fact from one whose candidates fell outside the outline.
          outsideOutline: docs.runtimeVisualCandidates
            .filter((candidate) => !outlineIds.has(candidate.outlineId)).length,
          candidates: docs.runtimeVisualCandidates,
          captureCandidates: docs.runtimeVisualCaptureCandidates,
          sourceHtml: { before: docs.runtimeVisualSourceHtml.before.length, after: docs.runtimeVisualSourceHtml.after.length },
        };
      })()`);

      const captureSide = async (side) => {
        const candidates = documents.captureCandidates[side];
        if (!candidates.length) return { snapshots: [], outcome: "no-candidates", elapsedMs: 0 };
        const sideHtml = side === "before" ? html : mutation.after;
        const startedAt = Date.now();
        const result = await controller.capture({
          contractVersion: RUNTIME_VISUAL_CONTRACT.version,
          captureSessionId: sessionId,
          sourceSha256: sha(sideHtml),
          side,
          html: sideHtml,
          candidates,
          viewport: VIEWPORT,
        });
        const elapsedMs = Date.now() - startedAt;
        // Whether the owner answered at all is a different fact from whether a
        // host was measurable, and only the first can be a timeout. Collapsing
        // them hides which of the two a page is failing on.
        const outcome = result?.outcome === "captured"
          ? "captured"
          : `${result?.outcome || "none"}:${result?.reason || ""}`;
        if (result?.outcome !== "captured") return { snapshots: [], outcome, elapsedMs };
        return {
          snapshots: acceptRuntimeVisualSnapshots(
            result.envelope.runtimeVisualSnapshots,
            new Set(candidates.map((candidate) => candidate.key)),
          ) || [],
          outcome,
          elapsedMs,
        };
      };
      const beforeSide = await captureSide("before");
      const afterSide = await captureSide("after");
      const before = beforeSide.snapshots;
      const after = afterSide.snapshots;
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
      if (drawnHosts === null) {
        // An unmeasurable count must stay visible rather than abort the suite or
        // pass as zero, so it is carried as -1 and reported below.
        try {
          if (documents.captureCandidates.before.length) {
            const measured = await drawnHostCount(
              previewController,
              html,
              documents.captureCandidates.before,
            );
            drawnHosts = measured.drawn;
            devicePixelRatio = measured.devicePixelRatio;
          } else drawnHosts = 0;
        } catch {
          drawnHosts = -1;
        }
        drawnHostsByPage.set(label, drawnHosts);
      }
      // A page with no charting library and no inline vector graphic has no
      // runtime visual to verify, and neither has a page whose candidates draw
      // nothing once loaded. "Nothing verified" is the correct answer in both
      // cases, so gating on it would fail a page for behaving exactly as a
      // reviewer would expect.
      const nothingVerified = drawnHosts > 0
        && capturedBoth === 0
        && pageDrawsAtRuntime;
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
      // The strongest property the pipeline owes a reviewer. Where the owner
      // could not read a surface — a tainted canvas, a WebGL context, a surface
      // over budget, a closed binding — it must not answer "verified unchanged",
      // because that is the one wrong answer a reviewer cannot catch. Reporting
      // a change or reporting nothing verifiable are both acceptable.
      const claimedVerifiedUnchanged = documents.candidates.some((candidate) => {
        const first = before.find((snapshot) => snapshot.key === candidate.key);
        const second = after.find((snapshot) => snapshot.key === candidate.key);
        if (first?.state !== "captured" || second?.state !== "captured") return false;
        return reviewRuntimeVisualSnapshotComparison(first, second) === "unchanged";
      });
      const failures = [];
      if (expectedCandidates !== undefined && documents.candidates.length < expectedCandidates) {
        failures.push(`候选 ${documents.candidates.length} < 期望 ${expectedCandidates}，本例什么都没测`);
      }
      if (expectation === "mustNotConfirmUnchanged" && claimedVerifiedUnchanged) {
        failures.push("冒充已核实未变");
      }
      if (nothingVerified) {
        failures.push(
          `未核实任何宿主（真实图表宿主 ${drawnHosts}，`
          + `before=${beforeSide.outcome}/${beforeSide.elapsedMs}ms，`
          + `after=${afterSide.outcome}/${afterSide.elapsedMs}ms）`,
        );
      }
      if (expectation === "changed" && drawnHosts > 0 && capturedBoth < drawnHosts) {
        failures.push(`核实覆盖不全 ${capturedBoth}/${drawnHosts}`);
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
        outlineCount: documents.outlineCount,
        outsideOutline: documents.outsideOutline,
        captureCandidates: {
          before: documents.captureCandidates.before.length,
          after: documents.captureCandidates.after.length,
        },
        candidates: documents.candidates.length,
        drawnHosts,
        capturedBoth,
        confirmed,
        suspected,
        renderedDifference,
        claimedVerifiedUnchanged,
        nothingVerified,
        pageDrawsAtRuntime,
        capture: {
          before: { outcome: beforeSide.outcome, elapsedMs: beforeSide.elapsedMs },
          after: { outcome: afterSide.outcome, elapsedMs: afterSide.elapsedMs },
        },
        probeIneffective,
        orphanMarkers,
        failures,
        gating,
      });
      process.stdout.write(
        `${label.padEnd(32)} ${mutation.id.padEnd(20)} `
        + `静态变化=${String(documents.changes.length).padStart(3)} `
        + `候选=${String(documents.candidates.length).padStart(2)} `
        + `图表宿主=${String(drawnHosts).padStart(2)} `
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
    devicePixelRatio,
    totals: {
      rows: rows.length,
      gatingFailures: gatingFailures.length,
      contaminatedRows: rows.filter((row) => row.structurallyContaminated).length,
      ineffectiveProbeRows: rows.filter((row) => row.probeIneffective).length,
    },
    rows,
  }, null, 2)}\n`);
  process.stdout.write(
    `\n行数 ${rows.length}，门禁失败 ${gatingFailures.length}，`
    + `设备像素比 ${devicePixelRatio === null ? "未测" : devicePixelRatio}\n`
    + `report: ${reportPath}\n`,
  );
  app.exit(gatingFailures.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
