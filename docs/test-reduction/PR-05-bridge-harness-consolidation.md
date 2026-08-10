# PR5：统一 Bridge 集成测试环境并去除重复生命周期脚手架

> 建议分支：`test/bridge-harness-consolidation`
> 批次：第二批，可与 PR2、PR4、PR6 并行开发
> 严格前置：PR1 已合并，分支基于其后的最新 `origin/main`
> 单一结果：Bridge、Schema、Scope 测试共享隔离且可诊断的测试环境，保留全部事务/协议/失败关闭 oracle
> 预估净减少：1,500–2,000 行测试代码；估算不是删除授权

## 背景和目标

`workspace-bridge.test.mjs`、`schema-contract.test.mjs`、`scope-validator.test.mjs` 合计 7,749 行。三者都需要真实启动 Bridge、选择端口、等待 health、发送 JSON、运行 official finalizer、停止 child 和清理临时目录，但各自重复实现。

生产侧已经通过 `SourceTransaction` 集中 autosave/source-history 的原子提交与恢复。本 PR 不改生产事务；只收敛测试 harness、共用 fixture builder，并将具有相同步骤/不同输入的故障注入改成可读的数据表。

核心原则：去掉脚手架重复，不删除独特协议、磁盘、重启、CAS 或 failpoint oracle。

## 事实与根因

### 1. 关键文件和重复符号

| 文件 | 行数 | 重复 helper |
| --- | ---: | --- |
| `tests/workspace-bridge.test.mjs` | 4,926 | `reservePort`、`requestJson`、`postJson`、`stopChild`、`startBridge`、`runFinalizer` |
| `tests/schema-contract.test.mjs` | 1,346 | `reservePort`、`requestJson`、`postJson`、`stopChild`、`startBridge` |
| `tests/scope-validator.test.mjs` | 1,477 | 同上 + `runFinalizer` |

重复不仅是函数体，还包括：

- 临时 root/workspace/sources 创建；
- synthetic complete HTML 写入；
- `/workspace` → `/project/ensure` 注册；
- Bridge stdout/stderr 累积和 health polling；
- `t.after` 中 child stop + recursive cleanup；
- Request/output/finalizer/status 的标准流程。

### 2. 生产调用链已经集中

当前生产调用链：

```text
scripts/workspace-bridge.mjs::route
  POST /autosave
    -> saveAutosave
    -> commitSourceTransaction({ kind: "autosave", ... })

  POST /source-history/action
    -> runSourceHistoryAction
    -> commitSourceTransaction({ kind: "history", ... })

Bridge restart
  -> recoverPendingSourceTransaction
  -> validate durable candidate/history hashes
  -> settle or fail closed
```

`scripts/source-transaction-service.mjs::commitSourceTransaction` 拥有 prepared transaction、atomic source replacement、source history、audit settle；`recoverPendingSourceTransaction` 拥有 restart recovery。

因此测试不能删除以下独特 oracle：

- expected source Hash/CAS 和 external conflict；
- source commit point 两侧的 crash recovery；
- autosave 与 history 共用的每个 SourceTransaction failpoint；
- audit exactly-once、stable action ID replay；
- runtime pending write、recovery candidate/history hash 校验；
- schema/identity/path/revision/hash drift fail closed；
- scope policy 的 ready/attention/no content-based blocking；
- official finalizer 才能完成 Attempt。

### 3. 根因

每个测试文件为了“独立”复制了进程和 HTTP 生命周期。文件独立没有错，但 helper 未被建模成每次调用全新环境，导致复制比共享更安全。正确修复是建立严格隔离、无共享状态的公共测试环境，而不是共享一个长寿命 Bridge。

## 修改清单

### 新增 `tests/helpers/bridge-test-environment.mjs`

提供窄 API：

```text
createBridgeTestEnvironment(t, options)
  -> root
  -> workspace
  -> sources
  -> baseUrl
  -> logs
  -> createSource(name, html|buffer)
  -> requestJson(path, init)
  -> postJson(path, body)
  -> ensureProject(sourcePath)
  -> stop()
```

必须实现：

- 每次调用独立 `mkdtemp` root、workspace、sources 和随机端口；
- 支持显式 extra environment/failpoint；
- Bridge child stdout/stderr 分开累积；
- bounded health polling，child 提前退出时包含完整日志；
- `stop()` 幂等，SIGTERM 后有界 SIGKILL fallback；
- `t.after` 先 stop child，再删除该次 root；
- HTTP 非 JSON/连接失败时保留 status/text 和 Bridge 日志；
- 可配置 auth token，并默认覆盖实际生产授权路径；
- 不使用 module-global child、port、workspace、request counter。

禁止：

- 一个文件或多个 test 共享同一个 Bridge 进程；
- helper 自动重试 mutation；
- helper 吞掉非 2xx 或替测试决定预期 status；
- cleanup 使用宽泛目录或 unresolved env var。

### 可选新增 `tests/helpers/ai-attempt-fixture.mjs`

只有 `workspace-bridge`、schema、scope 三处都需要相同 official flow 时才新增：

- `submitRequest`
- 写入唯一允许的 `output/index.html`
- `runOfficialFinalizer`
- `readStatus`

它必须接收显式 identity 和 HTML，返回原始响应/路径；不得自动断言 ready，不得写 completion metadata，不得扩展 Attempt output scope。

### `tests/workspace-bridge.test.mjs`

#### A. 替换脚手架

删除本地 port/start/request/stop/finalizer helper，使用公共环境。保持每个顶层 test 一个独立环境。

#### B. 表驱动 SourceTransaction failpoint

对 autosave/history 共用 commit boundary 使用具名表：

| case 字段 | 含义 |
| --- | --- |
| `failpoint` | 注入位置 |
| `operation` | autosave / undo / redo |
| `expectedDisk` | old/new bytes |
| `expectedRuntime` | pending/settled/failed |
| `expectedHistory` | cursor/hash/action state |
| `expectedAuditCount` | exactly once 数量 |
| `restart` | 是否必须重启 Bridge |

不同 commit point 仍是独立 subtest 名和独立期望；不得只断言最终 200。

#### C. 复用 fixture builder

将重复 project/request/comment/attachment/identity 对象改为返回 fresh clone 的 builder。Builder 不得复用被测 normalization/Hash 函数计算期望值；关键 Hash 继续用独立 `crypto` oracle。

#### D. 保留独特场景

以下场景不得因表驱动或文件缩小而删除：

- non-UTF8、旧 schema/legacy directory 拒绝且不 mutation；
- initial registration/document identity/move/replacement；
- auth/CORS；
- autosave/history/CAS/conflict/restart；
- Request/attachment/frozen input/finalizer/completion；
- Version transaction/activation/history tamper；
- draft CAS/rebase/replay/crash window；
- recovery candidate/history tamper；
- archived compatibility normalization；
- output `PROJECT.md` protocol violation。

### `tests/schema-contract.test.mjs`

保留纯 schema/semantic tests 全部独立。真实 Bridge 集成只保留它独有的证明：

- Bridge 生成的完整 lifecycle bundle 每个 artifact 都通过对应 schema；
- bundle identity/lineage/hash/path 语义对齐；
- source 在 AI ready 前不被替换，Version bytes/marker hash 正确；
- activation 后 working path bytes 正确。

使用公共 Bridge/Attempt helper 删除 500 行以后重复的启动和流程样板。若同一成功链已在 workspace Bridge 精确验证，schema test 只读取并校验 artifact bundle，不重复每个 UI/route 细节。

不删除 schema-valid 但 semantic drift、strict union、completion signal、runtime lock、transaction precondition、project active-run authority 等纯负例。

### `tests/scope-validator.test.mjs`

保留所有 `validateScope` 纯函数矩阵：text/attribute/structure/style、exact union、duplicate、supplement、topology/insertion/text ref、ambiguous/orphan/stale selector。

三个真实 lifecycle 场景继续证明：

- target guidance 不阻止 related script/attribute/structure edit；
- unrelated but usable HTML 为 `attention` 且保留 candidate；
- broad page/script edits 不产生旧 scope report 或错误阻断。

使用公共环境和表驱动 candidate cases，删除 port/start/finalizer/cleanup 重复。不能把这三条只降为直接调用 `validateScope`，因为它们验证当前产品已不以 scope validator 阻断 AI candidate。

### 新增 `tests/bridge-test-environment.test.mjs`

只有公共 helper 含非平凡生命周期时新增，至少验证：

- 两个环境端口、root、logs、auth 相互独立；
- child 提前退出包含日志；
- stop 幂等且先退出后清理；
- mutation 不自动重试；
- 一个环境 cleanup 不影响另一个。

使用 synthetic temp paths，不接触真实 workspace。

### `scripts/test-node-group.mjs`

- 新 helper test 按性质归 integration 或 core；
- 原三个顶层测试仍恰好属于一个非-full group；
- 不把所有 Bridge 集成塞入 smoke。当前 smoke 中的 scope-validator 是否保留，按最新 TEST_STRATEGY 复核；如要改变属于门禁策略扩大，先停止汇报。

### `tests/test-impact-map.json`

- helper 变化选择 workspace/schema/scope 和 helper 自测；
- `workspace-bridge.mjs` 继续选择关键 Bridge integration 和 AI smoke；
- schemas 变化继续选择 schema、scope、workspace 的必要 integration；
- 不恢复 PR1 已拆分的全局 state/desktop 规则。

### `tests/test-gate-selection.test.mjs`

新增 helper/schema/scope/workspace 的精确 ownership 断言；保持 PR1 七案总和和 release lane。

### `tests/TEST_STRATEGY.md`

记录：

- Bridge 环境每 test 隔离；
- pure schema/scope 与真实 lifecycle 集成的职责分界；
- SourceTransaction failpoint 表仍逐 case 有独立 disk/runtime/history/audit oracle；
- helper 不重试 mutation。

## 边界条件

必须保持：

- source bytes、Hash、CAS、atomic replace、external conflict；
- autosave/history 所有 failpoint 和 restart recovery；
- pending write、recovery file/history hash、audit exactly-once；
- stable operation/action replay；
- draft monotonic CAS 和单写 crash window；
- schema strictness 与 semantic bundle validation；
- AI ready/attention/no-change/finalizer/activation；
- scope 已从硬 blocking 变为 review guidance 的现有产品合同；
- auth、CORS、path/identity/schema fail closed；
- 每 test 独立目录和进程。

明确不做：

- 不改 `scripts/workspace-bridge.mjs`、`source-transaction-service.mjs`、schema 或 product protocol；
- 不合并不同 commit point 的预期；
- 不用被测实现计算预期 Hash/normalization；
- 不共享长寿命 Bridge；
- 不增加 retry/timeout 掩盖竞态；
- 不删除 compatibility decoder 或改变支持窗口；
- 不把真实 integration 全部替换成 pure unit。

## 验收标准

### helper 和聚焦测试

```bash
node --test \
  tests/bridge-test-environment.test.mjs \
  tests/schema-contract.test.mjs \
  tests/scope-validator.test.mjs \
  tests/workspace-bridge.test.mjs \
  tests/test-gate-selection.test.mjs
```

若没有新增 helper test，从命令移除。预期：全部通过，无真实路径/用户数据。

### 集成组

```bash
npm run build
npm run test:node:integration:prepared
```

预期：集成组全部通过；任一失败输出对应 test 的独立 Bridge stdout/stderr 和 root 信息。

### 顺序与隔离检查

至少执行：

- 三个目标文件分别单独运行；
- 三者同一 `node --test` 运行；
- 如 Node runner 支持，改变文件顺序或启用其默认文件并发。

预期：无端口冲突、无共享 workspace、无顺序依赖。

### 任务门禁

```bash
npm run gate:edit
npm run task:finish
```

### 关键回归

- autosave commit point 前后；
- history undo/redo 每个相同 failpoint；
- external conflict keep/adopt；
- restart 后 source/history/runtime/audit 一致；
- schema-valid 但 identity/hash/path drift 拒绝；
- related/broad candidate ready、unrelated candidate attention；
- missing finalizer、tampered artifacts、PROJECT.md 均拒绝；
- auth token 和 CORS preflight。

### 量化

- 三份重复 helper 只保留公共实现；
- 每个 failpoint 在迁移表中有相同或更强 oracle；
- 净测试 LOC 目标 1,500–2,000；低于目标时保留唯一 integration，不继续删协议测试。

## 停止条件

出现以下任一情况立即停止：

- PR1 未合并，或 PR #133/新 PR 修改 Bridge/schema/scope 相同边界；
- 三个 startBridge 实现有实质不同的安全/环境语义，无法用显式 option 表达；
- 公共 helper 必须共享进程或 workspace 才能工作；
- 表驱动后无法区分 commit point 或失败日志；
- 某 integration 是唯一 schema/scope/product policy oracle；
- 必须修改 production route/schema/finalizer；
- 只能增加 timeout/retry 或重试 mutation；
- test 单独运行与组合运行结果不同；
- 需要改变 smoke/full group 策略才能通过。

停止报告必须列出 helper 差异、唯一 oracle、端口/进程日志、生产依赖缺口和建议拆出的独立 PR。

## 未决风险

- 重复 helper 行数可能不足以实现 1,500–2,000 净减少；主要降幅还依赖安全地表驱动流程样板。
- Node test 文件并发模型和 macOS 端口释放时序可能暴露当前被复制 helper 掩盖的竞态。
- schema real-run 的长链虽与 workspace Bridge 重叠，但它的“生成产物整体符合 schema”仍是唯一 oracle，不能完全删除。
- scope lifecycle 三例验证的是已变化的产品政策，不是 `validateScope` 算法本身；误删会恢复错误的 hard-blocking 假设。
- 公共 helper API 过宽会变成新的内部框架；应保持 HTTP/raw response 可见，避免 DSL 化。
