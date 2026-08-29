#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ACTIVE_INDEX = "docs/decisions/README.md";
const ARCHIVE_INDEX = "docs/decisions/archive/README.md";
const HISTORY_MAX_MARKER = /<!--\s*adr-history-max:\s*(\d{4})\s*-->/u;
const HISTORY_GAPS_MARKER = /<!--\s*adr-history-gaps:\s*([^>]+?)\s*-->/u;
const DECISION_FILE = /^(\d{4})-[^/]+\.md$/u;

function repositoryPath(value) {
  return value.split(path.sep).join("/");
}

function parseStatus(source) {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    const direct = line.match(/^\s*(?:[-*>]\s*)?(?:Status|状态)\s*[:：]\s*(.*?)\s*$/iu);
    if (direct) return direct[1].trim();
    if (/^\s*#{1,6}\s+Status\s*$/iu.test(line)) {
      const value = lines.slice(index + 1).find((candidate) => candidate.trim());
      if (value) return value.trim().replace(/[.。]\s*$/u, "");
    }
  }
  return "";
}

export function parseAdrDocument(relativePath, source, location) {
  const fileName = path.posix.basename(relativePath);
  const fileMatch = fileName.match(DECISION_FILE);
  const heading = source.match(/^#\s+(?:ADR[- ]*)?(\d{4})(?:\s*[:：-]\s*|\s+)([^\n]*)$/mu);
  const statusText = parseStatus(source);
  return {
    relativePath,
    source,
    location,
    number: fileMatch ? Number(fileMatch[1]) : null,
    fileNumber: fileMatch ? Number(fileMatch[1]) : null,
    headingNumber: heading ? Number(heading[1]) : null,
    title: heading ? heading[2].trim() : "",
    statusText,
    statusKind: /^superseded\b/iu.test(statusText) ? "superseded" : "active",
  };
}

function markdownLinks(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
    .map((match) => match[1].trim().replace(/^<|>$/gu, "").split(/\s+/u)[0])
    .filter(Boolean);
}

function linkTargetFrom(indexPath, target) {
  const withoutFragment = target.split("#", 1)[0];
  if (!withoutFragment || /^(?:[a-z]+:|\/\/)/iu.test(withoutFragment)) return null;
  return repositoryPath(path.posix.normalize(path.posix.join(
    path.posix.dirname(indexPath),
    withoutFragment,
  )));
}

function adrNumberFromText(text) {
  return [...text.matchAll(/\bADR[- ]?(\d{4})\b/giu)].map((match) => Number(match[1]));
}

function checkCoverage(indexPath, indexText, expectedPaths, recordsByPath) {
  const counts = new Map();
  const unknown = [];
  for (const target of markdownLinks(indexText)) {
    const resolved = linkTargetFrom(indexPath, target);
    if (!resolved || !resolved.startsWith("docs/decisions/")) continue;
    if (!recordsByPath.has(resolved)) {
      unknown.push(`${indexPath}: unknown decision link ${target}`);
      continue;
    }
    counts.set(resolved, (counts.get(resolved) || 0) + 1);
  }
  const violations = [...unknown];
  for (const expected of expectedPaths) {
    const count = counts.get(expected) || 0;
    if (count !== 1) violations.push(`${indexPath}: ${expected} appears ${count} times; expected exactly once`);
  }
  for (const [target, count] of counts) {
    if (!expectedPaths.includes(target)) {
      violations.push(`${indexPath}: ${target} is indexed in the wrong ADR index (${count} times)`);
    }
  }
  return violations;
}

function decisionLinksInRepository(relativePath, source, recordsByPath) {
  const violations = [];
  for (const target of markdownLinks(source)) {
    if (!target.includes("decisions/")) continue;
    const resolved = linkTargetFrom(relativePath, target);
    if (resolved && !recordsByPath.has(resolved) && resolved !== ACTIVE_INDEX && resolved !== ARCHIVE_INDEX) {
      violations.push(`${relativePath}: broken decision link ${target}`);
    }
  }
  return violations;
}

export function validateAdrIndex({
  records,
  activeIndexText,
  archiveIndexText,
  repositoryDecisionLinks = [],
  architectureMapText = "",
} = {}) {
  const violations = [];
  const byPath = new Map(records.map((record) => [record.relativePath, record]));
  const byNumber = new Map();

  for (const record of records) {
    if (!Number.isInteger(record.number) || record.number < 1) {
      violations.push(`${record.relativePath}: filename must start with a positive four-digit ADR number`);
    } else {
      const sameNumber = byNumber.get(record.number) || [];
      sameNumber.push(record.relativePath);
      byNumber.set(record.number, sameNumber);
    }
    if (record.headingNumber !== record.number) {
      violations.push(`${record.relativePath}: filename number ${record.number ?? "?"} does not match H1 number ${record.headingNumber ?? "?"}`);
    }
    if (record.location === "active" && record.statusKind === "superseded") {
      violations.push(`${record.relativePath}: superseded ADRs belong under docs/decisions/archive/`);
    }
    if (record.statusKind === "superseded") {
      const statusLinks = markdownLinks(record.statusText);
      const successorNumbers = adrNumberFromText(record.statusText);
      if (statusLinks.length === 0) {
        violations.push(`${record.relativePath}: superseded status must link to its successor`);
      }
      for (const number of successorNumbers) {
        const successors = records
          .filter((candidate) => candidate.number === number)
          .map((candidate) => candidate.relativePath);
        if (successors.length === 0) {
          violations.push(`${record.relativePath}: successor ADR ${String(number).padStart(4, "0")} does not exist`);
        }
        if (!statusLinks.some((target) => {
          const resolved = linkTargetFrom(record.relativePath, target);
          return successors.includes(resolved);
        })) {
          violations.push(`${record.relativePath}: successor ADR ${String(number).padStart(4, "0")} is not the target of a status link`);
        }
      }
    }
  }

  for (const [number, paths] of byNumber) {
    if (paths.length > 1) violations.push(`ADR ${String(number).padStart(4, "0")} is duplicated: ${paths.join(", ")}`);
  }

  const activePaths = records.filter((record) => record.location === "active").map((record) => record.relativePath).sort();
  const archivePaths = records.filter((record) => record.location === "archive").map((record) => record.relativePath).sort();
  violations.push(...checkCoverage(ACTIVE_INDEX, activeIndexText, activePaths, byPath));
  violations.push(...checkCoverage(ARCHIVE_INDEX, archiveIndexText, archivePaths, byPath));
  violations.push(...repositoryDecisionLinks);

  const maxNumber = Math.max(...byNumber.keys(), 0);
  const maxMarker = activeIndexText.match(HISTORY_MAX_MARKER);
  if (!maxMarker) {
    violations.push(`${ACTIVE_INDEX}: missing adr-history-max marker`);
  } else if (Number(maxMarker[1]) !== maxNumber) {
    violations.push(`${ACTIVE_INDEX}: adr-history-max must equal current maximum ${String(maxNumber).padStart(4, "0")}`);
  }
  const gapsMarker = activeIndexText.match(HISTORY_GAPS_MARKER);
  const gaps = gapsMarker
    ? gapsMarker[1].split(",").map((value) => Number(value.trim())).filter(Number.isInteger)
    : [];
  if (!gapsMarker) violations.push(`${ACTIVE_INDEX}: missing adr-history-gaps marker`);
  const gapSet = new Set(gaps);
  if (gapSet.size !== gaps.length) {
    violations.push(`${ACTIVE_INDEX}: adr-history-gaps contains duplicates`);
  }
  for (const gap of gaps) {
    if (byNumber.has(gap)) violations.push(`historical ADR gap ${String(gap).padStart(4, "0")} was reused`);
    if (gap < 1 || gap > maxNumber) {
      violations.push(`historical ADR gap ${String(gap).padStart(4, "0")} is outside the assigned history`);
    }
  }
  for (const number of byNumber.keys()) {
    if (number > 0 && number <= maxNumber && gaps.includes(number)) {
      violations.push(`ADR ${String(number).padStart(4, "0")} is both assigned and marked as a historical gap`);
    }
  }
  for (let number = 1; number <= maxNumber; number += 1) {
    if (!byNumber.has(number) && !gapSet.has(number)) {
      violations.push(
        `ADR ${String(number).padStart(4, "0")} is an unrecorded historical gap; new ADR numbers must use max + 1`,
      );
    }
  }

  if (/docs\/decisions\/archive\//u.test(architectureMapText)) {
    violations.push("docs/ARCHITECTURE_MAP.md: the default architecture reading path cannot treat archived ADRs as current constraints");
  }
  return [...new Set(violations)].sort();
}

async function allRepositoryMarkdownFiles() {
  const ignored = new Set([".git", "node_modules", "dist", "dist-desktop", "release", ".next", ".codex-worktrees", ".worktrees"]);
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.flatMap((entry) => {
      if (ignored.has(entry.name)) return [];
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return [visit(absolute, relative)];
      return entry.isFile() && entry.name.endsWith(".md")
        ? [Promise.resolve([relative])]
        : [];
    }));
    return nested.flat();
  }
  return visit(PRODUCT_ROOT);
}

export async function adrViolations({ productRoot = PRODUCT_ROOT } = {}) {
  const activeRoot = path.join(productRoot, "docs", "decisions");
  const archiveRoot = path.join(activeRoot, "archive");
  const activeNames = (await readdir(activeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();
  const archiveNames = (await readdir(archiveRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();
  const records = [];
  for (const [location, root, names, prefix] of [
    ["active", activeRoot, activeNames, "docs/decisions"],
    ["archive", archiveRoot, archiveNames, "docs/decisions/archive"],
  ]) {
    for (const name of names) {
      const source = await readFile(path.join(root, name), "utf8");
      records.push(parseAdrDocument(`${prefix}/${name}`, source, location));
    }
  }
  const recordsByPath = new Map(records.map((record) => [record.relativePath, record]));
  const repositoryLinks = [];
  const repositoryFiles = await allRepositoryMarkdownFiles();
  for (const relative of repositoryFiles) {
    const source = await readFile(path.join(productRoot, relative), "utf8");
    repositoryLinks.push(...decisionLinksInRepository(relative, source, recordsByPath));
  }
  const [activeIndexText, archiveIndexText, architectureMapText] = await Promise.all([
    readFile(path.join(activeRoot, "README.md"), "utf8").catch(() => ""),
    readFile(path.join(archiveRoot, "README.md"), "utf8").catch(() => ""),
    readFile(path.join(productRoot, "docs", "ARCHITECTURE_MAP.md"), "utf8").catch(() => ""),
  ]);
  return validateAdrIndex({
    records,
    activeIndexText,
    archiveIndexText,
    repositoryDecisionLinks: repositoryLinks,
    architectureMapText,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await adrViolations();
  if (violations.length > 0) {
    process.stderr.write(`ADR index check failed:\n- ${violations.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("ADR index check passed.\n");
  }
}
