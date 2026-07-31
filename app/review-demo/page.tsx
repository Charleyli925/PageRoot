"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
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
import { MinusCircleIcon } from "@phosphor-icons/react/dist/csr/MinusCircle";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/csr/PlusCircle";
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

type DemoChange = {
  id: string;
  number: number;
  kind: string;
  location: string;
  title: string;
  comment: string;
  before: string;
  after: string;
  extra?: string;
};

const CHANGES: DemoChange[] = [
  {
    id: "story",
    number: 1,
    kind: "文案修改",
    location: "核心结论",
    title: "先讲清增长来自哪里",
    comment: "首页要先讲结论，不要从过程开始。",
    before: "本轮活动覆盖更广，但增长主要来自新增流量。",
    after: "高意向人群贡献了 68% 的新增成交。",
  },
  {
    id: "metric",
    number: 2,
    kind: "数字与样式",
    location: "关键指标",
    title: "把转化率升级为主指标",
    comment: "把真正重要的指标凸显出来，弱化装饰。",
    before: "转化率 8.7%，与其他指标使用相同层级。",
    after: "转化率 12.4%，同比 +3.7pp，并作为主指标强调。",
  },
  {
    id: "audience",
    number: 3,
    kind: "模块移动",
    location: "人群洞察",
    title: "先解释原因，再给投放建议",
    comment: "把人群洞察放到投放策略前，先解释为什么。",
    before: "人群洞察位于页面底部。",
    after: "人群洞察移动到核心结论之后。",
  },
  {
    id: "actions",
    number: 4,
    kind: "整段重写",
    location: "下一步行动",
    title: "从泛泛建议改成三步动作",
    comment: "建议不要泛泛讲扩大投放，要落到可执行动作。",
    before: "扩大覆盖面，继续观察各渠道变化。",
    after: "预算集中到高意向人群，暂停低效渠道，并在 48 小时后复盘。",
    extra: "AI 额外补充了“48 小时后复盘”，不在原评论文字内。",
  },
];

const VIEW_LABELS: Record<ReviewView, string> = {
  after: "修改后",
  before: "修改前",
  overlay: "叠加对比",
};

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
          <strong>AI 商品运营效果分析.html</strong>
          <span>
            {isReview ? "V1.3 → AI 候选 V1.4" : "V1.3 · 已安全保存"}
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
      <article className={styles.frozenReport} aria-label="提交给 AI 前的冻结页面">
        <header className={styles.reportHero}>
          <span>投放复盘 · 07.08—07.28</span>
          <h1>AI 商品运营效果分析</h1>
          <p>本轮活动覆盖更广，但增长主要来自新增流量。</p>
        </header>
        <section className={styles.metricGrid}>
          <div><span>新增成交</span><strong>¥ 286,400</strong><small>同比 +18.6%</small></div>
          <div><span>转化率</span><strong>8.7%</strong><small>同比 +0.4pp</small></div>
          <div><span>获客成本</span><strong>¥ 42.8</strong><small>同比 -6.2%</small></div>
        </section>
        <section className={styles.reportSection}>
          <span>渠道表现</span>
          <h2>新增流量带来规模，高意向人群仍有提升空间</h2>
          <p>搜索广告带来最多新增访问，内容渠道带来的访问量较少，但停留与收藏更好。</p>
        </section>
        <section className={styles.reportSection}>
          <span>下一步行动</span>
          <h2>继续扩大覆盖面</h2>
          <p>扩大覆盖面，继续观察各渠道变化。</p>
        </section>
      </article>
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
              <strong>3 条评论</strong>
            </div>
            <ShieldCheckIcon aria-hidden="true" size={23} weight="duotone" />
          </header>
          <div className={styles.roundFacts}>
            <div><span>基于版本</span><strong>V1.3</strong></div>
            <div><span>目标版本</span><strong>V1.4</strong></div>
            <div><span>提交时间</span><strong>14:28</strong></div>
          </div>
          <div className={styles.commentPreview}>
            {CHANGES.slice(0, 3).map((change) => (
              <div key={change.id}>
                <ChatCircleTextIcon aria-hidden="true" size={15} weight="duotone" />
                <span><strong>{change.location}</strong>{change.comment}</span>
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
              <strong>发现 4 处可见变化</strong>
              <p>3 条评论已响应，另有 1 处 AI 补充。你可以先审阅，也可以直接打开候选版本。</p>
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

function ChangePin({
  number,
  active,
  onClick,
}: {
  number: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={styles.changePin}
      data-active={active ? "true" : undefined}
      type="button"
      aria-label={`查看修改 ${number}`}
      onClick={onClick}
    >
      {number}
    </button>
  );
}

function OverlayLegend() {
  return (
    <section className={styles.overlayLegend} aria-label="叠加对比包含的复杂变化类型">
      <span>
        <GitDiffIcon aria-hidden="true" size={15} weight="duotone" />
        <strong>复合变化预演</strong>
      </span>
      <ul>
        <li data-tone="replace">文字替换</li>
        <li data-tone="style">纯样式</li>
        <li data-tone="move">布局与移动</li>
        <li data-tone="remove">删除</li>
        <li data-tone="add">新增</li>
        <li data-tone="rebuild">整块重做</li>
      </ul>
    </section>
  );
}

function ComplexOverlayCases() {
  return (
    <section className={styles.overlayStressTest} aria-label="复杂修改对比示例">
      <header className={styles.complexIntro}>
        <span>复杂差异压力测试</span>
        <h2>同一轮修改，可能同时改变文字、样式和页面结构</h2>
        <p>这些示例只在“叠加对比”里展开，用来验证真实复杂 HTML 返回时仍能清楚说明发生了什么。</p>
      </header>

      <article className={styles.overlayCase}>
        <header className={styles.overlayCaseHeader}>
          <span>01</span>
          <div><strong>局部文字 + 纯样式变化</strong><small>保留没变的上下文，只标出真正变化的词和视觉属性</small></div>
        </header>
        <div className={styles.wordLevelDiff}>
          <p>
            搜索广告<del>带来最多新增访问</del><ins>负责拉新规模</ins>，内容渠道
            <del>访问量较少，但收藏率更好</del><ins>贡献了最高质量的高意向访问</ins>。
          </p>
          <div className={styles.styleChangePair}>
            <div data-side="before">
              <small>修改前 · 普通正文</small>
              <p>高意向人群是本轮增长来源</p>
              <span>14px · 常规 · 灰色</span>
            </div>
            <ArrowRightIcon aria-hidden="true" size={17} weight="bold" />
            <div data-side="after">
              <small>修改后 · 关键结论</small>
              <p>高意向人群是本轮增长来源</p>
              <span>18px · 加粗 · 强调色</span>
            </div>
          </div>
        </div>
      </article>

      <article className={styles.overlayCase}>
        <header className={styles.overlayCaseHeader}>
          <span>02</span>
          <div><strong>布局重排 + 指标层级变化</strong><small>内容没有全部消失，但列数、面积和阅读顺序发生了变化</small></div>
        </header>
        <div className={styles.layoutComparison}>
          <section data-side="before">
            <header><span>修改前</span><small>等宽三列</small></header>
            <div className={styles.metricLayoutPreview} data-layout="before">
              <div><span>新增成交</span><strong>¥286k</strong></div>
              <div><span>转化率</span><strong>8.7%</strong></div>
              <div><span>获客成本</span><strong>¥42.8</strong></div>
            </div>
          </section>
          <section data-side="after">
            <header><span>修改后</span><small>主指标占双列</small></header>
            <div className={styles.metricLayoutPreview} data-layout="after">
              <div data-featured="true"><span>核心转化率</span><strong>12.4%</strong><small>成为第一阅读焦点</small></div>
              <div><span>新增成交</span><strong>¥286k</strong></div>
              <div><span>获客成本</span><strong>¥42.8</strong></div>
            </div>
          </section>
        </div>
      </article>

      <article className={styles.overlayCase}>
        <header className={styles.overlayCaseHeader}>
          <span>03</span>
          <div><strong>模块删除、新增与跨区移动</strong><small>不把结构变化伪装成几行普通文字修改</small></div>
        </header>
        <div className={styles.structureEvents}>
          <section data-tone="remove">
            <MinusCircleIcon aria-hidden="true" size={20} weight="duotone" />
            <div><span>整个模块已删除</span><strong>渠道明细表</strong><small>原位置：渠道表现之后 · 6 行数据</small></div>
            <TableIcon aria-hidden="true" size={24} weight="duotone" />
          </section>
          <section data-tone="add">
            <PlusCircleIcon aria-hidden="true" size={20} weight="duotone" />
            <div><span>新增模块</span><strong>异常渠道提醒</strong><small>新位置：下一步行动之前 · AI 额外补充</small></div>
            <WarningCircleIcon aria-hidden="true" size={24} weight="duotone" />
          </section>
          <section data-tone="move">
            <ArrowsDownUpIcon aria-hidden="true" size={20} weight="duotone" />
            <div><span>模块跨区移动</span><strong>人群洞察</strong><small>页面底部 → 核心结论之后 · 内容本身未删除</small></div>
            <RowsIcon aria-hidden="true" size={24} weight="duotone" />
          </section>
        </div>
      </article>

      <article className={styles.overlayCase}>
        <header className={styles.overlayCaseHeader}>
          <span>04</span>
          <div><strong>列表重序 + 拆分与合并</strong><small>同时告诉用户哪项被删除、哪项只是换了位置</small></div>
        </header>
        <div className={styles.orderComparison}>
          <section data-side="before">
            <header><span>修改前</span><small>按渠道组织</small></header>
            <ol>
              <li><span>1</span><p>扩大搜索广告覆盖</p><small data-tone="remove">删除</small></li>
              <li><span>2</span><p>继续观察内容渠道</p><small data-tone="merge">合并</small></li>
              <li><span>3</span><p>周末汇总完整周报</p><small data-tone="move">后移</small></li>
            </ol>
          </section>
          <ArrowRightIcon aria-hidden="true" size={18} weight="bold" />
          <section data-side="after">
            <header><span>修改后</span><small>按执行优先级组织</small></header>
            <ol>
              <li><span>1</span><p>暂停联盟渠道新增预算</p><small data-tone="add">新增</small></li>
              <li><span>2</span><p>预算集中到高意向人群</p><small data-tone="merge">合并</small></li>
              <li><span>3</span><p>48 小时后快速复盘</p><small data-tone="move">前移</small></li>
            </ol>
          </section>
        </div>
      </article>

      <article className={styles.overlayCase}>
        <header className={styles.overlayCaseHeader}>
          <span>05</span>
          <div><strong>整块重做：故事线和组件结构都变了</strong><small>旧模块完整保留为参考，新模块完整展示为候选</small></div>
        </header>
        <div className={styles.moduleRebuildComparison}>
          <section data-side="before">
            <header><MinusCircleIcon aria-hidden="true" size={16} weight="duotone" /><span>原模块 · 整块替换</span></header>
            <div className={styles.oldModuleExample}>
              <small>渠道周报</small>
              <h3>继续扩大覆盖面</h3>
              <p>搜索广告带来更多访问，后续继续观察各渠道表现并在周末汇总。</p>
              <span>查看渠道详情</span>
            </div>
          </section>
          <section data-side="after">
            <header><PlusCircleIcon aria-hidden="true" size={16} weight="duotone" /><span>新模块 · 完整候选</span></header>
            <div className={styles.newModuleExample}>
              <div><small>决策建议</small><span>优先级 P1</span></div>
              <h3>未来 48 小时先做三件事</h3>
              <ul>
                <li><strong>预算</strong><span>高意向人群 +20%</span></li>
                <li><strong>渠道</strong><span>暂停联盟新增投放</span></li>
                <li><strong>复盘</strong><span>负责人：运营组 · 明晚</span></li>
              </ul>
            </div>
          </section>
        </div>
      </article>

      <footer className={styles.overlayRuleNote}>
        <ShieldCheckIcon aria-hidden="true" size={18} weight="duotone" />
        <p><strong>复杂变化按“用户能理解的语义”分组</strong>不要求用户理解 DOM 节点，也不会把移动误显示成一次删除加一次新增。</p>
      </footer>
    </section>
  );
}

function ReportReview({
  view,
  activeIndex,
  onSelectChange,
}: {
  view: ReviewView;
  activeIndex: number;
  onSelectChange: (index: number) => void;
}) {
  const isBefore = view === "before";
  const isOverlay = view === "overlay";

  const sectionProps = (index: number) => ({
    "data-active": activeIndex === index ? "true" : undefined,
    "data-change": String(index + 1),
  });

  const audienceModule = (
    <section className={styles.audienceModule} {...sectionProps(2)}>
      <ChangePin number={3} active={activeIndex === 2} onClick={() => onSelectChange(2)} />
      <div className={styles.sectionEyebrow}>人群洞察</div>
      <h2>高意向人群规模不大，但贡献了主要增量</h2>
      <div className={styles.audienceFacts}>
        <div><span>人群占比</span><strong>31%</strong></div>
        <div><span>新增成交贡献</span><strong>68%</strong></div>
        <div><span>二次访问率</span><strong>42%</strong></div>
      </div>
      {isOverlay ? (
        <span className={styles.moveLabel}>
          <ArrowsClockwiseIcon aria-hidden="true" size={14} weight="bold" />
          从页面底部移动到这里
        </span>
      ) : null}
    </section>
  );

  return (
    <article className={styles.reviewReport} data-view={view}>
      <header className={styles.reviewHero} {...sectionProps(0)}>
        <ChangePin number={1} active={activeIndex === 0} onClick={() => onSelectChange(0)} />
        <span>投放复盘 · 07.08—07.28</span>
        <h1>AI 商品运营效果分析</h1>
        {isOverlay ? (
          <p className={styles.inlineDiff}>
            <del>本轮活动覆盖更广，但增长主要来自新增流量。</del>
            <ins>高意向人群贡献了 68% 的新增成交。</ins>
          </p>
        ) : (
          <p>{isBefore ? CHANGES[0].before : CHANGES[0].after}</p>
        )}
      </header>

      {isOverlay ? <OverlayLegend /> : null}

      <section className={styles.reviewMetrics}>
        <div>
          <span>新增成交</span>
          <strong>¥ 286,400</strong>
          <small>同比 +18.6%</small>
        </div>
        <div className={styles.changedMetric} {...sectionProps(1)}>
          <ChangePin number={2} active={activeIndex === 1} onClick={() => onSelectChange(1)} />
          <span>{isBefore ? "转化率" : "核心转化率"}</span>
          {isOverlay ? (
            <strong className={styles.metricDiff}><del>8.7%</del><ins>12.4%</ins></strong>
          ) : (
            <strong>{isBefore ? "8.7%" : "12.4%"}</strong>
          )}
          <small>{isBefore ? "同比 +0.4pp" : "同比 +3.7pp"}</small>
        </div>
        <div>
          <span>获客成本</span>
          <strong>¥ 42.8</strong>
          <small>同比 -6.2%</small>
        </div>
      </section>

      {!isBefore ? audienceModule : null}

      <section className={styles.channelModule}>
        <div className={styles.sectionEyebrow}>渠道表现</div>
        <h2>内容渠道更适合承接高意向用户</h2>
        <p>搜索广告带来最多新增访问；内容渠道访问量较少，但收藏率与二次访问率更好。</p>
        <div className={styles.channelRows}>
          <div><span>搜索广告</span><strong>规模最高</strong><small>转化稳定</small></div>
          <div><span>内容渠道</span><strong>意向最高</strong><small>值得加码</small></div>
          <div><span>联盟渠道</span><strong>成本偏高</strong><small>建议收缩</small></div>
        </div>
      </section>

      <section className={styles.actionModule} {...sectionProps(3)}>
        <ChangePin number={4} active={activeIndex === 3} onClick={() => onSelectChange(3)} />
        <div className={styles.sectionEyebrow}>下一步行动</div>
        {isOverlay ? (
          <>
            <h2 className={styles.blockDiffTitle}><del>继续扩大覆盖面</del><ins>把预算收拢到有效人群</ins></h2>
            <p className={styles.blockDiffCopy}>
              <del>扩大覆盖面，继续观察各渠道变化。</del>
              <ins>1. 预算集中到高意向人群；2. 暂停低效渠道；3. 48 小时后复盘。</ins>
            </p>
          </>
        ) : isBefore ? (
          <><h2>继续扩大覆盖面</h2><p>扩大覆盖面，继续观察各渠道变化。</p></>
        ) : (
          <>
            <h2>把预算收拢到有效人群</h2>
            <ol>
              <li><strong>集中预算</strong><span>高意向人群预算提高 20%</span></li>
              <li><strong>暂停低效渠道</strong><span>联盟渠道暂停新增预算</span></li>
              <li><strong>快速复盘</strong><span>48 小时后核对转化与成本</span></li>
            </ol>
          </>
        )}
      </section>

      {isBefore ? audienceModule : isOverlay ? (
        <section className={styles.oldLocation} aria-label="模块原位置">
          <ArrowsClockwiseIcon aria-hidden="true" size={18} weight="duotone" />
          <span><strong>人群洞察原位置</strong>模块已移动到核心结论之后</span>
        </section>
      ) : null}

      {isOverlay ? <ComplexOverlayCases /> : null}
    </article>
  );
}

function ReviewScreen({
  onExit,
  onAccept,
  onKeep,
}: {
  onExit: () => void;
  onAccept: () => void;
  onKeep: () => void;
}) {
  const [view, setView] = useState<ReviewView>("after");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeChange = CHANGES[activeIndex];

  const navigate = (direction: -1 | 1) => {
    setActiveIndex((current) => (current + direction + CHANGES.length) % CHANGES.length);
  };

  return (
    <div className={styles.demoRoot}>
      <BrandHeader state="review" onBackToReview={onExit} />
      <main className={styles.reviewStage}>
        <section className={styles.reviewWorkspace}>
          <div className={styles.reviewToolbar}>
            <div className={styles.reviewTitle}>
              <GitDiffIcon aria-hidden="true" size={20} weight="duotone" />
              <span><strong>审阅 AI 修改</strong><small>4 处变化 · 3 条评论已响应 · 1 处额外补充</small></span>
            </div>
            <div className={styles.viewSwitch} aria-label="对比方式">
              {(Object.keys(VIEW_LABELS) as ReviewView[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={view === item}
                  onClick={() => setView(item)}
                >
                  {VIEW_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.reviewCanvas}>
            <ReportReview view={view} activeIndex={activeIndex} onSelectChange={setActiveIndex} />
          </div>
        </section>

        <aside className={styles.changeRail}>
          <header className={styles.changeRailHeader}>
            <div>
              <span>修改清单</span>
              <strong>{activeIndex + 1} / {CHANGES.length}</strong>
            </div>
            <div>
              <button type="button" aria-label="上一处修改" onClick={() => navigate(-1)}>
                <ArrowLeftIcon aria-hidden="true" size={16} weight="bold" />
              </button>
              <button type="button" aria-label="下一处修改" onClick={() => navigate(1)}>
                <ArrowRightIcon aria-hidden="true" size={16} weight="bold" />
              </button>
            </div>
          </header>

          <div className={styles.changeList}>
            {CHANGES.map((change, index) => (
              <button
                className={styles.changeCard}
                data-active={index === activeIndex ? "true" : undefined}
                key={change.id}
                type="button"
                onClick={() => setActiveIndex(index)}
              >
                <span className={styles.changeCardTop}>
                  <span>{change.number}</span>
                  <strong>{change.location}</strong>
                  <small>{change.kind}</small>
                </span>
                <span className={styles.changeCardTitle}>{change.title}</span>
              </button>
            ))}

            <section className={styles.changeDetail} aria-live="polite">
              <div className={styles.commentQuote}>
                <ChatCircleTextIcon aria-hidden="true" size={17} weight="duotone" />
                <span><small>你的评论</small><q>{activeChange.comment}</q></span>
              </div>
              <div className={styles.beforeAfter}>
                <div><span>修改前</span><p>{activeChange.before}</p></div>
                <div><span>修改后</span><p>{activeChange.after}</p></div>
              </div>
              {activeChange.extra ? (
                <div className={styles.extraChange}>
                  <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />
                  <span><strong>额外变化</strong>{activeChange.extra}</span>
                </div>
              ) : null}
            </section>
          </div>

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
            <div><dt>本轮评论</dt><dd>3 条</dd></div>
            <div><dt>可见变化</dt><dd>4 处</dd></div>
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
