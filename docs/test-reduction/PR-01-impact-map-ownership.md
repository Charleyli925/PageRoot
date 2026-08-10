# PR1：收窄测试影响映射并建立所有权基线

> 建议分支：`test/impact-map-ownership`
> 批次：第一批，必须先完成
> 严格前置：PR #133 已合并或明确关闭；执行分支已基于结算后的最新 `origin/main`
> 单一结果：日常改动只运行直接 owner 的测试，完整 release 门禁不变
> 生产代码修改：禁止

## 背景和目标

当前影响选择算法会把同一文件命中的所有规则做并集。算法本身是确定且合理的，但 `tests/test-impact-map.json` 中几条规则把整类 Session、Workbench 子模块和全部 Desktop 文件打成一个 ownership 桶，导致局部改动被放大为大量无关 Node 测试和 Browser/Electron/AI 冒烟。

本 PR 只修正“哪些改动归哪个测试 owner”，不删除测试、不改变测试语义、不改门禁算法。完成后建立后续 PR2–PR6 的稳定选择基线。

量化目标：

- 七个代表文件的 Node 选择数合计从当前 113 降到不高于 56；
- `release` lane 的完整 suite 列表逐项不变；
- 任何无法精确映射的代码仍进入现有 `node-core` fallback；
- 本 PR 测试 LOC 可小幅增加，因为它新增的是选择器回归 oracle。

## 事实与根因

### 1. 调用链

当前调用链为：

```text
npm run gate:edit / gate:task
  -> scripts/test-gate.mjs::changedFiles(base)
  -> validateImpactMap(JSON)
  -> scripts/test-gate-core.mjs::selectGatePlan(...)
  -> 对每个 changed file 遍历全部 rules
  -> 命中规则的 nodeTests 和 suites 全部做 Set 并集
  -> expandPrerequisites(...)
  -> scripts/test-gate.mjs::commandForSuite(...)
  -> node --test / build / Playwright
```

关键证据：

- `scripts/test-gate.mjs::changedFiles` 同时读取 base diff、unstaged、staged 和 untracked 文件。
- `scripts/test-gate-core.mjs::selectGatePlan` 在遍历规则时，将每个命中规则的 `nodeTests` 加入同一个 `Set`，并将允许的 suite 一并加入计划。
- `selectedNodeTests` 为空且出现未映射代码时，现有 fallback 才选择 `node-core`；精确规则收窄不会制造“零测试通过”。
- `commandForSuite("node-targeted")` 直接执行计划中的精确文件列表；没有隐藏的二次扩张。

结论：根因是 map 的 ownership 粒度，不是 `selectGatePlan` 的并集算法。

### 2. 过宽规则

当前基线的关键规则：

| 规则 | 当前匹配面 | 当前问题 |
| --- | --- | --- |
| `state-architecture` | 17 类 application 模块、多个 domain/shared/scripts、25 个 Node 测试 | 改 `CommentSession` 也运行 Draft、Project、Run、Version、History 等全部测试 |
| `workbench-lifecycle` | `app/workbench.tsx` 及 `app/workbench/**`、评论布局和多个合同测试 | 任一 Workbench 子模块都被当作整个 Workbench 生命周期变化 |
| `ai-review-workspace` | Review 算法、UI、runtime owner、文档和 AI E2E | 一个 review 文件同时选中算法、桌面包、preload、protocol 和全部 Review 测试 |
| `web-ui` | 所有 `app/components/**` | `NoticeBar.tsx` 也运行 Canvas、Workbench shell 等无关合同 |
| `desktop-runtime` | `desktop/**` 全部文件 | 更新控制器、文件操作、Preview、runtime capture 互相放大 |
| `comment-rail-layout` | 评论布局本身 | 又被 `workbench-lifecycle` 重复命中，额外引入 Electron 和 AI smoke |

### 3. 代表性实测

在 `origin/main@4e7e63c9` 上，用 `selectGatePlan({ lane: "task" })` 单文件测得：

| 文件 | Node 数 | 非 Node suite |
| --- | ---: | --- |
| `app/lib/comment-rail-layout.js` | 9 | typecheck、lint、Browser、Electron、AI |
| `app/workbench/review-document.ts` | 23 | typecheck、lint、Browser、Electron、AI |
| `app/components/NoticeBar.tsx` | 4 | typecheck、lint、Browser |
| `app/application/comment-session.js` | 25 | typecheck、lint |
| `desktop/application-update.mjs` | 16 | typecheck、lint、Electron |
| `desktop/runtime-visual-capture-owner.mjs` | 26 | typecheck、lint、Electron、AI |
| `scripts/workspace-bridge.mjs` | 10 | typecheck、lint、Electron build、AI |
| **合计** | **113** | — |

这些数字是执行前基线。PR #133 会修改 `tests/test-impact-map.json` 及 Review 相关测试，所以在它结算前不能开始本 PR。

### 4. 完整门禁已有独立固定合同

`tests/test-gate-selection.test.mjs` 当前明确断言 `release` lane 包含：

```text
typecheck
lint
dependency-audit
build-web
node-full
browser-full
real-html
build-desktop
electron-full
ai-closed-loop
```

因此，收窄 edit/task ownership 不需要也不得修改 release 范围。

## 修改清单

### `tests/test-impact-map.json`

按 owner 拆分规则。建议使用以下规则族；实际正则必须按结算后文件名重新核对。

#### A. 拆分 `state-architecture`

将一个 25 测试的桶拆为至少以下 owner：

| 新规则 | 主要生产路径 | 直接 Node owner |
| --- | --- | --- |
| `comment-session` | `app/application/comment-session.*` | `tests/comment-session.test.mjs` |
| `document-session` | `app/application/document-session.*`、`recovery-store.*` | `tests/document-session.test.mjs`、`tests/recovery-store.test.mjs` |
| `draft-session` | `draft-session`、`draft-service`、`draft-aggregate`、decoder/shared aggregate | Draft 的 Session、service、aggregate 测试 |
| `project-session` | project session/application/query/rules、external-file-open、local outcomes、project-open queue | 对应 Project/External/Outcome 测试，不带 Run/Version |
| `run-session` | `run-session`、`run-lifecycle` | `tests/run-session.test.mjs`、`tests/run-lifecycle.test.mjs` |
| `version-session` | `version-session`、version model/compatibility decoder | `tests/version-session.test.mjs`、兼容 decoder 测试 |
| `source-history` | source-history domain/session/service/transaction | history、history-session；事务集成只在事务实现变化时加入 |
| `runtime-capabilities` | capability manifest | `tests/runtime-capabilities.test.mjs` |
| `architecture-contract` | `check-architecture`、架构规范和 ADR | `tests/architecture-boundaries.test.mjs`，必要时兼容测试 |

要求：一个生产文件只映射到它直接实现或调用的 owner；不得为了“保险”重新把所有 Session 放进每条规则。

#### B. 收窄 Workbench 规则

- 将 `^app/workbench(?:\.tsx|/.*)$` 拆开：
  - `app/workbench.tsx` 可保留较宽的 orchestration coverage；
  - `app/workbench/review-document.ts`、`AiReviewWorkspace.tsx`、`review-state.ts`、handoff/presentation 等子模块分别进入自己的规则。
- 从 `workbench-lifecycle` 移除 `app/lib/comment-rail-layout.js`；评论布局只由 layout Node + Browser 行为 owner 负责。
- 不因为 `tests/source-architecture-fixture.mjs` 被读取，就把所有 Workbench 子模块映射到所有源码字符串测试；后续 PR2/PR3 会删除这类耦合。

#### C. 拆分 Review 规则

至少区分：

- Review 文档分析/投影：text diff、semantic alignment、projection facts、comment source map；
- Review runtime capture：runtime hosts、runtime visual contract、capture adapter、desktop owner；
- Review UI/state：`AiReviewWorkspace`、review state、scroll sync；
- AI 端到端配置/spec 自身。

`desktop-package.test.mjs`、`desktop-preload-ipc.test.mjs` 和 `preview-protocol.test.mjs` 只能在对应 package/preload/protocol 或 runtime IPC 文件变化时加入，不得由每个 Review 算法文件统一触发。

#### D. 拆分 Desktop 规则

用直接职责替代 `^desktop/.*`：

| 新规则 | 示例路径 | 直接 owner |
| --- | --- | --- |
| `desktop-update` | `desktop/application-update.mjs` | application-update；涉及 IPC 时再加入 preload contract |
| `desktop-project-files` | project files、rename、export、external open、project queue | 对应文件/队列/安全测试 |
| `desktop-preview` | preview protocol/window policy | preview-protocol、window-policy |
| `desktop-runtime-capture` | runtime visual capture owner | capture owner、runtime contract、必要的 AI smoke |
| `desktop-lifecycle` | bridge startup/shutdown、close recovery | startup/shutdown/close tests |
| `desktop-main-preload` | `desktop/main.mjs`、`desktop/preload.mjs` | IPC、window、package contract；允许较宽但必须显式 |

Desktop 生产文件仍可选择 `electron-smoke`；本 PR 的核心目标是删除无关 Node 扇出，不以取消真实桌面冒烟换速度。

#### E. 增加组件级 Web 规则

- 为 `NoticeBar.tsx`/`NoticeBar.module.css` 建 notification UI 规则，暂时选择 notification policy、notification UI 和 Browser notification recovery，不选择 Workbench shell。
- 通用 `web-ui` 仅作为没有更精确组件规则时的 fallback；精确规则命中后仍会与通用规则并集，因此必须从通用规则正则中排除已有专属 owner，或将通用规则改为列举真正共享的组件。

### `tests/test-gate-selection.test.mjs`

新增表驱动的 ownership 回归：

1. 对上述七个代表文件分别断言精确 `selectedNodeTests` 和精确 suite；
2. 对每个案例断言必须包含 direct owner、不得包含明确无关 owner；
3. 对七案 Node 数求和并断言 `<= 56`；
4. 保留并加强 release/artifact/main/developer/candidate lane 的既有逐项断言；
5. 新增一例未映射代码仍进入 `node-core` fallback；
6. 新增一例同一文件命中两个真实 owner 时会安全取并集，证明没有修改核心算法；
7. `Node groups partition every top-level test exactly once` 继续通过。

代表路径的单案上限：

| 路径 | Node 上限 | 必须保留的非 Node owner |
| --- | ---: | --- |
| comment rail | 2 | Browser smoke |
| review document | 12 | AI smoke；若 Browser/Native 有直接依赖需写明理由 |
| NoticeBar | 2 | Browser smoke |
| CommentSession | 3 | 无 Browser/Electron/AI |
| application update | 4 | Electron smoke |
| runtime capture owner | 15 | Electron + AI smoke |
| workspace bridge | 10 | AI smoke |

精确列表以直接 imports、调用链和现有 owner 测试为准；不得只写数量断言掩盖错误选择。

### `tests/TEST_STRATEGY.md`

补充：

- edit/task 影响映射按 owner 规则拆分；
- 一个文件命中多个真实 owner 时取并集；
- release 全量门禁不受影响；
- 新增或移动测试时必须更新 exact ownership；
- 禁止用宽泛目录正则替代 ownership 设计。

### `docs/DEVELOPMENT.md`

在 test lanes 部分补充如何查看 `output/test-runs/*/selection.json`，以及修改 impact map 后必须运行 `tests/test-gate-selection.test.mjs`。

### 明确不修改

- `scripts/test-gate-core.mjs`
- `scripts/test-gate.mjs`
- `scripts/test-node-group.mjs`
- 任何生产代码或 GitHub workflow

如果当前 map 无法在不改算法的情况下表达合理 ownership，触发停止条件，先汇报所缺的 map 能力及最小 schema 设计，不在本 PR 顺手改 gate core。

## 边界条件

必须保持：

- changed-files 仍覆盖 base、staged、unstaged、untracked；
- top-level Node 测试文件变化时仍运行自身；
- `rendered-html.test.mjs` 仍先构建 Web；
- suite prerequisite 顺序和 fast-failure 排序不变；
- 未映射代码仍 fallback 到 `node-core`；
- release/artifact/candidate/developer/main lane 的固定合同不变；
- 任何 suite 仍必须无人值守。

明确不做：

- 不删除、改写或迁移测试内容；
- 不减少 release full suite；
- 不移除 Desktop 代码的必要 Electron smoke；
- 不把“当前经常一起修改”当作同一 owner 的证据；
- 不因目标是 50% 就删掉直接依赖测试。

## 验收标准

### 聚焦命令

```bash
node --test tests/test-gate-selection.test.mjs
npm run architecture:check
npm run typecheck
```

预期：全部通过；七案合计不高于 56；release suite 精确列表不变。

### 选择计划人工复核

用 Node 脚本直接调用 `selectGatePlan`，打印七个路径的 `selectedNodeTests`、suite 和 reason。预期：

- 每个测试都能解释为直接 owner；
- comment rail 不再触发 Electron/AI；
- CommentSession 不再触发 Draft/Project/Run/Version 全家桶；
- update controller 不再触发 runtime capture、file writer 等无关测试；
- runtime capture 不再触发 application update、rename、export 等无关测试；
- Workbench review 子模块不再自动进入 shell/comment/notification 合同。

### 任务门禁

```bash
npm run gate:edit
npm run task:finish
```

预期：通过；`selection.json` 只包含本 PR 文档和 impact-map 所需测试，不出现完整 release lane。

### 关键回归场景

- 修改一个 top-level Node test：只运行自身；
- 修改 `tests/rendered-html.test.mjs`：先 `build-web` 再 targeted Node；
- 修改未映射 `.ts`：进入 `node-core` fallback；
- 修改 AI E2E spec：仍选择 AI smoke config contract；
- release plan：完整十项 suite 不变；
- Node groups：每个顶层测试仍恰好属于一个非-full 组。

## 停止条件

出现以下任一情况立即停止：

- PR #133 未结算，或其最终 diff 与本文规则重叠；
- 最新 `main` 已修改 map schema、lane 或 gate core 语义；
- 某代表路径没有现有 direct owner，收窄后只能零测试；
- 需要修改 `selectGatePlan` 才能表达排除/优先级；
- 收窄会取消一个当前唯一 Electron/AI oracle；
- release suite 或 suite prerequisite 必须改变；
- 七案 <=56 只能通过删除 direct owner 达到；
- 新开放 PR 同时修改 `tests/test-impact-map.json` 的相同规则族。

停止报告必须列出：当前 base SHA、冲突文件/规则、现有选择、新建议选择、缺失 owner，以及是否需要单独 gate-schema PR。

## 未决风险

- 七个代表文件是抽样，不代表真实一个月改动分布；50% 是静态选择目标，合并后应结合 CI Health 再验证。
- `app/workbench.tsx` 仍是大型 orchestration 文件，它本身发生变化时合理地会选中较宽测试；本 PR 不承诺把该文件变成窄改动。
- `review-document.ts` 直接依赖多个 Review 算法，12 个 Node 上限需要在最新 import graph 上验证，不能预先当成必然可达。
- Desktop 文件之间有 IPC/package 联动；某些文件可能合理保留两个或三个 owner，不能只按文件名拆。
- PR #133 会改变 Review/runtime compatibility 表面，本文列出的当前测试文件可能被移除或改名。
