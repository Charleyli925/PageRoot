# PR3：将剩余跨 owner 源码合同收敛到真实 owner

> 建议分支：`test/owner-contract-convergence`
> 批次：第三批，推荐最后执行和合并
> 严格前置：PR2 已合并；最终结算前同步已合并的 PR4/PR5/PR6
> 单一结果：源码字符串只保留显式 architecture/security/packaging boundary，业务正确性由 Session、算法、Browser 或 Electron owner 证明
> 预估净减少：1,300–1,800 行测试代码；估算不是删除授权

## 背景和目标

PR2 先移除 UI、通知、评论和画布交互层的大量实现形状断言。本 PR 再处理剩余四类跨 owner 合同：native command queue、Workbench source fence、AI review workspace 和 rendered HTML architecture scan。

这些文件不是简单的重复：其中可能包含唯一的 generation/lease、source freeze、review bootstrap 隔离或 package/server-render 边界。因此本 PR 必须先建立“旧断言 → 真实 owner → 新 oracle”迁移矩阵，只删除已有等价行为证明的部分。

目标状态：

- `tests/source-architecture-fixture.mjs` 无消费者后删除；
- 业务正确性测试不再读取并拼接 `app/workbench.tsx` 和 Canvas 大文件；
- 必须依赖源码形状的少量显式 architecture boundary 统一由 `scripts/check-architecture.mjs` + `tests/architecture-boundaries.test.mjs` 拥有；
- Server render 仍有真实 `worker.fetch` oracle；Review bootstrap 仍实际执行，不降级成字符串存在性。

## 事实与根因

### 1. 当前文件规模

| 文件 | 行数 | regex 断言数 | 当前职责混合 |
| --- | ---: | ---: | --- |
| `tests/native-command-queue-contract.test.mjs` | 566 | 48 | Canvas queue/lease、Workbench drawer、project/external/close FIFO |
| `tests/workbench-source-fence-contract.test.mjs` | 318 | 31 | freeze、autosave ack、recovery、version、project、history |
| `tests/ai-review-workspace.test.mjs` | 533 | 390 | handoff UI、review state/CSS、diff、scroll、runtime、bootstrap |
| `tests/rendered-html.test.mjs` | 515 | 122 | 真实 server render + v3 architecture source scan |
| `tests/source-architecture-fixture.mjs` | 44 | — | 读取并拼接多个大实现文件 |

五个文件合计 1,976 行。它们直接或间接读取多个生产文件并以 `section(...)`、`assertOrdered(...)`、regex 验证内部实现顺序。

### 2. 已存在 owner

- `DocumentSession`、`DraftSession`、`DrainCoordinator`、`ProjectSession`、`RunSession`、`SourceHistorySession`、`VersionSession` 已有各自 Node 测试。
- `IslandEditingController`、native edit generation/lease 和真实 authored DOM 输入已有 Node/Browser/Native Electron 测试。
- Review text diff、semantic alignment、projection facts、runtime hosts/contract、scroll sync 已有独立 Node owner。
- AI review/accept、finalizer、版本激活、失败关闭已有正式 Electron 闭环。
- `scripts/check-architecture.mjs::architectureViolations` 已集中检查 retired modules、raw Bridge、storage、层级 imports、SourceTransaction、Session owner 和 drain boundary；`tests/architecture-boundaries.test.mjs` 只需断言结果为空。
- `tests/rendered-html.test.mjs::render` 已真实 import `dist/server/index.js` 并调用 `worker.fetch`，这是应保留的独立 server-render oracle。

### 3. 根因调用链

```text
Session/Controller 已有公开行为
  + Workbench/Canvas 仍是大型 orchestration 文件
  -> 测试直接扫描实现顺序以“补保险”
  -> owner 重构时正则大面积失败
  -> 同一行为继续由 Session/Browser/Electron 重复证明
```

正确收敛不是删除所有源码字符串，而是只保留“某层绝不能 import/出现/拥有某能力”这类显式架构边界。

## 修改清单

### `tests/native-command-queue-contract.test.mjs`

逐场景分三类处理：

#### 迁到 controller/行为 owner

- latest-wins、user-explicit 高于 system、discard reason、queued replay；
- canonical replacement 前 lease retirement；
- source fence 后 generation 失效；
- composition 与 source revision 的 hard boundary。

优先 owner：现有 native controller/session Node 测试和 Native Electron。使用可观察的 command outcome、generation、lease、DOM identity、source bytes、selection，不读取函数体文本。

#### 迁到 Workbench Session/桌面 owner

- manual version open success/failure/discard；
- background project result 不进入当前 Canvas；
- refresh/project switch awaiter settle；
- external HTML acceptance；
- close 等待 acceptance/application owner；
- renderer FIFO publication。

优先 owner：ProjectApplicationSession、ExternalFileOpenSession、DrainCoordinator、VersionSession、Native Electron project switch/close。

#### 允许暂时保留的最小显式边界

如果现有公共行为无法证明“旧 lease 在 DOM replacement 前已退休”或“user command 不被 system command 覆盖”，可保留一个聚焦测试，但必须：

- 只读取单一 owner 文件，不使用 `source-architecture-fixture`；
- 测试名明确标为 architecture boundary；
- 不包含 UI copy、CSS 或其他 Session 行为；
- 在未决风险中登记未来可替代接口，而不是新增测试专用生产 API。

### `tests/workbench-source-fence-contract.test.mjs`

逐项迁移：

| 当前合同 | 新 owner |
| --- | --- |
| autosave byte-identical ack、revision、protocol error | `DocumentSession`/Bridge integration |
| recovery identity mismatch | recovery/document session + Native Electron failure path |
| beforeunload pending native edit/revision | DrainCoordinator + Native Electron close |
| committed version adoption | VersionSession + AI/Native Electron |
| project hydration token/context | ProjectSession/ProjectApplicationSession |
| stale canvas generation/bounded rebuild | Canvas/Native Electron |
| safe-save render acknowledgement | DocumentSession + Browser/Native Electron |
| source undo tuple/lease | SourceHistorySession + Native Electron |

若 `fenceAndFreezeCurrentCanvas` 的 exact frozen HTML/hash、fail-closed 和调用顺序没有其他 owner，可保留一个最小源码 architecture test，只覆盖该边界，不覆盖后续业务流程。

### `tests/ai-review-workspace.test.mjs`

目标：保留真正执行代码的 bootstrap/isolation 测试；移除 CSS/JSX/copy/internal callback 扫描。

- `generatedReviewBootstrap` 继续在 `vm` 或真实 DOM 中执行，验证作者页面看不到私有 comment/runtime identity、不能伪造 channel，且 bootstrap 输出稳定。
- diff、semantic、projection、runtime host、scroll sync 的纯行为迁到其现有 Node owner，不在此文件重复 regex。
- review 页面、filter、page mode、navigation、accept/return/focus/overlay 由 AI Electron 观察真实 UI。
- runtime capture request/envelope/late failure 由 runtime owner Node + AI Electron。
- 文案和 CSS 数值只有在可访问性或安全隔离上有行为意义时才由 Browser/Electron 保留；普通 layout shape 删除。

如果 PR #133 已修改 compatibility surface，先以其合并结果重新列出测试名；禁止恢复已退休 alias 只为保留旧断言。

### `tests/rendered-html.test.mjs`

保留：

- `render()` 对真实 `dist/server/index.js` 的 import；
- `/` 返回 200、HTML content-type、关键公开入口和资源存在；
- 服务端输出不包含已退休托管/编辑器依赖的必要 product/package boundary。

迁走或删除：

- Document/Draft/Drain/Run/Version 内部字段和方法名；
- Workbench/Canvas callback 顺序；
- 与 `check-architecture`、package test、Session test 重复的 retired symbol 扫描；
- history card/TargetRef/SourcePatch 的实现字符串。

该文件仍需 `build-web` 前置，不能因缩小文件而取消。

### `scripts/check-architecture.mjs`

作为源码形状断言的唯一 architecture owner：

- 保留所有当前层级 import、retired module/operation、raw fetch/Bridge/storage、SourceTransaction 和 Session ownership 检查；
- 仅吸收从上述测试迁来的、确实属于“禁止依赖/唯一 owner/必须 delegate”的规则；
- 每条新规则输出文件和可操作原因；
- 不吸收 UI copy、CSS、回调微观顺序或完整业务流程；
- 不创建正则来复制已经由 Session 行为证明的状态机。

如果一个边界需要解析 AST 才能可靠表达，不在本 PR 引入新 parser；保留最小现有测试并停止汇报后续建议。

### `tests/architecture-boundaries.test.mjs`

继续只调用 `architectureViolations()` 并断言空列表。若需要覆盖 checker 自身的负例，使用临时/纯函数输入的最小单元测试；不得复制全仓 source scan。

### `tests/source-architecture-fixture.mjs`

当 `rg` 确认无消费者后删除。若仍有 PR2 未迁移消费者，说明前置未完成，停止而不是强删。

### Session/算法 owner 测试

按迁移矩阵只补缺失的 observable oracle，候选文件包括：

- `tests/document-session.test.mjs`
- `tests/drain-coordinator.test.mjs`
- `tests/project-application-session.test.mjs`
- `tests/external-file-open-session.test.mjs`
- `tests/source-history-session.test.mjs`
- `tests/version-session.test.mjs`
- `tests/review-*.test.mjs`
- 现有 native controller/session 测试

只在旧测试确有独有行为时新增；不要为了保持测试数量一比一复制。

### `scripts/test-node-group.mjs`

删除已移除 contract 文件引用；保留顶层测试恰好属于一个组的约束。

### `tests/test-impact-map.json`

- 删除已移除文件引用；
- architecture checker 变化映射到 `architecture-boundaries.test.mjs`；
- owner 文件变化映射到对应 Session/算法测试；
- `rendered-html.test.mjs` 变化仍触发 `build-web`。

### `tests/test-gate-selection.test.mjs`

更新 group/ownership 精确断言，保持 PR1 七案例阈值和 release lane 不变。

### `tests/TEST_STRATEGY.md` 与 `docs/ENGINEERING_STANDARDS.md`

- `TEST_STRATEGY` 写清剩余 source-string test 的允许清单和 owner。
- 仅当现有 Engineering Standards 不足以表达最终规则时修改；不得重复相同条文。

## 边界条件

必须保持：

- native command user/system priority、latest-wins、discard、generation 和 lease safety；
- composition、source revision、project switch、close 的 drain/fence；
- frozen HTML/hash 与 disk/source authority 一致；
- AI candidate 未 accept 前不激活，bootstrap/private identity 隔离；
- Review diff/scroll/runtime 的已有独立算法和跨进程 oracle；
- server render 真实构建产物和公开入口；
- architecture checker 当前全部硬边界；
- `rendered-html.test.mjs` 的 build prerequisite。

明确不做：

- 不改生产行为、owner、协议或 Workbench 拆分；
- 不新增测试专用 export、data attribute 或 Bridge route；
- 不删除 security/package/dependency/architecture 必要 source scan；
- 不把所有合同合并为一个更大的 `check-architecture` regex 文件；
- 不处理 PR4 的 E2E 场景去重、PR5 的 Bridge harness、PR6 的 package contract。

## 验收标准

### 静态与聚焦 Node

```bash
rg -n "source-architecture-fixture|readCanvasArchitecture|readWorkbenchArchitecture" tests
npm run architecture:check
node --test \
  tests/architecture-boundaries.test.mjs \
  tests/document-session.test.mjs \
  tests/drain-coordinator.test.mjs \
  tests/project-application-session.test.mjs \
  tests/external-file-open-session.test.mjs \
  tests/source-history-session.test.mjs \
  tests/version-session.test.mjs \
  tests/ai-review-workspace.test.mjs \
  tests/rendered-html.test.mjs \
  tests/test-gate-selection.test.mjs
```

如果某目标文件已按计划删除，从命令移除并以 `rg` 无残余引用为准。`rendered-html` 运行前必须先：

```bash
npm run build
```

### Browser/Electron

```bash
npm run test:browser:full
npm run test:electron:smoke
npm run test:ai-closed-loop:smoke
```

若迁移涉及 project switch/close、source undo 或完整 Review geometry，运行完整 owner：

```bash
npm run test:electron:full
npm run test:ai-closed-loop
```

### 任务门禁

```bash
npm run gate:edit
npm run task:finish
```

预期：全部通过；release suite 不变；PR1 七案不高于 56。

### 迁移与量化

- 每个旧 test 名都有迁移表；
- `source-architecture-fixture.mjs` 删除或只剩有明确停止报告的唯一消费者；
- 业务测试不再读取拼接后的 Workbench/Canvas 源码；
- 净测试 LOC 目标 1,300–1,800；未达到时报告保留的唯一边界，不追删。

## 停止条件

出现以下任一情况立即停止：

- PR2 未完成，source fixture 仍有 UI consumer；
- 某 source-order 断言是唯一 generation/lease/freeze oracle；
- 必须新增生产 export 或改变 owner 才能建立行为测试；
- 最新 `check-architecture` 已有其他 PR 同时修改；
- 将断言移入 checker 后仍只是业务 callback 顺序，而非架构边界；
- 完整 AI/Native Electron 暴露旧测试确有独有回归；
- `rendered-html` 无法在保持真实 server render 的情况下缩小；
- 需要扩大到 PR4/PR5/PR6 的文件才能完成。

停止报告必须给出具体旧断言、它保护的故障、现有 owner 缺口、建议保留的最小合同和新增生产接口为何不在本 PR 授权内。

## 未决风险

- native queue 的微观顺序可能是浏览器事件重入安全边界，未必都能由高层结果稳定覆盖。
- `check-architecture.mjs` 自身使用字符串检查；集中 ownership 会降低散落，但不会自动提高 parser 精度。
- Review bootstrap 的 `vm` 环境不等于 Chromium isolated world；必须保留 AI Electron/owner 测试，不能把 vm 当最终安全证明。
- `rendered-html` 同时承担真实 SSR 和历史 architecture 清理，拆除 source scan 时可能暴露缺失的 package/Session owner。
- 1,300–1,800 行是估算；保留唯一边界后低于目标是允许结果。
