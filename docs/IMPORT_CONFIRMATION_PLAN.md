# 外部 HTML 打开、导入确认与项目归属 · 详细实施计划

- 计划版本：v2.1
- 状态：施工合同；本文不授权合并、打 tag、发布或制作安装包
- 产品规范：[IMPORT_CONFIRMATION_PRD.md](IMPORT_CONFIRMATION_PRD.md) v1.2
- 审计基线：`origin/main@e7fcc65529dd46bff45db4ef3237d58ce9a713fc`
- 实施基线：每个实施 PR 开始时重新同步最新 `origin/main`，旧 SHA 只用于解释本文审计结论
- 推荐拆分：2 个完整 PR；只有发现本文列出的硬阻塞才停下重新评审，不能自行扩成平行版本系统
- 目标：新外部 HTML 先确认再导入；同一外部原文件永久回到唯一项目；V1/当前本地编辑语义准确；可选删除严格后置；任何 Canvas 确认都有终态

本次收敛只修正文档合同：外部原 HTML 与隐藏 V1 保留首次导入字节且不含
PageRoot Stable ID；V1 可见 Working Copy 可物化 Stable ID，因而不保证逐字节
一致。AI Candidate 在晋升前归一化 Stable ID，V2 及后续不可变 Version 保存完整
的已采纳 Candidate HTML；对应 V2+ Working Copy 建立时与 Version 快照逐字节一致，
之后本地编辑只更新 Working Copy。唯一导出原样复制完整当前 HTML（含 Stable ID）；
Undo/Redo 仅属于当前打开文档会话。不得新增第二套导出或项目修改状态。

> 本分支已实施 PR-1 与 PR-2：长期外部源绑定、只读 A/B/C 分类、确认 UI、Prepared Intent、Canvas 终态与可选废纸篓删除。保持 Draft，直到全部条款验收完成后再标 Ready。

## 0. 执行摘要

本需求不是“在现有静默导入前加一个弹窗”。要同时修正四条相互依赖的合同：

1. **长期外部源归属**：Registry 已有 `importSourceKey + importSourceSha256`，但当前代码只把它当成一次导入崩溃重试证据；项目离开干净 V1 后，再次打开原稿仍可能建新项目。它必须升级为长期、唯一、与当前活动 Working Copy 无关的外部源关联。
2. **打开分流**：本地选择器和 OS `open-file` 现在会先 `readHtmlProject + activateProject(原稿)`，Renderer 随后才通过 `/project/ensure` 导入。新流程必须先只读分类，再等待用户；确认前不得修改 active/recent、不得把原稿发布到 `DocumentSession`。
3. **再次打开只打开之前的项目**：再次打开原稿时，“打开之前的项目”要打开项目当前可编辑 Working Copy。本需求不提供“查看初始版本 V1”；不可变 V1 只走既有版本历史。实施不得把最新正式 Version、当前本地编辑和 V1 混成同一个目标，也不得为这条打开链路组合 `viewHistory()`。
4. **Canvas 终态与删除时机**：当前顶部“正在确认当前画布…”只是由缺少 render ACK 推导，初始 ACK 尝试失败后可能没有显式失败状态。删除原稿必须等新项目、Session 和新 Canvas generation/Hash 全部确认；Canvas 失败不得删原稿，也不得无限 pending。

推荐两 PR：

| PR | 完整结果 | 合并后是否改善生产行为 |
|---|---|---|
| PR-1：外部源唯一关联与只读分类 | Repository 能把同一路径原稿稳定解析回唯一项目；`importExternal` 即使在 V1 已修改、已晋升 V2+、活动 Working Copy 已切换后也不能建第二项目；提供只读 A/B/C 分类 | 是。即使 UI 尚未改造，Repository 底线也会阻止同源重复项目 |
| PR-2：确认 UI、Prepared Intent、删除与 Canvas 终态 | 所有桌面入口先分类后确认；再次打开显示项目事实并只提供“打开之前的项目”；选择动作安全切换；删除严格后置；画布 ACK 成功/失败可恢复 | 是。完成 PRD 全部用户体验 |

如果选择单 PR，仍按本文 PR-1 → PR-2 的提交顺序施工，直到所有条款完成前保持 Draft，不得把半成品确认框或可勾选但不工作的删除选项标成 Ready。

## 1. 已核实的现行代码事实与根因

### 1.1 当前本地/外部打开在确认前就取得了活动文件身份

| 文件 / 函数 | 当前行为 | 问题 |
|---|---|---|
| `desktop/main.mjs` `openHtml()` | 文件选择后立即 `readHtmlProject()`，随后 `activateProject(project.sourcePath)` | 用户尚未同意导入，原稿已写入 active/recent |
| `desktop/main.mjs` `openExternalFileRequest()` | OS/QoderWork 请求同样先读取并 `activateProject()` | 冷启动、Finder、Open With 与运行中打开都绕不过静默切换 |
| `desktop/main.mjs` `acceptExternalFileOpen()` | 消费 opaque `requestId` 后直接执行上述活动文件修改 | `requestId` 目前只保护路径，尚不表达“已分类、待确认” |
| `app/application/project-workflow.js` `openProject()` | 在打开文件选择器之前先 `prepareSwitch()` | 用户即使随后取消选择，也已经为一次没有发生的切换 drain 当前项目 |
| `app/application/project-workflow.js` `#openExternalProject()` | 先 drain/freeze，再调用 Desktop accept，随后把返回项目送进 `ProjectApplicationSession` | 无法在不切当前项目的前提下展示首次/再次打开确认 |

### 1.2 当前导入发生在原稿已经进入 Renderer 之后

```text
Desktop read/activate 外部原稿
  → Renderer #applyProject 把原稿挂到 DocumentSession/Canvas
  → Workbench 发现尚无 projectId/documentId
  → WorkspaceController #createRegistration
  → Bridge POST /project/ensure
  → ProjectFileRepository.importExternal
  → 创建项目内 V1，再把 Renderer 切到托管 Working Copy
```

因此旧计划若只在 `/project/ensure` 前加确认，仍会让原稿短暂成为当前可编辑画布，也会污染 active/recent。新计划把导入决定前移到 Desktop/Repository 的打开分类阶段。

### 1.3 Registry 已有外部源证据，但恢复条件过窄

`bridge/project-file-repository.mjs` 当前导入会写：

```text
project record:
  importSourceKey       = SHA-256(normalized external path)
  importSourceSha256    = first imported bytes SHA-256

pending import:
  same key + same first-import hash
```

但 `#recoveredImportTarget()` 还要求：

- `latestOfficialVersionId === V1`；
- `activeWorkingCopyId === V1 Working Copy`；
- 当前 V1 工作文件 Hash 仍等于首次导入 Hash。

只要用户正常编辑 V1、采纳 V2，或改为基于历史版本继续编辑，这些条件就不成立。随后 `#importExternal()` 会把同一路径当成全新项目。这是“再次打开原稿重复建项目”的直接技术根因。

### 1.4 Canvas 有有界校验函数，但顶部状态缺少失败事实

- `verifyCanvasRendered()` 会轮询、至多重建一次，并最终抛出“画布没有在时限内确认载入目标 HTML”。
- `DocumentWorkflow.ensureCurrentCanvas()` 会把该异常转成失败 outcome。
- 但 Workbench 的初始 render ACK effect 在尝试次数耗尽后会直接结束；`canvasRenderAcks.edit` 仍为空。
- 顶部 `safeSaveLabel` 只判断 ACK 是否存在：不存在就一直显示“正在确认当前画布…”，没有 `failed` 状态、失败原因或重试动作。
- `ProjectWorkflow.#applyAcceptedProject()` 发布新项目后不会等待新 generation 的 render ACK 才宣布打开流程结束。

所以产品问题不只是“测试导入太频繁”。正常用户再次打开原稿，或复杂 HTML 的新 Canvas ACK 没有收敛时，都可能看到长期确认状态。

## 2. 本计划冻结的架构决策

### 2.1 复用现有 Registry 字段，不新建 Hash 去重系统

本次把现有字段的语义明确为：

| 字段 | 新权威语义 |
|---|---|
| `importSourceKey` | 首次导入时由 Repository 对**真实规范化外部路径**计算的 opaque canonical-path digest；用于同一路径再次查找，不向 Renderer 暴露 |
| `importSourceSha256` | 首次导入字节 Hash；用于判断“当前原稿仍与初始 V1 一致”以及确认期间 CAS，不参与跨路径项目匹配 |

不新增“扫描全部 V1 Hash 找项目”，不因两个文件内容相同而关联，不把 `importSourceKey` 变成项目写权限。项目写权限继续由 Registry 登记根、Project/Document、manifest、Working Copy/OpenTarget 和真实路径共同决定。

本期“同一外部源”的强制支持范围是：同一文件仍在首次导入的 canonical path。`realpath` 可消除 `/var` 与 `/private/var` 等路径别名。外部原稿被用户移动/改名后的跨路径追踪不靠 Hash 猜测，也不在本期增加外部 inode 绑定；若未来需要，必须另写可审计需求。

### 2.2 A/B/C 分类是 Repository 的判别联合

新增只读方法，建议名：

```text
ProjectFileRepository.classifyOpenPath({ sourcePath })
```

返回且只返回三种内部结果：

```text
managed-project   // A：有效 v4 精确文件
known-external    // B：外部 canonical path 已绑定一个项目
new-external      // C：未绑定的新外部 HTML
```

分类顺序固定：

1. 验证普通 `.html/.htm`、非软链接、大小限制并得到 realpath；
2. 先用 `#resolveOpenTarget` 判断是不是有效受管文件；
3. 若不是受管文件，读取当前外部 bytes/Hash，计算 canonical `importSourceKey`；
4. 查询已提交 `projects` 与 `pendingImports`；
5. 唯一已提交 claim → B；零 claim → C；多个 claim → 完整性错误，绝不降级为 C；
6. B 类必须重新加载该 Registry 项目、当前活动 Working Copy、工作状态和 V1；任何身份/路径/Hash 无法验证时失败关闭，不能新建替代项目。

分类是只读操作：Registry 原始 bytes、Recent、activePath、项目目录和原稿都必须保持不变。

### 2.3 “导入重试”与“长期关联”使用同一证据，但走不同方法

- 删除或改写现有 `#recoveredImportTarget()` 的“必须仍是干净 V1”前提。
- 抽出 `#resolveExternalSourceBinding({ importSourceKey, currentSourceSha256 })`：只负责找到唯一项目并返回它**当前活动 Working Copy**及展示事实。
- `#importExternal()` 开始时先调用同一绑定解析：
  - 已绑定 → `imported: false`，返回既有项目当前活动 OpenTarget；
  - 未绑定 → 才允许进入新导入事务；
  - 冲突/损坏 → 报错，不创建项目。
- `currentSourceSha256 === importSourceSha256` 只决定 `sourceRelation: unchanged | changed`，绝不决定关联是否存在。

### 2.4 Prepared Open Intent 是唯一外部路径能力

Desktop 主进程扩展现有 `external-file-open.mjs`，建立有界内存 Prepared Intent：

```text
requestId
canonical external sourcePath       // 仅主进程
classifiedAtSha256                  // 仅主进程
classification                      // A/B/C
boundProjectId / prepared target    // 仅主进程
state                               // prepared / committing / committed / finalized / canceled
commit receipt                      // 已提交后可幂等重放
originalDisposition                 // kept / trashed / trash-failed
```

Renderer 永远只持有 `requestId` 和展示 DTO。它不能回传 source path、source key、项目根或待删除路径来扩大权限。

Prepared Intent 不持久化。崩溃后：

- 未导入的请求自然消失；
- 已发布项目由 Registry/pending import 恢复；
- 原稿删除尚未执行则保持原样；
- 用户下次打开同一路径，重新按 A/B/C 分类。

### 2.5 Renderer 仍使用现有两个打开 Session，不在 Workbench 复制状态

- `ExternalFileOpenSession` 扩展为拥有 `classifying / awaiting-confirmation / queued / applying / deferred / attention / idle` 状态和当前 public descriptor。
- `ProjectApplicationSession` 继续拥有已接受结果 FIFO；扩展一个按 `applicationId` 收口的完成 receipt，使 `WorkspaceController` 能等待“项目已发布并完成 Canvas 验证”，而不是由 Workbench 猜测事件顺序。
- `ProjectWorkflow` 负责 classify 后的 prompt state、项目 switch/drain/freeze、Prepared Intent commit、同步 Session 发布、失败回滚。
- `WorkspaceController` 暴露确认/取消/重试命令；再次打开的唯一正向 action 是 `continue-current`。不在这条链路组合 `VersionWorkflow.viewHistory()`。
- Workbench 只订阅 aggregate snapshot、渲染确认框、发 `confirm/cancel/retry` 命令；直接 Bridge 调用继续为 0。

### 2.6 Edit Canvas ACK 进入 Document 权威状态

`DocumentSession` 已拥有 `canvasGeneration`，因此 ACK 终态也归它，不再让 Workbench 的 `canvasRenderAcks.edit` 成为平行事实。

建议增加：

```text
canvasAuthority: {
  status: idle | pending | verified | failed,
  generation,
  renderedSha256,
  error
}
```

规则：

- `reset / publishAuthority / reloadCanvas / beginEdit` 使当前代进入 `pending`；
- `DocumentWorkflow.ensureCurrentCanvas()` 按 `generation + hash` single-flight；
- 精确 ACK 才能 `verified`；旧 generation、旧 HTML、旧 Hash 的迟到 ACK直接丢弃；
- 有界重建仍失败则 `failed`，保留原因和显式重试；
- 当前视图安全保存只有在 persistence idle、revision 已写回且 Canvas 当前代/Hash `verified` 时成立；
- 历史视图可验证自己的 rendered Hash，但不把历史 Hash写成当前 Working Copy source Hash。

Preview 的 disposable ACK 可以继续作为 Workbench 展示投影，但 Edit ACK 必须只有上述一个 owner。

### 2.7 删除只在新 Canvas 已验证之后

勾选删除不随 import 请求直接执行。顺序固定：

```text
import + Registry binding committed
  → Desktop activePath 已切到 managed V1
  → Project/Document/Version/Draft/Comment 同步发布
  → 新 Canvas generation + rendered Hash verified
  → ProjectWorkflow确认 DocumentSession 已记录该代 verified
  → Renderer 仅以 requestId 请求 finalize
  → Main 重验 committed receipt、active managed target、原稿路径/类型/Hash/根外约束
  → shell.trashItem(original)
```

Canvas failed、应用退出、Renderer 销毁、request 被替换、Hash 漂移或 finalize 响应未知：默认都不删。项目已经完整导入时不删除或回滚磁盘项目；仅允许按 §5.5 恢复先前的活动项目投影。

## 3. 开工前提、工作树与停止条件

每个实施 PR：

1. 从主工作树运行 `git fetch origin`、`npm run task:status`、`git status -sb`；
2. 确认 PRD/计划已在最新 `origin/main`；
3. 主工作树必须干净且留在 `main`；
4. 用 `npm run task:start -- fix/<name>` 创建新隔离 worktree；
5. 记录实际 `origin/main` SHA；新 SHA 使旧测试证据失效；
6. 先跑与本 PR 相关的基线测试，基线失败先停下归因，不在功能 diff 中顺手“修绿”。

出现以下情况必须停止并回到产品/架构评审，不能自行扩 scope：

- 要支持外部原稿移动/改名后的跨路径自动找回；
- 要支持保留旧 V1 Working Copy 同时创建第二条干净 V1 分支；
- 需要 Renderer 提供任意删除路径；
- 需要按 Hash 合并/去重项目；
- 需要让用户处理历史多个关联项目；
- 最新 `main` 已改变 Registry schema、ProjectApplicationSession 或 Edit runtime 的关键合同，使本文文件/函数映射失效；
- 发现必须删除、覆盖或自动合并已有项目才能迁移；
- 无法在不执行作者脚本第二次的前提下完成 Canvas 重试。

## 4. PR-1：外部源唯一关联、Registry 串行化与只读分类

### 4.1 PR-1 的完成定义

合并后即使 UI 仍走旧的 lazy registration：

- 同一 canonical 外部路径最多创建一个项目；
- 项目已本地编辑、已晋升 V2+、已切到历史 Working Copy 后，再次 `importExternal` 都返回当前活动项目；
- 外部原稿内容变了也不创建第二项目；
- 同内容的另一路径仍创建独立项目；
- 提供无副作用 A/B/C classifier 和稳定 DTO，供 PR-2 使用；
- 多 Repository 实例/并发请求不会因 read-modify-write 丢 Registry 更新。

### 4.2 先写失败测试，锁住旧缺陷

在 `tests/project-file-repository.test.mjs` 先增加会在现行代码失败的用例：

1. 导入 A，修改 `A-V1.html` 并保存，再用外部 A 调 `classifyOpenPath/importExternal`，仍返回原 `projectId`；
2. 导入 A，晋升 V2，再次打开外部 A，返回 V2 当前活动 Working Copy；
3. 导入 A，基于 V1/V2 历史 Working Copy 继续编辑后，再次打开外部 A，返回 runtime 指向的精确 Working Copy，不静默跳 latest；
4. 修改外部 A，自身 Hash 与首次导入不同，分类仍为 B 且 `sourceRelation=changed`；
5. 把 A 字节复制到 B 路径，B 分类仍为 C；
6. 两个 Repository 实例同时导入同一路径，最终只有一个项目；
7. 两个实例同时导入不同路径，最终两个项目都保留，Registry 不丢写；
8. 人工制造两个 project record 声明同一 key，分类报 `EXTERNAL_SOURCE_BINDING_CONFLICT`，Registry bytes 和项目目录不变；
9. 唯一绑定项目的 Working Copy 缺失/manifest 损坏，分类失败，不降级为 C；
10. `/var` / `/private/var` 等 realpath 别名得到同一 source key（仅 macOS 条件用例）。

测试必须独立计算期望 Hash，不能调用被测 source-key helper生成 oracle。

### 4.3 `bridge/project-file-repository.mjs`：规范化外部源

抽出私有纯/窄函数，建议：

```text
#readExternalSourceDescriptor(sourcePath)
  → canonicalSourcePath
  → sourceKey
  → sourceSha256
  → Buffer / information
```

修改要求：

- `lstat` 必须是普通文件且不是 symlink；
- `realpath` 后再次确认扩展名、项目根外/内分类和读取身份；
- source key 对 canonical path UTF-8 bytes 做 SHA-256；
- 导入读取、分类读取、确认重读共用该函数，不能各自实现路径正规化；
- 导入前、发布前仍重读 Hash；
- 不把 canonical 外部 path 写入项目 HTML 或对用户内容做字节改写。

### 4.4 `bridge/project-file-repository.mjs`：长期关联解析

新增私有方法：

```text
#externalSourceClaims(registry, sourceKey)
#resolveExternalSourceBinding({ sourceKey, currentSourceSha256 })
#externalSourceProjectFacts({ projectId, record, currentSourceSha256 })
```

返回事实至少包括：

- `projectId / documentId / projectName`；
- 当前活动 `openTarget`；
- `currentBasedOnVersionId` 及 ordinal；
- `latestOfficialVersionId` 及 ordinal；
- 当前 Working Copy `differsFromBase`；
- 初始 Version ID/ordinal（必须实际从 manifest 找 ordinal 1）；
- `sourceRelation: unchanged | changed`；
- 首次导入 Hash只用于 relation，不返回 raw source key。

硬不变量：

- claim 是否存在只看 canonical source key，不看当前 Working Copy、latest Version 或当前外部 Hash；
- active Working Copy 必须从 runtime + manifest + state 精确解析；
- V1 必须存在、ordinal=1、snapshot Hash 等于 `importSourceSha256`；不成立则绑定损坏，不能新建项目替代；
- 多 claim 是完整性错误，不自动选最近项目、目录名最像或 Hash 相同的项目。

### 4.5 `bridge/project-file-repository.mjs`：当前 Registry mutation lock

现有 `#serial()` 只串行一个 Repository 实例；PRD 的同源唯一性需要跨实例也成立。新增当前 Registry 事务锁，不能复用“只迁移旧 shape”的 legacy lock语义。

建议结构：

```text
.pageroot-registry-write-lock/
  .owner-<uuid>.json
```

要求：

- 原子 `mkdir`/owner marker 取得；
- owner 记录 `pid + token + createdAt`；
- 活 PID 或无完整 sealed owner 时只等待，不能抢；
- 死 owner 只能按精确 token rename 后退休，不能 `rm -rf` 一个后来被替换的锁；
- 有界等待后报 `REGISTRY_BUSY`；
- lock release 在 `finally`；
- 只有一把 Registry 锁，不存在 current lock 与 legacy migration lock 的反向嵌套问题（exact legacy V4 migration 已随 ADR 0028 移除）；
- 所有 Registry read-modify-write 路径改走统一 `#mutateRegistry()`，包括 pending import、publish/clear、项目根 rename/rebind；
- 只读分类读取原子 Registry 文件，不刷新 `updatedAt`、不规范化写回。

新导入可以在持有 current Registry lock 的情况下完成最多 25 MB 的 staging/publish，以确保跨实例不会同时声明同一 key。若实现选择缩小锁区间，必须先提供等价 CAS/claim receipt 证明；不能只在 UI 加 single-flight。

### 4.6 pending import、崩溃与重试

修改：

```text
#preparePendingImport
#publishPendingImport
#clearPendingImportIfMatches
#recoverPublishedImports
#importExternal
```

顺序：

1. 持 Registry mutation lock，重读最新 Registry；
2. 唯一绑定已存在 → 返回当前项目；
3. 同 key 有 pending → 尝试现有恢复；仍由活操作占用则 `SOURCE_IMPORT_PENDING`，不能建新项目；
4. 无 claim 才写 pending intent；
5. staging + V1 snapshot + visible Working Copy + metadata；
6. 发布项目根；
7. 把 pending 原子晋升为 project record，保留 source key/首次 Hash；
8. 标记 import recovery committed；
9. 清 pending；
10. 释放 lock。

崩溃恢复：

- pending 且发布根有效 → 恢复同一项目并提交同一绑定；
- pending 且发布根不存在、当前已取得死 owner 后的 Registry lock → 可清该精确 pending，使同源未来可重试；
- pending 根存在但 Project/Document/manifest 无法验证 → 保留 pending 并报错，不把目录升级为项目；
- staging 隐藏目录不因“看起来像项目”获得 Registry 权限；不扫描并接管；
- Registry 已提交但响应丢失 → 重放返回同一项目当前活动 OpenTarget。

### 4.7 公共 Repository 分类 API

新增：

```text
classifyOpenPath({ sourcePath })
```

内部结果建议：

```text
{ kind: "managed-project", target, sourceSha256 }
{ kind: "known-external", sourceSha256, sourceRelation, projectFacts }
{ kind: "new-external", sourceSha256, sourceFileName, visibleV1FileName }
```

`visibleV1FileName` 必须调用与导入完全相同的 `safeProjectName / htmlExtension / visibleFileName(..., 1)`；不得为预览文件名调用 `#allocateProjectRoot` 或创建目录。

### 4.8 `bridge/workspace-bridge.mjs`

新增 authenticated read-only route，建议：

```text
POST /project/open-classification
body: { sourcePath }
```

原因是 source path 来自 Desktop 主进程，使用 POST 可避免本地路径出现在 query string/错误日志。响应通过 route adapter 移除：

- raw `importSourceKey`；
- Registry record；
- 外部绝对路径（Desktop 已经持有，Renderer不需要）；
- 项目内部隐藏路径；
- HTML content（分类 UI 不需要）。

PR-1 只让 Desktop 后续通过现有 authenticated `net.fetch` helper 调该 route；不向 Application Bridge client 或 Workbench 增加 `classify*` 方法。Bridge 测试断言分类前后 Registry原始 bytes 完全相同。

### 4.9 PR-1 文档同步

同一 PR 更新：

- `docs/ARCHITECTURE.md`：外部 source provenance 成为长期 lookup，不是写 authority；
- `docs/ARCHITECTURE_CONTRACT.md`：兼容与 Registry mutation lock；
- `docs/STATE_OWNERSHIP.md`：Repository 拥有 source-key → project lookup；
- `docs/SECURITY_MODEL.md`：不按 Hash 去重；多 claim 失败关闭；
- `docs/VERSION_AND_PROJECT_FILES_PRD.md`：同一路径再次导入不新建项目；
- `docs/INTERACTION_FLOW.md`：先更新底层行为说明，但仍标注确认 UI在 PR-2 完成；
- `tests/TEST_STRATEGY.md`：Registry 并发/崩溃 owner 和分类测试层级；
- `docs/decisions/0026-external-source-project-binding.md`：记录长期关联、非 Hash 去重和不提供歧义选择器。实施时再次确认 0026 仍是空号。

### 4.10 PR-1 测试矩阵

| 层 | 文件 | 必测 |
|---|---|---|
| Schema | `tests/project-file-schema.test.mjs` | 现有 optional provenance pair 继续严格成对；未知字段拒绝；本 PR 若没有 schema shape 变化，必须证明无需迁移写回 |
| Repository | `tests/project-file-repository.test.mjs` | §4.2 全部；pending failpoint；current lock 活/死 owner；不同源并发不丢写 |
| Bridge | `tests/project-file-bridge.test.mjs`、`tests/workspace-bridge.test.mjs` | A/B/C DTO、auth、无副作用、known source 返回当前工作稿事实 |
| Architecture | `tests/architecture-boundaries.test.mjs` | Workbench Bridge 直连仍为 0；Registry owner 没有复制到 UI |
| 回归 | 现有 project catalog/open/history tests | Registry catalog、Working Copy rename、历史继续编辑、Promotion 不受影响 |

PR-1 阶段门禁：

```text
npm run gate:edit
node --test tests/project-file-schema.test.mjs
node --test tests/project-file-repository.test.mjs
node --test tests/project-file-bridge.test.mjs tests/workspace-bridge.test.mjs
npm run architecture:check
npm run task:finish
```

进入 Ready 前必须用 exact head 重跑要求门禁；失败不得用跳过测试、放宽 validator 或删除旧 fixture 解决。

## 5. PR-2：统一打开意图、两种确认、删除与 Canvas 终态

### 5.1 PR-2 的完成定义

- 文件菜单、标题“+”、Finder/Open With、Dock/argv、冷启动 handoff 使用同一个 A/B/C classifier；
- A 直接打开；B 显示“已经导入”；C 显示首次导入确认；
- 确认前 active/recent、项目目录、Registry、DocumentSession、Canvas 均不变；
- B 的“打开之前的项目”打开当前活动 Working Copy；确认框不提供“查看 V1”；
- C 的确认才创建 V1；取消零副作用；
- 删除只在新 Canvas verified 后发生；
- 所有请求、dialog、switch、Canvas 和删除步骤都有成功/取消/失败/被替换/超时/销毁终态。

### 5.2 先锁协议与 Session 测试

先修改/新增测试而不是先写 JSX：

- `tests/external-file-open.test.mjs`：Prepared Intent 状态、一次性 request、替换、幂等 commit/cancel/finalize；
- `tests/external-file-open-session.test.mjs`：`awaiting-confirmation`、用户动作、较新请求替换、旧动作 stale、close cancel；
- `tests/project-application-session.test.mjs`：完成 receipt、deferred 已提交结果不丢、dispose resolve stale；
- `tests/document-session.test.mjs`：Canvas pending/verified/failed、旧 ACK忽略、reload 新 generation；
- `tests/document-workflow.test.mjs`：Canvas verify single-flight、一次自动重建、失败投影、显式 retry；
- `tests/project-workflow.test.mjs`：confirm 前零 switch、commit 前 final fence、commit 后同步 publish、Canvas fail rollback；
- `tests/workspace-controller.test.mjs`：确认命令只接受 `continue-current` / `import-new`；拒绝 `view-initial`。

### 5.3 `desktop/external-file-open.mjs`：Prepared Intent owner

扩展现有 mailbox，或在同文件新增 `createPreparedHtmlOpenStore()`；优先不新增打包文件。若拆新文件，必须同步 package allowlist 和 packaged artifact gate。

状态机：

```text
published-path
  → classifying
  → prepared(A/B/C)
  → committing
  → committed
  → finalized

任意未 committed 状态 → canceled
committed + Canvas 失败 → rollback-pending → rolled-back 或 attention
```

要求：

- 内存上限与现有 64 request 量级一致；
- 新未开始请求替换旧 prepared 请求时，旧 request主进程先 cancel，再向 Renderer 发布新 descriptor；
- 已进入 commit 的请求不可被新请求抹掉，必须先形成 committed/rolled-back/attention；
- 同一个 requestId 的 commit/finalize/rollback 可幂等重放；不同 action 重放拒绝；
- canceled/finalized ID 不可复活；
- dispose/退出清空未提交 delete 意图；
- 不把 `deleteOriginal` 持久化或写 Registry。

### 5.4 `desktop/main.mjs`：只读 prepare，不再提前 activate

重写：

```text
openHtml()
openExternalFileRequest()
acceptExternalFileOpen()
adoptPendingExternalFileAtStartup()
```

新顺序：

```text
picker / mailbox path
  → read-only inspect + Bridge classify
  → Prepared Intent store
  → 返回 public descriptor
```

这一阶段禁止调用：

- `activateProject(externalOriginal)`；
- `persistProjectState()`；
- `/project/ensure`；
- Renderer project apply；
- `shell.trashItem`。

新增窄操作，建议：

```text
commitPreparedHtmlOpen({ requestId, action, deleteOriginal })
cancelPreparedHtmlOpen({ requestId })
rollbackPreparedHtmlOpen({ requestId })
finalizePreparedHtmlOpen({ requestId })
```

`commit` 在 `projectOpenQueue` 内重新分类并重读 Hash：

- A + `open-managed`：重验完整 OpenTarget/HTML/Hash，之后 activate；
- B + `continue-current`：重验 source key仍唯一、项目当前 active OpenTarget，之后 activate managed working file；
- C + `import-new`：重验仍为 C且 Hash 未变，调用 Bridge `/project/ensure`，之后 activate V1；
- C 在确认期间变为 B：返回 `OPEN_INTENT_RECLASSIFIED` 及新 B descriptor，不导入；
- 文件 Hash、realpath、项目 target 或 classification 与准备时变化：失败并要求重新确认，不沿用旧文案事实；
- `deleteOriginal=true` 只允许 `import-new`，其他 action拒绝。

commit receipt 保存：previous active path、committed managed path、project/document/openTarget/hash、是否真实新导入、原稿首次 Hash和 delete 请求。响应丢失时同 ID 返回同一 receipt，不再次导入或 activate。

`commitPreparedHtmlOpen()` 已经运行在 `projectOpenQueue` 内，不能再调用自身也包裹 `projectOpenQueue.run()` 的公开 `openRegisteredProject()` / `activateManagedWorkingCopy()`，否则会形成嵌套队列等待。应抽出无队列包装的 `openRegisteredProjectOperation()` / `commitActivatedProjectPath()` 内部原语，公开 IPC 入口和 Prepared Intent commit各自在最外层只进入队列一次。现有 mailbox 的 `activationTail` 在改成只读 prepare后不得继续成为第二个 active/recent mutation FIFO；Desktop 活动项目变更只有 `projectOpenQueue` 一个 owner。

### 5.5 Desktop rollback

在 Renderer 发布新项目或验证新 Canvas失败时：

1. Main 只在 `activePath` 仍等于该 receipt committed target 时接受 rollback；
2. previous active path存在则重新按受管项目完整身份读取并恢复 active/recent；不存在则恢复空活动状态；
3. Renderer 使用 `ProjectWorkflow.captureManagedSourceTransitionAuthority()` / `restoreManagedSourceTransitionAuthority()` 恢复此前 Project/Document/Version/Draft/Comment/Run authority；
4. 旧 Canvas进入新 generation 并重新验证；
5. 新导入的项目**不删除**：它是完整、已绑定项目，只是本次打开未完成；原稿保持；
6. rollback 响应未知时进入 attention，禁止删除，提供“重试恢复”而不是猜测当前项目。

commit 前的任何失败直接保留旧项目，不需要 rollback。

### 5.6 `desktop/preload.mjs`：严格 IPC codec

现有 `acceptExternalOpen` 改为“接受并分类”，新增 prepare/commit/cancel/finalize/rollback 方法。每个 payload 使用 exact-key validator。

Renderer 可见 DTO：

```text
new-external:
{
  requestId,
  classification: "new-external",
  sourceFileName,
  visibleV1FileName,
  projectsRootLabel
}

known-external:
{
  requestId,
  classification: "known-external",
  sourceFileName,
  projectName,
  currentBasedOnVersionId,
  currentBasedOnOrdinal,
  latestOfficialVersionId,
  latestOfficialOrdinal,
  currentDiffersFromBase,
  sourceRelation: "unchanged" | "changed"
}

managed-project:
{
  requestId,
  classification: "managed-project"
}
```

不得出现：external absolute path、source key、待删除 path、Registry record、隐藏快照路径。Preload 的 catch-up generation 规则继续保证旧 startup descriptor 不能覆盖新的 live request。

`tests/desktop-preload-ipc.test.mjs` 必须覆盖 malformed/extra keys、非法 action、旧 protocol、stale readiness catch-up 和 Renderer无法提交 path。

### 5.7 `app/application/external-file-open-session.js`

Snapshot 扩展：

```text
status
activeRequestId
queuedRequestId
deferredRequestId
confirmation: null | public descriptor
action: null | requested action
attention: null | recoverable failure
```

转移：

```text
idle → classifying → awaiting-confirmation(B/C)
idle → classifying → applying(A)
awaiting-confirmation → applying(user confirm)
awaiting-confirmation → idle(cancel/Escape/backdrop/close)
awaiting-confirmation(A) + newer request → cancel old → classify new
applying + newer request → complete/rollback old first → then new
任何迟到 descriptor/action/outcome + requestId 不匹配 → stale, no publish
```

删除勾选状态由 ProjectWorkflow prompt snapshot拥有，每个 C request初始化为 false；B request根本没有该字段。切换 descriptor必须重置，不能由 Workbench local state跨请求保留。

### 5.8 `app/application/project-application-session.js`

保留现有 FIFO/最新未开始请求替换规则，增加 completion receipt：

- `enqueue()` 返回稳定 `applicationId`；
- `waitFor(applicationId)` 或等价 promise只存在 owner内部，不进入 snapshot；
- execute 结果包含 `succeeded / failed / deferred / stale / attention`；
- 已经从 Main commit 的项目结果不得因后继请求到达而丢弃；
- final fence失败时保留 committed result供同一 ID重试；
- dispose 对所有 waiters 返回 stale，不能悬挂 Promise；
- close drain能看到 awaiting-confirmation、applying、deferred、attention 的差别。

### 5.9 `app/application/project-workflow.js`

#### 5.9.1 本地选择器顺序

`openProject({kind:"local"})` 先调用 Desktop picker/classify。用户在 picker 取消，直接结束；不提前 `prepareSwitch()`。Desktop 接受文件后仍由 accepted-project FIFO 做最终围栏。Recent/registered 项目继续沿用其已验证直接打开流程。

#### 5.9.2 分类处理

- A：自动建立 application，进入现有安全 switch；无确认框。
- B/C：发布 `openConfirmation` snapshot，画布和项目不变。
- 分类失败：event/notice 明确失败，Session回 idle。

#### 5.9.3 用户确认后的共同切换

```text
epoch > 0：prepareSwitch() → final fence/freeze current Canvas → capture previous aggregate authority
epoch = 0（冷启动尚未绑定项目，例如上次打开的是待确认外部 HTML）：跳过 Canvas fence，与 #applyAcceptedProject 相同
  → Desktop commitPreparedHtmlOpen（首次导入把原稿目录记为该项目的 Preview/Edit 资源根，并写入 desktop project state）
  → validate returned project HTML/Hash/OpenTarget/receipt
  → synchronous #applyProject
  → refreshWorkspace（结束 hydrating；先水合再确认画布，避免二次重建打断 one-shot runtime）
  → ensureCurrentCanvas(new context)
  → finalizePrepared
  → success receipt
```

必须删除“先 accept/activate，再由第二个 application重复 prepareSwitch”的双重围栏；一个 `applicationId` 只执行一次最终 switch fence和一次 commit。若为兼容保留 helper，测试要证明没有重复作者 runtime或重复 activate。冷启动确认不得因 `freezeWorkingSource` 返回空而挡住导入。

#### 5.9.4 Canvas 失败

- commit 前：旧项目保持，解锁并报错；
- commit 后、Session publish 前：Main rollback + restore previous authority；
- Session publish 后、新 Canvas verify失败：尝试 Main rollback + aggregate restore +旧 Canvas verify；
- rollback成功：确认框保留可重试，原稿不删；
- rollback未知/失败：进入 attention，展示当前可验证项目状态，不无限 pending；原稿不删；
- 任意分支 `finally` 释放 freeze/busy，旧 operation的迟到 ACK不得改变新状态。

### 5.10 `app/application/workspace-controller.js`：确认命令

新增唯一公开命令，建议：

```text
confirmExternalOpen({ requestId, action, deleteOriginal })
cancelExternalOpen({ requestId })
retryExternalOpen({ requestId })
retryCanvasVerification()
```

`action` 只允许 `import-new` 与 `continue-current`。`view-initial` 必须在 codec 层拒绝，不得组合 `VersionWorkflow.viewHistory()`。

既有版本历史的“基于此版本继续编辑”不在本打开确认中出现；Repository 继续每个 Version 最多一份 Working Copy，本需求不创建第二份干净 V1 工作稿。

### 5.11 `app/application/document-session.*` 与 `document-workflow.js`

#### DocumentSession

- 增加 `canvasAuthority` typed snapshot及 `beginCanvasVerification / confirmCanvas / failCanvas`；
- `confirm/fail` 必须带 generation + expected rendered Hash，旧值返回 false；
- `reset/publish/reload/beginEdit` 进入 pending；
- d.ts、aggregate snapshot和测试同步。

#### DocumentWorkflow

- `ensureCurrentCanvas()` 以 `generation + hash + project context` single-flight；
- 复用现有 `verifyCanvasRendered` 的“轮询 → 至多一次 reload → 失败”机制；
- 成功写 `verified`，失败写 `failed`；
- `finally` 清 in-flight promise；
- retry明确进入新 generation，不能对同 generation无限自动重放；
- history Hash与 current source Hash分开传递。

#### Workbench

- 删除 `canvasRenderAcks.edit` 作为权威；Preview ACK可保留；
- 初始 render effect 调 Controller/DocumentWorkflow，而不是 40 次后静默返回；
- `safeSaveLabel`：pending 显示“正在确认当前画布…”；verified且保存一致显示“已安全保存”；failed显示“画布确认失败 · 重试”；
- failed notice属于可恢复 direct action，不能自动循环；
- `data-render-verified` 与 Electron测试从同一 `canvasAuthority` 投影。

### 5.12 `app/workbench.tsx` 与确认框组件

建议抽出 `app/workbench/ExternalHtmlOpenDialog.tsx`，复用 `AiReviewWorkspace` 的 modal视觉 token；不要在两处复制键盘/焦点逻辑。若不抽组件，也必须共享 CSS class/token。

首次导入框严格按 PRD §5：

- 标题、项目根、V1 文件名、资源不导入说明；
- checkbox默认 false；
- `取消 / 导入并打开`；
- Escape/backdrop=取消；Enter=主操作；
- 打开时 focus主按钮或标题策略与现有 dialog一致；关闭后焦点回到发起“+”或合理工作台入口。

已导入框严格按 PRD §6：

- 分开显示当前基于版本、最新正式版本、是否有已保存修改；
- 只有 `sourceRelation=unchanged` 才说当前原稿与 V1完全一致；
- changed时显示不会自动导入/覆盖；
- `取消 / 打开之前的项目`，没有第三按钮；
- 不显示删除 checkbox；
- 主按钮是“打开之前的项目”，不是“打开最新版本”，也不是“查看初始版本 V1”。

确认框使用 `role=dialog`、`aria-modal`、唯一 title/description ID、Tab循环、Shift+Tab、Escape、backdrop、屏幕阅读器可读状态；自动化按 role/name定位，禁止依赖 CSS selector 文案扫描。

### 5.13 删除原稿的窄能力

优先在 `desktop/external-file-open.mjs` 抽纯 controller并注入 `shell.trashItem`，生产 Main只组装：

```text
finalizePreparedHtmlOpen({requestId})
```

Main 重验：

1. request committed且真实 `imported=true`；
2. 用户当时 `deleteOriginal=true`；
3. ProjectWorkflow只有在同 request 的 `DocumentSession.canvasAuthority` 已对 committed generation/rendered Hash标记 `verified` 后才能调用 finalize；顺序由 workflow测试证明，Main不接受 Renderer自报的 project/hash/path作为新权威；
4. committed target仍是 active managed Working Copy，且 Main重读得到的 project/document/hash与 receipt一致；
5. 原稿仍是本 request canonical普通 HTML、非 symlink；
6. 原稿 realpath在 projectsRoot外，且不等于任何 managed target/snapshot；
7. 原稿当前 Hash仍等于首次导入 Hash；
8. 每个 request最多调用一次 `trashItem`。

结果：

- 未勾选 → `kept`；
- trash成功 → `trashed`；
- 任何校验/OS失败 → `trash-failed`，项目仍成功；
- 响应丢失重放同 request返回已记录 disposition，不二次 trash；
- 不使用 `unlink`，Repository不获得项目根外删除权。

Node测试通过依赖注入的 fake `trashItem` 验证真实调用次数和路径，并用 ProjectWorkflow fake port证明 Canvas未 verified时 `finalize` 调用次数为 0。Electron E2E不把开发者真实文件放入废纸篓，也不增加可被普通 Renderer调用的测试后门。

由于当前 Edit iframe 与应用 Renderer同源，确认框的 checkbox和按钮 handler必须拒绝 `event.isTrusted === false` 的程序化点击/键盘事件，尤其不能让当前作者脚本用 `.click()` 勾选删除并确认。Main仍把 Renderer视为非文件路径权威：即使 Renderer被操纵，最多只能提交一个不可猜测、当前有效、已绑定固定原稿的 requestId，不能选择其他文件。

### 5.14 close、退出、替换与超时

| 状态 | 新打开请求 | 应用关闭 |
|---|---|---|
| classifying | 最新未开始请求可替换；旧读取结果 stale | 有界等分类结束或取消；不持久用户同意 |
| awaiting-confirmation | cancel旧 Prepared Intent，展示新 request，C checkbox重置 | 视为取消，清 intent，继续正常 close drain |
| applying before commit | 新请求排队 | 等本操作成功/回滚/明确失败 |
| committed before Canvas verify | 新请求排队，不能抹掉已提交项目 | 有界验证；失败则原稿不删，项目保持可恢复 |
| attention | 新请求只有在用户明确放弃/恢复后处理 | close允许保留完整 committed项目，删除意图作废；不得无限等待 |
| finalized | 正常处理下一请求 | 正常关闭 |

`SWITCH_DEADLINE_MS`、Bridge 15s timeout、Canvas verify deadline各自保留 owner，不再用一个无上限 spinner覆盖。所有 timeout必须有稳定 error code和用户动作。

### 5.15 成功/失败通知

删除 Workbench `registration-published imported:true` 的旧 Toast：

```text
已打开 / 原来的文件没有改动
```

改由 External Open operation最终 outcome发通知，避免 lazy registration事件与用户操作重复：

- 新导入 kept / trashed / trash-failed：PRD §10；
- known continue：不显示“再次导入成功”，只显示项目状态；
- Canvas failed：sticky recoverable action“重试画布确认”；
- source changed during confirmation：要求重新确认，不自动继续。

通知类型和 action必须符合现有 notification policy，不在 Workbench新增独立 toast状态机。

### 5.16 PR-2 文档同步

同一 PR 把计划涉及的旧现行文本全部改成最终行为：

- `docs/IMPORT_CONFIRMATION_PRD.md` 状态改为已实施；
- `docs/INTERACTION_FLOW.md` §4、§11、§12 和验收条目；
- `docs/MVP_PRD.md` 打开流程；
- `docs/VERSION_AND_PROJECT_FILES_PRD.md` §7/历史继续编辑/正式版本语义；
- `docs/STATE_OWNERSHIP.md` Prepared Intent、prompt、Canvas authority和跨 workflow编排；
- `docs/ARCHITECTURE.md` / `ARCHITECTURE_CONTRACT.md`；
- `docs/SECURITY_MODEL.md` 根外 trash窄权限；
- `docs/NOTIFICATION_MESSAGE_CATALOG.md` 两个 dialog和终态文案；
- `tests/TEST_STRATEGY.md` 测试 owner；
- `CHANGELOG.md`；
- `docs/COMPATIBILITY.md`：现有 provenance pair长期语义和移除条件（若登记为兼容 adapter）。

不得让“任何外部 HTML立即新建项目”“再次打开再建一个项目”“首次打开修改原稿”继续在其他现行文档出现。

建议补 ADR 0027（实施时核对空号）：Prepared Open Intent、根外废纸篓权限与 Canvas-verified finalization。若 PR-1/PR-2合并，可把 0026/0027 合成一个 ADR，但产品、存储和删除三个决定都必须可审计。

## 6. PR-2 测试矩阵

### 6.1 Node：Desktop / IPC / Session

| 文件 | 必测 |
|---|---|
| `tests/external-file-open.test.mjs` | local/OS intent、latest替换、commit/cancel/finalize/rollback幂等、close handoff不保存用户同意 |
| `tests/desktop-preload-ipc.test.mjs` | exact payload、无 path删除参数、malformed/extra key拒绝、catch-up不覆盖live |
| `tests/project-open-queue.test.mjs` | prepare只读、commit串行、旧 committed结果先发布、较新失败不回退更旧项目 |
| `tests/external-file-open-session.test.mjs` | B/C dialog、替换、checkbox reset、stale action、close cancel、attention |
| `tests/project-application-session.test.mjs` | completion receipt、deferred重试、dispose收口 |
| `tests/project-workflow.test.mjs` | 确认前零 switch；三 action；final fence；rollback；Canvas failed；delete finalize时序 |
| `tests/workspace-controller.test.mjs` | 只接受 `continue-current` / `import-new`；拒绝 `view-initial`；retry命令 |
| `tests/document-session.test.mjs` | Canvas状态机与迟到 ACK |
| `tests/document-workflow.test.mjs` | single-flight、一次重建、terminal failure、retry |
| `tests/version-workflow.test.mjs` | 既有历史查看/继续编辑不受本打开确认影响；不新增第二条 Working Copy |

### 6.2 Node：删除安全负向矩阵

每一项断言 `trashItem` 调用次数为 0，项目文件和原稿字节按预期保留：

- requestId缺失、过期、已取消、已 finalized；
- action不是 `import-new`；
- 未勾选删除；
- import失败或 classification reclassified；
- Canvas未 verified（workflow不得调用 finalize）；
- project/document/active target与 receipt不符；
- 原稿丢失、目录、symlink、非 HTML；
- realpath进入 projectsRoot；
- 原稿等于 managed V1/隐藏 snapshot；
- 原稿 Hash在导入后变化；
- Renderer payload企图夹带 path；
- 当前作者 iframe对 checkbox/主按钮执行非 trusted `.click()`；
- `trashItem` 抛错；
- 同一 finalize重复调用。

成功 case断言只调用一次 receipt中的 canonical原稿路径，V1/Registry不变。

### 6.3 Browser / 组件行为

若现有 Browser suite能挂载 Workbench确认框，覆盖：

- dialog role/name/description；
- Tab/Shift+Tab焦点循环；
- Escape/backdrop取消；
- Enter主操作；
- C checkbox默认 false并在替换后 reset；
- B没有 checkbox；
- current/latest版本事实分开；
- changed source文案；
- Canvas failed状态和显式重试，不自动循环。

不通过扫描 `workbench.tsx` 字符串证明行为；使用公开 DOM和 Session测试。

### 6.4 Electron：真实打开链

更新 `tests/e2e/electron/helpers/pageroot-app-fixture.mjs`：

- 需要自动导入的旧测试 helper必须通过真实 dialog role/button执行“导入并打开”；
- 增加 `autoConfirmImport: false` 供确认框测试；
- 禁止 `SKIP_IMPORT_CONFIRM`、隐藏 IPC直调或生产 bypass环境变量；
- `loadedDiskFrame()` 只有确认完成后才等待 managed V1；
- 全部 fixture使用合成 HTML和隔离 userData/project root。

正式 Electron cases：

1. 运行中选择新 HTML：确认框前 active source/Registry/画布不变；取消零副作用；
2. 新 HTML确认导入：V1 bytes=原稿 bytes，原稿保留，Canvas verified；
3. 冷启动 argv/open-file：先显示确认，不静默导入；取消回欢迎项目；
4. 保留原稿再次 `open-file`：显示 B dialog，项目目录数/版本数不变；
5. B“打开之前的项目”：打开已保存本地编辑，不跳只读 latest；
6. 外部原稿被改：B dialog显示 changed，不覆盖、不导入；
7. 较新 OS request在旧 dialog可见时替换，旧 request不能迟到导入；
8. 合成复杂/动态 HTML：打开后 Canvas最终 verified，或明确 failed+retry，绝不长期 pending；
9. Canvas验证注入失败：原稿不删，旧项目成功 rollback或进入明确 attention；
10. close在 dialog可见时等价取消，不把同意/checkbox写入 handoff。
11. B dialog 没有“查看初始版本 V1”按钮。

`packaged-startup-smoke.spec.mjs` 现有“启动即导入”用例必须改为驱动确认框，再验证 managed V1。真实 `shell.trashItem` 的调用正确性由注入 Node controller拥有；Electron不得污染用户废纸篓。

### 6.5 回归重点

- 欢迎项目自动建立仍不弹确认；
- 项目列表/Recent/registered project直接打开无确认；
- 受管 V1 Finder rename/root rename继续恢复；
- Candidate Promotion、AI任务、历史继续编辑不受 source binding影响；
- Edit one-shot runtime同一 generation不重复执行作者脚本；
- 评论/附件/PROJECT.md drain、IME fence、source history不被提前 picker破坏；
- browser-only隐藏 file input仍走 browser contract，不触发 Desktop导入/删除；
- `architecture:check` 保持 Workbench Bridge调用 0、唯一 Session owner和typed drain。

### 6.6 PR-2 阶段门禁

开发中按改动分批：

```text
npm run gate:edit
node --test tests/external-file-open.test.mjs tests/external-file-open-session.test.mjs
node --test tests/desktop-preload-ipc.test.mjs tests/project-open-queue.test.mjs
node --test tests/document-session.test.mjs tests/document-workflow.test.mjs
node --test tests/project-application-session.test.mjs tests/project-workflow.test.mjs
node --test tests/workspace-controller.test.mjs tests/version-workflow.test.mjs
npm run architecture:check
```

完成准备推送前：

```text
npm run task:finish
```

Ready/full-gate：完整 source matrix；Desktop/IPC/Bridge/Schema/Electron 风险应触发相应 native Electron和 Release Dry Run。任何新 commit使旧 exact-head证据失效，必须重新跑。

不在本计划自动制作 Developer Preview。只有另获明确授权时，才从指定 exact tree运行 `package:developer`，并额外验证安装 App的真实 HTML启动/再次打开路径，而不是只看源码测试。

## 7. 失败与恢复总表

| 失败点 | 已发生的持久变化 | 用户终态 | 自动动作 |
|---|---|---|---|
| 分类前路径非法/不可读 | 无 | 无法打开 | 不切项目 |
| 分类检测多 claim | 无 | 项目归属完整性错误 | 不提供选择器、不新建 |
| 首次/B dialog取消 | 无 | 回当前项目 | cancel intent |
| 确认期间原稿 Hash变 | 无 | 要求重新打开/确认 | 不导入、不继续 |
| current switch drain失败 | 无 | 旧项目可操作，显示原因 | 不 commit intent |
| import staging失败 | pending按事务清理 | 旧项目可操作 | 原稿不删 |
| 项目根发布后 Registry响应丢失 | 完整项目可能已发布 | 重放同 request恢复同项目 | 不创建第二个 |
| Main commit后 Renderer发布失败 | active可能已切、项目可能已导入 | rollback旧项目或 attention | 原稿不删 |
| Canvas验证失败 | 完整项目可能已存在 | rollback/明确失败+重试 | 原稿不删，不无限 pending |
| trash失败 | 项目和Canvas成功 | 项目已导入，原稿仍在 | 不回滚、不自动重试 |
| trash响应丢失 | 可能已进废纸篓 | 同 request返回receipt | 不二次 trash |
| dialog中退出 | 无 | 下次恢复旧项目/欢迎项目 | 未确认 intent丢弃 |
| import后、trash前崩溃 | 项目+binding已存在 | 再打开原稿显示B dialog | 不补删 |
| attention状态关闭应用 | 完整 committed项目保留 | 下次按active/Registry恢复 | 删除意图作废 |

## 8. 文件 / 函数 → 修改 → 不变量 → 主要测试

| 文件 / 函数 | 修改 | 不变量 | 测试 |
|---|---|---|---|
| `bridge/project-file-repository.mjs` `#recoveredImportTarget` | 替换为长期 binding resolver | 不依赖V1干净/latest/active V1 | edited/promoted/history WC reopen |
| 同文件 `#importExternal` | 已绑定先返回；新源才导入 | 同源最多一个项目 | same-source concurrency/failpoints |
| 同文件 Registry writes | current mutation lock + latest reread | 跨实例不丢写 | two repositories |
| 同文件 `classifyOpenPath` | A/B/C只读分类 | 分类零磁盘变化 | registry byte equality |
| `bridge/workspace-bridge.mjs` | read-only classification route | 路径不进query/响应 | bridge auth/DTO |
| `desktop/external-file-open.mjs` | Prepared Intent + receipt | raw path仅Main；幂等 | state-machine unit |
| `desktop/main.mjs` open functions | prepare不activate；commit才activate | 确认前active/recent不变 | project-open queue/Electron |
| `desktop/preload.mjs` | 窄prepare/commit/cancel/finalize | Renderer不能传删除path | preload IPC |
| `external-file-open-session.js` | confirmation/apply/attention状态 | request替换与迟到fence | Session unit |
| `project-application-session.js` | completion receipt | committed前序不被后继丢弃 | Session unit |
| `project-workflow.js` | 单一switch/commit/apply/rollback | 无双重freeze、无半Session发布 | workflow unit |
| `workspace-controller.js` | 项目打开→V1查看组合 | Workbench不跨workflow编排 | controller unit |
| `document-session.*` | Canvas authority终态 | generation/hash exact | session unit |
| `document-workflow.js` | single-flight verify/retry | 一次自动重建，失败终止 | workflow unit |
| `workbench.tsx` | dialog命令与Canvas投影 | 无平行事实、无Bridge直连 | Browser/Electron |
| `ExternalHtmlOpenDialog.tsx`（建议） | 两种dialog无障碍UI | 文案/焦点严格 | component/Electron |
| Electron helpers/specs | 真实驱动确认 | 无测试bypass | native + packaged startup |

## 9. 兼容、迁移与历史数据

### 9.1 不需要重写所有当前 Registry

当前项目 record已有 optional `importSourceKey/importSourceSha256` pair。PR-1直接读取它作为长期关联证据，不为了“升级语义”刷新 Registry时间戳或重写 bytes。

- 有唯一 pair：立即可识别 B；
- 没有 pair（欢迎项目、早期 exact legacy migration项目等）：保持未绑定，不能按文件名/Hash猜；用户应从项目目录打开；
- 多个历史 pair同 key：只对该 source报完整性错误，保留所有项目，不让整个 Registry的其他项目失效；
- 从 PR-1 起，新导入和 pending claim保证唯一，争取让正常用户永远不进入歧义状态。

不扫描用户磁盘寻找原稿，不读取真实用户 HTML做迁移，不自动删除/合并旧项目。

### 9.2 Schema shape

优先不改变 `project-registry.v4.schema.json` shape，只收紧生产操作语义和测试。如果实现确实需要新增 pending receipt字段：

1. 必须保持 optional、严格 validator和 JSON Schema同步；
2. 当前 shape读取不写；
3. 新 producer写完整新字段；
4. 旧 pending兼容只允许完成或失败关闭；
5. 更新 `COMPATIBILITY.md`、fixture和 package schema闭包；
6. 不得借同一个 `schemaVersion` 接受任意未知字段。

若需要新增顶层 `externalSources` index或改变 project record必需字段，停止本计划重新做 Registry versioning评审；本文默认不需要。

## 10. 安全审查清单

- [ ] Renderer永远不能提交外部 source path、source key或删除 path。
- [ ] 分类 route只由 authenticated Bridge调用，响应不含 path/content/hidden metadata。
- [ ] `importSourceKey`不授权写，只用于 lookup。
- [ ] 相同 Hash不同 path仍为不同项目。
- [ ] 多 claim/损坏绑定失败关闭，不猜测。
- [ ] Registry mutation跨实例串行，死锁恢复不删除新 owner。
- [ ] 确认期间 source Hash CAS。
- [ ] commit receipt幂等，未知响应不重复副作用。
- [ ] trash只接受 committed import requestId，且在 Canvas verified后。
- [ ] trash使用 `shell.trashItem`，不使用 `unlink`。
- [ ] projectsRoot内、V1、snapshot、symlink、目录、Hash漂移均拒绝。
- [ ] trash失败不回滚项目、不自动重试。
- [ ] close handoff不保存同意或delete checkbox。
- [ ] 测试仅使用合成临时文件，不触碰用户真实项目或废纸篓。
- [ ] 新模块若加入Electron包，更新allowlist/verifier。

## 11. 性能与可观测性

- 分类最多读取所选外部 HTML一次并读取 Registry/目标项目元数据；确认时为CAS再读一次。不得扫描所有项目文件内容。
- 查 claim可在 Registry project/pending记录上 O(project count)；本期不为此增加第二持久 index。若项目数实测成为瓶颈，再独立设计 index。
- 新增稳定错误码，不把本地 path、filename、HTML或原始异常送入 telemetry。
- 可记录非敏感枚举：`classification=managed|known|new`、`source_relation=unchanged|changed`、`result=confirmed|canceled|failed|reclassified`、`original_disposition=kept|trashed|trash_failed`、duration bucket。
- 不记录 project name、版本文件名、source key、Hash或绝对路径。
- Canvas可记录 `verified|failed|retried` 与 duration bucket，不记录 HTML。

## 12. Ready 前人工复核问题

实施者必须逐项回答并给出代码/测试证据：

1. 是否仍有任何本地/OS打开路径在确认前调用 `activateProject(externalOriginal)`？
2. 是否仍有 `null resolveOpenTarget → 一律 import` 的路径绕过 source binding？
3. V1 字节已变化、最新 V6、当前基于 V2 时，再开原稿究竟返回哪个 workingCopyId？
4. 对话框是否把 current based version与 latest official分开？
5. `sourceRelation=changed` 是否仍保持 B，不自动导入？
6. 同内容另一条路径是否仍为 C？
7. 两进程/两Repository同源并发由哪个文件系统原子动作保证唯一？
8. Main commit响应丢失如何回到同一 receipt？
9. 新 Canvas不 ACK时哪个 owner把状态设为 failed？用户如何重试？
10. 删除调用发生在什么 exact event之后？Renderer能否改变路径？
11. 再次打开确认框是否仍出现“查看初始版本 V1”？答案必须是否。
12. close/dialog替换/dispose是否都有 terminal transition？
13. 是否新增了第二个 Version Working Copy或“干净V1分支”？答案必须是否。
14. 是否改写外部原稿或V1 snapshot？除明确 trash外答案必须是否。

## 13. 实施完成报告

每个 PR 按 `CODEX_WORKFLOW` 报告：

- branch、exact commit、base/head；
- 逐文件摘要；
- 实际测试命令、通过数、失败/跳过原因；
- 文档/ADR/Schema影响；
- PR URL、Draft/Ready状态；
- worktree是否干净；
- 未完成项和明确不在范围项。

PR-2 额外附 PRD §16逐条验收表，并报告：

- 新外部源、已绑定源、受管项目三个真实入口；
- 当前本地编辑与最新正式版本分开展示；原稿与 V1 的 relation 只用于说明会不会自动导入；
- 同源重开前后 projectId、项目目录数、Version数；
- Canvas generation/Hash从 pending到verified或failed的证据；
- 删除 IPC精确参数面和负向测试矩阵；
- installed App验证是否执行。未获单独打包授权时明确写“未制作/未安装Developer Preview”，不能把源码测试说成安装验证。
