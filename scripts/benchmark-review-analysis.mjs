import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { build } from "vite";

const root = process.cwd();
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "pageroot-review-benchmark-"),
);

function complexHtml(sectionCount, changed) {
  const sections = Array.from({ length: sectionCount }, (_, sectionIndex) => {
    const cards = Array.from({ length: 12 }, (__, cardIndex) => `
      <article class="metric metric-${cardIndex}">
        <h3>指标 ${cardIndex}</h3>
        <p>${changed && sectionIndex % 11 === 0 && cardIndex === 4
          ? "修改后的复杂说明"
          : "稳定的复杂说明"} ${sectionIndex}-${cardIndex}</p>
        <div class="chart" data-chart="${sectionIndex}-${cardIndex}"></div>
      </article>`).join("");
    return `<section class="card card-${sectionIndex}">
      <h2>模块 ${sectionIndex}</h2>
      <div class="grid">${cards}</div>
      <script type="application/json">{"index":${sectionIndex},"series":[1,2,3,4,5]}</script>
    </section>`;
  }).join("");
  return `<!doctype html><html><head><style>
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); }
    .chart { width: 480px; height: 240px; }
  </style></head><body><main>${sections}</main></body></html>`;
}

try {
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: temporaryDirectory,
      emptyOutDir: true,
      lib: {
        entry: path.join(root, "app/workbench/review-document.ts"),
        name: "PageRootReviewBenchmark",
        formats: ["iife"],
        fileName: () => "review.js",
      },
    },
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({
      path: path.join(temporaryDirectory, "review.js"),
    });
    const results = [];
    for (const sectionCount of [120, 300, 600]) {
      const beforeHtml = complexHtml(sectionCount, false);
      const afterHtml = complexHtml(sectionCount, true);
      const result = await page.evaluate(async ({
        before,
        after,
        count,
      }) => {
        performance.clearMeasures();
        const timerGaps = [];
        let lastTimerAt = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          timerGaps.push(now - lastTimerAt);
          lastTimerAt = now;
        }, 10);
        const startedAt = performance.now();
        const review = await globalThis.PageRootReviewBenchmark
          .buildReviewDocumentsAsync(before, after, {
            sessionId: `benchmark-${count}`,
            sourcePath: "/tmp/pageroot-complex-review.html",
            externalBootstrap: false,
            comments: [],
          });
        const elapsedMs = performance.now() - startedAt;
        clearInterval(timer);
        const phases = {};
        performance.getEntriesByType("measure").forEach((entry) => {
          if (!entry.name.startsWith("pageroot:review-analysis:")) return;
          const phase = entry.name.split(":").at(-1);
          phases[phase] = (phases[phase] || 0) + entry.duration;
        });
        return {
          sections: count,
          sourceBytes: before.length + after.length,
          elapsedMs,
          maxTimerGapMs: Math.max(0, ...timerGaps),
          timerTicks: timerGaps.length,
          changes: review.changes.length,
          outputBytes: review.before.length + review.after.length,
          phases,
        };
      }, {
        before: beforeHtml,
        after: afterHtml,
        count: sectionCount,
      });
      const expectedChanges = Math.ceil(sectionCount / 11);
      if (result.changes !== expectedChanges) {
        throw new Error(
          `Review benchmark expected ${expectedChanges} changes, received ${result.changes}.`,
        );
      }
      results.push(result);
    }
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
