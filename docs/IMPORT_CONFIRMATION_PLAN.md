# 首次打开导入确认 · 修改计划

- 状态：施工合同；本文不授权合并、打 tag 或发布
- 产品规范：[IMPORT_CONFIRMATION_PRD.md](IMPORT_CONFIRMATION_PRD.md)
- 规划基线：`origin/main@e7fcc65529dd46bff45db4ef3237d58ce9a713fc`（以实施时再同步的 `origin/main` 为准）
- 目标边界：桌面打开未登记 HTML 的确认、默认复制导入、可选废纸篓删除原稿
- 明确不属于本计划：资源包/多文件网站、欢迎项目改版、浏览器导入、版本从 0 起算、跨项目去重、把 Candidate 写成项目根正式文件

> 任何实施 PR 仍需独立授权。本仓库当前这一支只提交产品和施工文档。

## 1. 执行结论

把「选中外部 HTML → 立刻 `ensureProject` / `importExternal` → 再把画布切到 V1」拆成两段：

1. **分类 + 确认**：主进程先判断是不是有效 v4 Project。是则走现有打开；否则只发出不透明待确认请求，渲染器弹出 PRD 确认框。确认前不写项目、不写 Recent、不把外部 HTML 挂到画布。
2. **导入 + 可选删除**：用户点「导入并打开」后，Repository 仍只在配置项目根内做现行原子复制导入。若勾选了删除，主进程在导入成功且当前目标已切到 V1 之后，把**本轮请求里的那一份外部 HTML**移入废纸篓。删除失败不回滚项目。

正式版本编号不变：导入 = V1，第一次采纳 AI = V2。

建议串行三步，不并行改同一条打开链：

| 步骤 | 内容 | 是否改生产行为 |
|---|---|---|
| 本文档 PR | PRD、本计划、现行文档指针 | 否 |
| 实施 PR-1 | 确认框 + 确认后才复制导入 | 是 |
| 实施 PR-2 | 勾选后废纸篓删除原稿（窄 IPC） | 是 |

PR-2 依赖 PR-1 的请求 ID 和确认框复选框。可以在 PR-1 就把复选框画出来但禁用并注明「下一 PR」，**不建议**：用户会以为勾了却没删。两个实施 PR 应紧挨着，或在同一实施 PR 里分提交；不得只上线确认框却留下不能工作的删除勾选。

若实施时选择单 PR，必须同时包含确认、复制导入和删除；安全测试不得省略。

## 2. 现行实现（基线事实）

当前桌面打开一条未登记 HTML 的大致顺序：

```text
用户选文件 / 外部打开
  → 主进程 projectOpenQueue + readHtmlProject
  → activateProject(原稿路径) 写入活动文件
  → 渲染器 FIFO 把原稿 HTML 挂到 DocumentSession / 画布
  → WorkspaceController.ensureRegistered()
  → Bridge POST /project/ensure
  → ProjectFileRepository.importExternal() 复制为项目内 V1
  → 再把权威路径切到 V1 工作文件
  → Toast：「已打开 / 原来的文件没有改动。」
```

关键代码：

| 位置 | 现在做什么 |
|---|---|
| `desktop/main.mjs` `openHtml()` | 选文件后立刻 `readHtmlProject` + `activateProject` |
| `desktop/external-file-open.mjs` | 校验外部绝对路径并进入打开队列 |
| `app/application/project-workflow.js` | 切换围栏后 `openLocal` / 外部接受，再 enqueue |
| `app/application/workspace-controller.js` `#createRegistration` | 对当前 `activeSource` 调 `ensureProject` |
| `scripts/workspace-bridge.mjs` `ensureProjectFile` | 直接 `importExternal` |
| `scripts/project-file-repository.mjs` `#importExternal` | 未登记则复制导入；已登记则返回现有 target |
| `app/workbench.tsx` `registration-published` | `imported: true` 时发上述 Toast |

因此今天有两个用户能感觉到的问题：确认前原稿已经变成当前文件；导入是静默的。实施必须先挡住这两步。

## 3. 目标运行时顺序

```text
切换围栏收口当前项目
  → 选文件或接受外部路径（主进程校验绝对 .html/.htm）
  → resolveOpenTarget
       ├─ 有效 v4：按现有路径 activate + 渲染器打开
       └─ 外部 HTML：
            不 activate 原稿
            分配不透明 requestId，把 {fileName, v1FileName, projectsRootBreadcrumb} 交给渲染器
            画布仍显示上一项目
            用户取消 → 丢弃 requestId
            用户确认 → Bridge importExternal(原稿路径, expectedHash)
                      → 发布 V1 后 activate(V1 路径)
                      → 若勾选删除：主进程 trash 本轮原稿路径
                      → 成功提示 + 可「在文件夹中打开」
```

`importExternal` 的复制/staging/Registry 协议保持不变。新增的只是调用时机、确认门闩，以及导入成功后一条独立的删除操作。

## 4. 所有权与接口

### 4.1 不新增第二套 Session 事实

按 ADR 0011 / 0019：

- 待确认路径和 requestId：主进程打开队列 / 外部打开 mailbox（扩展现有 owner，不新建「磁盘权威」）。
- 确认框可见性、勾选、展示文案：`ProjectWorkflow` 编排，Workbench 只负责呈现。
- 导入结果：仍由 `ProjectFileRepository` 发布，Controller 经现有 `ensureProject` / 打开成功路径写入 Project/Document/Version Session。
- 删除原稿：只允许主进程执行。

禁止：Workbench 直接调 Bridge 导入或删除；Renderer 传文件系统路径给删除 IPC；把勾选写入 `project.json`、Registry 或 `localStorage`。

### 4.2 建议的窄接口

名称可在实施时按现有 codec 风格微调，语义不能加宽。

**主进程 → 渲染器（待确认）**

```text
{
  requestId,          // 主进程生成，一次性
  sourceFileName,     // 产品首页.html
  visibleV1FileName,  // 产品首页-V1.html
  projectsRootLabel,  // 文稿 › PageRoot › 项目
  sourceSha256        // 打开确认框时的外部 Hash，确认时原样交回
}
```

不传绝对路径给渲染器删除逻辑。若现有外部打开已经用 requestId 换路径，复用该模式：渲染器只回传 `requestId`。

**渲染器 → 主进程 / Bridge（确认）**

```text
{
  requestId,
  deleteOriginal: boolean
}
```

Bridge `ensureProject` / `importExternal` 仍只接收主进程已绑定的 `sourcePath` + `expectedSourceSha256`。`deleteOriginal` 不得进入 Repository。

**主进程删除**

```text
trashExternalSourceAfterImport({ requestId, expectedSourceSha256, importedWorkingCopyPath })
```

内部再次：取 requestId 对应路径、普通文件、非软链接、真实路径不在项目根内、Hash 仍匹配、且不等于 `importedWorkingCopyPath`，然后 `shell.trashItem`。任何一项失败都返回明确错误，不抛到「项目导入失败」。

### 4.3 展示用 V1 文件名

确认框里的 `产品首页-V1.html` 必须调用与 `#importExternal` 相同的 `safeProjectName` / `htmlExtension` / `visibleFileName(..., 1, extension)`。允许只读预计算，禁止为了预计算而 `allocateProjectRoot` 或写 `pendingImports`。

项目根面包屑：若真实根是默认 `~/Documents/PageRoot/项目`，固定显示「文稿 › PageRoot › 项目」；否则按真实根做 ` › ` 分段。不要把即将分配的项目文件夹名拼进去。

## 5. 实施 PR-1：确认后才导入

### 5.1 行为

- 未登记 HTML 弹出 PRD §4 确认框。
- 取消 / Escape / 遮罩：PRD §6。
- 「导入并打开」：现行 `importExternal` 复制导入，再 activate V1。
- 复选框先画出来；若与 PR-2 分开发布，这一 PR 必须把勾选接到删除实现，不能做假勾选。

### 5.2 主要改动文件

| 文件 | 改动 |
|---|---|
| `desktop/main.mjs` | `openHtml` 分类；外部未登记时不 `activateProject(原稿)` |
| `desktop/external-file-open.mjs` | 冷启动 / Open With 同样进入待确认，而不是当已打开源 |
| `desktop/preload.mjs` | 暴露待确认与确认/取消；不暴露任意删除路径 |
| `app/application/project-workflow.js` | 打开结果增加 `pending-import`；确认/取消命令；替换待确认文件时重置勾选 |
| `app/application/workspace-controller.js` | 注册/ensure 只在确认后对导入结果执行；禁止用原稿路径先挂画布再导入 |
| `app/application/external-file-open-session.js` 或等价打开 session | 承接待确认请求的一次性 ID 与替换规则 |
| `app/workbench.tsx` / `app/workbench/presentation.tsx` | 确认框 UI；废止旧 Toast |
| `app/workbench/AiReviewWorkspace.tsx` 的 `confirmDialog` 样式 | 复用，不新做一套视觉语言 |
| `scripts/workspace-bridge.mjs` | `ensureProject` 仍只负责导入；可增加只读 classify 若主进程不直接调 Repository |
| `scripts/project-file-repository.mjs` | 如需，抽出纯函数给 V1 文件名/面包屑；`#importExternal` 复制语义不变 |

分类既可在主进程直接调 Repository，也可经 Bridge 只读接口。为避免主进程依赖 Bridge 才知道「是不是 v4」，优先让 Desktop 在打开队列里使用与 Bridge 同一套 Repository 只读解析，或抽一层无副作用的 `classifyOpenPath`。不得靠「先导入再看返回值 `imported: false`」来分类。

### 5.3 欢迎项目与浏览器

- 欢迎项目首次写入并登记：保持 `INTERACTION_FLOW` §3.1，不进确认框。
- 浏览器 `openLocal` / `browser-file`：无项目目录写入，不进本流程。

### 5.4 文档（PR-1 必须同步）

把 PRD 从「待实施」变成现行行为，并改写被取代条款：

- `docs/INTERACTION_FLOW.md` §4 步骤 3–4
- `docs/VERSION_AND_PROJECT_FILES_PRD.md` §7.1 / §7.3 / §16.1 首条 / §16.3
- `docs/MVP_PRD.md` 打开段落
- `docs/NOTIFICATION_MESSAGE_CATALOG.md` 增加确认框与新成功/失败提示，删除或标注废止的旧 Toast
- `docs/STATE_OWNERSHIP.md` 增加待确认请求行
- `docs/ARCHITECTURE.md` 打开路径那一段
- `CHANGELOG.md`（若该实施 PR 会进入发布说明）

PRD 本文状态改为「已实施」，或把冲突段落直接合并进 `VERSION_AND_PROJECT_FILES_PRD.md` 后在本文保留短指针。不要两份正文长期双写。

### 5.5 测试（PR-1）

| 层 | 覆盖 |
|---|---|
| Node：Repository | 现有 `importExternal` 仍复制、不删原稿；文件名函数与确认框预计算一致 |
| Node：ProjectWorkflow / ExternalFileOpenSession | 未确认不 enqueue 画布；取消不导入；确认才导入；新请求替换待确认并重置勾选；关闭确认视为取消 |
| Node：Desktop 打开分类 | v4 直接打开；外部进 pending；非 html 失败 |
| Electron | 打开未登记 HTML 看见确认框；取消后当前源不变；确认后源路径变成 `…-V1.html` 且原稿仍在 |
| 回归 | 打开已登记 V1、项目目录切换、欢迎启动、外部打开队列取代，均无确认框或确认框被正确跳过 |

现有大量测试默认「打开外部 HTML 即 V1」。凡走 UI/打开队列的，都要补确认动作。直接调用 `repository.importExternal` 的单测保持原样，它们不是产品打开路径。

禁止增加生产开关 `SKIP_IMPORT_CONFIRM`。测试通过驱动确认框或调用与产品相同的确认命令。

## 6. 实施 PR-2：可选删除原稿

若与 PR-1 合并不再单列，本节仍必须完整实现。

### 6.1 行为

见 PRD §8–§9。默认不删。勾选且导入成功后 `shell.trashItem(原路径)`。

### 6.2 安全是本 PR 的硬范围

这是配置项目根之外的破坏性操作，必须有失败关闭测试：

- 无 requestId / 过期 ID / 已消费 ID
- Renderer 伪造路径（接口根本不接受路径则断言无此参数）
- 目标位于 `projectsRoot` 内
- 目标等于刚发布的 V1 或隐藏快照
- 软链接、目录、非 html
- Hash 已与导入记录不同
- `trashItem` 抛错

以上均不得删除项目文件，也不得把导入标为失败（导入已成功时）。

`docs/SECURITY_MODEL.md` 必须增加这一条窄权限：仅限「本轮已成功导入的外部源 HTML → 废纸篓」，并写明 Renderer 无路径权。

建议同时写短 ADR（下一个空号，当前决策目录最新为 0025；实施时核对避免与既有 0022 重号）：

- 导入必须明示同意
- 删除原稿是导入成功后的可选补偿，不是 `mv` 进项目
- 废纸篓而不是 `unlink`
- Repository 不获得项目根外删除权

### 6.3 测试（PR-2）

- 不勾选：原稿仍在原路径，字节不变
- 勾选成功：原路径不存在（或仅存在于废纸篓），V1 可打开
- 勾选但 trash 失败：V1 可打开，原稿仍在，提示文案固定
- 导入失败：无论勾选与否都不 trash
- 崩溃窗口：导入已发布、删除未发生 → 再打开原稿仍走确认框

Electron 测废纸篓时，使用隔离临时目录中的原稿，不要动开发者真实文稿。

## 7. 文案与 UI 实现要点

确认框结构（标题 / 三段说明 / 复选框 / 双按钮）必须能被测试按角色名取到：

- 对话框名：标题全文，例如 `要把「产品首页.html」导入 PageRoot 吗？`
- 主按钮：`导入并打开`
- 次按钮：`取消`
- 复选框：`成功导入后删除原文件`

说明段落按 PRD 固定句子拼接 V1 文件名和面包屑，避免改成更「技术」的句子。

成功提示从 Workbench `registration-published` 的 `imported: true` 分支改到 PRD §9。删除结果由主进程随打开成功一并返回 `originalDisposition: kept | trashed | trash-failed`，不要让渲染器自己去 stat 原稿。

## 8. 风险与处理

| 风险 | 处理 |
|---|---|
| 确认前已经 activate 原稿，用户开始编辑 | PR-1 必须取消这条路径；这是本计划最高优先级回归 |
| 测试/自动化假设静默导入 | 更新 Electron helper；Repository 直调保持 |
| 删除权限被做成通用 IPC | 接口只接受 requestId；安全测试列为 P0 |
| 勾选删除但相对资源还在原目录 | 产品已说明资源不导入；原稿进废纸篓后会话资源根可能失效，不改 HTML 补路径 |
| 用户取消外部打开后以为文件丢了 | 取消不做任何磁盘操作 |
| 同内容二次打开变成第二项目 | 保持现状并在确认框再次出现；本计划不做去重 |
| 冷启动渲染器未就绪 | 待确认请求等渲染器，不退回原生 `showMessageBox`，不在等待期间导入 |

## 9. 明确不做

- 让用户挑选项目目录或项目名
- 把整夹资源一起复制/移动
- 记住「上次勾选了删除」
- 用 Hash 把原稿识别成已有项目
- 确认框里预览 HTML
- 改欢迎页文案去解释本流程（除非实施时发现欢迎页仍在教「打开即改原文件」）
- 为删除做回收站面板或「撤销导入」

## 10. 验证阶梯

1. 文档 PR：`npm run gate:edit`（影响映射应打到文档/策略类测试；无生产逻辑也可仅静态检查）。
2. 实施 PR：开发中 `npm run gate:edit`；准备推送前 `npm run task:finish`。
3. 打开路径、IPC 与删除权限变更属于信任边界，Ready / `full-gate` 必须跑完整源码矩阵；`candidate-context` 若判定 Electron/Desktop 风险，会带 Release Dry Run。
4. 不在本计划里打包安装包，除非另有明确授权。

## 11. 实施完成时的报告要求

除 `CODEX_WORKFLOW` 常规报告外，实施 PR 必须能逐条勾 PRD §14 验收，并写明：

- 确认前是否仍有任何路径会 `activateProject(原稿)` 或 `ensureProject` 静默导入；
- 删除 IPC 的精确参数面；
- 更新了哪些打开相关 Electron 测试与 helper。
