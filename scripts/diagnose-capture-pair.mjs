#!/usr/bin/env node

/**
 * One-off diagnostic: characterises how two captured PNGs differ.
 *
 * A raster verdict only says "these differ"; it cannot say whether the cause
 * was a redrawn chart or the same chart landing on a different sub-pixel
 * phase. Those two need opposite fixes, so guessing between them wastes a
 * repair cycle. The shape of the difference tells them apart: sub-pixel
 * resampling touches a large share of edge pixels by a small amount, while a
 * redraw moves fewer pixels much further.
 *
 *   npx electron scripts/diagnose-capture-pair.mjs -- before.png after.png
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { app, nativeImage } from "electron";

function bitmapOf(filePath) {
  const image = nativeImage.createFromBuffer(readFileSync(filePath));
  if (image.isEmpty()) throw new Error(`Cannot decode ${filePath}`);
  return { size: image.getSize(), pixels: image.toBitmap() };
}

async function main() {
  const [beforePath, afterPath] = process.argv.slice(process.argv.indexOf("--") + 1);
  if (!beforePath || !afterPath) throw new Error("Expected two PNG paths.");
  await app.whenReady();
  const before = bitmapOf(path.resolve(beforePath));
  const after = bitmapOf(path.resolve(afterPath));
  if (
    before.size.width !== after.size.width
    || before.size.height !== after.size.height
  ) {
    process.stdout.write(`dimensions differ: ${JSON.stringify(before.size)} vs ${JSON.stringify(after.size)}\n`);
    app.exit(0);
    return;
  }
  const { width, height } = before.size;
  const buckets = { "0": 0, "1-4": 0, "5-16": 0, "17-64": 0, "65-255": 0 };
  let differing = 0;
  let total = 0;
  let maxDelta = 0;
  const rowDeltas = new Array(height).fill(0);
  const columnDeltas = new Array(width).fill(0);
  for (let index = 0; index < before.pixels.length; index += 4) {
    const delta = Math.max(
      Math.abs(before.pixels[index] - after.pixels[index]),
      Math.abs(before.pixels[index + 1] - after.pixels[index + 1]),
      Math.abs(before.pixels[index + 2] - after.pixels[index + 2]),
    );
    total += 1;
    if (delta > maxDelta) maxDelta = delta;
    if (delta === 0) { buckets["0"] += 1; continue; }
    differing += 1;
    if (delta <= 4) buckets["1-4"] += 1;
    else if (delta <= 16) buckets["5-16"] += 1;
    else if (delta <= 64) buckets["17-64"] += 1;
    else buckets["65-255"] += 1;
    const pixel = index / 4;
    rowDeltas[Math.floor(pixel / width)] += 1;
    columnDeltas[pixel % width] += 1;
  }
  const busyRows = rowDeltas.filter((count) => count > 0).length;
  const busyColumns = columnDeltas.filter((count) => count > 0).length;
  process.stdout.write(
    `${width}x${height}  differing=${differing}/${total} `
    + `(${(differing / total * 100).toFixed(1)}%)  maxDelta=${maxDelta}\n`
    + `  delta buckets: ${JSON.stringify(buckets)}\n`
    + `  rows touched=${busyRows}/${height}  columns touched=${busyColumns}/${width}\n`,
  );
  // A whole-surface shift touches nearly every row and column; a redraw is
  // usually contained.
  const spread = (busyRows / height) * (busyColumns / width);
  process.stdout.write(
    `  spread=${spread.toFixed(2)} -> ${spread > 0.6 ? "whole-surface (shift/resample signature)" : "localised (redraw signature)"}\n`,
  );
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
