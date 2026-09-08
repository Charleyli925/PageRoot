# Stemmio 可信修改闭环实施记录

## 基线

2026-09-08 拉取 origin/main，源码基线 `4b6aa8658f324a8c5e319f3bbc379fc785205487`，与报告一致。主目录有无关未提交改动，本轮使用独立工作树。已读取本机 Developer Preview build-info，安装 commit 为同一基线；真实账号与运行时验证尚未执行。仓库受管发布描述固定 Codex native 0.148.0、codex-acp 1.7.0（不是实机版本声明）。附件的外部 content-reference 未提供可读取文件；以已附完整文字为执行范围。

## 已核对的入口和缺口

| 能力 | 真实入口 | 当前证据 / 后续归属 |
| --- | --- | --- |
| 服务检查 | RunWorkflow.checkAgentUsability → AgentProviderCatalog.diagnose | diagnose 返回失败仍 succeeded；Catalog 已有诊断代次 fence 和 single-flight，保留并补配置/回执/超时，PR-1 |
| 登录 | AgentProviderCatalog.startLogin / 登录页等待逻辑；Main openAgentLogin | 应用有第二次打开入口，区分手动备用与自动打开，PR-1 |
| 服务选择 | AiConversationSidebar chooseService | pointerdown 与 click 都调用业务；不可用服务只 queue default；ready fallback 猜测当前选择，PR-2 |
| 计时 | AiConversationSidebar interval effect | 依赖 agentLastActivityAt，PR-2 |
| 提交 | RunWorkflow.submit、reconcileSubmission；ProjectFileRepository Request 准备/发布 | spendTicket 早于持久 Request；已有操作核对；缺预检前提交记录，PR-3 |
| Conversation | workspace-bridge currentConversation；ConversationRepository.mutateConversation | 现有路由仅读取与草稿；修改链路缺少事实投影，PR-3/4 |
| 执行 | agent-runtime-coordinator、run-session、RunWorkflow 轮询 | 运行事实与历史需可恢复关联；UI 事件不能作为持久化来源，PR-4/5 |
| 候选与采用 | VersionWorkflow.prepareReviewCandidate / activateReadyVersion；ProjectFileRepository.#promoteCandidate | 已有 promote_<candidateId> 和多阶段恢复；应复用，PR-7 |
| 评论 | Request 冻结 annotations；Promotion 与 CommentSession 后续处理 | 必须验证提交后新增/修订不会被旧采用清除，PR-7 |

## 交付顺序

| 里程碑 | PR | 范围 | 状态 |
| --- | --- | --- | --- |
| A | PR-0 | ADR、场景和基线 | 已合并 #474；后续 PR 保持 Draft、不合并 |
| A | PR-1 | 检查、登录、连接修复 | Draft #475，task:finish 通过 |
| A | PR-2 | 服务选择与计时 | Draft #476，task:finish 通过（独立分支，PR-6 集成） |
| B | PR-3 | 预检前提交、冻结要求、防重、复制 | Draft #477，完整 task:finish 通过 |
| B | PR-4 | 事实投影、持久执行、重启恢复 | Draft #478，完整 task:finish 通过 |
| C | PR-5 | 安全进度、停止竞争 | Draft #479，完整 task:finish 通过 |
| C | PR-6 | 四区域侧栏、原地修复、阅读行为 | 实施中：已整合 PR-2；92 项专项与三宽度 Electron 场景通过 |
| C | PR-7 | 审阅、采用、不用、评论修订 | 待实施 |
| D | PR-8 | 故障注入、真实桌面、视觉与无障碍 | 待实施 |

PR-0 先行；PR-3 → PR-4 → PR-5；PR-6 接入 PR-1/2/4/5；PR-7 接入历史与审阅；PR-8 汇总。每个 PR 为 Draft，独立说明行为、持久化变化、测试、未覆盖项与回退边界。合并与发布须另行授权。

## 发布阻断矩阵

所有项目初始均为未验收，不将旧测试等同于本轮通过。

1. 已登录但协议失败：真实阻塞与新回执。
2. 设置和侧栏同时登录：一个进程、一个自动打开者。
3. 旧诊断晚返回：不覆盖新检查/配置/文档。
4. Qoder 单次鼠标/键盘选择：一次保存，执行身份一致。
5. 每 100ms 活动：独立计时，结束固定、后台校正。
6. 预检失败保留要求；提交保存失败不外发。
7. 双击/丢失提交回执：同一操作不重复执行。
8. 切文档/改默认服务：冻结目标不变。
9. 停止与完成竞争：唯一权威结果，不虚报停止。
10. 候选落盘后崩溃：新 Bridge 恢复同一候选。
11. 双击采用/丢回执：只应用一次，重启核对。
12. 审阅期间源改变：不覆盖，保留候选。
13. 提交后评论新增/修订：旧采用不删除新内容。
14. 敏感公共事件：凭据/路径/推理/原始工具数据不跨界。
15. 日志容量有界、截断可见、不同事件不误去重。
16. 复制不依赖 Agent 目录，剪贴板失败不显示已交付，导入必须校验。
17. 原始 Codex 初始化故障：分项诊断与真实受管闭环，不以模拟代替。
18. Qoder 停止后 DeepSeek 成功：新 Bridge 重启保留两轮要求/服务/摘要/结果；投影失败不重跑。

视觉证据覆盖八种关键状态、340/400/480px、200% 缩放、长文本/历史；键盘焦点与滚动锚点稳定，读屏不逐秒播报。真实账号测试尚未执行。

PR-1：新增诊断编号、失败阶段、配置代次与操作回执；检查未就绪返回 rejected。连接失败保留分项事实。真实 Codex 初始化故障与桌面截图仍待真实环境验收，不声明根因已修复。
