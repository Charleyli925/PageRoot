// Adversarial pages for the runtime visual pipeline. Authored pages cannot
// produce these conditions on demand: a page that rewrites the canvas
// prototype, a canvas tainted by a cross-origin image, a WebGL surface with no
// 2d context, a surface over the pixel budget, or two hosts claiming one
// identity. Each page states what the pipeline must do, and every expectation
// here is about refusing to claim something rather than about a nicer verdict.
//
// Synthetic data only: every value is invented and no page references a real
// document, project or host.

const CHART_SCRIPT = `
  const draw = (canvas, shade) => {
    const context = canvas.getContext("2d");
    context.fillStyle = shade;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0b1220";
    context.fillRect(8, 8, 40, 60);
  };
`;

function page(title, body, script = "", headStyle = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; }
  section { padding: 24px; }
  .host { width: 240px; height: 160px; }
  ${headStyle}
</style>
</head>
<body>
<section>
  <h1>${title}</h1>
  ${body}
</section>
<script>${CHART_SCRIPT}${script}</script>
</body>
</html>
`;
}

/**
 * Each scenario names the property under test, the page pair, and the outcome
 * the pipeline owes a reviewer. `mustNotConfirmUnchanged` is the strongest of
 * them: claiming "verified unchanged" for something never actually read is the
 * one failure a reviewer cannot detect for themselves.
 */
export function reviewRuntimeAdversarialScenarios() {
  return Object.freeze([
    Object.freeze({
      id: "prototype-rewrite",
      // The digest is read in an isolated world, so a page rewriting the canvas
      // prototype in its own world must not be able to dictate what the owner
      // sees. If it could, every "unchanged" verdict on every page would be
      // only as trustworthy as the page itself.
      property: "隔离世界不受页面改写原型影响",
      expectation: "changed",
      hostId: "adv-proto",
      before: page("原型改写", '<div class="host" id="adv-proto"></div>', `
        const original = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
          const image = original.call(this, x, y, w, h);
          image.data.fill(7);
          return image;
        };
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-proto").appendChild(canvas);
        draw(canvas, "#38bdf8");
      `),
      after: page("原型改写", '<div class="host" id="adv-proto"></div>', `
        const original = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
          const image = original.call(this, x, y, w, h);
          image.data.fill(7);
          return image;
        };
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-proto").appendChild(canvas);
        draw(canvas, "#f97316");
      `),
    }),
    Object.freeze({
      id: "throwing-library-getter",
      property: "库入口抛异常时不崩且不冒充已核实",
      expectation: "mustNotConfirmUnchanged",
      hostId: "adv-throw",
      before: page("抛异常入口", '<div class="host" id="adv-throw"></div>', `
        Object.defineProperty(window, "echarts", {
          configurable: true,
          get() { throw new Error("library unavailable"); },
        });
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-throw").appendChild(canvas);
        draw(canvas, "#22c55e");
      `),
      after: page("抛异常入口", '<div class="host" id="adv-throw"></div>', `
        Object.defineProperty(window, "echarts", {
          configurable: true,
          get() { throw new Error("library unavailable"); },
        });
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-throw").appendChild(canvas);
        draw(canvas, "#a855f7");
      `),
    }),
    Object.freeze({
      id: "tainted-canvas",
      // A canvas the owner cannot read must fall back to the pixel path, and
      // must never be reported as verified unchanged on the strength of a
      // digest that was never obtained.
      property: "跨域污染 canvas 回退像素路径，不得冒充已核实未变",
      expectation: "mustNotConfirmUnchanged",
      hostId: "adv-taint",
      before: page("污染画布", '<div class="host" id="adv-taint"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-taint").appendChild(canvas);
        draw(canvas, "#0ea5e9");
        const image = new Image();
        image.crossOrigin = null;
        image.onload = () => canvas.getContext("2d").drawImage(image, 0, 0);
        image.src = "https://example.invalid/tile.png";
      `),
      after: page("污染画布", '<div class="host" id="adv-taint"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-taint").appendChild(canvas);
        draw(canvas, "#ef4444");
        const image = new Image();
        image.crossOrigin = null;
        image.onload = () => canvas.getContext("2d").drawImage(image, 0, 0);
        image.src = "https://example.invalid/tile.png";
      `),
    }),
    Object.freeze({
      id: "webgl-surface",
      property: "WebGL 画布无 2d 上下文时回退，不得冒充已核实未变",
      expectation: "mustNotConfirmUnchanged",
      hostId: "adv-webgl",
      before: page("WebGL 画布", '<div class="host" id="adv-webgl"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-webgl").appendChild(canvas);
        const gl = canvas.getContext("webgl");
        if (gl) { gl.clearColor(0.1, 0.6, 0.9, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      `),
      after: page("WebGL 画布", '<div class="host" id="adv-webgl"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-webgl").appendChild(canvas);
        const gl = canvas.getContext("webgl");
        if (gl) { gl.clearColor(0.9, 0.3, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      `),
    }),
    Object.freeze({
      id: "oversized-surface",
      property: "超出像素预算的画布回退，不得冒充已核实未变",
      expectation: "mustNotConfirmUnchanged",
      hostId: "adv-huge",
      before: page("超预算画布", '<div class="host" id="adv-huge"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 4096; canvas.height = 2048;
        canvas.style.width = "240px"; canvas.style.height = "160px";
        document.getElementById("adv-huge").appendChild(canvas);
        draw(canvas, "#14b8a6");
      `),
      after: page("超预算画布", '<div class="host" id="adv-huge"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 4096; canvas.height = 2048;
        canvas.style.width = "240px"; canvas.style.height = "160px";
        document.getElementById("adv-huge").appendChild(canvas);
        draw(canvas, "#e11d48");
      `),
    }),
    Object.freeze({
      id: "duplicate-identity",
      // Binding requires one globally unique match, so a second element wearing
      // the same identity must close the binding rather than pick either one.
      property: "身份重复时绑定关闭，不得任选其一",
      expectation: "mustNotConfirmUnchanged",
      // The only page here whose binding is meant to close entirely.
      expectedCandidates: 0,
      hostId: "adv-dup",
      before: page(
        "重复身份",
        '<div class="host" id="adv-dup"></div><div class="host" id="adv-dup"></div>',
        `
        document.querySelectorAll("#adv-dup").forEach((host, index) => {
          const canvas = document.createElement("canvas");
          canvas.width = 240; canvas.height = 160;
          host.appendChild(canvas);
          draw(canvas, index ? "#f59e0b" : "#3b82f6");
        });
      `,
      ),
      after: page(
        "重复身份",
        '<div class="host" id="adv-dup"></div><div class="host" id="adv-dup"></div>',
        `
        document.querySelectorAll("#adv-dup").forEach((host, index) => {
          const canvas = document.createElement("canvas");
          canvas.width = 240; canvas.height = 160;
          host.appendChild(canvas);
          draw(canvas, index ? "#7c3aed" : "#3b82f6");
        });
      `,
      ),
    }),
    Object.freeze({
      id: "never-settling-animation",
      // A chart that never stops repainting used to be dropped, which turned a
      // live chart into a silent gap. It must stay visible to the pipeline, and
      // an unchanged one must still not be reported as a confirmed change.
      property: "永不静止的动画不得被丢弃，也不得报确认变化",
      expectation: "unchanged",
      hostId: "adv-anim",
      before: page("持续动画", '<div class="host" id="adv-anim"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-anim").appendChild(canvas);
        const context = canvas.getContext("2d");
        let tick = 0;
        const spin = () => {
          tick += 1;
          context.fillStyle = "#0f172a";
          context.fillRect(0, 0, 240, 160);
          context.fillStyle = "#38bdf8";
          context.fillRect(20 + (tick % 40), 20, 30, 100);
          requestAnimationFrame(spin);
        };
        spin();
      `),
      after: page("持续动画", '<div class="host" id="adv-anim"></div>', `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-anim").appendChild(canvas);
        const context = canvas.getContext("2d");
        let tick = 0;
        const spin = () => {
          tick += 1;
          context.fillStyle = "#0f172a";
          context.fillRect(0, 0, 240, 160);
          context.fillStyle = "#38bdf8";
          context.fillRect(20 + (tick % 40), 20, 30, 100);
          requestAnimationFrame(spin);
        };
        spin();
      `),
    }),
    Object.freeze({
      id: "sticky-ancestor",
      // Ancestor transform is deliberately left out of the digest because a
      // sticky ancestor resolves a scroll-dependent matrix. This is the page
      // that would break if it were ever folded in.
      property: "sticky 祖先的滚动相关矩阵不得造成确认变化",
      expectation: "unchanged",
      hostId: "adv-sticky",
      before: page(
        "sticky 祖先",
        '<div style="position:sticky;top:0"><div class="host" id="adv-sticky"></div></div>'
        + '<div style="height:2400px"></div>',
        `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-sticky").appendChild(canvas);
        draw(canvas, "#64748b");
      `,
      ),
      after: page(
        "sticky 祖先",
        '<div style="position:sticky;top:0"><div class="host" id="adv-sticky"></div></div>'
        + '<div style="height:2400px"></div>',
        `
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        document.getElementById("adv-sticky").appendChild(canvas);
        draw(canvas, "#64748b");
      `,
      ),
    }),
    Object.freeze({
      id: "descendant-stylesheet-recolor",
      // Resolved paint of every drawable node is folded in precisely because a
      // stylesheet rule leaves the SVG markup untouched.
      property: "外部样式重着色 SVG 后代必须被发现",
      expectation: "changed",
      hostId: "adv-svg",
      before: page(
        "SVG 后代着色",
        '<div class="host" id="adv-svg"><svg id="adv-svg-chart" viewBox="0 0 240 160" width="240" height="160">'
        + '<path d="M20 140 L60 60 L100 110 L140 30 L180 90" fill="none" stroke-width="6"></path>'
        + "</svg></div>"
        + "<style>#adv-svg path { stroke: #2563eb; }</style>",
      ),
      after: page(
        "SVG 后代着色",
        '<div class="host" id="adv-svg"><svg id="adv-svg-chart" viewBox="0 0 240 160" width="240" height="160">'
        + '<path d="M20 140 L60 60 L100 110 L140 30 L180 90" fill="none" stroke-width="6"></path>'
        + "</svg></div>"
        + "<style>#adv-svg path { stroke: #dc2626; }</style>",
      ),
    }),
    Object.freeze({
      id: "composite-filter",
      // The effect is applied by the script at runtime, not written on the host
      // in source. A box style the static diff can pin on the exact host is
      // already reported by the static layer, and the runtime deliberately skips
      // it to avoid saying the same thing twice — so a source-side style would
      // test the wrong thing here. Only a runtime-applied effect exercises the
      // presentation half of the digest.
      property: "运行时施加的合成期 filter 必须被发现",
      expectation: "changed",
      hostId: "adv-filter",
      before: page("合成期 filter", '<div class="host" id="adv-filter"></div>', `
        const host = document.getElementById("adv-filter");
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        host.appendChild(canvas);
        draw(canvas, "#0284c7");
        host.style.filter = "none";
      `),
      after: page("合成期 filter", '<div class="host" id="adv-filter"></div>', `
        const host = document.getElementById("adv-filter");
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        host.appendChild(canvas);
        draw(canvas, "#0284c7");
        host.style.filter = "invert(1)";
      `),
    }),
  ]);
}
