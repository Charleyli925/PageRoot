# Codex 受限工具适配方案（技术条件待验证）

## 已确认问题

受管 codex-acp 1.7.0 使用原生工具执行模型任务，没有把客户端 ACP terminal/create 提供给模型。真实合成项目生成了候选，但受限 finalizer 没有被调用，现有主机拒绝完成。PR-8 保留该校验，并在预检阻断已知不兼容版本。此文档不授权切换为 agent-native，也不把阻断称为功能完成。

## 建议新增的入口

为一个已冻结 Request/Attempt 提供一个仅在执行期间存在的工具适配入口。它复用现有 execution-host 实例及 policy，不能成为独立执行权威。

仅映射以下既有能力：

1. 读取冻结输入：调用现有 readTextFile 校验，文件必须在 manifest 允许的读取集合，保留顺序、哈希、路径与大小约束。
2. 写候选：调用现有 writeTextFile 校验，只能写本 Attempt 的固定 Candidate 输出；拒绝 Working Copy、原始文件、completion、任意目录和符号链接逃逸。
3. 完成本轮：调用现有 createTerminal / waitForTerminalExit，执行参数只能来自冻结 policy.finalizer，调用方不能提交 shell 命令、可执行文件、环境变量或工作目录。主机必须观察到恰好一次成功 finalizer，之后仍执行现有完整 HTML、身份、哈希和 Candidate 校验。

拟使用适配器支持的 session/new MCP 服务配置作为传输。MCP 服务与主机之间必须绑定当前执行身份和短期授权，不能监听外部网络；关闭/取消后立即撤销并确认子进程退出。原生模型工具必须被可靠禁用或受等价边界限制；若所选上游接口做不到，继续拒绝运行，不能仅靠 prompt 要求模型自觉不越界。

不读取用户凭据来制作工具令牌，不把服务账号凭据交给工具入口。新增的是一次执行的本地能力授权，生命周期由现有 AgentRuntimeCoordinator 管理。

## 不接受的替代

- 不绕过 assertTurnCompleted，不凭模型文字或磁盘上孤立的 completion 文件确认成功。
- 不自动采用候选，不将原生工具写入视为可信来源。
- 不注册第二套持久 Task/Run，不恢复已退休 App Server 权威，不把安全 profile 改为 agent-native。
- 不通过宽泛 shell、任意文件工具、常驻服务或扩大目录权限实现兼容。

## 实现与验收条件

先验证上游能否强制工具边界，再实现传输；若无法约束原生工具，先报告证据和新的技术选择。复用既有权威的兼容实现属于当前任务；若方案需要扩大文件、工具或执行权威，则按仓库 AGENTS.md 的 “New authority ... need a separate explicit request” 单独请求授权。不能仅因增加传输代码就推定需要新授权。

必须覆盖：伪造/过期执行身份、跨 Request 路径、源码写入、符号链接、错误哈希、重复 finalizer、并发取消、启动失败、服务退出与重启、未知完成回执。所有负向用例必须保持源文件不变且不能误报完成。

随后使用新建合成项目和已授权现有 Codex 账号完成：连接诊断、提交、真实工具执行、Candidate 校验、审阅、采用、第二轮及重启历史。成功证据齐备后才移除已知版本的兼容性阻断。本方案仍需实施验证，不能以文档代替运行通过。

## 当前上游能力核验

本机受管 1.7.0 的 `AgentMode.ReadOnly` 实际仍映射为 `workspaceWrite`，且没有关闭临时目录写入；`sendPrompt` 每轮显式提交该 mode 的 sandboxPolicy。`createSessionConfig` 支持注入 MCP 服务，但这本身不关闭原生工具。因此只添加 MCP 不能证明维持现有逐文件执行边界；当前可用接口下仍然阻断。需找到或实现可强制等价边界的上游能力，再实施传输，不要求用户通过扩大权限来绕过。
