const SHA = (digit) => `sha256:${digit.repeat(64)}`;

export const RUNTIME_VISUAL_HOSTILE_PAGES = Object.freeze([
  Object.freeze({
    id: "pr100-canvas-native-intrinsics",
    pr: 100,
    threadId: "PRRT_kwDOTdtgh86W9A1Y",
    surface: "review",
    html: `<!doctype html><main><div id="chart"><canvas width="8" height="8"></canvas></div>
      <script>Math.round=()=>0;Math.max=()=>0;Number=()=>0;</script></main>`,
    contract: "Capture binds numeric and canvas intrinsics before authored scripts run.",
    closureReason: "The bootstrap uses captured Number and Math operations for canvas sizing.",
  }),
  Object.freeze({
    id: "pr100-single-painted-child",
    pr: 100,
    threadId: "PRRT_kwDOTdtgh86W9A1b",
    surface: "review",
    html: `<!doctype html><main><div id="chart"></div><script>
      const bar=document.createElement("i");bar.style.cssText="display:block;background:red;width:8px;height:8px";
      document.getElementById("chart").append(bar);</script></main>`,
    contract: "One visible painted child plus one geometry atom is chart-like evidence.",
    closureReason: "Admission and change comparison both accept the paint-plus-geometry pair.",
  }),
  Object.freeze({
    id: "pr100-transparent-text",
    pr: 100,
    threadId: "PRRT_kwDOTdtgh86W9A1d",
    surface: "review",
    html: `<!doctype html><main><div id="chart"></div><script>
      const label=document.createElement("span");label.style.color="transparent";label.textContent="hidden";
      const alphaLabel=document.createElement("span");alphaLabel.style.cssText="color:rgba(255, 0, 0, 0);text-shadow:0 0 2px rgba(0, 255, 0, 0)";alphaLabel.textContent="also hidden";
      RegExp.prototype[Symbol.match]=()=>null;
      document.getElementById("chart").append(label,alphaLabel);</script></main>`,
    contract: "Text without visible color, shadow, decoration, or stroke paint is not visual evidence.",
    closureReason: "Keyword and zero-alpha paint are both excluded before content, paint, and geometry hashing.",
  }),
  Object.freeze({
    id: "pr105-generic-selector-host",
    pr: 105,
    threadId: "PRRT_kwDOTdtgh86XQhQi",
    surface: "edit",
    html: `<!doctype html><main><canvas></canvas><script>
      document.querySelector("canvas").getContext("2d").fillRect(0,0,8,8);</script></main>`,
    contract: "A generic or computed DOM query makes every exact empty visual host a candidate.",
    closureReason: "Indirect-query detection widens capture conservatively while exact host identity stays source-backed.",
  }),
  Object.freeze({
    id: "pr105-dynamic-id-dependency",
    pr: 105,
    threadId: "PRRT_kwDOTdtgh86XQhQm",
    surface: "edit",
    html: `<!doctype html><main><p id="data">1,2,3</p><div id="chart"></div><script>
      document.getElementById("chart").textContent=document.getElementById(["da","ta"].join("")).textContent;
      </script></main>`,
    changedHtml: `<!doctype html><main><p id="data">3,2,1</p><div id="chart"></div><script>
      document.getElementById("chart").textContent=document.getElementById(["da","ta"].join("")).textContent;
      </script></main>`,
    contract: "Computed element lookup is an indirect dependency and keys capture by the full source hash.",
    closureReason: "The computed getElementById call widens candidates and invalidates on any source change.",
  }),
  Object.freeze({
    id: "pr105-owner-deadline",
    pr: 105,
    threadId: "PRRT_kwDOTdtgh86XQhQo",
    surface: "edit",
    html: `<!doctype html><main><div id="chart"></div><script>
      Object.defineProperty(performance,"now",{value:()=>0});
      document.getElementById("chart").append(document.createElement("canvas"));</script></main>`,
    contract: "Every page-realm capture operation is bounded by the owner deadline.",
    closureReason: "A stalled settle promise cancels and destroys the hidden capture window.",
  }),
  Object.freeze({
    id: "pr107-parser-text-mutation",
    pr: 107,
    threadId: "PRRT_kwDOTdtgh86XW6Z8",
    surface: "review",
    html: `<!doctype html><main><section id="target">original</section><div class="chart"></div><script>
      document.getElementById("target").textContent="mutated";</script><div class="chart"></div></main>`,
    contract: "Parser-added targets may bind by stable identity before mutable text is compared, even across duplicate parser checkpoints.",
    closureReason: "Mutation records retain only the path-matching Element; mismatched observations never fall back to a partial-document fingerprint scan.",
  }),
  Object.freeze({
    id: "pr107-attribute-limit",
    pr: 107,
    threadId: "PRRT_kwDOTdtgh86XW6Z_",
    surface: "review",
    html: `<!doctype html><main><div id="chart" ${Array.from(
      { length: 25 },
      (_, index) => `data-key-${index}="${index}"`,
    ).join(" ")}></div><script>
      document.getElementById("chart").append(document.createElement("canvas"));</script></main>`,
    contract: "Producer and consumer use the same 24-attribute identity limit.",
    closureReason: "The producer deterministically prioritizes and truncates identity attributes before serialization.",
  }),
]);

export const RUNTIME_VISUAL_FIXTURE_SOURCE_SHA = Object.freeze({
  before: SHA("a"),
  after: SHA("b"),
});

export function runtimeVisualHostilePage(id) {
  return RUNTIME_VISUAL_HOSTILE_PAGES.find((fixture) => fixture.id === id);
}
