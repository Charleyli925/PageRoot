import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parse as parseHtml } from "parse5";

import { validateRuntimeSnapshotCaptureRequest } from "../desktop/runtime-visual-capture-owner.mjs";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";
import {
  REVIEW_RUNTIME_CHART_HOST_IDS,
  REVIEW_RUNTIME_CHART_SCENARIO_IDS,
  reviewRuntimeChartScenario,
} from "./fixtures/review-runtime-chart-scenarios.mjs";

// The census is only meaningful while its fixtures still bind. A drifted path
// or a host that stopped being source-empty would make every capture report
// "unavailable", and the census would pass by measuring nothing. These mirror
// the owner's static binding rules so that failure is loud and local.

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function htmlElement(document) {
  return elementChildren(document).find((node) => node.tagName === "html") || null;
}

function childAtPath(root, path) {
  let element = root;
  for (const index of path) {
    element = elementChildren(element)[index] || null;
    if (!element) return null;
  }
  return element;
}

function allElements(root) {
  const elements = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.tagName === "string") elements.push(node);
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(root);
  return elements;
}

function attribute(element, name) {
  const found = (Array.isArray(element?.attrs) ? element.attrs : [])
    .find((entry) => entry.name === name);
  return found ? String(found.value ?? "") : null;
}

function sourceContentIsEmpty(node) {
  return (node?.childNodes || []).every((child) => {
    if (child?.nodeName === "#comment") return true;
    if (child?.nodeName === "#text") return !String(child.value || "").trim();
    return false;
  });
}

function matchesBinding(element, hostId) {
  return element?.tagName === "div"
    && sourceContentIsEmpty(element)
    && attribute(element, "id") === hostId;
}

function captureRequest(page, side) {
  return {
    contractVersion: RUNTIME_VISUAL_CONTRACT.version,
    captureSessionId: "review-census-fixture-0001",
    sourceSha256: `sha256:${createHash("sha256").update(page.html, "utf8").digest("hex")}`,
    side,
    html: page.html,
    candidates: [...page.hostPaths.entries()].map(([id, elementPath]) => ({
      key: `runtime-host-${id}`,
      path: [...elementPath],
      tagName: "div",
      kind: "host",
      identityAttributes: [["id", id]],
    })),
    viewport: { width: 1_280, height: 900 },
  };
}

test("every census scenario declares both sides and a chart expectation", () => {
  REVIEW_RUNTIME_CHART_SCENARIO_IDS.forEach((id) => {
    const scenario = reviewRuntimeChartScenario(id);
    assert.ok(
      scenario.chartExpectation === "unchanged" || scenario.chartExpectation === "changed",
      `${id} must declare a chart expectation`,
    );
    ["before", "after"].forEach((side) => {
      assert.equal(typeof scenario[side].html, "string", `${id}.${side} must emit html`);
      assert.deepEqual(
        [...scenario[side].hostPaths.keys()].sort(),
        [...REVIEW_RUNTIME_CHART_HOST_IDS].sort(),
        `${id}.${side} must expose every chart host`,
      );
    });
  });
});

test("census scenarios include positive controls in both directions", () => {
  const expectations = REVIEW_RUNTIME_CHART_SCENARIO_IDS
    .map((id) => reviewRuntimeChartScenario(id).chartExpectation);
  assert.ok(
    expectations.includes("unchanged"),
    "a census without unchanged pairs cannot measure false positives",
  );
  assert.ok(
    expectations.includes("changed"),
    "a census without changed pairs could pass by never reporting anything",
  );
});

test("declared host paths resolve to unique source-empty hosts on both sides", () => {
  REVIEW_RUNTIME_CHART_SCENARIO_IDS.forEach((id) => {
    const scenario = reviewRuntimeChartScenario(id);
    ["before", "after"].forEach((side) => {
      const page = scenario[side];
      const root = htmlElement(parseHtml(page.html));
      assert.ok(root, `${id}.${side} must parse to an html element`);
      const elements = allElements(root);
      page.hostPaths.forEach((elementPath, hostId) => {
        const bound = childAtPath(root, elementPath);
        assert.ok(bound, `${id}.${side} path for ${hostId} must resolve`);
        assert.ok(
          matchesBinding(bound, hostId),
          `${id}.${side} host ${hostId} must be a source-empty div carrying its id`,
        );
        const matches = elements.filter((element) => matchesBinding(element, hostId));
        assert.equal(
          matches.length,
          1,
          `${id}.${side} host ${hostId} must be uniquely identifiable`,
        );
        assert.equal(matches[0], bound, `${id}.${side} host ${hostId} must be the bound element`);
      });
    });
  });
});

test("census capture requests satisfy the owner request contract", () => {
  REVIEW_RUNTIME_CHART_SCENARIO_IDS.forEach((id) => {
    const scenario = reviewRuntimeChartScenario(id);
    ["before", "after"].forEach((side) => {
      assert.doesNotThrow(
        () => validateRuntimeSnapshotCaptureRequest(captureRequest(scenario[side], side)),
        `${id}.${side} must produce a valid capture request`,
      );
    });
  });
});

test("structural scenarios move the charts while unchanged pairs keep chart inputs identical", () => {
  const shifted = reviewRuntimeChartScenario("structure-add");
  assert.notDeepEqual(
    shifted.before.hostPaths.get(REVIEW_RUNTIME_CHART_HOST_IDS[0]),
    shifted.after.hostPaths.get(REVIEW_RUNTIME_CHART_HOST_IDS[0]),
    "structure-add must relocate the chart host so the sides scroll differently",
  );
  const chartScriptOf = (html) => html.slice(html.lastIndexOf("<script>"));
  REVIEW_RUNTIME_CHART_SCENARIO_IDS
    .filter((id) => reviewRuntimeChartScenario(id).chartExpectation === "unchanged")
    .filter((id) => id !== "chart-script-noop")
    .forEach((id) => {
      const scenario = reviewRuntimeChartScenario(id);
      assert.equal(
        chartScriptOf(scenario.before.html),
        chartScriptOf(scenario.after.html),
        `${id} must not change the chart script, or it is not an unchanged-chart scenario`,
      );
    });
  const noop = reviewRuntimeChartScenario("chart-script-noop");
  assert.notEqual(
    chartScriptOf(noop.before.html),
    chartScriptOf(noop.after.html),
    "chart-script-noop must change script bytes without changing the rendered result",
  );
});

test("scenario timings are applied identically to both sides", () => {
  const scenario = reviewRuntimeChartScenario("footer-only", {
    animationMs: 640,
    libraryDelayMs: 90,
  });
  ["before", "after"].forEach((side) => {
    assert.match(scenario[side].html, /var ANIMATION_MS = 640;/u);
    assert.match(scenario[side].html, /var DELAY_MS = 90;/u);
  });
});
