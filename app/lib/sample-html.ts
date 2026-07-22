export const DEFAULT_PROJECT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>源页 · PageRoot</title>
  <style>
    :root {
      --paper: #fffdf8;
      --paper-deep: #f5f1e9;
      --ink: #1f2026;
      --muted: #686871;
      --line: #ddd8cf;
      --violet: #6550e8;
      --violet-soft: #eeeaff;
      --green: #39745a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ebe8e1;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      width: min(1040px, calc(100% - 40px));
      margin: 28px auto;
      overflow: hidden;
      border: 1px solid rgba(63, 57, 48, .12);
      border-radius: 30px;
      background: var(--paper);
      box-shadow: 0 28px 80px rgba(46, 41, 32, .12);
    }
    .hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(260px, .72fr);
      gap: 54px;
      padding: 44px 50px 54px;
      overflow: hidden;
      color: #f8f6ff;
      background:
        radial-gradient(circle at 86% 2%, rgba(131, 104, 255, .38), transparent 34%),
        linear-gradient(135deg, #1c1b24 0%, #242036 58%, #30265a 100%);
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 68px;
    }
    .brand-lockup { display: flex; align-items: center; gap: 12px; }
    .brand-lockup img {
      width: 42px;
      height: 42px;
      border-radius: 13px;
      box-shadow: 0 10px 26px rgba(14, 10, 50, .34);
    }
    .brand-lockup strong { display: block; font-size: 15px; letter-spacing: .02em; }
    .brand-lockup small { display: block; margin-top: 2px; color: rgba(248, 246, 255, .55); font-size: 10px; letter-spacing: .12em; }
    .demo-badge {
      padding: 7px 11px;
      border: 1px solid rgba(255, 255, 255, .18);
      border-radius: 999px;
      color: rgba(255, 255, 255, .72);
      background: rgba(255, 255, 255, .06);
      font-size: 10px;
      letter-spacing: .08em;
    }
    .eyebrow {
      margin: 0 0 18px;
      color: #bdb2ff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      max-width: 640px;
      margin: 0;
      font-family: "Songti SC", "STSong", serif;
      font-size: clamp(44px, 6vw, 68px);
      font-weight: 600;
      line-height: 1.08;
      letter-spacing: -.045em;
    }
    h1 span { color: #b8a9ff; }
    .intro {
      max-width: 620px;
      margin: 25px 0 0;
      color: rgba(248, 246, 255, .7);
      font-size: 15px;
      line-height: 1.9;
    }
    .hero-foot {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 30px;
    }
    .hero-foot span {
      padding: 8px 11px;
      border-radius: 999px;
      color: rgba(255, 255, 255, .72);
      background: rgba(255, 255, 255, .075);
      font-size: 10px;
    }
    .source-card {
      position: relative;
      z-index: 1;
      align-self: end;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 22px;
      background: rgba(255, 255, 255, .075);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08);
      backdrop-filter: blur(14px);
    }
    .source-card small { color: #bdb2ff; font-size: 10px; letter-spacing: .12em; }
    .source-card h2 { margin: 12px 0 9px; color: #fff; font-size: 22px; line-height: 1.35; }
    .source-card p { margin: 0; color: rgba(248, 246, 255, .62); font-size: 12px; line-height: 1.75; }
    .source-path {
      display: grid;
      gap: 8px;
      margin-top: 25px;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, .13);
    }
    .source-path span { display: flex; align-items: center; gap: 8px; color: rgba(255, 255, 255, .7); font-size: 10px; }
    .source-path i { width: 6px; height: 6px; border-radius: 50%; background: #8de0af; box-shadow: 0 0 0 4px rgba(141, 224, 175, .1); }
    .content { padding: 58px 50px 48px; }
    .section-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 28px;
      margin-bottom: 26px;
    }
    .section-heading small { color: var(--violet); font-size: 10px; font-weight: 750; letter-spacing: .14em; }
    .section-heading h2 { max-width: 570px; margin: 8px 0 0; font: 600 32px/1.28 "Songti SC", "STSong", serif; }
    .section-heading p { max-width: 330px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.75; }
    .promise-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-block: 1px solid var(--line); }
    .promise { min-height: 204px; padding: 25px 24px 24px 0; }
    .promise + .promise { padding-left: 24px; border-left: 1px solid var(--line); }
    .promise-index { color: var(--violet); font: 700 10px/1 system-ui; letter-spacing: .12em; }
    .promise h3 { margin: 40px 0 10px; font-size: 18px; }
    .promise p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .workflow {
      display: grid;
      grid-template-columns: .78fr 1.6fr;
      gap: 52px;
      margin-top: 58px;
      padding: 42px;
      border-radius: 24px;
      background: var(--paper-deep);
    }
    .workflow-copy small { color: var(--green); font-size: 10px; font-weight: 750; letter-spacing: .14em; }
    .workflow-copy h2 { margin: 12px 0 14px; font: 600 29px/1.35 "Songti SC", "STSong", serif; }
    .workflow-copy p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .steps { display: grid; gap: 0; }
    .step {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 14px;
      padding: 18px 0;
      border-bottom: 1px solid #d8d2c7;
    }
    .step:first-child { padding-top: 0; }
    .step:last-child { padding-bottom: 0; border-bottom: 0; }
    .step b { color: var(--violet); font: 700 11px/1.6 system-ui; }
    .step strong { display: block; margin-bottom: 5px; font-size: 14px; }
    .step span { display: block; color: var(--muted); font-size: 11px; line-height: 1.65; }
    .notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-top: 34px;
      padding: 20px 22px;
      border: 1px solid #d9d2f5;
      border-radius: 17px;
      background: #f7f4ff;
    }
    .notice strong { display: block; margin-bottom: 5px; color: #3f35a4; font-size: 13px; }
    .notice span { display: block; color: #706c7d; font-size: 11px; line-height: 1.6; }
    .notice em { flex: none; color: #4e43c6; font-size: 11px; font-style: normal; font-weight: 700; }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 23px 50px 25px;
      border-top: 1px solid var(--line);
      color: #8a888e;
      font-size: 10px;
      letter-spacing: .06em;
    }
    @media (max-width: 760px) {
      .page { width: 100%; margin: 0; border: 0; border-radius: 0; }
      .hero { grid-template-columns: 1fr; gap: 40px; padding: 30px 24px 40px; }
      .brand-row { margin-bottom: 48px; }
      .content { padding: 42px 24px 36px; }
      .section-heading { display: block; }
      .section-heading p { margin-top: 14px; }
      .promise-grid { grid-template-columns: 1fr; }
      .promise, .promise + .promise { min-height: 0; padding: 24px 0; border-left: 0; border-bottom: 1px solid var(--line); }
      .promise:last-child { border-bottom: 0; }
      .promise h3 { margin-top: 20px; }
      .workflow { grid-template-columns: 1fr; gap: 30px; padding: 30px 24px; }
      .notice { align-items: flex-start; flex-direction: column; }
      footer { padding: 20px 24px; }
    }
  </style>
</head>
<body>
  <article class="page">
    <header class="hero">
      <div>
        <div class="brand-row">
          <div class="brand-lockup">
            <img src="./brand-logo.png" alt="源页 Logo" />
            <div><strong>源页</strong><small>PAGEROOT</small></div>
          </div>
          <span class="demo-badge">内置介绍页</span>
        </div>
        <p class="eyebrow">Edit visually. Stay in source.</p>
        <h1>看得见地改，<span>留在源码里。</span></h1>
        <p class="intro">源页是一款面向真实 HTML 的本地可视化工作台。直接选择页面中的模块或小区域，完成局部编辑、添加评论，再把边界清晰的修改请求交给 AI。</p>
        <div class="hero-foot"><span>本地 HTML</span><span>源码级局部 Patch</span><span>评论与版本审计</span></div>
      </div>
      <aside class="source-card">
        <small>SOURCE CONTRACT</small>
        <h2>预览帮助你判断，源码决定最终结果。</h2>
        <p>源页不会把预览画布当作新的真相。每一次有效修改，都回到你打开的那份 HTML 中完成。</p>
        <div class="source-path">
          <span><i></i>真实 HTML 是唯一事实源</span>
          <span><i></i>修改范围先被识别与校验</span>
          <span><i></i>历史记录保留变更依据</span>
        </div>
      </aside>
    </header>

    <div class="content">
      <section>
        <div class="section-heading">
          <div><small>WHY PAGEROOT</small><h2>让每一次页面修改，都更准确、更克制、更容易回看。</h2></div>
          <p>不把 HTML 变成低代码项目，也不让 AI 重写整页。源页只帮助你更清楚地表达和执行局部变化。</p>
        </div>
        <div class="promise-grid">
          <article class="promise"><span class="promise-index">01 / SELECT</span><h3>从画布准确选中</h3><p>单击选择整个模块；进入模块后，再选择标题、正文、指标卡或按钮等具体区域。</p></article>
          <article class="promise"><span class="promise-index">02 / EDIT</span><h3>只修改应该变化的地方</h3><p>文字、当前元素样式与安全的同级排序，会以局部源码 Patch 写回，不无故扰动其余结构。</p></article>
          <article class="promise"><span class="promise-index">03 / REVIEW</span><h3>把意见和依据一起留下</h3><p>评论、附件、直接编辑与 AI 返回结果都带着目标和版本关系，方便复核与追溯。</p></article>
        </div>
      </section>

      <section class="workflow">
        <div class="workflow-copy"><small>START HERE</small><h2>打开一份 HTML，开始一次有边界的修改。</h2><p>顶部项目区始终告诉你当前打开的是哪份文件，以及修改是否已经同步到磁盘。</p></div>
        <div class="steps">
          <div class="step"><b>01</b><div><strong>打开本地 HTML</strong><span>从左上角项目菜单选择文件。源页读取原文件，并建立可核对的初始基线。</span></div></div>
          <div class="step"><b>02</b><div><strong>选择、编辑或添加评论</strong><span>在画布中确定模块或小区域；直接处理简单改动，复杂要求则写成评论。</span></div></div>
          <div class="step"><b>03</b><div><strong>交给 AI，并检查新版本</strong><span>源页冻结本轮目标与上下文，校验返回结果没有越界后，再建立可查看的版本。</span></div></div>
        </div>
      </section>

      <aside class="notice">
        <div><strong>这是一张可以试操作的内置介绍页。</strong><span>你可以选择内容体验画布，但它尚未绑定本地文件；打开自己的 HTML 后，修改才会安全写回磁盘。</span></div>
        <em>请从左上角开始</em>
      </aside>
    </div>

    <footer><span>源页 · PageRoot</span><span>Edit visually. Stay in source.</span></footer>
  </article>
</body>
</html>`;

export const BLANK_PROJECT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>未命名页面</title>
  <style>
    * { box-sizing:border-box; }
    body { margin:0; background:#f2f0ea; color:#202126; font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; }
    main { width:min(820px,calc(100% - 32px)); min-height:720px; margin:32px auto; padding:64px; background:#fffdf8; }
    h1 { margin:0 0 16px; font-size:40px; line-height:1.2; }
    p { color:#626268; }
  </style>
</head>
<body>
  <main>
    <h1>未命名页面</h1>
    <p>双击这段文字开始编辑，或选择内容后添加评论交给内部 AI。</p>
  </main>
</body>
</html>`;
