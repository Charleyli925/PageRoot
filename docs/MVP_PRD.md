# HTML AI 工作台 MVP 产品需求

- 状态：v3 单引擎目标合同
- 适用范围：本地 HTML 源码局部编辑、内部 AI 交接、强制范围校验与版本历史
- 上位文档：[架构说明](ARCHITECTURE.md)
- 安全边界：[安全模型](SECURITY_MODEL.md)
- 验证策略：[测试策略](../tests/TEST_STRATEGY.md)
- 协议文档：[Change Request 协议](CHANGE_REQUEST_PROTOCOL.md)
- 交互文档：[交互流程](INTERACTION_FLOW.md)

本文描述目标产品，不描述 0.5.x 旧实现。若旧数据、旧说明或旧测试与本文冲突，以目标计划为准。

## 1. 产品结论

HTML AI 工作台让用户在真实本地 HTML 上完成两类工作：

1. 文字、inline 样式和同级模块顺序等直接编辑，由单一 SourcePatchEngine 对真实源码做局部 Patch 后自动写回源文件。
2. 生成内容、跨区域修改和整体调整，通过页面评论冻结为 Request，交给内部 AI 返回完整 HTML。

核心合同只有一句：

> 用户选中谁，直接编辑就只 Patch 谁；只有内部 AI 对一次冻结提交返回经过最终化、目标范围校验、确实不同并完成事务提交的完整 HTML，系统才创建下一版和新的当前工作文件，绝不覆盖提交前的 HTML。

## 2. 目标与非目标

### 2.1 MVP 目标

- 用户无需理解或执行手动保存。
- 用户始终知道当前内容是否已经写回文件。
- 提交给 QoderWork 时，只有待编辑文字提交、冻结与持久 Hash 校验全部成功后，当前项目才真实锁定。
- 用户可以在一个项目处理期间继续处理其他项目。
- 每个 AI Version 都能回答：哪个项目、哪个文件、基于哪版、前一版是什么、何时提交、何时完成、具体是哪份内容。
- 新 Version 打开时，版本身份、源 HTML、历史快照和画布内容严格一致。
- 连续 AI 修改后，用户最初打开的 HTML、每一份旧工作文件、每轮冻结输入和每份不可变历史 HTML 都完整保留。
- 历史查看与创建新 Version 是两个不同动作；历史页只读，不提供覆盖当前 HTML 的恢复旁路。
- 纯浏览器预览是正式只读能力：可运行页面自身交互，但不能编辑 PageRoot HTML、添加评论、附件或发送 AI，且所有页面操作都不会保存。
- 崩溃、外部冲突、取消、失败和 no-change 不丢评论、不留半提交。
- 旧项目记录和 0.6.1 完整、只读、Hash 可校验地归档；v3 从干净工作区开始。

### 2.2 非目标

- 不做低代码搭建器。
- 不让用户逐个接受 AI 的多个候选区块。
- 不把临时文件、自动写回、事务恢复快照或恢复日志显示为 Version。
- 不把文件名、页面标题或文件系统修改时间当作版本身份。
- 不依赖固定时间窗口推断内部 AI 已完成。
- 不维护一个会被反复覆盖、可能与项目当前路径分叉的含糊 `current/index.html`。有效 AI 成功创建按版本命名的 `working/V1.x.html` 并自动切换项目路径，不要求用户手动管理副本。
- 不让预览 DOM 序列化结果成为保存事实源。
- 不提供 legacy DOM、v2 Reader、迁移器或新旧引擎开关。
- 不修改共享 CSS Rule、CSS variable、断点、伪状态或外部 CSS。

## 3. 术语

| 名称 | 定义 |
|---|---|
| Project | 工作台中的独立项目，拥有自己的状态、锁、版本与 Request |
| Document | 项目绑定的源 HTML 稳定身份，由 `documentId` 表示 |
| Current HTML | `project.json.sourcePath` 当前指向、用户正在编辑的真实 HTML；AI 成功后可以切换到新的 `working/V1.x.html` |
| Version | 初始 V1 或一次有效内部 AI 返回形成的不可变里程碑 |
| Request | 一次冻结的用户意图和精确输入 |
| Attempt | 内部 AI 对某个 Request 的一次执行 |
| Candidate Version | 系统为当前 Request 预留、尚未提交的下一版身份 |
| Completion | 受支持 finalizer 最后原子写入的唯一完成信号 |
| Commit marker | 让 Version 正式进入历史的唯一提交点 |
| Comment | 用户对模块、子区域、文字或插入位置留下的本轮要求 |
| Edit event | 本地直接编辑的审计事实，不是 Version |

## 4. 产品对象与身份

系统必须区分：

| 字段 | 作用 |
|---|---|
| `projectId` | 项目身份 |
| `documentId` | 源 HTML 身份 |
| `versionId` | 机器版本 ID，例如 `ver_0009` |
| `versionOrdinal` | 连续序号，例如 `9` |
| `versionLabel` | 内部兼容标签，例如 `V9`；界面和工作文件按同一 ordinal 显示为 `V1.8` |
| `basedOnVersionId` | 当前提交内容的谱系基础 |
| `previousVersionId` | 时间线上前一个正式 Version |
| `requestId` | 本轮用户意图 |
| `attemptId` | 内部 AI 执行身份 |
| `baseSnapshotSha256` | 冻结输入的精确 Hash |
| `contentSha256` | 正式 Version HTML 的精确 Hash |

不得使用一个含糊的 `currentVersionId` 同时表达最新正式版本、当前谱系基础、当前精确匹配版本和正在查看的历史版本。

## 5. 功能需求

### 5.1 打开项目

用户可以：

- 打开本地 HTML。
- 从最近项目切换。
- 在一个项目处理时打开或切换另一个项目。

工作台不负责新建 HTML。首次打开和预览尚未登记的既有 HTML 不创建项目记录或 Version；第一次真实编辑、添加附件、发送给 QoderWork，或用户明确展开“项目资料”查看长期规则与记录文件夹时，才创建 `sourceType=initial` 的 V1。V1 是初始只读基线，不是一次手动保存。

每个项目拥有稳定 `projectId`，每个源 HTML 拥有稳定 `documentId`。改文件名或移动路径时，产品应通过持久身份和受控重新绑定保持 Document 连续性，不能只依赖文件名匹配。

初始 Version 的内部标签为 `V1 / ver_0001`，界面显示“版本 1”。第一次有效 AI 成功使用内部 `V2 / ver_0002`，界面显示“版本 2”；之后依次递增。兼容工作文件名仍可使用 `working/V1.1.html`、`working/V1.2.html`，但不得把该文件标签当作用户界面的版本身份，也不得回写并破坏严格 v3 Schema。

### 5.2 直接编辑与自动写回

支持的直接编辑至少包括：

- 双击 source-backed 静态文字后，光标直接出现在点击位置；普通文字和安全的混合行内文字都可输入、删除和选择。
- 可编辑宿主的可视段首、段尾和非空样式交界均可输入：可视段首继承右侧首字符，其他交界继承左侧字符，工具栏显示与下一次输入一致的样式。
- 文字 checkpoint 可以跨多个源码 text node，但不得拍平或序列化既有行内标签。
- 字体、字号、字重、斜体和颜色。
- 背景、填充、边框和常用间距。
- 同级模块顺序。
- 不提供画布级撤销或重做；源码画布拦截 `Cmd/Ctrl+Z`，避免 Chromium 绕过 SourcePatch 直接改 DOM。表单输入框保留自己的本地输入历史，评论在评论区独立删除。

每次本地修改：

1. 文字双击时由 `IslandEditingController` 为当前源码宿主建立唯一可编辑岛；浏览器只负责光标、Selection 和 IME，Controller 接管输入、删除、换行、粘贴与格式变更。
2. 约 700ms、格式、Cmd+S、目标切换、关闭或发送边界生成带目标身份、源 Hash、精确岛内 before/after 和操作类型的 `replace-editable-island` 命令；短暂失焦不结束会话。
3. SourceIndex/TargetResolver 唯一定位真实源码范围；无法唯一定位时保留草稿并阻止操作。
4. SourcePatchEngine 只替换目标元素的精确 `contentRange`，并验证岛外源码逐字节不变。岛内可进行最小 parse5 规范化；inverse 只用于同一事务失败时的原子恢复与测试证明，不保存为用户可操作的历史栈。
5. 用 Patch 结果更新内存 HTML 并原子重建 projection；失败时保留原会话和草稿。
6. 增加 `editRevision` 并追加稳定 ID 的 edit event。
7. 触发有上限 debounce 的同一条串行写入队列。
8. 写入成功后推进 `lastPersistedRevision` 和显示时间。

用户合同不是固定 700 毫秒，而是“无需手动保存，状态真实可见”。实现应以约 700 毫秒为初值并通过性能测试调整。

PageRoot 0.9.0 只有一个受控 `contenteditable="true"` 路线，不再在
`plaintext-only`、浏览器富文本和自定义补丁间切换。粘贴只读取纯文本；
换行固定生成 `<br>`；折叠光标在可视段首向右继承，其余文字、样式和
链接边界向左继承。Controller 以 grapheme 为单位处理删除，并以冻结
Selection 重放 IME 最终文本。

安全岛可保留行内语义、注释和不可变的图片、SVG、MathML、Canvas、
表单控件及媒体原子。MutationObserver 发现非 Controller 所有的 DOM
变化时立即恢复。脚本、样式、表单/嵌入根和包含不安全块结构的目标不
进入文字编辑。最终只能提交完整岛内容，经受保护属性、原子、注释、
重解析、范围和源码 Hash 校验；预览 DOM 永远不能整页序列化回源码。

编辑画布必须明确提示“本地文本编辑会直接修改源文件并保存”。这里的“源文件”指项目当前指向的 HTML：首次打开时是用户原文件；AI 成功后是新的 `working/V1.x.html`。

自动写回必须：

- 只接收 SourcePatchEngine 产出的完整下一份源码。
- 在写入前读取磁盘当前 Hash。
- 仅当 Hash 等于上次已知基线时继续。
- 写入同目录临时文件。
- 刷新并原子替换源 HTML。
- 替换后重读并校验 Hash。
- 串行处理新旧 revision，旧写入不能覆盖新编辑。
- Patch 后重新解析失败时不进入写入队列。
- `contenteditable`、临时 IME wrapper、预览 nodeId 和编辑器样式永不写入源文件；canonical item 只能由受权 SourcePatch plan 创建，并拥有 exact inverse。

界面状态：

- `正在更新…`
- `已更新到文件 · 16:32`
- `更新失败 · 内容仍保留`
- `检测到外部修改`

自动写回失败时：

- 保留内存内容和短期恢复日志。
- 暂停后续写入。
- 禁止提交给内部 AI。
- 提供重试或导出当前编辑内容。

外部 Hash 冲突时：

- 不覆盖外部内容。
- 提供重新载入外部文件、导出当前编辑内容。
- 用户明确处理前不得假装已更新。

### 5.3 文件菜单与快捷键

- 主编辑流程不显示“保存”或“另存为”按钮。
- “导出 HTML 副本”放在次级文件菜单，只复制内容，不改变项目绑定，不创建 Version。
- `Cmd+S` 只立即刷新当前自动写入队列，并反馈“内容已更新到文件”或真实错误。
- 原生菜单和右键菜单不得存在另一条会创建 Version 的保存链路。

### 5.4 评论与目标

用户可以对以下层级添加评论：

- 整个模块。
- 模块内子区域。
- 具体文字。
- 两个模块之间的插入位置。

每条评论立即获得稳定 `commentId`、创建/更新时间、正文、附件、目标定位和持久性类型。用户可通过“添加图片或文件”选择多个本地文件，也可直接在评论输入框粘贴剪贴板图片。图片以缩略图显示，点击打开大图预览；缩略图悬停后右上角显示移除按钮。普通文件以紧凑文件条显示文件名和大小，长文件名必须截断但保留完整 title。

单轮评论不设置产品层面的条数上限。超过 40 条时，评论栏按共享滚动视口加前后缓冲区虚拟化渲染；被聚焦、编辑或等待删除确认的卡片必须始终保留。画布仍保存全部目标位置与完整评论数据，跳转远处评论时先把目标卡片纳入渲染窗口再同步滚动，不能因优化丢失评论或串错目标。

附件立即复制到项目记录的 `draft/attachments/<commentId>/`，不能依赖桌面、下载目录、移动硬盘或其他原始文件继续存在；项目记录也不保存这些外部原始路径。每个附件保存稳定 `attachmentId`、类型、文件名、媒体类型、字节数、Hash、项目相对路径和来源（剪贴板或文件选择）。附件与评论共享同一 TargetRef，因此图片/文件、评论正文和模块/子区域位置形成可审计的一对多关系。

v3 TargetRef 保存 label、层级、selector/结构锚点、源码位置、源 Hash、稳定属性、祖先指纹、文字前后缀及 `exact|rebound|ambiguous|orphaned` 状态。

排序或局部修改后唯一重找到的目标显示 `rebound`；多个候选显示 `ambiguous`；被删除后显示 `orphaned`。不安全目标保留评论与审计，不静默消失，也不能驱动直接写入。

评论和附件独立于 HTML 自动写回持久化。评论/附件的创建、编辑和删除不创建 Version。删除当前草稿附件时清理项目草稿副本；已经冻结到 Request 或归档 Version 所引用的附件保持不可变。冻结优先使用同一文件系统的 copy-on-write 副本并在发布 Request 前同步到磁盘，不支持时安全回退为完整复制；无论采用哪种物理方式，语义上都是不再依赖草稿或外部原文件的独立快照。

交给内部 AI / QoderWork 时，`PROMPT.md` 和 `change-request.json` 为每个附件提供 Request 管理的本机绝对路径，同时保留 Request 相对路径用于项目整体移动后的恢复。交接内容不得包含附件 Base64，也不得暴露或要求 AI 追踪用户选择文件时的外部原始路径。

本地直接编辑写入 `edit-audit.jsonl` 或等价追加记录，至少包含稳定事件 ID、revision、时间、类型、目标、before 和 after。

### 5.5 提交给 QoderWork

提交入口为主按钮“一键发送至 QoderWork”。

用户触发提交后必须按唯一顺序执行：

1. 提交当前原生编辑 checkpoint；composition、映射或 Patch 失败立即停止。
2. 校验本轮评论并完成必要的首次项目登记。
3. 同步执行 `freezeNow()`，得到可验证的 HTML、source SHA 与 revision。
4. 只有冻结成功才设置 `projectLocked=true` 并进入 `submitting`。
5. 等待自动写回追平 revision，并重读磁盘 Hash；任一步失败都回到 editing，不建立或发布 Request。
6. 去重快速双击、键盘快捷操作和重复事件。

锁定不能早于原生编辑 checkpoint/freeze 成功，否则失败会留下“未提交却被锁定”的假状态。

锁定后允许：

- 滚动和被动查看冻结页面与评论。
- 查看本轮处理状态。
- 取消本轮。
- 再次复制交接内容。
- 查看项目规则与版本历史、导出 HTML 副本。
- 打开或切换其他项目。

锁定后禁止当前项目：

- 画布编辑、样式、排序。
- 添加、修改或删除评论。
- 项目规则修改。
- 再次提交。

历史版本在所有状态下都只读查看，不提供替换当前 HTML 的能力。

提交准备流程：

1. 等待同一自动写入队列追平 `freezeCutoffRevision`。
2. 再读当前 HTML，确认实际 Hash 等于已写入内容，并把完整字节冻结到 `input/base/index.html`。
3. 冻结评论、附件和相关 edit event；重新核对附件大小与 Hash，拒绝选择后被篡改或丢失的文件。
4. 生成 Request、Attempt、候选 Version 身份。
5. 保存精确 `input/base/index.html` 和 Hash。
6. 写入 v3 Request、annotation records、input manifest 和 Prompt。
7. 切换为 `processing`。

任何准备步骤失败都必须安全回到 `editing`，保留原评论和本地内容。

桌面端只把交接消息写入系统剪贴板；写入后必须逐字 readback 一致才报告“已复制”。产品不自动打开、控制或粘贴到 QoderWork。

剪贴板状态必须按项目和本轮 Request/Attempt 隔离。“已复制”只表示剪贴板 readback 一致，不表示 Qoder 已收到。A 项目复制失败时，A 的 Request 保持冻结且可重试；B 项目的发送按钮、复制状态和后续 Request 不得被 A 的失败占用。

`input/base/index.html` 是本轮修改前完整、不可变的 HTML。后续 AI 成功、失败、取消或 no-change 都不得改写它。

### 5.6 项目级状态机

```text
editing
  → submitting
  → processing
  → validating
  → committing
  → ready
  → editing
```

附加持久状态：

- `awaiting-conflict-resolution`
- `recovering-transaction`

`submitting`、`processing`、`validating`、`committing`、冲突和事务恢复均锁定当前项目。`ready` 表示新版已经完整打开，可短暂展示成功提示后回到 `editing`。

状态与 active run 的唯一事实源是该项目自己的 `runtime-state.json`。`project.json` 不保存第二份 active run。

### 5.7 候选版本

系统是唯一编号权威。假设最新正式 Version 是 V8：

- 系统预留 `ver_0009 / V9`。
- Request 和 Prompt 明确写入候选身份。
- AI 不得自行计算或改写版本号。
- 失败、取消、no-change 或未采用冲突不消耗 V9。

历史版本不能在当前版本链内回写。若用户把旧快照作为普通文件重新打开，它会获得新的 Document、V1 和独立候选编号。

### 5.8 内部 AI 输出与 finalizer

每个 Attempt 的唯一 HTML 输出是 `output/index.html`。

内部 AI 完成全部修改后必须执行 Prompt 中的完整 finalizer 命令。finalizer：

1. 从冻结 Request 读取全部身份与 Hash。
2. 核对 Request/Attempt 仍是唯一 active run。
3. 校验输出是完整可加载 HTML。
4. 统一写入 HTML 机器元数据。
5. 计算精确 Hash 与规范化比较 Hash。
6. 最后原子写入 `completion.json`。

以下均不是完成条件：

- 只出现完整 HTML。
- 文件在任意固定时间内没有变化。
- 标签闭合。
- AI 写了一段摘要。
- 旧 Attempt 中残留输出。

完成后 output 视为封存；若继续变化，标记协议违规并阻止建版。

### 5.9 校验与 no-change

工作台发现 completion 后进入 `validating`，必须独立校验：

- Schema 和 finalizer 版本受支持。
- 项目、文档、Request、Attempt 和候选身份全部相同。
- active run 仍有效且未取消、失败或被替代。
- 冻结输入 Hash 相同。
- 实际 output Hash 与 completion 相同。
- HTML 完整可加载。
- 规范化比较可重复。
- ScopeValidator 能在 base 与 output 两侧唯一解析所有允许目标。
- 每个实质差异都能分类为目标内、目标外、finalizer metadata 或语义等价规范化。

规范化比较只允许移除以下工作台自有 meta：

- `html-ai-document-id`
- `html-ai-version-id`
- `html-ai-version-label`
- `html-ai-based-on-version-id`
- `html-ai-request-id`

同一确定性解析/序列化算法计算两侧比较 Hash。不得忽略 CSS、JavaScript、正文、结构、属性或普通空白变化。

若比较 Hash 相同：

- 状态显示“内部 AI 未产生有效变化”。
- 不创建 Version。
- 不消耗候选号。
- 保留 Request、Attempt、评论和诊断记录。
- 解锁当前项目，允许用户修改要求后再次提交。

若比较 Hash 不同，必须生成符合 `scope-report.v1.schema.json` 的强制报告。目标外正文、属性、结构、共享 CSS、JavaScript 或无法唯一定位的目标均使 Attempt 失败；保留 output、completion、scope report 和 outcome，不创建 Version、不消耗候选号。正式产品没有关闭 ScopeValidator 的功能开关。

### 5.10 两阶段 Version 提交

校验通过后进入 `committing`：

准备阶段：

1. 再次确认 active run。
2. 建立持久事务日志。
3. 准备不可变 HTML、v3 `version.json`、scope report 引用和评论归档。
4. 核对候选 Hash。
5. 核对当前源 Hash 等于 `baseSnapshotSha256`。
6. 保存并校验源 HTML 短期恢复文件。
7. 刷盘并将事务标为 `prepared`。

应用阶段：

1. 再次核对源 Hash。
2. 以 create-new/no-clobber 语义创建候选 `working/V1.x.html`；同名不同内容时失败关闭，不覆盖。
3. 重读新工作文件并校验候选 Hash，标记 `source-applied`；提交前当前 HTML 保持不变。
4. 原子发布到 `versions/<version-id>/`。
5. 原子写入 `committed.json`，这是唯一提交点。
6. 将项目和 registry 的 canonical path 切换到新工作文件，原始路径与旧工作路径保留为同一项目的别名。
7. 从提交标记重建 `project.json` 缓存。
8. 从新工作文件重新打开 current 画布。
9. 校验新工作文件、Version 快照和画布三个 Hash 相同。
10. 清理恢复文件并显示成功。

没有有效 `committed.json` 的目录不出现在历史或 latest Version 中。

### 5.11 外部冲突

如果 AI 完成时源文件已由外部程序修改：

- 不覆盖源文件。
- 不写 commit marker。
- 进入持久 `awaiting-conflict-resolution`。
- 保留候选输出、外部内容与所有 Hash。
- 当前项目继续锁定，其他项目不受影响。

用户选择采用 AI 候选：

1. 记录确认时间和当时外部 Hash。
2. 将外部内容保存为恢复文件。
3. 将事务 `expectedSourceHash` 更新为经确认的外部 Hash。
4. 再次确认外部内容未继续变化。
5. 创建新的 `working/V1.x.html` 并继续两阶段事务；外部修改后的旧文件仍完整保留。

用户选择保留外部内容或取消：

- 不创建 Version。
- 释放候选号。
- 恢复冻结评论到 editing。
- 以外部源内容重新建立当前谱系状态。

### 5.12 Version 历史

版本历史只列：

- 原生 v3 `initial` 和 `internal-ai` Version。

旧 Version、评论和 Request 只存在于切换前只读归档，不进入新产品历史列表。

每个正式 Version 显示：

- `V9`
- 生成时间
- 基于 V5
- 上一版 V8
- Request/Attempt
- 摘要与评论数量

用户动作分开：

1. “查看此版本”：进入 `viewMode=history`，从精确不可变路径打开，只读。
2. “在 Finder 中显示”：定位 `versions/<version-id>/files/index.html`，不打开其他版本或当前工作文件。
3. “返回当前 HTML”：回到项目当前指向的工作文件。

历史模式必须显示：

```text
正在查看 V6（只读）
当前项目：基于 V9
[返回当前 HTML]
```

历史模式不提供覆盖、替换或恢复当前 HTML 的按钮；Bridge 同样不暴露历史回写路由。

### 5.13 时间语义

必须区分：

| 时间 | 含义 |
|---|---|
| 当前 HTML 修改时间 | 最近一次自动写回成功时间 |
| Request 提交时间 | 输入冻结并发布的时间 |
| AI 完成时间 | finalizer 写入 completion 的时间 |
| Version 生成时间 | commit marker 成功提交的时间 |

文件系统 mtime 不能代替 Version 生成时间。

## 6. 数据与目录

```text
项目记录/
└── projects/
    └── <projectId>/
        ├── project.json
        ├── PROJECT.md
        ├── runtime-state.json
        ├── edit-audit.jsonl
        ├── working/
        │   ├── V1.1.html
        │   └── V1.2.html
        ├── recovery/
        ├── transactions/
        ├── versions/
        └── requests/
```

事实源：

| 事实 | 权威位置 |
|---|---|
| 当前可编辑 HTML | `project.json.sourcePath` 当前指向的原始 HTML 或 `working/V1.x.html` |
| 项目/文档身份与可重建缓存 | `project.json` |
| 整个项目长期使用的 AI 规则 | `PROJECT.md` |
| active run、项目锁、冲突与恢复事务 | `runtime-state.json` |
| 当前评论、edit event、删除 tombstone、草稿 revision 与已处理 operation ID | `draft/annotations.json`；`runtime-state.json` 只保存其指针与 revision |
| 本地直接编辑审计 | `edit-audit.jsonl` |
| 冻结输入 | Request 的 `input/` |
| AI 完成 | Attempt 的 `completion.json` |
| 正式 Version | 带有效 `committed.json` 的 Version 目录 |

任何渲染缓存都可丢弃，不能参与判断当前事实或最新 Version。

“项目资料”必须把权限和用途说清楚：主入口为“项目长期规则”和“项目记录文件夹”。`PROJECT.md` 适用于整个项目、空闲时可修改；读取完成前与 AI 处理期间只读，停止输入约 700ms 后自动保存，保存只影响后续任务。切换项目、关闭规则页和关闭应用前必须完成保存或原位说明失败。记录文件夹通过 Finder 查看每轮要求、AI 返回与历史文件。不得只写“Request 与审计记录”这类需要用户理解内部术语的概括，也不得在规则仍在读取时接受输入或静默丢弃未保存修改。

正式签名的 macOS App 在启动约 5 秒后检查 stable 更新，并在应用持续打开期间每 4 小时再次检查；“关于源页”同时提供用户主动触发的“检查更新”和固定 GitHub 仓库入口。自动与手动检查必须合并到同一个主进程更新控制器，不得并发建立两套下载或安装状态。检测到 stable 新版本时，顶部发送按钮上方显示紧凑更新状态；当前版本或自动检查失败时不占位，手动检查的结果和失败原因则在“关于源页”原位显示。新版本自动下载并优先使用差分传输，失败时允许回退完整 ZIP。下载完成后用持久提示和“重启更新”入口要求用户明确决定；只有编辑器写入、草稿和 Bridge 关闭排空全部成功后才重启安装。普通退出不得暗中安装，GitHub 仓库只作为项目与人工后备入口。

## 7. 数据合同

新写入必须符合：

- `version-manifest.v3.schema.json`
- `change-request.v3.schema.json`
- `annotation-records.v3.schema.json`
- `project-state.v3.schema.json`
- `runtime-state.v3.schema.json`
- `scope-report.v1.schema.json`
- `completion.v1.schema.json`
- `input-manifest.v1.schema.json`
- `attempt-outcome.v1.schema.json`
- `version-transaction.v1.schema.json`
- `committed-marker.v1.schema.json`

项目、运行态、Request、annotations 和 Version 使用 v3 干净主 Schema；completion、scope report、transaction、commit marker 等独立对象维持各自严格版本。

## 8. v3 干净切换

正式切换必须：

1. 完整备份 0.6.1 安装包、源码、QA 结果、活动 HTML 与旧 `项目记录`。
2. 对活动源和归档副本做逐字节或 SHA-256 对账。
3. 将旧记录备份标记为只读并与 v3 活动目录隔离。
4. v3 使用空 registry、空 `projects/` 和严格新 Schema。
5. 用户继续编辑的 HTML 作为普通 HTML 重新登记为新项目 V1。
6. 不自动恢复旧 Version 序号、评论绑定、Request、Attempt 或运行态。
7. v1/v2 主记录返回 `UNSUPPORTED_SCHEMA_VERSION`，不做推断或补字段。

旧 HTML 快照仍可作为普通 HTML 打开或重新导入；这是新建项目，不是历史迁移。

## 9. 非功能要求

### 9.1 一致性

- 文件写入原子化。
- 自动写入队列串行化。
- completion、事务和 commit marker 幂等。
- 状态转换持久化。
- 对关键路径重复计算 Hash，不信任缓存或单方声明。

### 9.2 可恢复性

- debounce 期间崩溃可从短期日志恢复。
- `prepared`、`source-applied`、Version 发布、commit marker、缓存更新各边界均可恢复。
- 恢复结果只能是完整旧状态或完整同一新 Version。

### 9.3 安全边界

- Request 可移植 JSON 只使用受控相对路径。
- finalizer 只读取当前冻结 Request，只写当前 Attempt 和受控项目事务目录。
- 拒绝路径穿越、软链接逃逸和不属于 active run 的 completion。
- 不执行 HTML 中的任意本地命令。

## 10. 验收标准

### 10.1 自动写回

- 主界面、原生菜单和右键菜单不存在独立保存建版入口。
- 连续编辑并自动写回 20 次，版本号和历史条数不变。
- `Cmd+S` 只刷新同一队列。
- 重启后源 HTML 包含最后一次成功写回。
- 自动写入失败或外部冲突时不能提交。
- 页面草稿 revision 落后 Bridge 时，先读取权威草稿并重放稳定 operation；旧快照不能覆盖新评论，也不能让已经删除的评论复活。
- 草稿 POST 超时后先按 operation ID 查询是否已确认；不得把“可能已成功”当成失败后盲目重发。
- 在草稿内容未变化时连续触发关闭或项目切换，Bridge draft revision 保持不变，应用不会进入永久“尚未安全记录”状态。

### 10.2 锁定与多项目

- 触发提交的同一时刻，当前项目所有修改入口禁用。
- 快速双击只生成一个 Request。
- 刷新或重启仍恢复精确 active run 和锁。
- 当前项目处理时可以切换并编辑其他项目。
- A 项目剪贴板失败、取消、豁免、冲突或打开结果的迟到回调不改变 B 项目的忙碌态和按钮可用性。
- A、B 的状态轮询并行，单个项目响应慢不阻塞另一个项目。
- 快速切换后立即关闭并重启，最后一次原位编辑仍同时存在于源文件与画布；revision 差异不得因缺少内存 queued write 而永久阻止关闭。

### 10.3 强完成

- output 单独存在任意时长都不建版。
- 只有受支持 finalizer 写出的有效 completion 才进入校验。
- 任一身份或 Hash 不匹配都不建版。
- completion 后 output 再变化会标记协议违规。
- no-change 不建版且不消耗候选号。

### 10.4 版本与历史

- 新写入只有 `initial` 和 `internal-ai` 两类。
- 本地编辑、自动写回、评论、导出、历史恢复、失败、取消和冲突未采用都不建版。
- no-change、失败、取消和冲突未采用也不创建 `working/V1.x.html`。
- 新版提示只在新工作文件、不可变快照、画布 Hash 一致且 canonical path 已切换后显示。
- 历史查看永远只读且只打开精确 Version 路径。
- 每个历史版本可一键在 Finder 中显示精确 `files/index.html`。
- 连续两次 AI 成功后，原始 HTML 与第一份工作文件逐字节不变，项目当前路径指向第二份工作文件。
- 历史页不提供恢复或覆盖当前 HTML；需要以旧快照开始时，将其作为普通文件登记为新的 Document 与 V1。

### 10.5 事务、范围与干净切换

- 每个事务故障点均能恢复到完整旧态或完整新态。
- 无 commit marker 的候选不出现在历史。
- ScopeValidator 继续完整记录目标外正文、属性、结构、CSS 和 JavaScript 变化。
- 身份、脚本、协议、路径、Hash、目标歧义和完整性属于硬校验，失败时不创建 Version、不消耗候选号。
- 目标外正文、属性、普通结构与样式联动属于软观察：写入 `validation-review.json`，在结果面板说明，但不阻断候选 Version。
- v3 运行时、前端历史和发布包不包含旧 Schema Reader、migration report 或 legacy marker 分支。
- 0.6.1 与切换前数据已有独立只读归档，可用于整体回退。
