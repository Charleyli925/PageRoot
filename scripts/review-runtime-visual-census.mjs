#!/usr/bin/env node

/**
 * Review runtime visual false-positive census.
 *
 * Runs under Electron because the behaviour under measurement only exists in a
 * real offscreen renderer: the settle wait, the per-candidate scrollIntoView
 * and `capturePage` are what produce the sampled pair. A Node-level fake with
 * canned PNG bytes cannot reproduce it.
 *
 * The census deliberately reuses the production capture owner and the
 * production comparison functions unmodified. It measures; it does not repair.
 * Every candidate row records which comparison step emitted the verdict and
 * the raw raster distance, so a failure is attributable instead of merely
 * counted.
 *
 *   npx electron scripts/review-runtime-visual-census.mjs -- --runs 10
 *
 * Options:
 *   --runs N              repetitions per scenario (default 10)
 *   --scenarios a,b       subset of scenario ids (default: all)
 *   --animation-ms N      fixture chart animation duration (default 1000)
 *   --library-delay-ms N  fixture chart library load delay (default 120)
 *   --settle-ms N         override the owner settle wait (default: contract)
 *   --viewport-height N   capture viewport height (default 900). A viewport
 *                         tall enough to hold the whole page removes the
 *                         per-candidate scrollIntoView, which isolates the
 *                         scroll path from the animation path.
 *   --out DIR             report directory (default output/runtime-visual-census)
 *   --keep-pixels         also persist the PNG pair for every mismatch
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BrowserWindow, app, nativeImage, net, protocol, session as electronSession } from "electron";

import {
  createPreviewProtocolController,
  registerPreviewProtocolScheme,
} from "../desktop/preview-protocol.mjs";
import { createReviewRuntimeFrozenScriptStore } from "../desktop/review-runtime-frozen-scripts.mjs";
import { createRuntimeSnapshotCaptureController } from "../desktop/runtime-visual-capture-owner.mjs";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";
import {
  REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET,
  isReviewRuntimeVisualRasterDifferenceMeaningful,
  mergeReviewRuntimeVisualChanges,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualPixelsAreUniform,
  reviewRuntimeVisualSnapshotComparison,
} from "../app/lib/review-runtime-visual.js";
import {
  REVIEW_RUNTIME_CHART_HOST_IDS,
  REVIEW_RUNTIME_CHART_RENDERERS,
  REVIEW_RUNTIME_CHART_SCENARIO_IDS,
  reviewRuntimeChartScenario,
} from "../tests/fixtures/review-runtime-chart-scenarios.mjs";

const VIEWPORT_WIDTH = 1_280;
const DEFAULT_VIEWPORT_HEIGHT = 900;

function parseOptions(argv) {
  const options = {
    runs: 10,
    scenarios: [...REVIEW_RUNTIME_CHART_SCENARIO_IDS],
    animationMs: 1_000,
    libraryDelayMs: 120,
    settleMs: RUNTIME_VISUAL_CONTRACT.captureSettleMs,
    viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
    renderers: [...REVIEW_RUNTIME_CHART_RENDERERS],
    out: path.resolve("output/runtime-visual-census"),
    keepPixels: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--runs": options.runs = Number(value); index += 1; break;
      case "--scenarios": options.scenarios = String(value).split(","); index += 1; break;
      case "--animation-ms": options.animationMs = Number(value); index += 1; break;
      case "--library-delay-ms": options.libraryDelayMs = Number(value); index += 1; break;
      case "--settle-ms": options.settleMs = Number(value); index += 1; break;
      case "--viewport-height": options.viewportHeight = Number(value); index += 1; break;
      case "--renderers": options.renderers = String(value).split(","); index += 1; break;
      case "--out": options.out = path.resolve(String(value)); index += 1; break;
      case "--keep-pixels": options.keepPixels = true; break;
      default:
        if (flag.startsWith("--")) throw new Error(`Unknown census option: ${flag}`);
    }
  }
  const unknown = options.scenarios
    .filter((id) => !REVIEW_RUNTIME_CHART_SCENARIO_IDS.includes(id));
  if (unknown.length) throw new Error(`Unknown scenario id: ${unknown.join(", ")}`);
  const unknownRenderers = options.renderers
    .filter((name) => !REVIEW_RUNTIME_CHART_RENDERERS.includes(name));
  if (unknownRenderers.length) {
    throw new Error(`Unknown renderer: ${unknownRenderers.join(", ")}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  // An out-of-range numeric option would otherwise be rejected deep inside the
  // owner and surface as "every candidate unavailable", which reads like a
  // clean census instead of a broken one.
  const boundedOption = (name, value, minimum, maximum) => {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return value;
  };
  const viewportBudget = RUNTIME_VISUAL_CONTRACT.pageBudget.viewport;
  boundedOption("--animation-ms", options.animationMs, 0, 60_000);
  boundedOption("--library-delay-ms", options.libraryDelayMs, 0, 60_000);
  boundedOption("--settle-ms", options.settleMs, 0, RUNTIME_VISUAL_CONTRACT.captureSettleMs);
  boundedOption(
    "--viewport-height",
    options.viewportHeight,
    viewportBudget.minHeight,
    viewportBudget.maxHeight,
  );
  options.viewport = Object.freeze({
    width: VIEWPORT_WIDTH,
    height: options.viewportHeight,
  });
  return options;
}

function sourceSha256(html) {
  return `sha256:${createHash("sha256").update(html, "utf8").digest("hex")}`;
}

function candidatesForSide(side) {
  return [...side.hostPaths.entries()].map(([id, elementPath]) => Object.freeze({
    key: `runtime-host-${id}`,
    path: [...elementPath],
    tagName: "div",
    kind: "host",
    identityAttributes: [["id", id]],
  }));
}

/**
 * Electron's `toBitmap` yields BGRA. The production metric sums the absolute
 * difference of the first three channels and skips the fourth, so a consistent
 * channel permutation on both sides produces exactly the same mean value.
 */
function decodedPixels(snapshot) {
  if (snapshot?.state !== "captured") return null;
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(snapshot.pngBytes));
    if (image.isEmpty()) return null;
    const size = image.getSize();
    if (size.width !== snapshot.width || size.height !== snapshot.height) return null;
    return image.toBitmap();
  } catch {
    return null;
  }
}

/**
 * Mirrors `classifyReviewRuntimeVisualCandidates` for a single candidate while
 * also reporting which ordered step decided the verdict.
 */
function verdictForPair(before, after) {
  const comparison = reviewRuntimeVisualSnapshotComparison(before, after);
  if (comparison === "unavailable") {
    return { verdict: "unverified", step: "capture-unavailable", rasterDifference: null };
  }
  if (comparison === "changed") {
    const dimensionsDiffer = before.width !== after.width
      || before.height !== after.height
      || before.layoutWidth !== after.layoutWidth
      || before.layoutHeight !== after.layoutHeight;
    return {
      verdict: "changed",
      step: dimensionsDiffer ? "dimensions" : "rendered-text",
      rasterDifference: null,
    };
  }
  const beforePixels = decodedPixels(before);
  const afterPixels = decodedPixels(after);
  const uniform = beforePixels && afterPixels
    ? reviewRuntimeVisualPixelsAreUniform(beforePixels)
      && reviewRuntimeVisualPixelsAreUniform(afterPixels)
    : false;
  if (comparison === "unchanged") {
    return {
      verdict: uniform ? "unverified" : "unchanged",
      step: uniform ? "uniform-surface" : "png-hash-equal",
      rasterDifference: 0,
    };
  }
  const rasterDifference = beforePixels && afterPixels
    ? reviewRuntimeVisualMeanRgbDifference(beforePixels, afterPixels)
    : null;
  if (!Number.isFinite(rasterDifference)) {
    return { verdict: "unverified", step: "png-undecodable", rasterDifference: null };
  }
  if (isReviewRuntimeVisualRasterDifferenceMeaningful(rasterDifference)) {
    return { verdict: "changed", step: "raster", rasterDifference };
  }
  return {
    verdict: uniform ? "unverified" : "unchanged",
    step: uniform ? "uniform-surface" : "raster-within-budget",
    rasterDifference,
  };
}

/**
 * Runs the real merge rules over the real verdicts so the census reports what
 * a reviewer would actually see, not just the raw classification.
 *
 * Two dimensions decide that presentation and neither is visible in a verdict
 * alone: whether the source diff also found a change in the chart's section
 * (corroboration), and whether the user commented on the host. Each run is
 * evaluated under all four combinations.
 */
function mergePresentation({ verdicts, corroborated, commented }) {
  const outline = REVIEW_RUNTIME_CHART_HOST_IDS.map((hostId, index) => ({
    id: `outline-${index + 1}`,
    group: "页面",
    label: `图 ${index + 1}`,
    helper: corroborated ? "结构调整" : "本轮未修改",
    types: corroborated ? ["structure"] : [],
    ...(corroborated ? { changeId: `change-${index + 1}` } : {}),
  }));
  const changes = corroborated
    ? outline.map((item, index) => ({
      id: `change-${index + 1}`,
      label: item.label,
      helper: "结构调整",
      types: ["structure"],
      beforePresent: true,
      afterPresent: true,
    }))
    : [];
  const runtimeVisualCandidates = REVIEW_RUNTIME_CHART_HOST_IDS.map((hostId, index) => ({
    key: `runtime-host-${hostId}`,
    outlineId: `outline-${index + 1}`,
    changeId: corroborated ? `change-${index + 1}` : `runtime-change-outline-${index + 1}`,
    label: `图 ${index + 1}`,
    ...(commented ? { commented: true } : {}),
  }));
  const merged = mergeReviewRuntimeVisualChanges(
    { changes, outline, runtimeVisualCandidates },
    verdicts,
  );
  const markerVerdictByKey = new Map(
    merged.markers.map((marker) => [marker.candidateKey, marker.verdict]),
  );
  const presentationByKey = new Map();
  runtimeVisualCandidates.forEach((candidate) => {
    const markerVerdict = markerVerdictByKey.get(candidate.key);
    presentationByKey.set(
      candidate.key,
      markerVerdict === "changed"
        ? "confirmed"
        : markerVerdict === "suspected" ? "suspected" : "silent",
    );
  });
  return presentationByKey;
}

function snapshotSummary(snapshot) {
  return snapshot?.state === "captured"
    ? {
      state: "captured",
      pngSha256: snapshot.pngSha256,
      width: snapshot.width,
      height: snapshot.height,
      layoutWidth: snapshot.layoutWidth,
      layoutHeight: snapshot.layoutHeight,
      renderedTextSha256: snapshot.renderedTextSha256,
      byteLength: snapshot.byteLength,
    }
    : { state: "unavailable" };
}

async function main() {
  const options = parseOptions(process.argv.slice(process.argv.indexOf("--") + 1));
  registerPreviewProtocolScheme(protocol);
  // Every capture destroys its offscreen window. Without this the first
  // destroyed window would satisfy "all windows closed" and quit the census
  // silently in the middle of the first scenario.
  app.on("window-all-closed", () => {});
  await app.whenReady();

  const previewController = createPreviewProtocolController({
    protocolApi: protocol,
    netFetch: (url, requestOptions) => net.fetch(url, requestOptions),
  });
  previewController.install();

  const controller = createRuntimeSnapshotCaptureController({
    BrowserWindowClass: BrowserWindow,
    createSession: (payload) => previewController.createSession(payload),
    revokeSession: (sessionId) => Promise.resolve(previewController.revokeSession(sessionId)),
    createIsolatedSession: (partition) => {
      const isolatedSession = electronSession.fromPartition(partition);
      previewController.installFor(isolatedSession.protocol);
      return isolatedSession;
    },
    releaseIsolatedSession: async (isolatedSession) => {
      await Promise.all([
        Promise.resolve(isolatedSession.clearStorageData?.()).catch(() => undefined),
        Promise.resolve(isolatedSession.protocol?.unhandle?.("pageroot-preview")).catch(() => undefined),
        Promise.resolve(isolatedSession.protocol?.unhandle?.("https")).catch(() => undefined),
      ]);
    },
    frozenChartScripts: createReviewRuntimeFrozenScriptStore({
      netFetch: (url, requestOptions) => net.fetch(url, requestOptions),
    }),
    captureSettleMs: options.settleMs,
  });

  mkdirSync(options.out, { recursive: true });
  const pixelDirectory = path.join(options.out, "mismatch-pixels");
  if (options.keepPixels) mkdirSync(pixelDirectory, { recursive: true });

  const rows = [];
  let sequence = 0;
  for (const renderer of options.renderers) {
  for (const scenarioId of options.scenarios) {
    for (let run = 1; run <= options.runs; run += 1) {
      sequence += 1;
      const scenario = reviewRuntimeChartScenario(scenarioId, {
        animationMs: options.animationMs,
        libraryDelayMs: options.libraryDelayMs,
        renderer,
      });
      const captureSessionId = `review-census-${String(sequence).padStart(6, "0")}`;
      const captureSide = async (side) => {
        const page = scenario[side];
        const startedAt = Date.now();
        const outcome = await controller.capture({
          contractVersion: RUNTIME_VISUAL_CONTRACT.version,
          captureSessionId,
          sourceSha256: sourceSha256(page.html),
          side,
          html: page.html,
          candidates: candidatesForSide(page),
          viewport: options.viewport,
        });
        return { outcome, elapsedMs: Date.now() - startedAt };
      };
      // Same order as production: the after side always runs second and so
      // always inherits a warmer session.
      const before = await captureSide("before");
      const after = await captureSide("after");
      const snapshotsByKey = (result) => new Map(
        (result.outcome?.envelope?.runtimeVisualSnapshots || [])
          .map((snapshot) => [snapshot.key, snapshot]),
      );
      const beforeSnapshots = snapshotsByKey(before);
      const afterSnapshots = snapshotsByKey(after);
      const runCandidates = candidatesForSide(scenario.before);
      const verdictByKey = new Map();
      const detailByKey = new Map();
      runCandidates.forEach((candidate) => {
        const detail = verdictForPair(
          beforeSnapshots.get(candidate.key),
          afterSnapshots.get(candidate.key),
        );
        verdictByKey.set(candidate.key, detail.verdict);
        detailByKey.set(candidate.key, detail);
      });
      const verdicts = {
        changedKeys: [...verdictByKey].filter(([, v]) => v === "changed").map(([key]) => key),
        unverifiedKeys: [...verdictByKey].filter(([, v]) => v === "unverified").map(([key]) => key),
      };
      const presentations = {
        corroboratedCommented: mergePresentation({ verdicts, corroborated: true, commented: true }),
        corroboratedUncommented: mergePresentation({ verdicts, corroborated: true, commented: false }),
        uncorroboratedCommented: mergePresentation({ verdicts, corroborated: false, commented: true }),
        uncorroboratedUncommented: mergePresentation({ verdicts, corroborated: false, commented: false }),
      };
      for (const candidate of runCandidates) {
        const beforeSnapshot = beforeSnapshots.get(candidate.key);
        const afterSnapshot = afterSnapshots.get(candidate.key);
        const { verdict, step, rasterDifference } = detailByKey.get(candidate.key);
        const expected = scenario.chartExpectation;
        const falsePositive = expected === "unchanged" && verdict === "changed";
        const falseNegative = expected === "changed" && verdict !== "changed";
        if ((falsePositive || falseNegative) && options.keepPixels) {
          const stem = `${renderer}-${scenarioId}-run${run}-${candidate.key}`;
          [["before", beforeSnapshot], ["after", afterSnapshot]].forEach(([side, snapshot]) => {
            if (snapshot?.state !== "captured") return;
            writeFileSync(
              path.join(pixelDirectory, `${stem}-${side}.png`),
              Buffer.from(snapshot.pngBytes),
            );
          });
        }
        rows.push({
          renderer,
          scenarioId,
          run,
          candidateKey: candidate.key,
          expected,
          verdict,
          step,
          rasterDifference,
          falsePositive,
          falseNegative,
          presentation: Object.fromEntries(
            Object.entries(presentations)
              .map(([name, byKey]) => [name, byKey.get(candidate.key)]),
          ),
          captureOutcome: {
            before: before.outcome?.outcome || "unknown",
            after: after.outcome?.outcome || "unknown",
          },
          captureElapsedMs: { before: before.elapsedMs, after: after.elapsedMs },
          snapshots: {
            before: snapshotSummary(beforeSnapshot),
            after: snapshotSummary(afterSnapshot),
          },
        });
      }
      process.stdout.write(
        `${renderer} ${scenarioId} run ${run}/${options.runs}: `
        + `${rows.slice(-2).map((row) => `${row.candidateKey.replace("runtime-host-", "")}=${row.verdict}`).join(" ")}\n`,
      );
    }
  }
  }

  controller.dispose();

  const scenarioSummary = options.renderers.flatMap((renderer) => (
    options.scenarios.map((scenarioId) => {
      const scenarioRows = rows.filter((row) => (
        row.scenarioId === scenarioId && row.renderer === renderer
      ));
      return {
        renderer,
        scenarioId,
        expected: scenarioRows[0]?.expected || "unknown",
        candidateRows: scenarioRows.length,
        falsePositives: scenarioRows.filter((row) => row.falsePositive).length,
        falseNegatives: scenarioRows.filter((row) => row.falseNegative).length,
        unverified: scenarioRows.filter((row) => row.verdict === "unverified").length,
        stepCounts: scenarioRows.reduce((counts, row) => {
          counts[row.step] = (counts[row.step] || 0) + 1;
          return counts;
        }, {}),
      };
    })
  ));
  // What a reviewer actually sees. A confirmed frame on a chart the source
  // never touched is the failure this whole programme exists to remove, so it
  // is counted separately from the raw verdict.
  const presentationSummary = [
    "corroboratedCommented",
    "corroboratedUncommented",
    "uncorroboratedCommented",
    "uncorroboratedUncommented",
  ].map((variant) => {
    const unchangedRows = rows.filter((row) => row.expected === "unchanged");
    const changedRows = rows.filter((row) => row.expected === "changed");
    return {
      variant,
      unchangedConfirmed: unchangedRows
        .filter((row) => row.presentation[variant] === "confirmed").length,
      unchangedSuspected: unchangedRows
        .filter((row) => row.presentation[variant] === "suspected").length,
      unchangedSilent: unchangedRows
        .filter((row) => row.presentation[variant] === "silent").length,
      changedConfirmed: changedRows
        .filter((row) => row.presentation[variant] === "confirmed").length,
      changedSuspected: changedRows
        .filter((row) => row.presentation[variant] === "suspected").length,
      changedSilent: changedRows
        .filter((row) => row.presentation[variant] === "silent").length,
    };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    options: {
      runs: options.runs,
      scenarios: options.scenarios,
      animationMs: options.animationMs,
      libraryDelayMs: options.libraryDelayMs,
      settleMs: options.settleMs,
      renderers: options.renderers,
      viewport: options.viewport,
    },
    contract: {
      captureSettleMs: RUNTIME_VISUAL_CONTRACT.captureSettleMs,
      ownerDeadlineMs: RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
      rasterBudget: REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET,
    },
    totals: {
      candidateRows: rows.length,
      falsePositives: rows.filter((row) => row.falsePositive).length,
      falseNegatives: rows.filter((row) => row.falseNegative).length,
      unverified: rows.filter((row) => row.verdict === "unverified").length,
    },
    scenarioSummary,
    presentationSummary,
    rows,
  };
  const reportPath = path.join(options.out, "review-runtime-visual-census.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write("\n=== Review runtime visual census ===\n");
  scenarioSummary.forEach((entry) => {
    process.stdout.write(
      `${entry.renderer.padEnd(7)}${entry.scenarioId.padEnd(20)} expect=${entry.expected.padEnd(9)} `
      + `rows=${String(entry.candidateRows).padStart(3)} `
      + `FP=${String(entry.falsePositives).padStart(3)} `
      + `FN=${String(entry.falseNegatives).padStart(3)} `
      + `unverified=${String(entry.unverified).padStart(3)} `
      + `${JSON.stringify(entry.stepCounts)}\n`,
    );
  });
  process.stdout.write("\n--- reviewer-visible presentation ---\n");
  presentationSummary.forEach((entry) => {
    process.stdout.write(
      `${entry.variant.padEnd(26)} `
      + `unchanged[confirmed=${entry.unchangedConfirmed} suspected=${entry.unchangedSuspected} silent=${entry.unchangedSilent}] `
      + `changed[confirmed=${entry.changedConfirmed} suspected=${entry.changedSuspected} silent=${entry.changedSilent}]\n`,
    );
  });
  process.stdout.write(
    `\ntotal rows=${report.totals.candidateRows} `
    + `false positives=${report.totals.falsePositives} `
    + `false negatives=${report.totals.falseNegatives} `
    + `unverified=${report.totals.unverified}\n`,
  );
  // A run where nothing could be captured is a broken census, not a clean one.
  if (report.totals.unverified === report.totals.candidateRows) {
    process.stdout.write(
      "WARNING: every candidate was unverified; the census measured nothing.\n",
    );
  }
  process.stdout.write(`report: ${reportPath}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
