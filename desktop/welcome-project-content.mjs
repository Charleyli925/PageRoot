export const WELCOME_PROJECT_NAME = "欢迎来到源页.html";
export const WELCOME_LOGO_RELATIVE_PATH = "brand-logo.png";

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
      font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
      font-size: clamp(46px, 5.8vw, 70px);
      font-weight: 400;
      line-height: .98;
      letter-spacing: -.06em;
      text-wrap: balance;
      font-feature-settings: "palt" 1;
    }
    h1 span { display: block; }
    h1 span + span {
      width: max-content;
      max-width: calc(100% - 34px);
      margin-top: 13px;
      margin-left: clamp(26px, 4.2vw, 56px);
      color: #c4b9ff;
      font-size: .91em;
      letter-spacing: -.055em;
      text-shadow: 0 16px 38px rgba(92, 70, 188, .18);
    }
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
    .promise-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-block: 1px solid var(--line); }
    .promise { min-height: 188px; padding: 28px 30px; border-bottom: 1px solid var(--line); }
    .promise:nth-child(odd) { padding-left: 0; }
    .promise:nth-child(even) { padding-right: 0; border-left: 1px solid var(--line); }
    .promise:nth-child(n + 3) { border-bottom: 0; }
    .promise-index { color: var(--violet); font: 700 10px/1 system-ui; letter-spacing: .12em; }
    .promise h3 { margin: 27px 0 10px; font-size: 18px; }
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
      .promise,
      .promise:nth-child(odd),
      .promise:nth-child(even) { min-height: 0; padding: 24px 0; border-left: 0; border-bottom: 1px solid var(--line); }
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
            <img src="./${WELCOME_LOGO_RELATIVE_PATH}" alt="源页 Logo" />
            <div><strong>源页</strong><small>PAGEROOT</small></div>
          </div>
          <span class="demo-badge">内置介绍页</span>
        </div>
        <p class="eyebrow">Write smoothly. Change precisely.</p>
        <h1><span>所见，即可落笔。</span><span>所改，止于所选。</span></h1>
        <p class="intro">在真实 HTML 上直接双击文字，光标准确落点，输入、删除、选择与中文输入都自然顺畅。简单修改即时完成，复杂要求则用评论清楚交给 AI。</p>
        <div class="hero-foot"><span>原生光标与输入法</span><span>源码级局部 Patch</span><span>评论与附件</span></div>
      </div>
      <aside class="source-card">
        <small>SAFE BY DEFAULT</small>
        <h2>每一次写回，都经过完整校验。</h2>
        <p>源页只相信真实 HTML。目标、源码和返回结果没有全部对上，就不会写入，也不会生成新版本。</p>
        <div class="source-path">
          <span><i></i>真实 HTML 是唯一事实源</span>
          <span><i></i>只修改被明确选中的范围</span>
          <span><i></i>AI 新版独立保留，不覆盖提交前文件</span>
        </div>
      </aside>
    </header>

    <div class="content">
      <section>
        <div class="section-heading">
          <div><small>CORE EXPERIENCE</small><h2>把网页修改，变成四件自然的事。</h2></div>
          <p>不用在源码里找标签，也不必向 AI 解释整张页面。你专注于内容和意见，源页负责守住修改边界。</p>
        </div>
        <div class="promise-grid">
          <article class="promise"><span class="promise-index">01 / TYPE</span><h3>顺畅的文本编辑</h3><p>安全可编辑的文字，双击就能把光标放到点击位置。输入、删除、选择、粘贴和中文输入法都沿用熟悉的原生体验。</p></article>
          <article class="promise"><span class="promise-index">02 / TARGET</span><h3>指哪改哪的局部修改</h3><p>选中标题就只改标题，选中正文就只改正文。修改以最小源码 Patch 写回，其余 HTML 结构和格式保持不动。</p></article>
          <article class="promise"><span class="promise-index">03 / COMMENT</span><h3>轻松完整的评论体验</h3><p>评论可以跟随整个页面、模块或具体文字；图片和文件也能一起附上，意见、目标与历史版本始终对应。</p></article>
          <article class="promise"><span class="promise-index">04 / VERIFY</span><h3>完整的安全校验</h3><p>写回前核对目标、源码与外部改动；AI 结果还会检查身份、文件完整性和修改范围，任何异常都会停止。</p></article>
        </div>
      </section>

      <section class="workflow">
        <div class="workflow-copy"><small>HOW IT FEELS</small><h2>打开 HTML，直接开始。</h2><p>当前文件、保存状态、评论数量和 AI 处理进度都清楚可见，你始终知道内容正处在哪一步。</p></div>
        <div class="steps">
          <div class="step"><b>01</b><div><strong>双击文字，光标落点即编辑</strong><span>简单内容自然输入；不能安全直改的区域不会被冒险写回，仍可用评论说明要求。</span></div></div>
          <div class="step"><b>02</b><div><strong>评论具体位置，带上图片或文件</strong><span>选中目标后写下要求，右侧评论与页面位置保持关系，集中查看、补充和复核都更方便。</span></div></div>
          <div class="step"><b>03</b><div><strong>发送、校验，再打开最新版</strong><span>源页冻结本轮内容；AI 返回后执行完整校验。通过后由你打开最新版，提交前文件与历史版本仍会保留。</span></div></div>
        </div>
      </section>

      <aside class="notice">
        <div><strong>在桌面版中，这张欢迎页可以直接体验编辑、选择和评论。</strong><span>桌面版会把它建立为本地 HTML；修改会自动保存到「欢迎来到源页.html」，AI 新版也会进入独立版本历史。</span></div>
        <em>从顶部「项目」打开其他 HTML</em>
      </aside>
    </div>

    <footer><span>源页 · PageRoot</span><span>Write smoothly. Change precisely.</span></footer>
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
