# 源页：内部 AI 对话补充与候选校验（已实现）

- 实现版本：PageRoot 0.9.5
- 日期：2026-08-02
- 状态：已进入代码、Schema、历史记录与打包验证

## 1. 内部 AI 对话里的增量要求

本轮有效要求由两部分组成：

1. 源页发送时冻结的原始评论与本地编辑；
2. 用户随后在 QoderWork 对话里新增、修订或撤回的要求。

第二部分不能直接改写冻结 Request。Prompt 要求内部 AI 先调用受控 helper，把用户原话写入当前 Attempt 的 `USER_SUPPLEMENT.json`，成功后才能执行。记录失败时必须停止执行该条补充。

记录采用追加式 `add / amend / retract`，旧记录不能覆盖。`add` 可通过 `refersTo` 指明它补充的原始 instruction；修订会替代被引用的旧 supplement，撤回会从最终有效要求中移除被引用记录。能够取得的原始文件会复制到 `supplement-attachments/` 并记录 SHA-256；只能看见、无法取得原件时记录 `description-only`，历史中明确显示“原件未归档”。finalizer 会先封存补充记录和附件 Hash，再生成完成记录。Attempt 结束后新增要求必须建立新 Request。

这套机制是项目协议，不是聊天平台同步：源页只确认受控记录成功，不能证明剪贴板内容已经被 AI 平台接收，也不能证明平台内每条对话都被遵守。

## 2. 候选校验分级

不可忽略的硬校验包括：

- 项目、文档、Request、Attempt、Version 身份；
- 冻结输入、输出、completion、manifest、commit marker 的 Hash；
- 完整 HTML、受管路径、普通文件与无路径逃逸；
- supplement 封存、引用、附件与 Hash；
- 管理元信息和可执行表面变化；
- 事务、工作副本与版本完整性。

完成记录和规范化比较通过后，Bridge 生成 `candidate-assessment.json`。它只回答两个
产品问题：返回的是不是完整、可显示且没有改变可执行表面的 HTML；它是否大体继承了
上一版。连续性证据来自可见文字、稳定 id/data 属性、class、资源引用和 title，属于
粗粒度启发式，不宣称逐节点证明。

评论 TargetRef 和有效 supplement 继续指导 AI、审阅与历史解释，但不再授权或禁止某个
DOM 子树之外的普通正文、属性、结构或样式变化。这样可以避免 AI 把 `<p>` 改为 `<div>`、
重组卡片或同步调整相关样式时被误判为失败。连续性证据充分为 `ready`；证据不足但 HTML
可用为 `attention`，保留同一不可变候选并要求先审阅；不完整、空 body 或可执行表面变化
为 `blocked`，不创建 Version。

## 3. 结果审阅与打开方式

AI 结果通过校验后先创建不可变 Version 和独立 working HTML，运行态进入 `ready-to-open`：

- 左侧仍显示原来的当前 HTML；
- 原始评论和本地编辑继续锁定并保留；
- 重启应用后仍恢复“可打开”状态；
- `ready` 候选显示“审阅对比”和“直接打开”，默认突出“审阅对比”；`attention` 候选只显示“审阅对比”；
- “审阅对比”只读取冻结 HTML 与不可变 AI 候选，不激活候选；正式审阅页提供双页完整画布、按文案/结构/视觉自动聚焦的变化筛选、包含未修改区域并按页面 Tab 分组的内容地图、上下文可见度、版本单页/并排切换和同步/独立滚动；
- 审阅画布允许原页面 Tab、折叠区等纯页内交互在隔离沙箱中运行，但禁止导航、提交、弹窗、下载和宿主 IPC，运行态变化不会保存；
- 审阅页不显示 Demo 标记；“返回 AI 修改前”必须先明确提示这次 AI 返回不会被采用、当前 HTML 保持为 AI 修改前版本，并说明返回本轮处理页后 AI 候选仍会保留、可以再次进入审阅；
- 只有 `ready` 用户点击“直接打开”，或任一可审阅候选在审阅页点击“接受全部并打开”，项目当前路径和左侧画布才切换；
- 点击前如果当前源文件被外部改动，系统拒绝切换并保留新 Version。

## 4. 历史展示

每个 AI Version 按四组展示：

- 源页原始评论；
- 内部 AI 对话补充；
- 本地编辑；
- AI 结果与校验（包括 candidate assessment；旧版可含 validation review）。

Version manifest 仍保持不可变；历史通过其 `requestId + attemptId` 定位同一 Attempt 下的 supplement 和 candidate assessment。旧 `validation-review.json` 只读兼容，不再由新 Attempt 写入。

失败或 no-change 后，本轮处理页只有“返回编辑”。退出不会自动打开某条评论，也不会清除
outcome；workspace 返回最近终态，标题栏“上轮处理”可在退出后或重启后重新打开。开始
冻结下一轮 Request 时，才把这个入口更新为新一轮。
