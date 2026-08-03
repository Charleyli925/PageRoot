# PageRoot Change Request 协议

- 协议主版本：3
- 状态：目标写入合同
- 上位文档：[架构说明](ARCHITECTURE.md)
- 安全边界：[安全模型](SECURITY_MODEL.md)
- Schema 入口：[schemas](../schemas)
- 代表性样本：[fixtures/v3](../fixtures/v3)

本协议规定 PageRoot 与内部 AI 通过本地可见文件夹交接时的身份、目录、冻结、完成、校验、事务和恢复规则。

v3 是干净切换后的唯一运行时协议。v1/v2 记录在切换前整体备份并转为只读归档；新程序不包含兼容 Reader 或自动迁移器。新写入不得沿用以下旧路径：

- 通过本地编辑创建 `local-editor` Version。
- 通过历史恢复创建 `restore` Version。
- 使用全局可变 `current/` 作为当前事实源。
- 只因 HTML 在固定窗口内未变化就自动成功。
- 把非权威摘要文件当作可选或替代完成信号。

## 1. 协议原则

1. 项目 `sourcePath` 当前指向的 HTML 是当前可编辑内容的唯一事实源。本地直接编辑修改这份文件；AI 成功先创建不可变 Version 与新工作文件，用户明确点击打开后才切换 `sourcePath`，不覆盖旧文件。
2. Request 是一次冻结快照，不随之后的本地编辑变化。
3. 系统是候选版本身份的唯一分配者。
4. 受支持 finalizer 最后原子写入的 `completion.json` 是唯一完成信号。
5. 工作台必须独立重算 Hash，不信任声明。
6. 只有带有效 `committed.json` 的 Version 才正式存在。
7. 运行时状态按项目隔离，当前项目锁不影响其他项目。
8. 所有新 JSON 使用严格 Schema，拒绝未知字段。
9. 仅打开或预览未登记 HTML 时，源文件、registry 和项目目录保持不变；第一次真实持久化或发送给内部 AI 时才建立项目身份与初始基线。

## 2. 目录

```text
项目记录/
└── projects/
    └── <displayName>__<YYYYMMDD-HHmmss>__<shortProjectId>/
        ├── project.json
        ├── PROJECT.md
        ├── runtime-state.json
        ├── edit-audit.jsonl
        ├── working/
        │   ├── V1.1.html
        │   └── V1.2.html
        ├── draft/
        │   ├── annotations.json
        │   └── attachments/<commentId>/<attachmentId>-<fileName>
        ├── recovery/
        │   └── autosave.jsonl
        ├── transactions/
        │   └── <transactionId>/
        │       ├── transaction.json
        │       ├── recovery/source.html
        │       └── prepared-version/
        ├── versions/
        │   └── <versionId>/
        │       ├── files/index.html
        │       ├── annotations/records.json
        │       ├── version.json
        │       └── committed.json
        └── requests/
            └── <requestId>/
                ├── PROMPT.md
                ├── change-request.json
                ├── input-manifest.json
                ├── input/
                │   ├── base/index.html
                │   ├── annotations/records.json
                │   ├── attachments/<commentId>/<attachmentId>-<fileName>
                │   ├── AI_RULES.md
                │   ├── PROJECT.md
                │   └── references/
                └── attempts/
                    └── <attemptId>/
                        ├── USER_SUPPLEMENT.json
                        ├── supplement-attachments/
                        ├── candidate-assessment.json
                        ├── validation-review.json (legacy only)
                        ├── annotations.json
                        ├── output/index.html
                        ├── completion.json
                        └── outcome.json
```

约束：

- 每个项目拥有独立目录、runtime state、事务、Version 和 Request。
- 完整 `projectId` 只作为协议身份；registry 通过不可变
  `storageDirectoryName` 定位可读项目目录。仅完整且身份可验证的 PageRoot
  0.9.0 v3 项目允许由单一兼容适配器在原目录补写
  `storageDirectoryName=projectId`；v1/v2、记录不完整或身份不一致的旧目录不迁移。
- `PROJECT.md` 是整个项目长期使用的 AI 修改规则，不只属于某一次 Request；项目空闲时允许用户修改并由工作台自动保存，处理期间只读。Request 会把当时已持久化规则冻结到 `input/PROJECT.md`。
- `runtime-state.json` 与 `edit-audit.jsonl` 是系统运行和本地直接编辑的审计文件，只建议查看，不提供普通用户编辑入口。
- `working/V1.x.html` 是有效 AI 结果通过校验后创建的完整 HTML。它先进入“可审阅/打开”状态；审阅只读不会切换项目当前源，只有用户点击“直接打开”或在审阅页确认“打开 AI 修改后”才成为项目当前源。旧工作文件永不原地改写。
- input manifest、冻结 annotation 等可移植索引只使用项目或 Request 内相对路径。
- `PROMPT.md` 可以包含本机绝对 Attempt 路径和可直接执行的 finalizer 命令。
- `change-request.json` 的附件项可以额外包含由系统生成的 Request 内本机绝对 `localPath`，供当前电脑上的内部 AI / QoderWork 直接读取；同一项必须保留可移植的 `requestRelativePath`。
- 除受控的 Request/Attempt/output/completion/附件 `localPath` 外，结构化路径不得为绝对路径；所有相对路径不得包含 `..`，任何路径都不得通过软链接逃逸项目目录。
- output 只有一个完整 HTML，不得创建 `PROJECT.md` 或其他额外页面资产。
- Finder 在 Attempt 或 output 中生成的普通、非软链接 `.DS_Store` 只属于系统显示元数据，不参与协议也不改变状态；其他未声明条目和同名软链接仍按协议违规拒绝。

## 3. 身份

### 3.1 格式

| 对象 | 格式 |
|---|---|
| 项目 | `project_<stable-id>` |
| 文档 | `doc_<stable-id>` |
| Version | `ver_0009` |
| Request | `req_<stable-id>` |
| Attempt | `attempt_001` |
| Transaction | `txn_<stable-id>` |

### 3.2 候选身份

每个 Request 固定：

```json
{
  "basedOnVersionId": "ver_0005",
  "previousVersionId": "ver_0008",
  "candidateVersionId": "ver_0009",
  "candidateVersionOrdinal": 9,
  "candidateVersionLabel": "V9"
}
```

- `basedOnVersionId` 表示冻结内容的谱系基础。
- `previousVersionId` 表示时间线上最新正式 Version。
- `candidateVersionId` 是本次可能提交的下一版。
- 内部 AI 不得自行改名、递增或另建版本身份。
- 候选只有成功提交后才被占用。

协议字段继续使用既有 `candidateVersionLabel=V1/V2/V3`，以兼容严格 v3 Schema；UI 按同一 ordinal 显示“版本 1、版本 2、版本 3”。既有 `working/*-V1.x.html` 文件名继续兼容，不作为用户版本名。内部 AI 必须原样保留协议标签，不能把显示标签写回旧字段。

## 4. 提交前冻结

### 4.1 锁定顺序

用户触发交接时，工作台必须在任何异步操作前同步持久化或至少同步进入可持久化的：

```text
lifecycleState=submitting
projectLocked=true
freezeCutoffRevision=<current editRevision>
```

随后：

1. flush 同一自动写回队列。
2. 等待 `lastPersistedRevision >= freezeCutoffRevision`。
3. 重读源 HTML并计算精确 Hash。
4. 把这份完整源 HTML 冻结到 `input/base/index.html`，再冻结截止 revision 内的 comments 和 edit events。
5. 分配 Request、Attempt 和候选 Version 身份。
6. 在临时目录完成全部文件。
7. Schema/Hash 校验通过后原子发布 Request。
8. 将状态改为 `processing`。

若任一步失败，删除未发布临时目录并回到 `editing`；不得丢失评论、编辑事实或源 HTML。

成功发布 Request 后，`input/base/index.html` 是本轮修改前的完整、不可变基线。无论 AI 最终成功、失败、取消或 no-change，它都不得被工作文件或后续 Request 替换。

### 4.2 冻结边界

冻结文件：

- `input/base/index.html`
- `input/annotations/records.json`
- `input/AI_RULES.md`
- `input/PROJECT.md`
- `input-manifest.json`
- `change-request.json`
- `PROMPT.md`

冻结后这些文件不可修改。用户在内部 AI 对话中新增、修订或撤销要求时，内部 AI 必须先调用 Prompt 提供的受控 helper，把用户原话追加到当前 Attempt 的 `USER_SUPPLEMENT.json`；helper 返回成功后才能执行。原始 Request 不变。Attempt 已封存后，任何新要求都必须创建新 Request。

## 5. Change Request v3

权威 Schema：

[change-request.v3.schema.json](../schemas/change-request.v3.schema.json)

顶层结构：

```json
{
  "schemaVersion": "3.0.0",
  "status": "frozen",
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "createdAt": "2026-07-17T08:34:00Z",
  "frozenAt": "2026-07-17T08:34:00Z",
  "freezeCutoffRevision": 42,
  "versionIdentity": {
    "basedOnVersionId": "ver_0005",
    "previousVersionId": "ver_0008",
    "candidateVersionId": "ver_0009",
    "candidateVersionOrdinal": 9,
    "candidateVersionLabel": "V9"
  },
  "baseSnapshot": {
    "relativePath": "input/base/index.html",
    "byteLength": 4988,
    "sha256": "sha256:...",
    "comparisonSha256": "sha256:...",
    "canonicalizationVersion": "1"
  },
  "paths": {},
  "requirements": {},
  "annotations": {},
  "finalization": {}
}
```

### 5.1 `baseSnapshot`

- `relativePath` 固定为 `input/base/index.html`。
- `sha256` 是冻结字节的精确 SHA-256。
- `comparisonSha256` 是规范化算法输出的比较 Hash。
- `canonicalizationVersion` 固定解析/序列化规则。
- `byteLength` 必须与实际 UTF-8 字节数一致。

### 5.2 `requirements`

要求包含：

- 一句摘要。
- 至少一条带稳定 `instructionId` 的指令。
- 每条指令引用明确 `targetRefs`。
- 每个 target 保存稳定 ID、用户可读 label、层级和定位。
- `preserveOutsideTargets=true`。

目标层级：

- `module`
- `subregion`
- `text`
- `insertion-point`

每个 TargetRef 必须使用 v3 的干净结构：

- `targetId`、`label`、`level`。
- `selector`、`sourceAnchor`、`fingerprint` 至少存在一种；允许组合使用来提高唯一定位置信度。
- 若包含源码锚点，只使用冻结基线中的 `sourceAnchor.startOffset/endOffset/sourceSha256`。
- 若包含指纹，使用 `fingerprint.tagName/stableAttributes/ancestorFingerprint`，可带文字前后缀。
- 面向 AI 执行的整模块 TargetRef 若文字引用超过 500 字符，`change-request.json` 省略低信息密度的 `textQuote`，仍使用 selector、sourceAnchor 和 fingerprint 精确定位；完整冻结记录中继续保留捕获时的引用用于审计。
- `resolution=exact|rebound|ambiguous|orphaned`。

`insertion-point` 的 `sourceAnchor` 必须是位于唯一父节点真实子节点边界上的零宽范围，即 `startOffset=endOffset`；不能使用旧 insertion `anchor` 对象或仅凭同级序号猜测位置。

offset 统一按 JavaScript UTF-16 code unit 计算。Request 只能把 `exact` 或 `rebound` 目标列入可执行范围；`ambiguous` 和 `orphaned` 评论仍保留审计记录，但必须先重新绑定才能驱动 AI 建版。

### 5.3 `annotations`

指向符合 [annotation-records.v3.schema.json](../schemas/annotation-records.v3.schema.json) 的冻结记录，并保存：

- 相对路径。
- 精确 Hash。
- 评论数。
- edit event 数。
- 附件数。

### 5.4 `finalization`

固定：

- `outputRelativePath=output/index.html`
- `completionRelativePath=completion.json`
- `completionSchema=completion.v1.schema.json`
- 受支持 finalizer 版本
- 可直接执行的完整 finalizer 命令

Request 不定义任何基于时间窗口的成功条件。

## 6. Annotation records v3

权威 Schema：

[annotation-records.v3.schema.json](../schemas/annotation-records.v3.schema.json)

根记录固定：

- 项目、文档、Request、Attempt。
- `capturedAt`。
- `freezeCutoffRevision`。
- `basedOnVersionId`。
- `baseSnapshotSha256`。
- comments 与 edit events。

Comment 包含：

- 稳定 `commentId`。
- 创建/更新时间。
- `capturedRevision`。
- 正文与目标。
- `attachments[]`：稳定 `attachmentId`、图片/文件类型、文件名、媒体类型、字节数、Hash、项目相对路径、Request 相对路径和添加来源。
- `request-only` 或 `project-rule`。

附件实体保存在项目目录，草稿阶段位于 `draft/attachments/`；系统不保存用户桌面、下载目录、移动硬盘等外部原始路径。冻结 Request 时逐个重新读取并核对字节数与 Hash，再优先以 copy-on-write 独立快照写入 `input/attachments/<commentId>/`，文件系统不支持时回退为完整复制；文件和父目录同步成功后才能发布 Request。冻结 Comment、`requirements.attachments[]`、对应 instruction 的 `attachmentRefs[]` 和 input manifest 必须引用同一组附件 ID；其中 `targetRef` 明确附件随哪条评论作用于哪个模块或子区域。

`requirements.attachments[]` 同时提供 Request 相对路径和 Request 管理文件的本机绝对 `localPath`。绝对路径只指向当前 Request 冻结快照，不得指向选择附件时的外部原文件。若项目目录整体移动，AI 应以 Request 根目录加相对路径重新定位。交接记录不得包含附件 Base64 或二进制内嵌内容。

Edit event 包含：

- 稳定 `eventId`。
- 时间与 revision。
- 发生编辑时的 `basedOnVersionId`；后续历史恢复不能改写这个事实。
- `text/style/reorder/structure`。
- 目标、摘要、before、after。

新记录没有 `committedVersionId`。本地编辑是事实审计，不通过保存变成 Version。成功的 AI Version 通过 `annotationArchive` 引用同一冻结记录；失败、取消、no-change 或冲突未采用时，Request 仍保留这些记录。

`input/annotations/records.json` 是不可变审计归档，保留评论和全部直接编辑事实，但不再作为 AI 默认执行输入。内部 AI 以 `change-request.json` 中的 instructions、targets 和 attachments 为唯一执行来源，避免重复读取同一评论和大量历史 edit events。

## 7. Input manifest

权威 Schema：

[input-manifest.v1.schema.json](../schemas/input-manifest.v1.schema.json)

Input manifest 同时包含完整冻结 Hash 清单 `files` 和 AI 执行读取子集 `readOrder`。

`files` 至少库存：

1. `PROMPT.md`
2. `input/AI_RULES.md`
3. `change-request.json`
4. `input/PROJECT.md`
5. `input/base/index.html`
6. `input/annotations/records.json`（完整审计归档）
7. 评论附件 `input/attachments/...`（存在时逐个列出，角色为 `reference`）
8. 其他明确列出的 references
每项包含相对路径、角色、媒体类型、字节数和 SHA-256。`readOrder` 默认依次只读 PROMPT、AI_RULES、change-request、PROJECT、base HTML 和评论附件；不包含 `input/annotations/records.json`。AI 只能读取 `readOrder` 声明的执行输入，不扫描 files 中仅用于审计的条目、其他 Request、Version 或项目目录。

`input-manifest.json` 只描述冻结的原始输入。当前 Attempt 的 `USER_SUPPLEMENT.json` 是唯一允许在冻结后额外读取的动态执行记录；它不回写 manifest，也不能由内部 AI 直接编辑。

## 8. Prompt

Prompt 必须是当前 Attempt 的精简入口，至少包含：

- PageRoot 品牌标题，并按“本轮身份、执行顺序、文件位置、对话补充、附件、完成”分组，避免把协议要求堆成一段难读的说明。
- 本机 Request 与 Attempt 绝对路径。
- Request、Attempt、项目、文档与候选 Version 身份。
- 读取顺序。
- 评论、TargetRef 与附件清单的读取要求；不得只读正文而忽略图片或文件。
- 每个附件的 Request 管理本机绝对路径和相对回退路径；明确禁止追踪外部原始文件。
- 唯一 output 路径。
- 完整 finalizer 命令。
- “完成全部写入后最后执行 finalizer”的明确要求。
- finalizer 返回 `status=cancelled` 时立即停止、不重试、也不改写到其他路径的明确要求。
- 不得修改冻结输入、不得扫描其他任务；`preserveOutsideTargets=true` 是默认边界，只有已经通过 helper 记录的用户补充可以明确扩大本轮范围。
- 对话补充 helper 的完整命令、追加式 `add / amend / retract` 规则，以及“记录成功后才可执行”的停止条件。
- `input/PROJECT.md` 只读；长期项目规则不得在本轮任务中修改。

Prompt 不让 AI 手写 `completion.json`，也不让 AI猜候选版本号。

## 9. AI 写入规则

内部 AI 可直接写：

- `attempts/<attemptId>/output/index.html`

`USER_SUPPLEMENT.json` 只能由受控 helper 追加，内部 AI 不得直接编辑。helper 可把内部 AI 当前对话新增的文件或图片复制到 `supplement-attachments/` 并记录字节数与 SHA-256；无法取得原件时只能写 `description-only`，历史中明确显示“原件未归档”。旧记录不可覆盖，只能通过 `add / amend / retract` 形成审计链。`add.refersTo` 可以指向它所补充的原始 `instructionId`；`amend / retract` 必须引用原始 instruction 或更早的 supplement record。所有写入、封存、建版与历史读取都使用同一组冻结 instruction 身份校验。

`amend` 会替代它引用的旧 supplement record，`retract` 会撤销它引用的 record；Prompt 和历史只消费最终仍有效的记录。有效补充与原始 TargetRef 一起解释用户想改什么，但不充当候选 Version 的逐节点授权表。脚本/handler/可执行 URL、身份、Hash、路径与协议仍按硬边界拒绝；普通正文、属性、结构和样式由审阅流程确认。

finalizer 可写：

- output 中的受控版本 meta
- `attempts/<attemptId>/completion.json`
- `USER_SUPPLEMENT.json` 的封存字段与整组记录、附件 Hash

工作台事务可写：

- `transactions/<transactionId>/`
- `versions/<candidateVersionId>/`
- 真实源 HTML
- `project.json`
- `runtime-state.json`
- Attempt 的 `outcome.json`

AI 不得：

- 修改 Request 或 frozen input。
- 修改其他 Attempt。
- 写 Version 目录、commit marker、项目状态或源 HTML。
- 在 output 中创建未声明资产。
- 手写 completion。

## 10. HTML 机器元数据

finalizer 在 `<head>` 中写入或校验：

```html
<meta name="html-ai-document-id" content="doc_dashboard">
<meta name="html-ai-version-id" content="ver_0009">
<meta name="html-ai-version-label" content="V9">
<meta name="html-ai-based-on-version-id" content="ver_0005">
<meta name="html-ai-request-id" content="req_metrics_cards">
```

这些值来自冻结 Request。Version manifest 是最终身份权威；HTML meta 用于独立识别与交叉校验。

## 11. Finalizer 与 completion

### 11.1 finalizer 前置条件

finalizer 必须：

1. 解析受控 Attempt 路径。
2. 向上定位唯一冻结 Request。
3. 校验路径未逃逸项目。
4. 读取项目身份与 `runtime-state.json`。
5. 在拒绝非活动 Attempt 之前，检查当前确切 Attempt 是否已有普通文件 `cancelled.json`。
6. 若取消标记存在，校验其 Schema、project/document/request/attempt 身份、`status=cancelled` 与非空 `cancelledAt`；匹配时返回 11.4 的取消终态，身份不符或软链接等不安全标记必须失败关闭。
7. 若没有取消标记，确认 active run 身份完全匹配、状态允许完成，且未失败或被替代。
8. 校验完整 HTML。
9. 写入受控 meta。
10. 计算精确与比较 Hash。
11. 用临时文件、刷盘、原子 rename 最后写入 completion。

### 11.2 Completion v1

权威 Schema：

[completion.v1.schema.json](../schemas/completion.v1.schema.json)

```json
{
  "schemaVersion": "1.0.0",
  "finalizerVersion": "1.0.0",
  "status": "completed",
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "basedOnVersionId": "ver_0005",
  "previousVersionId": "ver_0008",
  "candidateVersionId": "ver_0009",
  "candidateVersionOrdinal": 9,
  "candidateVersionLabel": "V9",
  "baseSnapshotSha256": "sha256:...",
  "inputManifestSha256": "sha256:...",
  "outputRelativePath": "output/index.html",
  "outputSha256": "sha256:...",
  "baseComparisonSha256": "sha256:...",
  "outputComparisonSha256": "sha256:...",
  "canonicalizationVersion": "1",
  "completedAt": "2026-07-17T08:40:00Z"
}
```

Completion 必须在 output 完全关闭后最后写入。完成后 output 封存；任何后续字节变化都使本次 completion 失效。

### 11.3 工作台发现 completion

工作台：

1. 只监听 `runtime-state.json.activeRun` 指向的确切 Attempt。
2. 原子读取 completion。
3. 校验 Schema 与 finalizer 版本。
4. 重新读取 runtime state，核对 active run。
5. 重读 Request 和实际 output。
6. 重算所有关键 Hash。
7. 进入 no-change、冲突或事务提交。

不扫描其他 Request，不按目录时间猜测，不复用旧 completion。
界面只根据 completion 是否已经出现显示“AI 已返回”；完成信号出现前的文件错误不得冒充 AI 返回。

### 11.4 已取消 Attempt 的 finalizer 结果

用户结束本轮后，官方 finalizer 对同一 Request/Attempt 返回成功退出的机器可读终态：

```json
{
  "ok": true,
  "status": "cancelled",
  "accepted": false,
  "retryable": false,
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "cancelledAt": "2026-07-29T08:40:00Z",
  "message": "本轮已在源页结束。请停止 AI Agent，不要重试。"
}
```

这是幂等的正常终态，不是 completion，也不表示候选已被接纳。finalizer 不修改 output、不写受控 meta 或 `completion.json`，工作台不创建 Version。重复执行返回同一类不可重试结果；AI Agent 必须停止，不能把它当作路径或保存故障重试。

## 12. 规范化比较

`canonicalizationVersion=1` 的合同：

1. 使用固定版本 HTML parser 解析冻结输入和 output。
2. 只删除五个明确白名单 meta：
   - `html-ai-document-id`
   - `html-ai-version-id`
   - `html-ai-version-label`
   - `html-ai-based-on-version-id`
   - `html-ai-request-id`
3. 用同一确定性 serializer 输出 UTF-8。
4. 计算两侧 SHA-256。

不得：

- 删除所有 `html-ai-*`。
- 忽略 CSS 或 JavaScript。
- 忽略正文、结构、普通属性或普通空白差异。
- 使用不同 parser/serializer 比较两侧。

比较 Hash 相同即 no-change：

- 不创建 Version。
- 不消耗候选身份。
- outcome 记录 `no-change`。
- Request、Attempt、评论和诊断保留。
- runtime state 回到 editing。

### 12.1 候选 HTML 健康与连续性评估

比较 Hash 不同不代表可以直接打开。Bridge 必须以冻结 base 和 AI output 生成：

[candidate-assessment.v1.schema.json](../schemas/candidate-assessment.v1.schema.json)

`candidate-assessment.json` 记录：

- base/output 精确 Hash 与比较 Hash，以及 Request、Attempt、候选 Version 身份；
- 完整文档、非空可显示 body、可执行表面不变三项健康结果；
- 可见文字 shingles、稳定 id/data 锚点、class、资源引用和 title 的粗粒度重合证据；
- `ready | attention | blocked` 与稳定 issue code。

`blocked` 只用于候选无法作为正常 HTML 使用，或可执行表面发生变化。协议、身份、Hash、
路径、受管 metadata 和 completion 封存仍在 assessment 之前硬阻断。`attention` 表示 HTML
可以打开，但系统无法充分证明它继承了上一版；Bridge 仍创建不可变候选 Version，界面必须
移除“直接打开”并要求先进入隔离对比审阅。`ready` 允许审阅或直接打开。

v3 TargetRef、评论和 supplement 继续作为生成指令与历史证据，但不再逐节点限制候选
Version。旧 Attempt 的 `scope-report.json` 与 `validation-review.json` 仍可只读展示；新
Attempt 不生成它们。`scope-validator.mjs` 继续服务直接 source patch、兼容性和独立合同测试，
不得重新接入 AI Version 的接受门禁。

## 13. 校验矩阵

| 校验 | 不匹配结果 |
|---|---|
| completion Schema | `unsupported-completion` |
| finalizer 版本 | `unsupported-finalizer` |
| projectId/documentId | `identity-mismatch` |
| requestId/attemptId | `active-run-mismatch` |
| basedOn/previous/candidate | `candidate-mismatch` |
| base snapshot Hash | `base-snapshot-mismatch` |
| output 实际 Hash | `output-hash-mismatch` |
| 比较 Hash | `comparison-hash-mismatch` |
| canonicalizationVersion | `canonicalization-mismatch` |
| output 完整性 | `invalid-html` |
| output body 无可显示内容 | `HTML_BODY_EMPTY`，阻断 |
| 脚本、inline handler、`javascript:` URL 或 meta refresh 变化 | `EXECUTABLE_CONTENT_CHANGED`，阻断 |
| 与上一版共同特征不足 | `PAGE_CONTINUITY_UNCERTAIN`，保留候选并强制先审阅 |
| completion 后 output 改变 | `sealed-output-modified` |
| active run 已取消/替代 | `stale-completion` |

硬校验失败不得创建 Version 或推进 latest Version。前端只把内部 error code 映射为稳定的
中文原因，不显示原始英文异常或代码串。失败与 no-change outcome 由 workspace API 作为
`recentRunOutcome` 恢复；用户返回编辑后仍可通过“上轮处理”再次打开，重启也不丢失。

## 14. 两阶段 Version 事务

权威 Schema：

[version-transaction.v1.schema.json](../schemas/version-transaction.v1.schema.json)

### 14.1 准备

1. 再读 runtime state，确认 active run。
2. 分配 `transactionId`。
3. 写 `transaction.json`，包含 `previousSourcePath`、冻结源 Hash、候选 Hash、`activeWorkingCopyRelativePath=working/V1.x.html` 与全部身份。
4. 将 output 复制到 `prepared-version/files/index.html`。
5. 写 v3 `version.json` 和 annotations archive；assessment 留在 Attempt，并由同一 `requestId + attemptId` 关联。
6. 校验准备内容 Hash。
7. 读取提交前项目当前指向的 HTML。
8. 若源 Hash 已变化，事务进入 `awaiting-conflict-resolution`。
9. 否则保存 `recovery/source.html` 作为恢复与审计证据并校验；它不授权覆盖原文件。
10. 刷盘并原子标记 `prepared`。

### 14.2 应用

1. 再次确认源 Hash 等于 `expectedSourceSha256`。
2. 以 create-new/no-clobber 语义写入候选工作文件 `working/V1.x.html`；同名不同内容时失败关闭。
3. 重读候选工作文件并校验候选 Hash，同时再次确认提交前当前 HTML 未被修改。
4. 标记 `source-applied`；该状态表示候选工作文件已完整落盘，不表示旧源文件被替换。
5. 原子发布 Version 目录。
6. 标记 `version-published`。
7. 原子写 `committed.json`。
8. 标记 `committed`。
9. 只推进 `project.json.latestVersionId`，保留 `sourcePath`、current exact Version 与当前画布不变。
10. 写入 Attempt outcome，将 runtime 与 transaction 标记为 `ready-to-open`；重启后仍可恢复这项待打开结果。

### 14.3 用户审阅或确认打开

`ready-to-open` 的正式处理页必须同时提供“审阅对比”和“直接打开”，其中“审阅对比”为默认强调操作。“审阅对比”读取冻结基础 HTML 与不可变候选 Version，不调用激活事务；正式审阅页不得带 Demo 标记，并复用正式工作台顶栏。

审阅状态必须保存为正交字段：`pageView`、`changeFilter`、`contextVisibility`、`navigationTarget`、`pagePresentationState`、`scrollMode` 和 `zoomMode`。默认值为“双页 + 全部变化 + 18% + 同步滚动 + 100%”，可把第一处变化设为导航目标。页面按钮只写 `pageView`；变化按钮只写 `changeFilter`；滑杆只写 `contextVisibility`；内容地图与上一处/下一处只写 `navigationTarget` 并揭示目标 Tab。任何一个入口都不得顺带重置其他字段。无匹配时保留筛选并显示空态。单双页文档均应铺满可用 Canvas，只保留边框、分隔与工具栏避让所需的最小间隙。

导航区域与可见变化 marker 必须分离。分析器必须先以显式身份、完全相同内容、语义标题、有效类身份或足够文字相似度建立高置信度节点配对；同标签、同位置不能单独授权配对。文案事实来自叶子级精确增删，结构事实来自未配对/移动/非视觉结构属性，视觉事实只来自已配对既有节点的呈现属性或实际命中样式规则；新增结构不得自动派生视觉变化。细粒度事实经祖先抑制和连通区域融合后形成唯一 canonical footprint，框和整页遮罩共同消费最终矩形，遮罩直接以每个框为透明孔，因此框内完整清晰、框外按可见度虚化。文案新增为绿色虚线框，文案删除为红色虚线框并保留红色删除线，结构在两页统一为蓝色，视觉在两页统一为紫色。`全部变化`只融合强重叠的多类型 footprint，同处只显示一个紫色融合框和类型并集说明；单类型框继续保留语义色。导航焦点不得改变变化集合或遮罩。

正式审阅页还必须提供包含已修改与未修改区域、并按原页面 Tab 分组的完整内容地图；变化项以克制的紫色边线和底色显示，未变化项降低对比度。地图面板从把手右侧展开，右边缘贴住画布，并在用户点击地图以外的页内画布、顶部栏或 App 区域时自动收起。修改前/后文档的 panel 与 action key 必须成对建立稳定映射；AI 改动控件文案或顺序时，优先依据显式目标、同 panel 控件类型与语义位置匹配。任一侧的安全页内动作始终镜像到另一侧，包括 Tab、折叠、业务按钮以及 input/select/textarea 的值与选中态；该合同不受同步/独立滚动控制，匹配失败时静默保持当前侧，不显示额外提示。导航、提交、弹窗、下载和宿主 IPC 仍由沙箱阻止。同步滚动联动横向位置并按内容区域 ID 与区内进度对齐纵向位置；独立滚动只关闭滚动跟随。页内动作和布局变化后必须自动刷新框选与虚化，内容地图选择不是刷新前置条件。运行态不得写回 HTML、Version 或项目状态。

审阅页点击“返回 AI 修改前”必须先逐行展示确认提醒：不会采用本次 AI 返回；继续以修改前版本为基线重新修改；AI HTML 已自动保留，且整句链接直接调用不可变 Version 的精确文件定位，在 Finder 中选中候选 HTML，而不是只打开本轮目录。确认后把该 active run 以 `declined-ai-candidate-after-review` 结束并令 runtime 回到 `editing`，直接恢复原 HTML 编辑状态；评论、编辑记录、候选 Version、working HTML 与本轮审计记录均不删除。“继续审阅”为紫色建议操作，“返回修改前版本”为灰色操作。通过左上角项目标识退出审阅仍只返回本轮处理页，不结束待打开状态。

“打开 AI 修改后”必须先确认项目将切换到完整 AI 候选，同时说明修改前版本与本轮记录仍保留；最终按钮为“确认并打开”。审阅开始前先跨过当前编辑画布的 source-authority fence；确认后让原编辑画布继续在审阅层下方完成激活、Hash 核对和候选渲染，处理抽屉保持关闭。只有候选画布已就绪且抽屉关闭状态至少完成一次渲染后才移除审阅层，禁止闪现等待 AI 页面。用户点击“直接打开”或在审阅页确认“打开 AI 修改后”后：

1. 重新核对 active run、transaction、Version、commit marker 与全部身份。
2. 确认当前源 HTML 仍等于校验时的旧 Hash；若已变化，保留新 Version 但拒绝切换。
3. 将 `project.json.sourcePath` 与 registry canonical path 切换到候选工作文件，并保留原始路径与旧工作路径作为同一项目的别名。文件系统对同一路径的不同拼写（例如 macOS 的 `/var` 与 `/private/var`）必须先归一到真实父目录；registry 合并重复指纹，并且每个项目只能有一个 `role=current` 的来源记录。
4. 更新 current based-on 与 exact Version，清空本轮已归档的草稿评论和编辑事件。
5. 从新的当前工作文件打开画布，并校验工作文件、不可变 Version 与画布三侧 Hash。
6. 标记 `cache-rebuilt`，清理恢复文件并解锁编辑。

### 14.4 Commit marker

权威 Schema：

[committed-marker.v1.schema.json](../schemas/committed-marker.v1.schema.json)

历史与 latest discovery 只承认：

- Version 目录存在。
- v3 manifest 有效。
- entry HTML Hash 有效。
- `committed.json` 有效。
- marker 的 Version、Transaction、Request、Attempt、manifest Hash 和 content Hash 全部匹配。

Version 目录发布但 marker 未写入时，对用户不可见。

初始 V1 使用 commit marker 的 `sourceType=initial` 分支，由项目初始化事务提交；该分支没有 Request、Attempt、previous 或 basedOn。内部 AI Version 使用 `sourceType=internal-ai` 分支并要求完整交接身份。

### 14.5 恢复

| 事务状态 | 恢复 |
|---|---|
| `prepared`，提交前当前 HTML 仍为旧 Hash | 创建候选工作文件并继续，或完整放弃候选 |
| `source-applied`，候选工作文件为候选 Hash | 继续发布与提交 |
| `version-published`，无 marker | 校验后写 marker |
| `committed` | 完成校验与工作文件落盘，进入 `ready-to-open`，不切换当前画布 |
| `ready-to-open` | 重启后继续等待用户审阅或打开；审阅不切换当前源，确认打开时重新核对旧源 Hash 后切换 canonical path |
| 提交前当前 HTML 不再是旧 Hash | 进入持久冲突，绝不覆盖 |
| 同名候选工作文件为其他 Hash | `WORKING_COPY_COLLISION`，绝不覆盖 |
| `cache-rebuilt` | 幂等核对并结束 |

恢复不能重新分配候选 ID，也不能重复创建 Version。

事务同时保留两个不同语义的源 Hash：

- `baseSnapshotSha256` 永远是交给内部 AI 的冻结输入，不能修改。
- `expectedSourceSha256` 是创建新工作文件和切换项目路径前，提交前当前 HTML 必须匹配的 Hash；只有用户明确采用 AI 结果解决外部冲突时，才可更新为用户确认的外部源 Hash。

事务还必须保存 candidate manifest、completion、恢复源和新工作文件的 Hash 与相对路径，确保崩溃恢复不依赖目录猜测。恢复只能完成同一个工作文件和 Version，不能重新编号或覆盖任一旧 HTML。

## 15. Version manifest v3

权威 Schema：

[version-manifest.v3.schema.json](../schemas/version-manifest.v3.schema.json)

Schema 使用 `sourceType` 常量区分严格分支。

### 15.1 Initial

只用于 V1，要求：

- 项目、文档身份。
- 固定 `ver_0001 / 1 / V1`。
- content 与 comparison Hash。
- canonicalization 版本。
- generatedAt、summary、files。

禁止出现 Request、Attempt、previous、basedOn 和 base snapshot。

### 15.2 Internal AI

要求：

- 项目、文档、Version ID/序号/显示名。
- previous 与 basedOn。
- Request、Attempt。
- 基础与最终精确 Hash。
- 两侧比较 Hash。
- canonicalization 版本。
- generatedAt、summary。
- completion 引用。
- Attempt outcome 引用。
- annotations archive，且同一个 Hash 分别指向 Version、冻结 Request 和 Attempt 中的归档路径。
- files。

新 Schema 不含 `local-editor` 或 `restore` 分支。

## 16. Project 与 runtime state

### 16.1 Project state

权威 Schema：

[project-state.v3.schema.json](../schemas/project-state.v3.schema.json)

`project.json` 保存：

- project/document 身份。
- sourcePath。
- latest Version。
- current based-on 与 exact Version。
- 当前 HTML Hash。
- 修改时间。
- 当前源文件和版本谱系 Hash。

它不允许 `activeRun` 或项目锁。

### 16.2 Runtime state

权威 Schema：

[runtime-state.v3.schema.json](../schemas/runtime-state.v3.schema.json)

`runtime-state.json` 是以下信息的唯一事实源：

- lifecycle state 与项目锁。
- edit revision 与 persisted revision。
- freeze cutoff。
- autosave 状态与恢复日志。
- 尚未写回的 `pendingWrite`：revision、预期源 Hash、目标 HTML Hash、恢复文件路径与 Hash。
- Request 尚未发布时的 `pendingSubmission`：冻结 revision、基础 Hash、预留的 Request/Attempt/候选版本身份和锁定时间；此时 `activeRun=null`。
- current/history view state。
- 当前评论和 edit event 草稿的权威文件路径、Hash、ID 与更新时间。
- active run；其中 `ready-to-open` 必须保留候选 Version 与 transaction 身份，直到用户确认打开、显式取消、确认“返回 AI 修改前”或进入可审计错误。仅通过左上角项目标识退出审阅不得释放候选；确认“返回 AI 修改前”结束 active run，但已经发布的候选 Version、working HTML 与审计记录仍保留。
- `activeTransaction`：提交、AI 冲突或恢复中的唯一 transaction ID 与日志路径，禁止扫描目录猜测。
- 外部冲突。
- 事务恢复。

每个状态转换必须原子持久化。重启后不通过扫描 Request 推断。

## 17. Outcome

权威 Schema：

[attempt-outcome.v1.schema.json](../schemas/attempt-outcome.v1.schema.json)

Attempt 的 `outcome.json` 是工作台写入的严格诊断终态，不是完成信号。状态：

- `version-created`
- `no-change`
- `cancelled`
- `failed`
- `external-source-kept`

每个分支都引用 project/document/request/attempt/candidate、版本血缘、冻结源 Hash和 Attempt annotations archive。只有 `version-created` 引用正式 Version、transaction、completion 与提交时间；其他分支不得把候选版本解释为正式 Version。

`no-change` 还必须保存 input manifest Hash 和 `canonicalizationVersion`；`external-source-kept` 必须引用被终止的 transaction，证明候选没有被静默提交。

## 18. 取消

取消必须再次核对事务状态：

- `submitting/processing/validating`：标记 Attempt 取消，恢复冻结评论，释放候选，回到 editing。
- `awaiting-conflict-resolution`：放弃未提交候选，保留源外部内容，恢复评论。
- `committing` 且 commit marker 尚未写入：按事务恢复规则完整回退或完成，不能直接删除。
- commit marker 已写入：Version 已提交，不能以“取消”撤销；候选进入只读历史并等待用户按正常“审阅对比”或“直接打开”流程处理。

迟到 completion 在取消后无效。若 AI Agent 在取消后才执行官方 finalizer，finalizer 必须返回 11.4 的 `status=cancelled`、`accepted=false`、`retryable=false` 终态，而不是通用写入失败；不得生成 completion 或 Version。取消标记身份不匹配时必须失败关闭，不能把另一个 Attempt 的取消状态套用到本轮。

## 19. 外部冲突

当源 Hash 不等于冻结 `baseSnapshotSha256`：

- 不覆盖源文件。
- 不写 commit marker。
- runtime state 进入 `awaiting-conflict-resolution`。
- transaction 保存外部、候选和基础 Hash。

采用 AI 候选时，更新事务的 `expectedSourceSha256` 为用户确认的外部 Hash，但不修改冻结 `baseSnapshotSha256` 或 basedOn 身份。

保留外部内容时，候选不提交，评论恢复，outcome 写 `external-source-kept`。

## 20. v3 干净切换

正式切换固定采用整体归档，不做逐记录迁移：

1. 保留 0.6.1 安装包、源码和验证记录。
2. 完整复制切换前 `项目记录` 与活动 HTML，并校验 Hash。
3. 将旧记录目录标记为只读归档。
4. v3 从空 registry 和空 `projects/` 开始。
5. 用户要继续编辑的当前 HTML 作为普通文件重新登记为新项目和 V1。

新程序必须在读取 registry、project、runtime、Request、annotations 和 Version 时严格要求 v3 主 Schema。发现 v1/v2 数据必须返回清晰的 `UNSUPPORTED_SCHEMA_VERSION`，不得尝试推断、补字段、迁移、展示 legacy history 或复用旧版本序号。

## 21. 完整性与安全

实现必须：

- 使用 UTF-8。
- 对结构化 JSON 使用 `additionalProperties=false`。
- 原子写 JSON 与关键 HTML。
- 拒绝路径穿越、软链接逃逸和跨项目引用。
- 校验每个声明文件的 byte length 与 SHA-256。
- 记录受支持的 Schema/finalizer/canonicalization 版本。
- 对 completion、candidate assessment、事务恢复和 commit marker 保持幂等。
- 将日志与用户内容分开，避免在诊断中泄露完整 HTML 或评论。

## 22. 协议验收

### 22.1 Request

- Request 发布前所有输入和 Hash 已冻结。
- `freezeCutoffRevision` 已追平落盘。
- basedOn、previous、candidate 三套身份明确。
- 不引用可变 current 目录。
- finalizer 命令和 completion 路径明确。

### 22.2 Completion

- output 单独存在 30 秒不触发校验成功。
- completion 缺失不建版。
- 任一身份/Hash 不匹配不建版。
- unsupported finalizer 不建版。
- completion 后 output 改变不建版。
- no-change 不建版。
- 取消后的 finalizer 可重复返回不可重试的 `cancelled` 终态，且不修改 output、不写 completion、不建版。

### 22.3 Transaction

- 无 marker 的 Version 不可见。
- prepared、source-applied、version-published、committed、cache-rebuilt 各边界可注入崩溃。
- 恢复后只能完整回到旧源或完整提交同一候选。
- 源、Version 快照和画布 Hash 一致后才报告成功。

### 22.4 Isolation 与干净切换

- A 项目 active run 不锁 B 项目。
- runtime state 不从 project state 或目录扫描猜测。
- 新运行时不读取 v1/v2 项目记录或 legacy marker。
- 旧目录和活动源切换前已有独立、只读、Hash 可校验的完整归档。
- 旧 HTML 快照只可作为普通 HTML 新建项目，不还原旧评论、Request、Attempt 或 Version 关系。
