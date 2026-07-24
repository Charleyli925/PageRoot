# 源页：内部 AI 对话补充与分级校验（已实现）

- 实现版本：PageRoot 0.8.1
- 日期：2026-07-22
- 状态：已进入代码、Schema、历史记录与打包验证

## 1. 内部 AI 对话里的增量要求

本轮有效要求由两部分组成：

1. 源页发送时冻结的原始评论与本地编辑；
2. 用户随后在 QoderWork 对话里新增、修订或撤回的要求。

第二部分不能直接改写冻结 Request。Prompt 要求内部 AI 先调用受控 helper，把用户原话写入当前 Attempt 的 `USER_SUPPLEMENT.json`，成功后才能执行。记录失败时必须停止执行该条补充。

记录采用追加式 `add / amend / retract`，旧记录不能覆盖。`add` 可通过 `refersTo` 指明它补充的原始 instruction；修订会替代被引用的旧 supplement，撤回会从最终有效要求中移除被引用记录。能够取得的原始文件会复制到 `supplement-attachments/` 并记录 SHA-256；只能看见、无法取得原件时记录 `description-only`，历史中明确显示“原件未归档”。finalizer 会先封存补充记录和附件 Hash，再生成完成记录。Attempt 结束后新增要求必须建立新 Request。

这套机制是项目协议，不是聊天平台同步：源页只确认受控记录成功，不能证明剪贴板内容已经被 AI 平台接收，也不能证明平台内每条对话都被遵守。

## 2. 校验分级

不可忽略的硬校验包括：

- 项目、文档、Request、Attempt、Version 身份；
- 冻结输入、输出、completion、manifest、commit marker 的 Hash；
- 完整 HTML、受管路径、普通文件与无路径逃逸；
- supplement 封存、引用、附件与 Hash；
- 目标身份失联/歧义、管理元信息和脚本越界等安全问题；
- 事务、工作副本与版本完整性。

有效补充明确写出范围外文字、属性或行内样式的 before/after 时，校验器可以把对应差异记为 supplement 授权；未被原话精确证明的变化不随之放宽。before 证据还必须在冻结 HTML 中解析到唯一语义位置；相同值重复出现时，只能用 `targetDescription` 在包含该值的局部源码上下文中唯一定位，否则失败关闭。一个封存 supplement 记录最多授权一个差异，新增位置也不能只凭 output 中的新值获得授权。范围联动、样式和普通结构变化属于软校验。软校验失败时右栏停在“需要你决定”，用户可以点击“无视本校验，继续”。系统把决定、具体代码、原因和时间写进 `validation-review.json`，并且只对当前不可变 scope report 生效。

## 3. 结果打开方式

AI 结果通过校验后先创建不可变 Version 和独立 working HTML，运行态进入 `ready-to-open`：

- 左侧仍显示原来的当前 HTML；
- 原始评论和本地编辑继续锁定并保留；
- 重启应用后仍恢复“可打开”状态；
- 只有用户点击“打开 Qoder 返回的最新版”，项目当前路径和左侧画布才切换；
- 点击前如果当前源文件被外部改动，系统拒绝切换并保留新 Version。

## 4. 历史展示

每个 AI Version 按四组展示：

- 源页原始评论；
- 内部 AI 对话补充；
- 本地编辑；
- AI 结果与校验（包括软校验豁免）。

Version manifest 仍保持不可变；历史通过其 `requestId + attemptId` 定位同一 Attempt 下的 supplement 和 validation review。
