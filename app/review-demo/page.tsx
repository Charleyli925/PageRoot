"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FlagCheckeredIcon } from "@phosphor-icons/react/dist/csr/FlagCheckered";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey";
import { MagicWandIcon } from "@phosphor-icons/react/dist/csr/MagicWand";
import { RowsIcon } from "@phosphor-icons/react/dist/csr/Rows";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import styles from "./review-demo.module.css";

type DemoState = "awaiting-ai" | "ready" | "review" | "accepted" | "kept";
type ReviewView = "after" | "before" | "overlay";
type DecisionSource = "review" | "direct";
type CompareKind = "rebuild" | "layout" | "sequence" | "collection" | "table" | "form" | "behavior";

const VIEW_LABELS: Record<ReviewView, string> = {
  after: "修改后",
  before: "修改前",
  overlay: "对照",
};

type ContentChange = {
  id: string;
  anchor: string;
  number: number;
  group: string;
  heading: string;
  kind: string;
  compareKind: CompareKind;
  compareLabel: string;
  title: string;
  summary: string;
  request: string;
  before: string;
  after: string;
  details: string[];
  extra?: string;
};

type OutlineItem = {
  title: string;
  helper: string;
  changeId?: string;
  generatedName?: boolean;
};

type OutlineGroup = {
  label: string;
  items: OutlineItem[];
};

const CONTENT_CHANGES: ContentChange[] = [
  {
    id: "opening",
    anchor: "top",
    number: 1,
    group: "页面开头",
    heading: "为复杂页面而生 / 数字实验场",
    kind: "整段重做",
    compareKind: "rebuild",
    compareLabel: "完整前后",
    title: "开场从“测试说明”改成“任务入口”",
    summary: "标题、说明、按钮、内容摘要和右侧计数一起变化，已经不是几处文字替换。",
    request: "让页面开头更像真实产品入口，先告诉用户能做什么，再引导继续浏览。",
    before: "用大段说明介绍综合测试页，并同时摆放 3 个测试按钮和 4 个特性标签。",
    after: "改成一句明确承诺、两个主要入口和一组可核对的页面内容数字。",
    details: ["主标题与故事线整体改写", "3 个测试按钮收拢为 2 个主要入口", "4 个技术特性改成页面内容摘要", "右侧“48+ 种组合”改为“7 类真实修改”"],
  },
  {
    id: "dashboard",
    anchor: "dashboard",
    number: 2,
    group: "数据与阅读",
    heading: "从宏观指标到微观事件，保持同一条数据叙事",
    kind: "布局和数字",
    compareKind: "layout",
    compareLabel: "并排布局",
    title: "四张并列指标卡改成“一主三辅”",
    summary: "指标内容大体保留，但面积、顺序、数字和阅读重点同时变化。",
    request: "突出综合体验健康度，把实时动态提到图表前面，数字也更新到最新一轮。",
    before: "4 张等宽指标卡在最上方，趋势图占大面积，实时动态位于右下。",
    after: "健康度成为横跨两倍宽度的主指标，其他三项变窄，实时动态移动到趋势图之前。",
    details: ["健康度 87.4 → 91.6", "活跃项目 18 → 24；周期 4.34534 → 3.8 天", "自动化覆盖率 76% → 81%", "实时动态从趋势图之后移动到之前"],
  },
  {
    id: "story",
    anchor: "story",
    number: 3,
    group: "数据与阅读",
    heading: "一份包含多层语义结构的长篇阅读样本",
    kind: "章节调整",
    compareKind: "sequence",
    compareLabel: "顺序追踪",
    title: "文章先讲“结构保真”，再解释上下文",
    summary: "段落被重写和移动；用章节顺序比把移动显示成删除加新增更清楚。",
    request: "把最重要的产品结论提前，删掉重复解释，目录要跟正文一起更新。",
    before: "开场 → 上下文边界 → 结构保真 → 持续协作。",
    after: "结构保真前移为第一章，三章全部重写，正文结尾增加交付前验证清单。",
    details: ["“结构保真”由第 2 章移到第 1 章", "三章标题与段落重新组织", "开场文字做词级改写", "目录、锚点与验证清单一起更新"],
  },
  {
    id: "catalog",
    anchor: "catalog",
    number: 4,
    group: "项目与运营",
    heading: "可筛选、可扩展的项目目录",
    kind: "卡片增删与排序",
    compareKind: "collection",
    compareLabel: "逐项清单",
    title: "项目卡片按优先级重排，并替换两项内容",
    summary: "重复卡片很多，逐项列出保留、移动、删除和新增比整块叠色更容易核对。",
    request: "把高优先级项目放前面，移除已经结束的样本，再补一个新的系统项目。",
    before: "6 个项目按类别交错排列，动态生成卡片位于列表尾部。",
    after: "6 个项目按优先级排列；删除 1 项、新增 1 项、移动 3 项。",
    details: ["“证据链版本引擎”移到第 1 位", "删除“公共空间温度计划”", "新增“跨端内容审阅器”", "其余 3 张卡片调整顺序但内容保持"],
  },
  {
    id: "operations",
    anchor: "operations",
    number: 5,
    group: "项目与运营",
    heading: "包含完整表格语义的运营后台",
    kind: "表格变化",
    compareKind: "table",
    compareLabel: "表格差异",
    title: "风险列改成下一动作，并同步两行状态",
    summary: "按表头、行和单元格解释变化，避免用户在两张大表里自己找数字。",
    request: "表格不要只报风险，要直接告诉运营下一步做什么，并更新本周进度。",
    before: "项目、负责人、状态、完成度、截止日期、风险，共 5 行。",
    after: "“风险”改为“下一动作”；新增 1 行、移除 1 行，2 个状态和 3 个进度更新。",
    details: ["表头“风险”改为“下一动作”", "低视力阅读组件库：待复核 → 进行中", "离线优先知识仓库：18% → 34%", "移出“城市慢行信息系统”", "新增“跨端内容审阅器”项目行"],
  },
  {
    id: "form",
    anchor: "form-lab",
    number: 6,
    group: "项目与运营",
    heading: "几乎把常见输入类型放进同一张表单",
    kind: "字段与反馈",
    compareKind: "form",
    compareLabel: "表单与反馈",
    title: "长表单增加三步引导和条件字段",
    summary: "步骤标题只是表面变化，真正需要确认的是高预算时的必填关系和提交反馈。",
    request: "把长表单的填写顺序讲清楚，高预算时再让用户补审批说明，并把提交结果留在表单里。",
    before: "4 组字段全部展开；依赖浏览器默认校验；提交后只显示简单提示。",
    after: "增加联系人、项目偏好、确认提交三步引导；高预算会出现必填说明；提交结果停留在表单内。",
    details: ["4 个字段组改成带步骤语义的标题", "顶部增加三步填写指引", "高预算时新增“审批说明”必填项", "提交反馈从短暂提示改为表单内说明"],
  },
  {
    id: "media",
    anchor: "media",
    number: 7,
    group: "媒体与文档",
    heading: "画廊、嵌入内容与可编程画布",
    kind: "布局与交互",
    compareKind: "behavior",
    compareLabel: "操作结果",
    title: "媒体画廊重排，画布和播放行为也变化",
    summary: "静态截图无法完整说明脚本变化，因此把可见布局与操作前后结果放在一起。",
    request: "让画廊在窄屏更稳定，并保证 Canvas、音频和视频的操作反馈一致。",
    before: "画廊混合跨列卡片；窗口变化时重绘波形；离线媒体只依赖浏览器回退。",
    after: "画廊改为稳定分组；重绘时保留当前点位；离线媒体显示明确状态和重试入口。",
    details: ["“潮汐档案”由跨列首图改为普通卡片", "Canvas 重绘后保留当前选中点", "音频与视频增加离线状态", "Image Map 热区随布局同步更新"],
    extra: "AI 同时调整了 Image Map 的热区，这是评论没有明确要求的额外变化。",
  },
];

const CONTENT_OUTLINE: OutlineGroup[] = [
  {
    label: "页面开头",
    items: [
      { title: "顶部导航：数据总览、深度文章、项目目录…", helper: "根据页面里的导航文字整理", generatedName: true },
      { title: "为复杂页面而生 / 数字实验场", helper: "页面主标题", changeId: "opening" },
    ],
  },
  {
    label: "数据与阅读",
    items: [
      { title: "从宏观指标到微观事件，保持同一条数据叙事", helper: "数据概览", changeId: "dashboard" },
      { title: "一份包含多层语义结构的长篇阅读样本", helper: "长篇文章", changeId: "story" },
    ],
  },
  {
    label: "项目与运营",
    items: [
      { title: "可筛选、可扩展的项目目录", helper: "项目卡片", changeId: "catalog" },
      { title: "包含完整表格语义的运营后台", helper: "项目表格", changeId: "operations" },
      { title: "几乎把常见输入类型放进同一张表单", helper: "长表单", changeId: "form" },
    ],
  },
  {
    label: "媒体与文档",
    items: [
      { title: "画廊、嵌入内容与可编程画布", helper: "图片与媒体", changeId: "media" },
      { title: "代码、终端输出和可展开文档", helper: "代码与说明" },
    ],
  },
  {
    label: "页面结尾",
    items: [
      { title: "最后，用一组常见问题验证长页面尾部体验", helper: "常见问题" },
      { title: "你已经抵达这份长页面的底部", helper: "联系入口" },
      { title: "Atlas Lab · 2030", helper: "页尾信息" },
    ],
  },
];

function BrandHeader({
  state,
  onBackToReview,
}: {
  state: DemoState;
  onBackToReview?: () => void;
}) {
  const isReview = state === "review";

  return (
    <header className={styles.appHeader}>
      <div className={styles.fileIdentity}>
        {/* This isolated browser demo intentionally keeps the existing static brand asset. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.brandLink} href="/" aria-label="返回源页工作台">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-logo.png" alt="源页" />
        </a>
        <div>
          <strong>复杂 HTML 综合测试页.html</strong>
          <span>
            {isReview ? "原版 → AI 完整候选版" : "原版 · 已安全保存"}
          </span>
        </div>
      </div>

      <div className={styles.headerActions}>
        <span className={styles.demoBadge}>交互 Demo · 不写入文件</span>
        {isReview ? (
          <button className={styles.headerButton} type="button" onClick={onBackToReview}>
            <XIcon aria-hidden="true" size={15} weight="bold" />
            退出审阅
          </button>
        ) : (
          <div className={styles.lockedModes} aria-label="当前页面模式">
            <button type="button" disabled>编辑</button>
            <button type="button" aria-pressed="true" disabled>预览</button>
          </div>
        )}
      </div>
    </header>
  );
}

function FrozenReport() {
  return (
    <div className={styles.frozenCanvas}>
      <div className={styles.frozenNotice}>
        <LockKeyIcon aria-hidden="true" size={16} weight="duotone" />
        <span>本轮处理期间，这一版保持只读；你仍可切换其他项目。</span>
      </div>
      <div className={styles.frozenDocument} aria-label="提交给 AI 前的完整冻结页面">
        <iframe
          src="/review-demo-local/before.html#top"
          title="复杂 HTML 综合测试页原版"
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        />
      </div>
    </div>
  );
}

function ProcessIcon({ step, waiting }: { step: number; waiting: boolean }) {
  if (step === 1) return <FlagCheckeredIcon size={21} weight="duotone" />;
  if (step === 2) {
    return waiting
      ? <CircleNotchIcon className={styles.spin} size={21} weight="bold" />
      : <MagicWandIcon size={21} weight="duotone" />;
  }
  if (step === 3) return <FloppyDiskIcon size={21} weight="duotone" />;
  return <FileHtmlIcon size={21} weight="duotone" />;
}

function HandoffPanel({
  ready,
  onSimulate,
  onReview,
  onDirectOpen,
  onLater,
}: {
  ready: boolean;
  onSimulate: () => void;
  onReview: () => void;
  onDirectOpen: () => void;
  onLater: () => void;
}) {
  const steps = [
    { title: "准备并复制", detail: "评论、附件与当前版本已冻结" },
    { title: "等待 AI 完成", detail: ready ? "已收到完整 HTML" : "AI 正在读取本轮要求并修改" },
    { title: "校验并保存", detail: ready ? "身份、Hash 与修改范围已通过检查" : "AI 返回后自动执行" },
    { title: "结果", detail: ready ? "候选版本 V1.4 已准备好" : "检查通过后生成独立候选版本" },
  ];

  return (
    <aside className={styles.handoffPanel} aria-label="本轮 AI 处理">
      <div className={styles.handoffHeader}>
        <div>
          <span>{ready ? "AI 修改已返回" : "正在等待 AI 返回"}</span>
          <strong>{ready ? "候选版本 V1.4 已准备好" : "当前 HTML 已安全锁定"}</strong>
        </div>
        <span className={ready ? styles.readyStatus : styles.waitingStatus}>
          <span aria-hidden="true" />
          {ready ? "待你处理" : "处理中"}
        </span>
      </div>

      <div className={styles.panelScroll}>
        <section className={styles.processBoard} aria-live="polite">
          <header>
            <span>本轮流程</span>
            <strong>4 个阶段 · 已完成 {ready ? 4 : 1} 个</strong>
          </header>
          <ol>
            {steps.map((step, index) => {
              const stepNumber = index + 1;
              const state = ready || stepNumber === 1
                ? "done"
                : stepNumber === 2
                  ? "current"
                  : "pending";
              return (
                <li key={step.title} data-state={state}>
                  <span className={styles.stepNumber}>{stepNumber}</span>
                  <span className={styles.stepIcon} aria-hidden="true">
                    <ProcessIcon step={stepNumber} waiting={!ready && stepNumber === 2} />
                  </span>
                  <span className={styles.stepCopy}>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                  <span className={styles.stepState}>
                    {state === "done"
                      ? <CheckCircleIcon aria-label="已完成" size={21} weight="fill" />
                      : state === "current" ? "进行中" : "等待"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className={styles.roundCard}>
          <header>
            <div>
              <span>本轮记录</span>
              <strong>7 条审阅要求</strong>
            </div>
            <ShieldCheckIcon aria-hidden="true" size={23} weight="duotone" />
          </header>
          <div className={styles.roundFacts}>
            <div><span>基于版本</span><strong>V1.3</strong></div>
            <div><span>目标版本</span><strong>V1.4</strong></div>
            <div><span>提交时间</span><strong>14:28</strong></div>
          </div>
          <div className={styles.commentPreview}>
            {CONTENT_CHANGES.slice(0, 3).map((change) => (
              <div key={change.id}>
                <ChatCircleTextIcon aria-hidden="true" size={15} weight="duotone" />
                <span><strong>{change.heading}</strong>{change.request}</span>
              </div>
            ))}
          </div>
        </section>

        {ready ? (
          <section className={styles.resultSummary}>
            <div className={styles.resultIcon}>
              <SparkleIcon aria-hidden="true" size={23} weight="fill" />
            </div>
            <div>
              <strong>发现 7 个内容区发生变化</strong>
              <p>7 条要求已响应，另有 1 处 AI 补充。原版和候选版都是可独立打开的完整 HTML。</p>
              <span>
                <WarningCircleIcon aria-hidden="true" size={14} weight="fill" />
                含 1 处评论范围外的补充
              </span>
            </div>
          </section>
        ) : (
          <section className={styles.waitingTip}>
            <EyeIcon aria-hidden="true" size={18} weight="duotone" />
            <p><strong>等待期间可以离开这里</strong>AI 返回后，源页会自动识别并保留候选版本。</p>
          </section>
        )}
      </div>

      <footer className={styles.handoffFooter}>
        {ready ? (
          <>
            <button className={styles.primaryAction} type="button" onClick={onReview}>
              <GitDiffIcon aria-hidden="true" size={18} weight="bold" />
              审阅修改
            </button>
            <button className={styles.secondaryAction} type="button" onClick={onDirectOpen}>
              <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
              直接打开
            </button>
            <button className={styles.tertiaryAction} type="button" onClick={onLater}>
              <ClockCounterClockwiseIcon aria-hidden="true" size={17} weight="duotone" />
              稍后处理
            </button>
          </>
        ) : (
          <>
            <button className={styles.primaryAction} type="button" onClick={onSimulate}>
              <MagicWandIcon aria-hidden="true" size={18} weight="duotone" />
              模拟 AI 返回
            </button>
            <small>Demo 控制：点击后进入“结果已返回”状态</small>
          </>
        )}
      </footer>
    </aside>
  );
}

function ReviewStateFrame({
  side,
  title,
  caption,
  children,
}: {
  side: "before" | "after";
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.reviewStateFrame} data-side={side}>
      <header>
        <span>{side === "before" ? "修改前" : "修改后"}</span>
        <div><strong>{title}</strong><small>{caption}</small></div>
      </header>
      <div className={styles.reviewStateBody}>{children}</div>
    </section>
  );
}

function ComparisonPair({
  view,
  before,
  after,
}: {
  view: ReviewView;
  before: ReactNode;
  after: ReactNode;
}) {
  if (view === "before") return <div className={styles.comparisonPair} data-single="true">{before}</div>;
  if (view === "after") return <div className={styles.comparisonPair} data-single="true">{after}</div>;
  return <div className={styles.comparisonPair}>{before}{after}</div>;
}

function OpeningComparison({ view }: { view: ReviewView }) {
  const before = (
    <ReviewStateFrame side="before" title="原开场" caption="说明型落地页">
      <div className={styles.openingSnapshot} data-side="before">
        <span>Complex HTML Test Document · v1.0</span>
        <h3>为复杂页面而生<br /><em>数字实验场</em></h3>
        <p>这是一份刻意“内容过载”的综合测试页面，用来验证真实世界中的选择、修改、重排和保存。</p>
        <div className={styles.snapshotActions}><span>开始浏览</span><span>打开原生对话框</span><span>查看测试提示</span></div>
        <ul><li>单文件自包含</li><li>响应式样式</li><li>原生交互</li><li>无框架依赖</li></ul>
      </div>
    </ReviewStateFrame>
  );
  const after = (
    <ReviewStateFrame side="after" title="新开场" caption="任务型入口">
      <div className={styles.openingSnapshot} data-side="after">
        <span>Complex HTML Test Document · v1.0</span>
        <h3>一次看清复杂页面<br /><em>能不能被可靠修改</em></h3>
        <p>从数据看板、长文章、项目目录到表格和媒体，选择一个真实场景开始验证；没有被点名的内容会保持原样。</p>
        <div className={styles.snapshotActions}><span>先看数据变化</span><span>打开交互样本</span></div>
        <div className={styles.contentSummaryMini}>
          <div><strong>8</strong><small>个主要内容区</small></div>
          <div><strong>6</strong><small>张项目卡片</small></div>
          <div><strong>5</strong><small>条运营项目</small></div>
        </div>
      </div>
    </ReviewStateFrame>
  );
  return <ComparisonPair view={view} before={before} after={after} />;
}

function DashboardComparison({ view }: { view: ReviewView }) {
  const before = (
    <ReviewStateFrame side="before" title="原数据概览" caption="四张等宽指标卡">
      <div className={styles.dashboardSnapshot} data-layout="before">
        <div><span>北极星指标</span><strong>87.4</strong><small>↑ 12.8%</small></div>
        <div><span>活跃项目</span><strong>18</strong><small>过去 30 天</small></div>
        <div><span>交付周期</span><strong>4.34534</strong><small>↓ 0.7 天</small></div>
        <div><span>自动化覆盖率</span><strong>76%</strong><small>目标 85%</small></div>
        <section><strong>双轨增长趋势</strong><span>占据主要阅读区域</span></section>
        <section><strong>实时动态</strong><span>位于页面右下</span></section>
      </div>
    </ReviewStateFrame>
  );
  const after = (
    <ReviewStateFrame side="after" title="新数据概览" caption="一主三辅，动态前移">
      <div className={styles.dashboardSnapshot} data-layout="after">
        <div data-featured="true"><span>综合体验健康度</span><strong>91.6</strong><small>成为第一阅读焦点</small></div>
        <section data-priority="true"><strong>实时动态</strong><span>4 条 · 刚刚更新</span></section>
        <div><span>活跃项目</span><strong>24</strong><small>↑ 6 个</small></div>
        <div><span>交付周期</span><strong>3.8 天</strong><small>↓ 0.5 天</small></div>
        <div><span>自动化覆盖率</span><strong>81%</strong><small>接近目标</small></div>
        <section><strong>双轨增长趋势</strong><span>缩为辅助区域</span></section>
      </div>
    </ReviewStateFrame>
  );
  return <ComparisonPair view={view} before={before} after={after} />;
}

function StoryComparison({ view }: { view: ReviewView }) {
  const before = (
    <ReviewStateFrame side="before" title="原文章顺序" caption="3 个连续章节">
      <ol className={styles.sequenceSnapshot}>
        <li><span>第一章</span><strong>上下文不是越多越好</strong><small>移动到第 2 章</small></li>
        <li><span>第二章</span><strong>结构保真是一种产品能力</strong><small>移动到第 1 章</small></li>
        <li><span>第三章</span><strong>从一次编辑到持续协作</strong><small>保留位置，重写</small></li>
      </ol>
    </ReviewStateFrame>
  );
  const after = (
    <ReviewStateFrame side="after" title="新文章顺序" caption="3 章正文 + 验证清单">
      <ol className={styles.sequenceSnapshot} data-side="after">
        <li data-tone="move"><span>第一章</span><strong>先保证结构能够被可靠核对</strong><small>原第 2 章</small></li>
        <li data-tone="move"><span>第二章</span><strong>再给每一次变化足够的上下文</strong><small>原第 1 章</small></li>
        <li><span>第三章</span><strong>把一次修改变成持续协作</strong><small>重新组织</small></li>
        <li data-tone="add"><span>新增</span><strong>交付前验证清单</strong><small>3 项</small></li>
      </ol>
    </ReviewStateFrame>
  );
  return (
    <>
      <ComparisonPair view={view} before={before} after={after} />
      {view === "overlay" ? (
        <p className={styles.focusedTextDiff}>
          <del>网页工具善于生成完整页面，可靠的编辑还要理解用户只想改哪里。</del>
          <ins>网页工具不仅要生成完整页面，更要让人一眼看懂哪里变了。</ins>
        </p>
      ) : null}
    </>
  );
}

const BEFORE_CATALOG = [
  ["未来工作方式观察站", "保留"],
  ["城市慢行信息系统", "后移"],
  ["证据链版本引擎", "移到第 1 位"],
  ["公共空间温度计划", "删除"],
  ["低视力阅读组件库", "保留"],
  ["离线优先知识仓库", "前移"],
];

const AFTER_CATALOG = [
  ["证据链版本引擎", "从第 3 位移入"],
  ["离线优先知识仓库", "从第 6 位移入"],
  ["未来工作方式观察站", "保留"],
  ["跨端内容审阅器", "新增"],
  ["低视力阅读组件库", "保留"],
  ["城市慢行信息系统", "从第 2 位移入"],
];

function CatalogSnapshot({ side }: { side: "before" | "after" }) {
  const items = side === "before" ? BEFORE_CATALOG : AFTER_CATALOG;
  return (
    <div className={styles.catalogSnapshot}>
      {items.map(([title, status], index) => (
        <div
          key={title}
          data-tone={status === "删除" ? "remove" : status === "新增" ? "add" : status.includes("移") ? "move" : undefined}
        >
          <span>{index + 1}</span>
          <strong>{title}</strong>
          <small>{status}</small>
        </div>
      ))}
    </div>
  );
}

function CatalogComparison({ view }: { view: ReviewView }) {
  const before = <ReviewStateFrame side="before" title="原项目顺序" caption="按类别交错排列"><CatalogSnapshot side="before" /></ReviewStateFrame>;
  const after = <ReviewStateFrame side="after" title="新项目顺序" caption="按优先级排列"><CatalogSnapshot side="after" /></ReviewStateFrame>;
  return <ComparisonPair view={view} before={before} after={after} />;
}

function OperationsSnapshot({ side }: { side: "before" | "after" }) {
  const after = side === "after";
  return (
    <div className={styles.compactTableWrap}>
      <table>
        <thead><tr><th>项目</th><th>状态</th><th>完成度</th><th>{after ? "下一动作" : "风险"}</th></tr></thead>
        <tbody>
          <tr><th>证据链版本引擎</th><td>进行中</td><td>{after ? "88%" : "84%"}</td><td>{after ? "准备上线检查" : "中"}</td></tr>
          <tr data-tone={after ? "change" : undefined}><th>低视力阅读组件库</th><td>{after ? "进行中" : "待复核"}</td><td>{after ? "71%" : "62%"}</td><td>{after ? "补齐键盘测试" : "高"}</td></tr>
          <tr><th>离线优先知识仓库</th><td>{after ? "进行中" : "已阻塞"}</td><td>{after ? "34%" : "18%"}</td><td>{after ? "确认缓存策略" : "高"}</td></tr>
          {after ? <tr data-tone="add"><th>跨端内容审阅器</th><td>待启动</td><td>12%</td><td>分配负责人</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function OperationsComparison({ view }: { view: ReviewView }) {
  if (view === "overlay") {
    return (
      <section className={styles.tableDiffCard}>
        <header><TableIcon aria-hidden="true" size={18} weight="duotone" /><span><strong>按表格位置归纳</strong><small>只列发生变化的表头、行和数字</small></span></header>
        <div className={styles.compactTableWrap}>
          <table>
            <thead><tr><th>变化位置</th><th>修改前</th><th>修改后</th><th>变化</th></tr></thead>
            <tbody>
              <tr><th>最后一列</th><td><del>风险</del></td><td><ins>下一动作</ins></td><td><span data-tone="replace">整列改写</span></td></tr>
              <tr><th>低视力阅读组件库</th><td><del>待复核 · 62%</del></td><td><ins>进行中 · 71%</ins></td><td><span data-tone="replace">状态和数字</span></td></tr>
              <tr><th>离线优先知识仓库</th><td><del>18%</del></td><td><ins>34%</ins></td><td><span data-tone="replace">数字</span></td></tr>
              <tr><th>跨端内容审阅器</th><td>—</td><td><ins>待启动 · 12%</ins></td><td><span data-tone="add">新增一行</span></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  return (
    <ComparisonPair
      view={view}
      before={<ReviewStateFrame side="before" title="原运营表格" caption="风险只用高、中、低表示"><OperationsSnapshot side="before" /></ReviewStateFrame>}
      after={<ReviewStateFrame side="after" title="新运营表格" caption="直接给出下一动作"><OperationsSnapshot side="after" /></ReviewStateFrame>}
    />
  );
}

function FormSnapshot({ side }: { side: "before" | "after" }) {
  const after = side === "after";
  return (
    <div className={styles.formSnapshot}>
      <header>{after ? <><span>1 联系人</span><span>2 项目偏好</span><span>3 确认</span></> : <strong>全部字段同时展开</strong>}</header>
      <div className={styles.formFields}>
        <label><span>姓名 *</span><i /></label>
        <label><span>电子邮箱 *</span><i /></label>
        <label><span>预算区间</span><i>{after ? "¥100,000 以上" : "请选择"}</i></label>
        {after ? <label data-tone="add"><span>审批说明 *</span><i>高预算时出现</i></label> : <label><span>上传测试附件</span><i>选择文件</i></label>}
      </div>
      <span className={styles.formActionPreview}>{after ? "检查并提交" : "模拟提交"}</span>
    </div>
  );
}

function FormComparison({ view }: { view: ReviewView }) {
  if (view === "overlay") {
    return (
      <section className={styles.behaviorMatrix}>
        <header><strong>用户操作</strong><span>修改前</span><span>修改后</span></header>
        <div><strong>浏览填写结构</strong><span>4 组字段连续展开</span><span data-tone="change">顶部增加三步索引，字段仍连续展示</span></div>
        <div><strong>选择高预算</strong><span>没有额外说明</span><span data-tone="add">出现“审批说明”必填项</span></div>
        <div><strong>必填项校验</strong><span>浏览器默认校验</span><span>保持浏览器默认校验</span></div>
        <div><strong>提交成功</strong><span>顶部短暂提示</span><span data-tone="change">停留原位并显示表单内说明</span></div>
      </section>
    );
  }
  return (
    <ComparisonPair
      view={view}
      before={<ReviewStateFrame side="before" title="原长表单" caption="4 组字段全部展开"><FormSnapshot side="before" /></ReviewStateFrame>}
      after={<ReviewStateFrame side="after" title="带步骤引导的长表单" caption="字段关系和提交反馈一起变化"><FormSnapshot side="after" /></ReviewStateFrame>}
    />
  );
}

function MediaSnapshot({ side }: { side: "before" | "after" }) {
  const after = side === "after";
  const items = after ? ["图片元素样本", "潮汐档案", "地表纹理", "风向记录"] : ["潮汐档案", "图片元素样本", "风向记录", "地表纹理"];
  return (
    <div className={styles.mediaSnapshot}>
      <div className={styles.mediaGrid} data-layout={side}>
        {items.map((item) => <span key={item} data-wide={item === (after ? "地表纹理" : "潮汐档案") ? "true" : undefined}>{item}</span>)}
      </div>
      <div className={styles.mediaStates}>
        <div><strong>Canvas 数据波形</strong><small>{after ? "重绘后保留选中点" : "调整宽度后重新绘制"}</small></div>
        <div><strong>Audio / Video</strong><small>{after ? "离线时显示状态与重试" : "依赖浏览器默认回退"}</small></div>
        <div><strong>Image Map</strong><small>{after ? "热区跟随新布局更新" : "左右各一个固定热区"}</small></div>
      </div>
    </div>
  );
}

function MediaComparison({ view }: { view: ReviewView }) {
  const before = <ReviewStateFrame side="before" title="原媒体区域" caption="混合跨列画廊"><MediaSnapshot side="before" /></ReviewStateFrame>;
  const after = <ReviewStateFrame side="after" title="新媒体区域" caption="稳定分组并补齐操作反馈"><MediaSnapshot side="after" /></ReviewStateFrame>;
  return (
    <>
      <ComparisonPair view={view} before={before} after={after} />
      {view === "overlay" ? (
        <section className={styles.behaviorSummary}>
          <ArrowsClockwiseIcon aria-hidden="true" size={18} weight="duotone" />
          <div><strong>静态画面之外，还有 3 个操作结果变化</strong><span>调整窗口宽度、离线播放、点击图片热区都需要单独验证。</span></div>
        </section>
      ) : null}
    </>
  );
}

function AdaptiveComparison({ change, view }: { change: ContentChange; view: ReviewView }) {
  if (change.compareKind === "rebuild") return <OpeningComparison view={view} />;
  if (change.compareKind === "layout") return <DashboardComparison view={view} />;
  if (change.compareKind === "sequence") return <StoryComparison view={view} />;
  if (change.compareKind === "collection") return <CatalogComparison view={view} />;
  if (change.compareKind === "table") return <OperationsComparison view={view} />;
  if (change.compareKind === "form") return <FormComparison view={view} />;
  return <MediaComparison view={view} />;
}

const DOCUMENT_URLS = {
  before: "/review-demo-local/before.html",
  after: "/review-demo-local/after.html",
} as const;

function RealDocumentPane({
  side,
  anchor,
  compact,
  onLoad,
}: {
  side: "before" | "after";
  anchor: string;
  compact: boolean;
  onLoad: () => void;
}) {
  const isBefore = side === "before";
  const url = `${DOCUMENT_URLS[side]}#${anchor}`;
  return (
    <section className={styles.realDocumentPane} data-side={side}>
      <header>
        <div>
          <span>{isBefore ? "原版" : "AI 候选版"}</span>
          <strong>{isBefore ? "用户提供的完整 HTML" : "基于原版生成的完整修改版"}</strong>
          <small>{isBefore ? "122,014 字节 · 3701 行" : "127,417 字节 · 3779 行"}</small>
        </div>
        <a href={url} target="_blank" rel="noreferrer">
          <ArrowSquareOutIcon aria-hidden="true" size={14} weight="bold" />
          全页打开
        </a>
      </header>
      <div className={styles.realDocumentViewport} data-compact={compact ? "true" : undefined}>
        <iframe
          key={`${side}-${anchor}`}
          src={url}
          title={`${isBefore ? "原版" : "AI 候选版"}：${anchor} 内容区`}
          loading="eager"
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
          onLoad={onLoad}
        />
      </div>
    </section>
  );
}

function RealDocumentComparison({ change, view, onDocumentLoad }: { change: ContentChange; view: ReviewView; onDocumentLoad: () => void }) {
  const sides: ("before" | "after")[] = view === "overlay" ? ["before", "after"] : [view];
  return (
    <section className={styles.realDocumentComparison}>
      <header className={styles.realDocumentIntro}>
        <div>
          <span>真实完整页面</span>
          <strong>已定位到“{change.heading}”</strong>
          <p>下面不是重画的示意图，而是浏览器直接载入原版和候选版；两边都可以独立滚动。</p>
        </div>
        <small>跳转依据：页面可见标题 + 锚点</small>
      </header>
      <div className={styles.realDocumentGrid} data-single={sides.length === 1 ? "true" : undefined}>
        {sides.map((side) => <RealDocumentPane key={side} side={side} anchor={change.anchor} compact={sides.length === 2} onLoad={onDocumentLoad} />)}
      </div>
    </section>
  );
}

function ContentMap({
  activeId,
  showAll,
  onToggleAll,
  onSelect,
}: {
  activeId: string;
  showAll: boolean;
  onToggleAll: () => void;
  onSelect: (changeId: string) => void;
}) {
  const visibleGroups = CONTENT_OUTLINE.map((group) => ({
    ...group,
    items: showAll ? group.items : group.items.filter((item) => item.changeId),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={styles.contentMapScroll}>
      <section className={styles.contentMapIntro}>
        <div><strong>按页面里的标题整理</strong><span>不显示代码名称，只显示用户在页面上能找到的内容。</span></div>
        <button type="button" aria-pressed={!showAll} onClick={onToggleAll}>{showAll ? "只看有变化" : "显示完整页面"}</button>
      </section>

      <nav className={styles.contentMap} aria-label="页面内容与变化位置">
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <header>
              <span>{group.label}</span>
              <small>{group.items.some((item) => item.changeId) ? `${group.items.filter((item) => item.changeId).length} 处变化` : "未修改"}</small>
            </header>
            <div>
              {group.items.map((item) => {
                const change = item.changeId ? CONTENT_CHANGES.find((candidate) => candidate.id === item.changeId) : undefined;
                return (
                  <button
                    key={item.title}
                    className={styles.contentMapItem}
                    data-active={change?.id === activeId ? "true" : undefined}
                    data-state={change ? "changed" : item.generatedName ? "named" : "unchanged"}
                    type="button"
                    disabled={!change}
                    onClick={() => change && onSelect(change.id)}
                  >
                    <span className={styles.mapIndex}>{change ? change.number : "—"}</span>
                    <span className={styles.mapCopy}><strong>{item.title}</strong><small>{item.helper}</small></span>
                    <span className={styles.mapState}>{change ? change.kind : item.generatedName ? "根据内容命名" : "未修改"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <section className={styles.contentMapAccuracy}>
        <ShieldCheckIcon aria-hidden="true" size={17} weight="duotone" />
        <span><strong>10 个名称直接来自页面标题</strong>页尾直接使用可见品牌文字；顶部导航没有独立标题，根据导航文字整理并明确标出。</span>
      </section>
    </div>
  );
}

const COMPARE_HINTS: Record<CompareKind, string> = {
  rebuild: "这一块改动太大，直接展开完整前后内容，避免红绿叠在一起。",
  layout: "内容仍能对应，左右并排展示面积、顺序和数字变化。",
  sequence: "重点追踪章节从哪里移动到哪里，移动不会显示成删除再新增。",
  collection: "重复卡片很多，按项目逐项标记保留、移动、删除和新增。",
  table: "直接按表头、行和单元格归纳，不要求用户扫两张完整大表。",
  form: "除了步骤标题，也对比输入条件、必填关系和提交结果。",
  behavior: "静态布局并排看，脚本与媒体变化另外用操作结果说明。",
};

function ReviewScreen({
  onExit,
  onAccept,
  onKeep,
}: {
  onExit: () => void;
  onAccept: () => void;
  onKeep: () => void;
}) {
  const [view, setView] = useState<ReviewView>("overlay");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAll, setShowAll] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const reviewCanvasRef = useRef<HTMLDivElement>(null);
  const activeChange = CONTENT_CHANGES[activeIndex];

  useEffect(() => {
    const timer = window.setTimeout(() => reviewCanvasRef.current?.scrollTo({ top: 0 }), 320);
    return () => window.clearTimeout(timer);
  }, []);

  const showChangeAtTop = () => {
    window.requestAnimationFrame(() => reviewCanvasRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const navigate = (direction: -1 | 1) => {
    setActiveIndex((current) => (current + direction + CONTENT_CHANGES.length) % CONTENT_CHANGES.length);
    setShowDetails(true);
    showChangeAtTop();
  };

  const selectChange = (changeId: string) => {
    const nextIndex = CONTENT_CHANGES.findIndex((change) => change.id === changeId);
    if (nextIndex >= 0) {
      setActiveIndex(nextIndex);
      setShowDetails(true);
      showChangeAtTop();
    }
  };

  return (
    <div className={styles.demoRoot}>
      <BrandHeader state="review" onBackToReview={onExit} />
      <main className={styles.reviewStage}>
        <section className={styles.reviewWorkspace}>
          <div className={styles.reviewToolbar}>
            <div className={styles.reviewTitle}>
              <GitDiffIcon aria-hidden="true" size={20} weight="duotone" />
              <span><strong>审阅 AI 修改</strong><small>真实复杂页面大改演示 · 7 处变化 · 1 处额外修改</small></span>
            </div>
            <div className={styles.viewSwitch} aria-label="对比方式">
              {(Object.keys(VIEW_LABELS) as ReviewView[]).map((item) => (
                <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{VIEW_LABELS[item]}</button>
              ))}
            </div>
          </div>

          <div className={styles.reviewCanvas} ref={reviewCanvasRef}>
            <article className={styles.adaptiveReview} key={activeChange.id}>
              <header className={styles.adaptiveHeader}>
                <div className={styles.changeBreadcrumb}><span>{activeChange.group}</span><ArrowRightIcon aria-hidden="true" size={12} weight="bold" /><strong>{activeChange.heading}</strong></div>
                <div className={styles.adaptiveTitleRow}>
                  <span>{activeChange.number}</span>
                  <div><small>{activeChange.kind}</small><h1>{activeChange.title}</h1></div>
                </div>
                <p>{activeChange.summary}</p>
              </header>

              <section className={styles.reviewIntent}>
                <ChatCircleTextIcon aria-hidden="true" size={18} weight="duotone" />
                <div><span>你的要求</span><q>{activeChange.request}</q></div>
              </section>

              <section className={styles.adaptiveMethod}>
                <div><span>本处对照方式</span><strong>{view === "overlay" ? activeChange.compareLabel : `完整${VIEW_LABELS[view]}内容`}</strong></div>
                <p>{view === "overlay" ? COMPARE_HINTS[activeChange.compareKind] : `当前只显示这一部分的${VIEW_LABELS[view]}状态，可随时切回“对照”。`}</p>
              </section>

              <div className={styles.adaptiveBody}>
                <RealDocumentComparison
                  change={activeChange}
                  view={view}
                  onDocumentLoad={() => window.setTimeout(() => reviewCanvasRef.current?.scrollTo({ top: 0 }), 80)}
                />
                <section className={styles.extractedComparison}>
                  <header><span>系统提炼的变化说明</span><small>帮助快速判断；最终以完整页面为准</small></header>
                  <AdaptiveComparison change={activeChange} view={view} />
                </section>
              </div>

              <section className={styles.changeBreakdown}>
                <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}>
                  <span><RowsIcon aria-hidden="true" size={17} weight="duotone" /><strong>这部分具体改了什么</strong><small>{activeChange.details.length} 项</small></span>
                  <span>{showDetails ? "收起" : "展开"}</span>
                </button>
                {showDetails ? (
                  <div>
                    <ol>{activeChange.details.map((detail) => <li key={detail}>{detail}</li>)}</ol>
                    <section className={styles.beforeAfterSummary}>
                      <div><span>原来</span><p>{activeChange.before}</p></div>
                      <ArrowRightIcon aria-hidden="true" size={16} weight="bold" />
                      <div><span>现在</span><p>{activeChange.after}</p></div>
                    </section>
                    {activeChange.extra ? (
                      <div className={styles.extraChange}>
                        <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />
                        <span><strong>评论范围外</strong>{activeChange.extra}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </article>
          </div>
        </section>

        <aside className={styles.changeRail}>
          <header className={styles.changeRailHeader}>
            <div><span>页面内容地图</span><strong>正在看第 {activeIndex + 1} 处 · 共 {CONTENT_CHANGES.length} 处</strong></div>
            <div>
              <button type="button" aria-label="上一处变化" onClick={() => navigate(-1)}><ArrowLeftIcon aria-hidden="true" size={16} weight="bold" /></button>
              <button type="button" aria-label="下一处变化" onClick={() => navigate(1)}><ArrowRightIcon aria-hidden="true" size={16} weight="bold" /></button>
            </div>
          </header>

          <ContentMap
            activeId={activeChange.id}
            showAll={showAll}
            onToggleAll={() => setShowAll((current) => !current)}
            onSelect={selectChange}
          />

          <footer className={styles.reviewFooter}>
            <p>第一版先按整份候选做决定，原版与候选都会保留。</p>
            <button className={styles.primaryAction} type="button" onClick={onAccept}>
              <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
              接受全部并打开
            </button>
            <button className={styles.secondaryAction} type="button" onClick={onKeep}>
              <ClockCounterClockwiseIcon aria-hidden="true" size={17} weight="duotone" />
              保留当前版本
            </button>
          </footer>
        </aside>
      </main>
    </div>
  );
}

function OutcomeScreen({
  outcome,
  source,
  onRestart,
  onReviewAgain,
}: {
  outcome: "accepted" | "kept";
  source: DecisionSource;
  onRestart: () => void;
  onReviewAgain: () => void;
}) {
  const accepted = outcome === "accepted";

  return (
    <div className={styles.demoRoot}>
      <BrandHeader state={outcome} />
      <main className={styles.outcomeStage}>
        <section className={styles.outcomeCard} data-outcome={outcome}>
          <div className={styles.outcomeIcon}>
            {accepted
              ? <CheckCircleIcon aria-hidden="true" size={34} weight="fill" />
              : <ClockCounterClockwiseIcon aria-hidden="true" size={32} weight="duotone" />}
          </div>
          <span>{accepted ? "候选版本已采用" : "当前版本未改变"}</span>
          <h1>{accepted ? "已打开 AI 版本 V1.4" : "已保留当前版本 V1.3"}</h1>
          <p>
            {accepted
              ? source === "direct"
                ? "你跳过了审阅并直接打开候选版本。原版 V1.3 与本轮记录仍然保留。"
                : "当前 HTML 已切换到审阅后的候选版本。原版 V1.3 与本轮记录仍然保留。"
              : "AI 候选 V1.4 没有成为当前 HTML，但仍保留在本轮记录里，可以稍后再次审阅。"}
          </p>
          <div className={styles.outcomeActions}>
            <button className={styles.primaryAction} type="button" onClick={onRestart}>
              <ArrowsClockwiseIcon aria-hidden="true" size={18} weight="bold" />
              重新体验 Demo
            </button>
            <button className={styles.secondaryAction} type="button" onClick={onReviewAgain}>
              <EyeIcon aria-hidden="true" size={18} weight="duotone" />
              再看一次审阅
            </button>
          </div>
        </section>

        <aside className={styles.decisionRecord}>
          <header><ShieldCheckIcon aria-hidden="true" size={23} weight="duotone" /><strong>版本决定记录</strong></header>
          <dl>
            <div><dt>修改前</dt><dd>V1.3 · 已保留</dd></div>
            <div><dt>AI 候选</dt><dd>V1.4 · 已保留</dd></div>
            <div><dt>当前 HTML</dt><dd>{accepted ? "V1.4" : "V1.3"}</dd></div>
            <div><dt>本轮要求</dt><dd>{source === "review" ? "6 条" : "3 条评论"}</dd></div>
            <div><dt>可见变化</dt><dd>{source === "review" ? "7 处" : "4 处"}</dd></div>
          </dl>
          <p>Demo 采用整份版本决策，因此不会产生局部回退后的结构冲突。</p>
        </aside>
      </main>
    </div>
  );
}

export default function ReviewDemoPage() {
  const [state, setState] = useState<DemoState>("awaiting-ai");
  const [showKeepConfirm, setShowKeepConfirm] = useState(false);
  const [decisionSource, setDecisionSource] = useState<DecisionSource>("review");
  const [note, setNote] = useState("");

  const ready = state === "ready";
  const stateAnnouncement = useMemo(() => {
    if (state === "awaiting-ai") return "正在等待 AI 返回";
    if (state === "ready") return "AI 修改已返回，可以审阅或直接打开";
    if (state === "review") return "正在审阅 AI 修改";
    if (state === "accepted") return "AI 候选版本已采用";
    return "已保留当前版本";
  }, [state]);

  useEffect(() => {
    if (!note) return undefined;
    const timer = window.setTimeout(() => setNote(""), 3200);
    return () => window.clearTimeout(timer);
  }, [note]);

  if (state === "review") {
    return (
      <>
        <ReviewScreen
          onExit={() => setState("ready")}
          onAccept={() => {
            setDecisionSource("review");
            setState("accepted");
          }}
          onKeep={() => setShowKeepConfirm(true)}
        />
        {showKeepConfirm ? (
          <div className={styles.modalBackdrop}>
            <section className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="keep-version-title">
              <div className={styles.confirmIcon}>
                <ClockCounterClockwiseIcon aria-hidden="true" size={25} weight="duotone" />
              </div>
              <h2 id="keep-version-title">保留当前版本 V1.3？</h2>
              <p>当前 HTML 不会改变。AI 候选 V1.4 和本轮评论仍会保留，之后可以再次审阅。</p>
              <div>
                <button className={styles.secondaryAction} type="button" onClick={() => setShowKeepConfirm(false)}>继续审阅</button>
                <button
                  className={styles.primaryAction}
                  type="button"
                  onClick={() => {
                    setShowKeepConfirm(false);
                    setState("kept");
                  }}
                >
                  确认保留 V1.3
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </>
    );
  }

  if (state === "accepted" || state === "kept") {
    return (
      <OutcomeScreen
        outcome={state}
        source={decisionSource}
        onRestart={() => {
          setDecisionSource("review");
          setState("awaiting-ai");
        }}
        onReviewAgain={() => setState("review")}
      />
    );
  }

  return (
    <div className={styles.demoRoot}>
      <BrandHeader state={state} />
      <main className={styles.handoffStage}>
        <FrozenReport />
        <HandoffPanel
          ready={ready}
          onSimulate={() => setState("ready")}
          onReview={() => setState("review")}
          onDirectOpen={() => {
            setDecisionSource("direct");
            setState("accepted");
          }}
          onLater={() => setNote("真实产品中会收起侧栏；候选版本仍会留在“本轮处理”里。")}
        />
      </main>
      <span className={styles.srAnnouncement} aria-live="polite">{stateAnnouncement}</span>
      {note ? <div className={styles.demoToast} role="status">{note}</div> : null}
    </div>
  );
}
