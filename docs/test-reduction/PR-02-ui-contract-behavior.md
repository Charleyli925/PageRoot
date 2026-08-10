# PR2：用行为 oracle 替代 UI 源码字符串合同

> 建议分支：`test/ui-contract-behavior`
> 批次：第二批，可与 PR4、PR5、PR6 并行开发
> 严格前置：PR1 已合并，分支基于其后的最新 `origin/main`
> 单一结果：UI、评论、通知和画布行为由 Node policy/Browser DOM/必要 Electron oracle 拥有，不再扫描 Workbench/CSS/JSX 形状
> 预估净减少：2,000–2,500 行测试代码；估算不是删除授权

## 背景和目标

当前若干顶层 Node 文件通过读取 `app/workbench.tsx`、Canvas 组件、CSS 和 JSX，再使用大量正则表达式断言文案、class、回调顺序和内部 helper。它们可以快速发现“代码形状变了”，但经常把无行为变化的重构当成失败，同时与现有 Browser、Session、policy 和 Electron 测试重复。

本 PR 的目标是把用户可观察 UI 行为放回最低成本、最接近真实行为的 owner：

- 纯策略和排序由纯 Node owner；
- ARIA、按钮、键盘、焦点、hover/focus pause、布局和恢复由 Browser；
- 磁盘、真实 IPC、进程关闭和 IME 只留给 Electron；
- 没有行为含义的 CSS 数值、JSX 排列和内部函数名断言直接删除。

本 PR 不允许修改生产代码来配合测试，也不承担跨 owner 的剩余架构合同；后者由 PR3 处理。

## 事实与根因

### 1. 关键文件和证据

| 文件 | 行数 | 测试数 | `assert.match/doesNotMatch` 数 | 主要问题 |
| --- | ---: | ---: | ---: | --- |
| `tests/workbench-shell-ux.test.mjs` | 1,625 | 30 | 592 | 一个文件横跨启动、项目、评论、AI、历史、外部动作、附件和 UI 排列 |
| `tests/frontend-target-refresh.test.mjs` | 771 | 15 | 138 | 前 3 例是 SourcePatch 行为，其余大量读取 Canvas/Workbench 源码 |
| `tests/notification-ui.test.mjs` | 305 | 13 | 152 | policy、copy、ARIA、恢复和 Workbench plumbing 混在源码字符串检查中 |
| `tests/source-architecture-fixture.mjs` | 44 | — | — | 拼接多个大型生产文件，为测试提供不稳定的“整仓源码字符串” |

`tests/source-architecture-fixture.mjs::readCanvasArchitecture` 和 `readWorkbenchArchitecture` 将多个实现文件读入并 `join("\n")`。因此某个断言可以在错误文件或错误 owner 中偶然命中，无法证明真实调用链或 DOM 行为。

### 2. 已存在的行为 owner

当前仓库已具备更直接的 owner：

| 行为 | 已存在 owner |
| --- | --- |
| notice priority、dedupe、sticky、timeout、safe copy | `tests/notification-policy.test.mjs` |
| notice ARIA、键盘 action、恢复流程 | `tests/e2e/browser/native-dom-notification-recovery.spec.mjs` |
| 评论排序、坐标、间距、滚轮、Enter/Shift+Enter | `tests/comment-rail-layout.test.mjs` |
| 评论 Tab、草稿、焦点、重测、无重叠 | `tests/e2e/browser/native-dom-comment-tabs.spec.mjs` |
| 安全页签和 authored action 隔离 | `tests/e2e/browser/native-dom-presentation-actions.spec.mjs` |
| 附件数量/大小/overflow 规则 | `tests/attachment-selection.test.mjs` |
| SourcePatch forward/inverse、reorder、TargetRef mapping | `tests/source-patch-engine.test.mjs`、`tests/source-index-target-resolver.test.mjs` |
| AI ready/review/accept、项目隔离和失败关闭 | `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs` |
| 磁盘、真实编辑、关闭重开、source history | `tests/e2e/electron/native-dom-electron.spec.mjs` |

`docs/ENGINEERING_STANDARDS.md` 已明确规定：优先可观察结果；源码字符串断言只用于 security、packaging、dependency 和显式 architecture boundary。当前三个 UI 合同文件超出了这个范围。

### 3. 根因调用链

```text
生产实现文件变化
  -> source-architecture-fixture 读取并拼接多个文件
  -> UI contract 用 regex 查找文案/class/helper/order
  -> 测试通过只说明字符串仍存在
  -> 同一行为又由 Browser/Session/Electron 再证明一次
```

根因不是缺少测试，而是测试 owner 不清：一个 Workbench source scan 同时替代了 policy、DOM、Session 和 Electron 的职责。

## 修改清单

### `tests/workbench-shell-ux.test.mjs`

目标：删除该文件，或仅在迁移期间保留一个极小的显式 shell architecture contract；最终状态优先删除。

逐场景迁移：

| 当前场景族 | 新 owner/处理 | 原因 |
| --- | --- | --- |
| welcome 注册、首次项目注册、autosave 事务 | `workspace-bridge.test.mjs` + Native Electron welcome 场景 | 必须观察真实 workspace/disk，不应查 Workbench 字符串 |
| 项目 hydration、project/run identity、切换结果隔离 | Project/Run/Document Session Node 测试 | 状态机与 identity 是 owner 行为 |
| Edit/Preview 分离、安全 authored actions | `native-dom-presentation-actions.spec.mjs`、`html-preview-sandbox.test.mjs` | Browser 能直接证明脚本未执行和 bytes 不变 |
| native edit freeze、source reversal、external adoption | Document/SourceHistory/External Session + Native Electron | 需要 generation、revision、disk oracle |
| header、action 顺序、tooltip、CSS spacing | 有明确可访问性/点击结果的迁至 Browser；纯视觉数字和内部排列删除 | JSX/CSS 形状不是产品正确性 oracle |
| Qoder handoff、结束/恢复 run、AI ready/open | AI Electron 闭环 | 真实跨进程状态已有 owner |
| history/version 打开 | VersionSession + Native Electron source history | 以版本身份和磁盘结果判断 |
| rename、Finder/browser 等外部动作 | 对应 Node controller/IPC 测试 | 一次用户意图和安全门已有独立计数 oracle |
| 评论 composer、layout、navigation、attachments | comment layout、comment tabs、notification recovery、attachment selection | 直接 DOM/纯算法 owner 已存在 |

禁止把 30 个旧测试逐个复制到另一个源码字符串文件。每个测试只迁移它独有且产品可观察的部分。

### `tests/notification-ui.test.mjs`

目标：完成迁移后删除。

- 将 priority、dedupe、persistent/ephemeral、技术错误净化、未知字段/路径不泄露，合并到 `tests/notification-policy.test.mjs` 的表驱动案例。
- 将 `role=status`、`aria-live=polite`、键盘触发、action/dismiss、hover/focus pause、恢复按钮路径放入 Browser notification recovery。
- “文案中不存在某个内部词”“Workbench 里没有某个 helper”只在它对应安全泄露边界时保留；普通 copy snapshot 删除。
- AI ready 不自动打开、候选身份显示时机，如仍是唯一行为，交由 AI Electron 场景，不在 notification 文件扫描 Workbench。

### `tests/frontend-target-refresh.test.mjs`

目标：把纯算法案例迁走，剩余真实交互转为 Browser，然后删除源码扫描部分；若文件只剩纯行为测试，则重命名到 owner 文件。

- 前三个 SourcePatch/TargetRef 场景：迁到 `tests/source-patch-engine.test.mjs` 或 `tests/source-index-target-resolver.test.mjs`，保留 forward/inverse、exact sibling、连续 move 和序列化 oracle。
- logical reorder refresh/reload：优先放到现有 Browser editing/structure spec；必须观察 DOM identity、frame 是否复用和 fallback。
- legacy whole-page comment normalization：迁到 compatibility/comment-session owner；若 PR #133 已退休该兼容形状，按最新事实删除而不是保留旧合同。
- style write、target identity、active cascade：由 SourcePatch Node + Browser style interaction 共同拥有。
- iframe keep/replace、selection clear、spacing menu、links/forms、root whitespace：迁到现有 Browser editing/presentation specs。
- handoff 前 commit/freeze：若 AI Electron 已直接证明 exact revision 和 frozen targets，则删除重复源码顺序断言；否则在 PR3 保留最小 architecture contract，不在本 PR新增实现扫描。

### `tests/notification-policy.test.mjs`

只增加当前 `notification-ui` 中尚未覆盖的纯策略矩阵：

- disposition × action 的合法/非法组合；
- critical notice 不能被低优先级覆盖；
- safe product copy 对技术前缀、未知字段、本地路径的净化；
- sticky/timeout/pause 的状态转换；
- analytics 只发送稳定 code，不发送可见 copy。

使用数据表和公开函数结果，禁止读取 Workbench/CSS/JSX。

### `tests/comment-rail-layout.test.mjs`

只补充仍由纯算法拥有且 Browser 不应重复排列的边界：

- 非有限坐标和安全上限失败关闭；
- 超过 100,000px 的有限长文档坐标；
- 动态卡片高度变化后无重叠；
- 编辑期间坐标冻结与结束后重算。

不要把真实 DOM focus、ARIA 或 Tab 切换搬到 Node。

### `tests/attachment-selection.test.mjs`

吸收附件数量、大小、invalid 不占 slot、overflow 分类等纯函数场景。Browser 只保留“移除后重试成功”和真实可访问操作。

### `tests/e2e/browser/native-dom-notification-recovery.spec.mjs`

在现有三个真实恢复流程上补齐必要 UI oracle：

- action 和 dismiss 可键盘触发；
- `role`/`aria-live` 与 tone/disposition 匹配；
- hover 或 focus 时 timeout pause，离开后恢复；
- recovery action 执行后 notice 消失或变为正确下一状态；
- analytics 捕获只包含 code/disposition/surface，不包含可见 copy 或本地路径。

不得用固定 sleep 代替状态轮询；不得放宽 timeout。

### `tests/e2e/browser/native-dom-comment-tabs.spec.mjs`

仅补充从 `workbench-shell-ux` 迁来的独有 DOM 行为：

- composer 显式出现、关闭后仍有可恢复入口；
- 当前/其他 Tab 的草稿与保存卡片排序；
- 动态 attachment/edit controls 触发 remeasure 且无重叠；
- comment navigation 保持共享页面滚动和稳定 target。

该文件已经覆盖多数行为，先做覆盖对照，已有断言不得重复添加。

### `tests/e2e/browser/native-dom-presentation-actions.spec.mjs`

补充真正缺失的 links/forms、空白点击、selection clear、toolbar close 行为；保持 authored handler 未执行和源字节不变。

### `scripts/test-node-group.mjs`

- 删除已移除的 `notification-ui.test.mjs`、`workbench-shell-ux.test.mjs` contract group 引用。
- 若 `frontend-target-refresh.test.mjs` 删除或改名，同步 group 分类。
- 不改变 smoke 的三个固定 owner，除非最新主线已修改正式策略；发现差异则停止。

### `tests/test-impact-map.json`

- 删除已移除测试的所有引用；
- 将 notification、comment、presentation、SourcePatch 路径映射到新 owner；
- 保留 PR1 的窄规则，不重新引入 `workbench-lifecycle` 全家桶；
- Browser spec 自身变化仍选择对应 Browser smoke。

### `tests/test-gate-selection.test.mjs`

- 更新 Node group 精确分区断言；
- 为 NoticeBar、comment rail、presentation action 增加 owner 选择断言；
- 保持 PR1 的七案例总和阈值和 release lane 不变。

### `tests/TEST_STRATEGY.md`

记录最终 owner：notification policy vs Browser、comment algorithm vs Browser、SourcePatch vs Browser/Electron。删去对已移除源码字符串合同的描述。

### `docs/DEVELOPMENT.md`

只有测试命令或 ownership 说明发生变化时更新；不复制 TEST_STRATEGY 的长合同。

## 边界条件

必须保持：

- welcome 项目真实注册、恢复和首次 autosave 事务；
- Edit/Preview 分离、author scripts 不在 Edit 运行、导出/源字节不变；
- native edit freeze、revision、source history、external adoption 失败关闭；
- comment draft 只能有一个、Tab 归属、排序、无重叠、滚轮和稳定 target；
- notice ARIA、键盘、恢复 action、优先级、去重、sticky/timeout 和 safe copy；
- attachment 数量/大小边界与移除后恢复；
- AI ready 不自动激活，accept 后身份和历史正确；
- 所有行为仍有至少一个独立 oracle。

明确不做：

- 不改 `app/**`、`desktop/**`、`scripts/workspace-bridge.mjs` 或 CSS；
- 不把视觉偏好像素值设为硬合同；
- 不新增 snapshot 库或组件测试框架；
- 不修改 Playwright timeout、retry、worker；
- 不处理 PR3 所属的 native queue/source fence/review architecture 合同；
- 不为了删文件把行为全部塞入一个更大的 Browser mega-test。

## 验收标准

### 聚焦 Node

```bash
node --test \
  tests/notification-policy.test.mjs \
  tests/comment-rail-layout.test.mjs \
  tests/attachment-selection.test.mjs \
  tests/source-patch-engine.test.mjs \
  tests/source-index-target-resolver.test.mjs \
  tests/test-gate-selection.test.mjs
```

预期：全部通过；已删除测试无残余 import、group 或 impact-map 引用。

### Browser

```bash
npm run build
npx playwright test --config tests/e2e/browser/playwright.config.mjs \
  tests/e2e/browser/native-dom-notification-recovery.spec.mjs \
  tests/e2e/browser/native-dom-comment-tabs.spec.mjs \
  tests/e2e/browser/native-dom-presentation-actions.spec.mjs
```

若 Playwright config 不接受位置参数，则运行：

```bash
npm run test:browser:full:prepared
```

预期：相关 Browser 场景通过，零 retry，失败时保留 trace/screenshot。

### 必要 Electron 回归

```bash
npm run test:electron:smoke
```

如果迁移触及 AI ready/accept 或真实 source-history 断言，再运行：

```bash
npm run test:ai-closed-loop:smoke
npm run test:electron:full
```

### 任务门禁

```bash
npm run gate:edit
npm run task:finish
```

预期：通过；PR1 的代表性 Node 选择总和仍不高于 56；release suite 清单不变。

### 量化与迁移证据

- 为旧 58 个测试场景（30 + 15 + 13）逐项标记：迁移、已覆盖删除、保留；
- 每个“已覆盖删除”必须引用现有测试名和 oracle；
- 净测试 LOC 目标 2,000–2,500；低于目标可以接受，但必须解释唯一 oracle 或新增行为测试占用，不得继续机械删除。

## 停止条件

出现以下任一情况立即停止：

- PR1 未合并或最新 map ownership 与本文不一致；
- 某旧源码字符串测试是唯一能发现真实用户回归的 oracle；
- Browser 无法触发该行为，必须新增生产测试钩子；
- 需要修改产品 copy、CSS、组件结构或状态机才能使迁移测试通过；
- 迁移导致一个 Browser mega-test承担多个不相关生命周期；
- Playwright 只能通过 sleep、增加 timeout 或 retry 稳定；
- 与 PR4 同时修改同一个 AI Electron 场景；
- 与其他开放 PR 同时修改 `workbench-shell-ux.test.mjs`、notification 或 comment specs。

停止报告应附：旧测试名、当前唯一 oracle、尝试迁移的 owner、缺少的可观测接口，以及是否应保留最小源码 architecture contract 交给 PR3。

## 未决风险

- 正则断言数量不等于可删除数量；某些 source-order 断言可能是尚未显式建模的失败关闭边界。
- Browser comment spec 已较大，继续吸收场景可能降低定位性；应优先复用 helper 和聚焦 test，不扩大单个 test 生命周期。
- 真实 notification timeout/pause 可能依赖 fake timer 不可用；若真实等待会造成慢/脆弱，应保留纯 policy oracle，而不是扩大产品 API。
- PR #133 可能退休 compatibility 场景，`legacy whole-page comments` 的处理必须以合并后的事实为准。
- UI copy 是否属于稳定产品合同需要逐项判断；安全/恢复文案可保留，纯布局和内部状态词不应当成架构 oracle。
