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
 * Byte-level mutations only. Each one edits the authored bytes and leaves
 * every other byte untouched, which is what makes "the chart must not change"
 * a fair claim.
 *
 * `noop` is the strictest false-positive probe available: both sides are the
 * same bytes, so any reported chart change is unambiguously the pipeline's.
 */
export function reviewRuntimePageMutations(html, hostIds) {
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
  ];
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
