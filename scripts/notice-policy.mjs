// Notice growth freeze: production code may only keep registered setToast /
// NoticeBar / background-result / uncatalogued surfaces, and later PRs may
// only shrink those counts. Classification lives in the ledger; this module
// enforces the freeze without inspecting business-object property order.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  callExpressions,
  jsxElementNames,
  parseModule,
  stringLiterals,
} from "./architecture-ast-query.mjs";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const NOTICE_LEDGER_REL = "scripts/notice-disposition-ledger.json";

const SKIP_PREFIXES = [
  "tests/",
  "scripts/",
  ".codex-worktrees/",
];

function isSkipped(file) {
  return SKIP_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function callName(call) {
  return call.path.split(".").at(-1);
}

function isSetToastCreate(call) {
  if (callName(call) !== "setToast") return false;
  const kind = call.argKinds?.[0];
  return kind !== undefined && kind !== "null";
}

function isSetToastClear(call) {
  return callName(call) === "setToast" && !isSetToastCreate(call);
}

function eachNode(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => eachNode(child, callback));
}

function setToastAliases(handle) {
  const names = [];
  eachNode(handle.sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) {
      return;
    }
    if (ts.isIdentifier(node.initializer) && node.initializer.text === "setToast"
      && node.name.text !== "setToast") {
      names.push(node.name.text);
    }
  });
  return names;
}

function staticText(node) {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…");
  }
  if (ts.isConditionalExpression(node)) {
    return [staticText(node.whenTrue), staticText(node.whenFalse)].filter(Boolean).join(" / ");
  }
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return `${node.expression.text}()`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const title = node.properties.find((property) => (
      ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === "title"
    ));
    return title && ts.isPropertyAssignment(title) ? staticText(title.initializer) : "";
  }
  if (ts.isSpreadAssignment(node)) return "";
  return "";
}

function objectProp(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return "";
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return staticText(property.initializer);
    }
  }
  return "";
}

export function extractSetToastCreates(handle) {
  const creates = [];
  eachNode(handle.sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const pathName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : null;
    if (pathName !== "setToast") return;
    const arg = node.arguments[0];
    if (!arg || arg.kind === ts.SyntaxKind.NullKeyword) return;
    const loc = handle.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    creates.push({
      line: loc.line + 1,
      title: staticText(arg) || objectProp(arg, "title"),
      disposition: objectProp(arg, "disposition") || "inform-in-place",
      tone: objectProp(arg, "tone"),
      dedupeKey: objectProp(arg, "dedupeKey"),
    });
  });
  return creates;
}

export async function loadNoticeLedger() {
  const source = await readFile(path.join(PRODUCT_ROOT, NOTICE_LEDGER_REL), "utf8");
  return JSON.parse(source);
}

export function noticeSurfaceFacts({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const toastCalls = callExpressions(handle).filter((call) => callName(call) === "setToast");
  return {
    file,
    createCalls: toastCalls.filter(isSetToastCreate).length,
    clearCalls: toastCalls.filter(isSetToastClear).length,
    noticeBarJsx: jsxElementNames(handle).filter((name) => name === "NoticeBar").length,
    backgroundResultLiterals: stringLiterals(handle).filter((value) => value === "background-result").length,
    uncataloguedLiterals: stringLiterals(handle).filter((value) => value === "uncatalogued").length,
    aliases: setToastAliases(handle),
  };
}

export function noticePolicyViolations({
  file = "",
  source = "",
  module = null,
  ledger,
} = {}) {
  if (!ledger || isSkipped(file)) return [];
  const facts = noticeSurfaceFacts({ file, source, module });
  const violations = [];
  const registeredToast = new Set(ledger.registeredFiles?.setToast || []);
  const registeredNoticeBar = new Set(ledger.registeredFiles?.noticeBar || []);
  const registeredBackground = new Set(ledger.registeredFiles?.backgroundResult || []);
  const registeredUncatalogued = new Set(ledger.registeredFiles?.uncatalogued || []);

  if (facts.createCalls > 0 && !registeredToast.has(file)) {
    violations.push(`${file}: setToast create calls are frozen; add only by deleting another registered site first`);
  }
  if (facts.noticeBarJsx > 0 && !registeredNoticeBar.has(file)) {
    violations.push(`${file}: NoticeBar is frozen to registered surfaces`);
  }
  if (facts.backgroundResultLiterals > 0 && !registeredBackground.has(file)) {
    violations.push(`${file}: background-result is frozen to registered files`);
  }
  if (facts.uncataloguedLiterals > 0 && !registeredUncatalogued.has(file)) {
    violations.push(`${file}: uncatalogued is frozen to registered telemetry fallbacks`);
  }
  if (facts.aliases.length > 0) {
    violations.push(`${file}: setToast aliases are forbidden; wrappers cannot bypass the notice freeze`);
  }
  return violations;
}

export async function noticeInventoryViolations(fileRecords, ledger) {
  const violations = [];
  let createCalls = 0;
  let noticeBarJsx = 0;
  let backgroundResultLiterals = 0;
  let uncataloguedLiterals = 0;
  for (const record of fileRecords) {
    if (isSkipped(record.file)) continue;
    const facts = noticeSurfaceFacts(record);
    createCalls += facts.createCalls;
    noticeBarJsx += facts.noticeBarJsx;
    backgroundResultLiterals += facts.backgroundResultLiterals;
    uncataloguedLiterals += facts.uncataloguedLiterals;
  }
  const baseline = ledger.baseline || {};
  const siteCount = Array.isArray(ledger.sites) ? ledger.sites.length : 0;
  if (createCalls > (baseline.setToastCreateCalls ?? 0)) {
    violations.push(
      `notice freeze: setToast create calls ${createCalls} exceed baseline ${baseline.setToastCreateCalls}`,
    );
  }
  if (noticeBarJsx > (baseline.noticeBarJsx ?? 0)) {
    violations.push(
      `notice freeze: NoticeBar JSX ${noticeBarJsx} exceeds baseline ${baseline.noticeBarJsx}`,
    );
  }
  if (backgroundResultLiterals > (baseline.backgroundResultLiterals ?? 0)) {
    violations.push(
      `notice freeze: background-result literals ${backgroundResultLiterals} exceed baseline ${baseline.backgroundResultLiterals}`,
    );
  }
  if (uncataloguedLiterals > (baseline.uncataloguedLiterals ?? 0)) {
    violations.push(
      `notice freeze: uncatalogued literals ${uncataloguedLiterals} exceed baseline ${baseline.uncataloguedLiterals}`,
    );
  }
  if (createCalls !== siteCount) {
    violations.push(
      `notice freeze: ledger has ${siteCount} sites but production has ${createCalls} setToast create calls`,
    );
  }
  if (siteCount > (baseline.setToastCreateCalls ?? 0)) {
    violations.push(
      `notice freeze: ledger sites ${siteCount} cannot exceed create-call baseline ${baseline.setToastCreateCalls}`,
    );
  }
  return violations;
}

export function noticeRatchetViolations(current, previous) {
  if (!previous) return [];
  const violations = [];
  const currentBaseline = current.baseline || {};
  const previousBaseline = previous.baseline || {};
  for (const key of [
    "setToastCreateCalls",
    "noticeBarJsx",
    "backgroundResultLiterals",
    "uncataloguedLiterals",
  ]) {
    if ((currentBaseline[key] ?? 0) > (previousBaseline[key] ?? 0)) {
      violations.push(`notice freeze: baseline.${key} can only decrease`);
    }
  }
  const previousAllow = new Set((previous.allowlist || []).map((entry) => entry.id));
  for (const entry of current.allowlist || []) {
    if (!previousAllow.has(entry.id) && previousAllow.size > 0) {
      violations.push(`notice freeze: allowlist id ${entry.id} is new; allowlist can only shrink`);
    }
  }
  const previousSites = new Map((previous.sites || []).map((site) => [site.id, site]));
  for (const site of current.sites || []) {
    const before = previousSites.get(site.id);
    if (!before) continue;
    if (before.fingerprint !== site.fingerprint && before.class === site.class) {
      violations.push(
        `notice freeze: ${site.id} changed without a class change or deletion`,
      );
    }
  }
  return violations;
}
