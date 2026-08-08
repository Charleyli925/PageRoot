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
    html: `<!doctype html><main><div class="chart-host"></div><script>
      const bar=document.createElement("i");bar.style.cssText="display:block;background:red;width:8px;height:8px";
      document.querySelector(".chart-host").append(bar);</script></main>`,
    contract: "A class-only runtime host remains path-bound even when its identity attributes are limited to the source-box class.",
    closureReason: "The frozen path proves the unique host before the painted child is observed, so the runtime batch is not discarded for lack of non-class attributes.",
  }),
  Object.freeze({
    id: "pr100-transparent-text",
    pr: 100,
    threadId: "PRRT_kwDOTdtgh86W9A1d",
    surface: "review",
    html: `<!doctype html><main><div id="chart"></div><script>
      const label=document.createElement("span");label.style.color="transparent";label.textContent="hidden";
      const alphaLabel=document.createElement("span");alphaLabel.style.cssText="color:rgba(255, 0, 0, 0);text-shadow:0 0 2px rgba(0, 255, 0, 0)";alphaLabel.textContent="also hidden";
      const css4Label=document.createElement("span");css4Label.style.cssText="color:color(srgb 1 0 0 / 0);text-shadow:0 0 2px oklab(60% 0 0 / 0)";css4Label.textContent="css4 hidden";
      const hexLabel=document.createElement("span");hexLabel.style.color="#ff000000";hexLabel.textContent="hex hidden";
      const opaqueBlack=document.createElement("span");opaqueBlack.style.color="rgb(0, 0, 0)";opaqueBlack.textContent="visible black";
      const opaqueRed=document.createElement("span");opaqueRed.style.color="rgb(255, 0, 0)";opaqueRed.textContent="visible red";
      RegExp.prototype[Symbol.match]=()=>null;
      RegExp.prototype.exec=()=>null;
      document.getElementById("chart").append(label,alphaLabel,css4Label,hexLabel,opaqueBlack,opaqueRed);</script></main>`,
    contract: "Text without visible color, shadow, decoration, or stroke paint is not visual evidence, including CSS Color 4 alpha syntax.",
    closureReason: "Captured RegExp exec plus RGB, CSS Color 4, and hex alpha parsing exclude transparent paint before content, paint, and geometry hashing.",
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
    html: `<!doctype html><main><section id="target">original</section><p class="comment-target">first comment</p><p class="comment-target">second comment</p><div class="chart"></div><script>
      document.getElementById("target").textContent="mutated";</script><div class="chart"></div></main>`,
    contract: "Parser-added targets may bind by stable identity before mutable text is compared, while class-only comment fingerprints remain text-sensitive across duplicate parser checkpoints.",
    closureReason: "Mutation records retain only the path-matching Element; final class-only matching keeps frozen text and never guesses among duplicate siblings.",
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
