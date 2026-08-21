/**
 * Discovers runtime visual candidates in an arbitrary authored page, and
 * derives before/after pairs from it, so the census can run against real
 * documents without any of them entering the repository.
 *
 * Candidate discovery mirrors the owner's static binding rules rather than the
 * production annotator: the census only needs bindings the owner will accept,
 * and re-deriving them here keeps this file free of renderer imports.
 */

import { parse as parseHtml } from "parse5";

const MAX_CANDIDATES = 16;

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function htmlElement(document) {
  return elementChildren(document).find((node) => node.tagName === "html") || null;
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

function scriptText(root) {
  const chunks = [];
  const visit = (node) => {
    if (node?.tagName === "script") {
      (node.childNodes || []).forEach((child) => {
        if (child?.nodeName === "#text") chunks.push(String(child.value || ""));
      });
      return;
    }
    (node?.childNodes || []).forEach(visit);
  };
  visit(root);
  return chunks.join("\n");
}

/**
 * Returns owner-shaped capture candidates plus the host ids the mutations can
 * target. A source-empty element only qualifies when a script mentions its id:
 * that is what separates a chart container from the many empty layout boxes a
 * real page contains, and picking those up would report them as permanently
 * unavailable and pollute the census.
 */
export function discoverReviewRuntimePageCandidates(html) {
  const root = htmlElement(parseHtml(html));
  if (!root) return { candidates: [], hostIds: [] };
  const scripts = scriptText(root);
  const idCounts = new Map();
  const collectIds = (node) => {
    const id = attribute(node, "id");
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    elementChildren(node).forEach(collectIds);
  };
  collectIds(root);

  const candidates = [];
  const hostIds = [];
  const visit = (node, path, insideVisual) => {
    if (candidates.length >= MAX_CANDIDATES) return;
    const tagName = node.tagName;
    const id = attribute(node, "id");
    const isVisual = tagName === "svg" || tagName === "canvas";
    if (isVisual && !insideVisual) {
      candidates.push(Object.freeze({
        key: `runtime-host-${candidates.length + 1}`,
        path: Object.freeze([...path]),
        tagName,
        kind: tagName,
        identityAttributes: Object.freeze(id ? [Object.freeze(["id", id])] : []),
      }));
    } else if (
      !insideVisual
      && id
      && idCounts.get(id) === 1
      && sourceContentIsEmpty(node)
      && scripts.includes(id)
    ) {
      candidates.push(Object.freeze({
        key: `runtime-host-${candidates.length + 1}`,
        path: Object.freeze([...path]),
        tagName,
        kind: "host",
        identityAttributes: Object.freeze([Object.freeze(["id", id])]),
      }));
      hostIds.push(id);
    }
    elementChildren(node).forEach((child, index) => {
      visit(child, [...path, index], insideVisual || isVisual);
    });
  };
  elementChildren(root).forEach((child, index) => visit(child, [index], false));
  return { candidates: Object.freeze(candidates), hostIds: Object.freeze(hostIds) };
}

function insertAfterBodyOpen(html, markup) {
  const match = /<body\b[^>]*>/iu.exec(html);
  if (!match) return null;
  const at = match.index + match[0].length;
  return html.slice(0, at) + markup + html.slice(at);
}

function insertAfterHeadOpen(html, markup) {
  const match = /<head\b[^>]*>/iu.exec(html);
  if (!match) return null;
  const at = match.index + match[0].length;
  return html.slice(0, at) + markup + html.slice(at);
}

function insertBeforeBodyClose(html, markup) {
  const at = html.toLowerCase().lastIndexOf("</body>");
  if (at < 0) return null;
  return html.slice(0, at) + markup + html.slice(at);
}

function insertBeforeHeadClose(html, markup) {
  const at = html.toLowerCase().indexOf("</head>");
  if (at < 0) return null;
  return html.slice(0, at) + markup + html.slice(at);
}

const INSERTED_BLOCK = '<section data-pageroot-census-inserted="true" '
  + 'style="margin:16px;padding:16px;border:1px solid #e5e7eb;border-radius:12px">'
  + "<h2>普查插入区块</h2><p>这一段由普查注入，用于把下方内容整体下移。</p>"
  + "<p>它不属于任何图表，图表本身不应因此被判为变化。</p></section>";

const APPENDED_NOTE = '<p data-pageroot-census-appended="true" '
  + 'style="margin:16px;color:#6b7280;font-size:12px">普查追加的页尾说明文字。</p>';

/**
 * Changes what a chart draws, on any authored page, without knowing how that
 * page builds its option object.
 *
 * The library assigns itself to a global, so intercepting that access is
 * enough to wrap every chart the page later creates. The wrap happens on read
 * rather than on assignment: a UMD bundle publishes an empty object first and
 * only then fills in `init`, so wrapping at assignment time would inspect a
 * bare `{}` and silently do nothing.
 *
 * Byte-level edits cannot reach chart content the way they reach markup, and a
 * census that only ever edits markup can prove "no false alarm" while proving
 * nothing about detection — which is the more dangerous half to get wrong.
 */
function chartContentPatch(body) {
  return `<script data-pageroot-census-patch="true">(function () {
  var patched = null;
  function wrap(library) {
    if (!library || typeof library.init !== "function" || library.__pagerootCensusPatched) {
      return library;
    }
    var originalInit = library.init;
    library.init = function () {
      var chart = originalInit.apply(this, arguments);
      if (chart && typeof chart.setOption === "function" && !chart.__pagerootCensusPatched) {
        var originalSetOption = chart.setOption;
        chart.setOption = function (option) {
          try { mutate(option); } catch (error) { /* never break the page */ }
          return originalSetOption.apply(this, arguments);
        };
        chart.__pagerootCensusPatched = true;
      }
      return chart;
    };
    library.__pagerootCensusPatched = true;
    return library;
  }
  function mutate(option) {
${body}
  }
  Object.defineProperty(window, "echarts", {
    configurable: true,
    get: function () { return wrap(patched); },
    set: function (value) { patched = value; },
  });
})();</script>`;
}

const RECOLOUR_PALETTE = ["#1f9d76", "#4cb894", "#8ad3ba", "#c4e9dc", "#0f6b50"];

const RECOLOUR_PATCH = chartContentPatch(`    if (!option || typeof option !== "object") return;
    option.color = ${JSON.stringify(RECOLOUR_PALETTE)};
    var series = Array.isArray(option.series) ? option.series : [];
    series.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      entry.color = null;
      if (entry.itemStyle) entry.itemStyle.color = null;
      if (entry.lineStyle) entry.lineStyle.color = null;
      if (entry.areaStyle) entry.areaStyle.color = null;
    });`);

// A single SVG rule reaches inline vector charts, which no library hook can.
const RECOLOUR_STYLE = '<style data-pageroot-census-patch="true">'
  + `svg path,svg rect,svg polygon,svg circle{fill:${RECOLOUR_PALETTE[0]} !important}`
  + `svg polyline,svg line{stroke:${RECOLOUR_PALETTE[0]} !important}</style>`;

const RESCALE_PATCH = chartContentPatch(`    if (!option || typeof option !== "object") return;
    var series = Array.isArray(option.series) ? option.series : [];
    series.forEach(function (entry) {
      if (!entry || !Array.isArray(entry.data)) return;
      entry.data = entry.data.map(function (point) {
        if (typeof point === "number") return point * 1.32 + 3;
        if (point && typeof point === "object" && typeof point.value === "number") {
          var copy = {};
          for (var key in point) { if (Object.prototype.hasOwnProperty.call(point, key)) copy[key] = point[key]; }
          copy.value = point.value * 1.32 + 3;
          return copy;
        }
        return point;
      });
    });`);

/**
 * Each mutation edits the authored bytes and leaves every other byte
 * untouched, which is what makes "the chart must not change" a fair claim.
 *
 * `noop` is the strictest false-positive probe available: both sides are the
 * same bytes, so any reported chart change is unambiguously the pipeline's.
 * The recolour and rescale mutations are the other half — without them a
 * census can only show that nothing is reported, never that something would
 * be.
 */
export function reviewRuntimePageMutations(html, hostIds, hostSelectors = []) {
  const selector = hostSelectors.filter((value) => /^[A-Za-z][\w-]*$/u.test(value))
    .map((value) => `#${value}`)
    .join(",");
  const mutations = [
    { id: "real-noop", chartExpectation: "unchanged", after: html },
    {
      id: "real-append-tail",
      chartExpectation: "unchanged",
      after: insertBeforeBodyClose(html, APPENDED_NOTE),
    },
    {
      id: "real-insert-above",
      chartExpectation: "unchanged",
      after: insertAfterBodyOpen(html, INSERTED_BLOCK),
    },
    {
      id: "real-chart-recolor",
      chartExpectation: "changed",
      after: insertAfterHeadOpen(html, RECOLOUR_PATCH + RECOLOUR_STYLE),
    },
    {
      id: "real-chart-rescale",
      chartExpectation: "changed",
      after: insertAfterHeadOpen(html, RESCALE_PATCH),
    },
  ];
  if (selector) {
    // Library-independent control. Inverting a host repaints everything drawn
    // inside it, so a host that renders anything at all must be reported as
    // changed. When this one is missed, the capture never saw the host's
    // content and no library-level probe can be trusted on that page.
    mutations.push({
      id: "real-host-invert",
      chartExpectation: "changed",
      after: insertBeforeHeadClose(
        html,
        `<style data-pageroot-census-patch="true">${selector}{filter:invert(1) !important}</style>`,
      ),
    });
  }
  const firstHost = hostIds[0];
  // Only ids a CSS selector can carry verbatim; anything else would need
  // escaping rules this probe has no reason to reimplement.
  if (firstHost && /^[A-Za-z][\w-]*$/u.test(firstHost)) {
    mutations.push({
      id: "real-host-resize",
      chartExpectation: "unchanged",
      after: insertBeforeHeadClose(
        html,
        `<style>#${firstHost}{width:62% !important}</style>`,
      ),
      // Only the resized host is expected to change; every other host on the
      // page must stay unchanged, which makes this both a detection control
      // and a false-positive probe in one run.
      changedHostId: firstHost,
    });
  }
  return mutations.filter((mutation) => typeof mutation.after === "string");
}
