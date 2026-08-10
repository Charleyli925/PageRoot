# PR4：收敛 Electron/AI E2E 夹具和重复场景

> 建议分支：`test/electron-e2e-consolidation`
> 批次：第二批，可与 PR2、PR5、PR6 并行开发
> 严格前置：PR1 已合并，分支基于其后的最新 `origin/main`
> 单一结果：保留全部唯一跨进程 oracle，同时共享安全启动夹具、表驱动重复 geometry，并把非 AI 场景移回 Native/Node/Browser owner
> 预估净减少：1,500–2,200 行测试代码；估算不是删除授权

## 背景和目标

`tests/e2e/electron/ai-handoff-closed-loop.spec.mjs` 当前 4,055 行、21 个测试。第一个“verified AI result”测试从约第 559 行延伸到第 2758 行，单例约 2,200 行，同时证明 AI 请求、finalizer、Review UI、diff/geometry、runtime capture、评论、accept 和磁盘激活。

`tests/e2e/electron/native-dom-electron.spec.mjs` 另有 1,891 行、15 个测试。两个 spec 分别实现了 Electron 启停、用户目录、active project、loaded frame 和 cleanup。AI spec 还包含 update About、项目资源、评论兼容、快速切换/关闭等并非 AI 独有的场景。

本 PR 不以减少用例数为第一目标。它先标记每个跨进程 oracle 的唯一性，再：

- 抽取无业务判断的公共 Electron app fixture；
- 将重复 geometry/assertion 变成具名表驱动 helper，不降低断言；
- 将 update、project switch/close 等非 AI owner 场景移出 AI spec；
- 合并具有相同故障模型的兼容排列，保留至少一个真实端到端代表；
- 保持 smoke 仍选择“review accept”和“broad related result”两条关键路径。

## 事实与根因

### 1. 关键文件与符号

| 文件 | 行数 | 测试数 | 关键事实 |
| --- | ---: | ---: | --- |
| `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs` | 4,055 | 21 | workers=1、retries=0、timeout=180s；首例约 2,200 行 |
| `tests/e2e/electron/native-dom-electron.spec.mjs` | 1,891 | 15 | workers=1、retries=0；真实 DOM/磁盘/IME/close owner |
| `tests/e2e/electron/playwright.ai-smoke.config.mjs` | 21 | — | grep 两个精确标题 |
| `tests/ai-smoke-config.test.mjs` | 28 | 1 | 从源码提取标题并断言 smoke 选择与 teardown 形状 |

AI spec 内已有 helper：

- `seedActiveDiskProject`
- `launchPageRoot`
- `stopPageRoot`
- `closePageRootGracefully`
- `sendToMainRenderer`
- `createSourceFixture`
- `waitForProjectReady`
- `loadedDiskFrame`
- `addCommentAndSubmit`
- `openRecentProject`
- `writeAiOutput`
- `runOfficialFinalizer`

Native spec 重复实现前六类 app/project lifecycle helper。

### 2. E2E 当前职责混合

AI 21 例同时包含：

- 核心 AI：verified review/accept、多版本/relaunch、no-change、return、clipboard failure、项目隔离、double-click 幂等、cancel/restart、unknown outcome、missing finalizer、malformed HTML、broad related、activation failure；
- 评论兼容：global、legacy global、多个 orphan relink；
- 非 AI 桌面：project resources/drain、About/update、rapid project switching/close；
- 第一个大例中的低层 diff、scroll、geometry 和 runtime owner 大矩阵。

其中部分低层行为已有 Node owner，但正式 Electron 仍是跨进程/真实 geometry 的最终 oracle。不能仅依据文件大就删除。

### 3. 调用链

```text
Playwright Electron
  -> launchPageRoot / isolated userData / Bridge
  -> seed/open real source project
  -> UI comment + Request submission
  -> write Attempt output/index.html
  -> run official finalize-attempt.mjs
  -> poll Bridge status
  -> open Review / inspect real DOM geometry
  -> accept or return
  -> verify disk, Version, relaunch and cleanup
```

根因是生命周期脚手架、业务构造和所有 oracle 都内联在 spec；不同 owner 的场景也被放进 AI job，导致单文件和单例巨大。

## 修改清单

### 新增 `tests/e2e/electron/helpers/pageroot-app-fixture.mjs`

只抽取两个 spec 都需要、且没有业务断言的能力：

- 创建每 test 独立的临时 root、workspace、source 和 userData；
- `seedActiveDiskProject`；
- `launchPageRoot`，保留隐藏窗口、background throttling、Bridge 环境和现有关闭事件观察；
- `stopPageRoot`/`closePageRootGracefully`，先等待 Electron close，再删除 Bridge-owned 文件；
- `waitForProjectReady`；
- `loadedDiskFrame`；
- 收集 stdout/stderr 与诊断路径。

设计约束：

- 每次调用返回全新对象，不使用 module-global mutable state；
- cleanup 幂等，失败时仍收集日志；
- 不捕获或吞掉产品 assertion；
- 不自动重试整个 test；
- 不在 app 未关闭时 `rm` 用户目录；
- 不更改前台/后台策略。

AI 专属的 `addCommentAndSubmit`、`writeAiOutput`、`runOfficialFinalizer` 可保留在 AI spec；只有出现三个以上重复调用且不含业务断言时，才放到单独的 `helpers/ai-request-fixture.mjs`。不要把完整用户流程藏进一个不可读 helper。

### `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs`

#### A. 先建立场景保留表

以下场景默认必须保留为独立跨进程 oracle，除非迁移表证明另有等价 owner：

1. verified result 保持 pending，正式 Review 后 accept；
2. pre-load review navigation fail closed；
3. 两个 AI Version 顺序激活并跨 relaunch；
4. internal supplement seal/apply/history；
5. no-change 返回 Edit 且可重开；
6. return before AI 保留 candidate；
7. clipboard handoff failure 可恢复；
8. Project A 失败不污染 Project B；
9. double click 只创建一个 durable Request；
10. copied run cancel 后 restart 仍阻止 late finalization；
11. unknown outcome fail closed 后自动 reconcile；
12. missing finalizer 不建版；
13. malformed HTML 拒绝；
14. broad but related return 可接受；
15. committed Version 激活失败保持 visible blocked。

#### B. 收敛第一个约 2,200 行测试

保留一条真实完整链：comment → Request → official finalizer → ready → Review → accept → disk/version/relaunch。

将重复断言抽为具名 helper 和数据表：

- `assertReviewControlDefaults`
- `assertReviewChangeOutline`
- `assertProjectionGeometryCase`
- `assertOverlayMaskEquivalence`
- `assertRuntimeVisualSupplement`
- `assertReviewAcceptPersistence`

每个 geometry case 数据必须包含：输入 fixture、filter/page mode/context、预期 change type、owner element/range、frame count、mask count、允许误差和负例。表驱动只能消除样板，不能合并具有不同故障模型的 oracle。

仍必须保留正式 Electron 中独有的关键几何：

- text/structure/style 的最终 change type 和数量；
- pure deletion collapsed Range 导航；
- table row、SVG/Canvas/input 原子单元；
- overlay 与 mask hole 数量/坐标/path 等价；
- authored CSS 不能改写投影；
- Tab 揭示、滚动 generation、左右页/缩放后的重新测量；
- runtime owner 失败或迟到不改变静态 Review；
- accept 前不激活，accept 后磁盘和 Version identity 正确。

低层算法矩阵若已由 `review-text-diff`、`review-semantic-alignment`、`review-projection-facts`、`review-scroll-sync`、runtime owner Node 测试精确证明，可从 Electron 删除重复输入排列，但迁移表必须指向具体 test 名。

#### C. 移出非 AI owner 场景

- `automatic update actions ... About`：迁到 Native Electron 的独立小场景，或由 application-update + preload/UI owner 共同覆盖；不得留在 AI spec。
- `rapid project switching and immediate close ...`：Native Electron 已拥有 disk/native edit/close，补缺失断言后删除 AI 重复。
- `project resources ... drain edits`：迁到 Project/Drain Node + Native Electron；AI 只保留 Request 生成确需的 resource oracle。

#### D. 合并兼容排列

`global comment`、`legacy global comment`、`multiple orphaned comments relink`：

- 纯 normalization/relink 排列由 CommentSession/compatibility/Bridge Node 拥有；
- AI Electron 保留一个最能覆盖“评论冻结 → Request → finalizer → Review/Version”的代表场景；
- 如果 legacy compatibility 仍在支持窗口且只有 Electron 能证明重启恢复，则保留独立 legacy 场景，不能为了数量合并。

### `tests/e2e/electron/native-dom-electron.spec.mjs`

- 使用公共 app fixture，删除重复启动/停止/seed/wait helper；
- 保留真实 authored DOM、selection、IME、source bytes、autosave、undo/redo、switch/close；
- 只接收从 AI spec 迁来的非 AI 场景及其独有断言；
- 不把 AI finalizer/version review 流程搬进 Native spec；
- 每个迁入场景仍为聚焦 test，避免形成另一个 mega-test。

### `tests/e2e/electron/playwright.ai-smoke.config.mjs`

保持 smoke 的两类风险：

- verified review → accept；
- broad but related candidate 不被错误 scope 阻断。

如果测试标题重命名，grep 与 config test 同步修改。不得用宽泛 regex 意外选择更多场景。

### `tests/ai-smoke-config.test.mjs`

- 不再通过 regex 检查 teardown 实现字符串；改为导入/执行 fixture 的可测试 cleanup 行为，或在专门 helper test 中模拟 close event 顺序；
- 继续断言 smoke 只精确选择两条标题；
- 保持“process board 必须等待 control”行为由真实 E2E 断言，不扫描源代码。

如果 helper 无法在 Node 中安全测试，不新增生产接口；保留一条最小显式 fixture contract，并在风险中说明。

### 可选新增 `tests/electron-app-fixture.test.mjs`

仅在公共 fixture 含非平凡 teardown/state logic 时新增，使用 fake child/event emitter 验证：

- close event 先于 cleanup；
- stop 幂等；
- SIGTERM 超时后的有界 fallback；
- 一个 test 的日志/路径不泄露到另一个 test。

### `tests/test-impact-map.json`

- helper 变化同时选择 Native Electron 与 AI smoke；
- AI spec/config 变化只选择 AI smoke；
- Native spec 变化选择 Electron smoke；
- 不重新引入所有 Desktop Node 测试。

### `tests/test-gate-selection.test.mjs`

增加 helper、AI config、Native spec 的精确 suite 选择回归；保持 PR1 七案和 release lane。

### `tests/TEST_STRATEGY.md`

记录：

- 公共 Electron fixture 只拥有 lifecycle，不拥有产品 assertion；
- AI/Native 场景最终 ownership；
- 完整 AI 保留的跨进程列表；
- geometry 表驱动仍必须逐 case 有独立期望。

## 边界条件

必须保持：

- workers=1、retries=0、现有 timeout 预算；
- hidden/non-activating Electron 默认行为；
- official finalizer，不伪造 completion metadata；
- 每 test 独立 workspace/source/userData；
- close event 后才删除 Bridge-owned 文件；
- AI protocol/identity/path/hash/full HTML/no-change/cancel/unknown outcome；
- Review 静态优先、runtime evidence 可丢弃、accept 前不激活；
- Native selection、IME、disk bytes、undo/redo、switch/close；
- smoke 精确两场景，完整 suite 仍运行全部保留场景。

明确不做：

- 不改产品代码、Bridge route、finalizer 或 schema；
- 不删唯一跨进程/几何/磁盘 oracle；
- 不通过增加 retry、timeout、sleep 或 skip 稳定；
- 不让公共 fixture 自动重跑文件选择或整个 test；
- 不把测试逻辑藏入没有断言可读性的通用 DSL；
- 不修改 GitHub workflow 或 Electron job 拆分。

## 验收标准

### 静态与 fixture

```bash
node --test tests/ai-smoke-config.test.mjs tests/test-gate-selection.test.mjs
```

若新增 fixture Node test，一并运行。预期：smoke 精确两场景；cleanup 顺序和隔离通过。

### Native Electron

```bash
npm run test:electron:full
```

预期：全部 Native 场景通过，零 retry；迁入 update/switch/close 场景由真实 DOM/磁盘 oracle 判断。

### AI Electron

```bash
npm run test:ai-closed-loop:smoke
npm run test:ai-closed-loop
```

预期：smoke 两场景通过；完整保留场景全部通过；首个完整链的 change 数量、geometry、runtime supplemental、accept 后磁盘/Version 与基线一致。

### 任务门禁

```bash
npm run gate:edit
npm run task:finish
```

### 关键回归

- Electron launch 失败时日志可诊断且临时目录不提前删除；
- verified result 未 accept 前磁盘未改变；
- broad related candidate 仍 ready；
- missing finalizer/malformed HTML/activation failure 均 fail closed；
- cancel/restart 阻止 late completion；
- Project A/B 隔离；
- overlay/mask、Tab/scroll、runtime failure 的唯一 geometry oracle仍在；
- native dirty switch/close 保存最后编辑；
- test 顺序颠倒或单独运行不依赖前一 test 状态。

### 量化

- 每个原 21 AI 场景有保留/迁移/合并证据；
- helper 重复只保留一份；
- 净测试 LOC 目标 1,500–2,200；低于目标时列出不可删除的唯一 geometry/cross-process oracle。

## 停止条件

出现以下任一情况立即停止：

- PR1 未合并或 PR2 同时修改同一 E2E 场景；
- 某 geometry/runtime/identity 场景没有其他独立 oracle；
- 公共 fixture 需要共享 module-global state；
- 单测只有依赖执行顺序才能通过；
- cleanup 只能在 app 关闭前删除目录；
- 需要修改产品或 finalizer 才能抽 fixture；
- 移动场景导致 Native/AI ownership 不清；
- 只能增加 timeout/retry/sleep 通过；
- smoke grep 无法保持精确两场景；
- 完整 AI 用例数减少但迁移表无法指出等价 owner。

停止报告必须附原测试名、唯一跨层 oracle、拟迁移 owner、失败日志和最小保留方案。

## 未决风险

- 第一个 AI 大例包含大量正式 geometry 合同，1,500–2,200 行净减少未被预先证明；表驱动可能只减少样板而不能删行为。
- 两个 spec 的 launch helper 参数和 timeout 不完全相同，共享实现可能需要显式 profile，而不能强行统一默认值。
- update About 是否需要真实 Electron UI oracle需在现有 application-update/preload 测试上确认。
- legacy global comment 是否仍在兼容窗口取决于 PR #133 最终状态。
- E2E LOC 降低不必然降低运行时间；本 PR 的主要收益是可读性、隔离和 owner 清晰。
