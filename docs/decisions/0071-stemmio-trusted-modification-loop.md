# ADR 0071: Stemmio 可信修改闭环

状态：Accepted contract；PR-0 固定语义，PR-1～PR-8 的实现和验收仍待完成。

## 权威与终点

沿用 Request、Attempt、Candidate、Conversation、Working Copy、Promotion；不创建 Task/Run 数据库。执行结束与用户任务结束不同：候选就绪仅结束执行；采用、不用或明确无变化才结束用户任务。

记录提交不等于开始执行；AI 自述完成不等于通过校验；请求停止不等于已经停止；超时不等于明确失败；历史消息不授予操作权限。下表是只读产品语义映射，不是新增数据库枚举或可写 UI 状态机。

| 组 / 可见语义 | 事实来源 | 主操作 / 不可用原因 | 结束条件 |
| --- | --- | --- | --- |
| 服务 / 未安装 | Catalog installation | 安装；不能执行 | 受管安装校验完成 |
| 服务 / 未登录 | authentication | 登录；不能执行 | 登录结束且重新诊断 |
| 服务 / 连接失败 | protocol、service 和 readiness | 重新检查、换服务；不能发送 | 当前配置的新诊断通过 |
| 服务 / 检查中 | Catalog 操作身份、配置代次、deadline | 等待；不能重复检查 | 成功、阻塞、超时或被新操作取代 |
| 服务 / 可尝试发送 | 同一配置的分项诊断 | 开始修改 | 仍须通过执行预检；不是永久授权 |
| 执行 / 已接收未开始 | Bridge 已保存 submission 与 execution Turn | 修复后明确重试；没有 Request 授权 | 预检通过后关联 Request，或封存未开始原因 |
| 执行 / 运行中 | Request、Attempt、受管会话 | 停止；禁止新执行 | 确认停止、明确失败、无变化或校验候选 |
| 执行 / 正在停止 | Bridge 取消操作被接受 | 等待；禁止新执行 | 进程、远端和清理已核对 |
| 执行 / 结果待确认 | 丢失回执、断连或超时 | 核对同一操作；禁止重发 | 权威执行、产物和事务事实确认 |
| 执行 / 主动停止 | 取消原因与停止确认 | 新一轮重试 | 结束事实持久化；保留要求 |
| 执行 / 明确失败 | 安全错误码与失败阶段 | 按原因修复 | 结束事实持久化；cancelled 不能推断额度不足 |
| 执行 / 无变化 | 校验后的 no-change | 下一轮 | 不创建待审阅占位、不自动解决评论 |
| 结果 / 待审阅 | 已落盘并验证的 candidate-ready；Renderer ready-to-open | 查看具体候选 | 打开同一 candidateId 的审阅 |
| 结果 / 审阅中 | VersionWorkflow 的候选投影 | 采用；次操作不用这次 | 明确决定；禁止新执行 |
| 结果 / 正在应用 | Repository Promotion 事务 | 等待；禁止重复采用 | 事务确认或进入核对 |
| 结果 / 应用待确认 | Promotion 回执缺失 / recovering-transaction | 核对同一决定 | 事务、Version、Working Copy 共同确认；不能仅比 HTML |
| 结果 / 冲突 | 预期源指纹不匹配 | 查看差异、基于当前页面重新修改 | 保留候选，不覆盖、不自动合并 |
| 结果 / 已采用 | Promotion 完成与正式版本关系 | 下一轮 | 本轮匹配修订评论处理、历史投影可恢复 |
| 结果 / 未采用 | 候选 rejected 的权威决定 | 下一轮 | 保留要求与历史 |
| 复制 / 等待导入 | 剪贴板成功回执 | 导入结果 | 校验并进入相同候选决策流程 |

## 身份、持久化与恢复

关联链：documentId → turnId → submissionOperationId → requestId / attemptId → candidateId → decisionOperationId。

复用现有 Request operationKey 和 Promotion 的 `promote_<candidateId>` 身份；实现前确认其作用域与跨进程稳定性。Turn 是 Conversation 的 execution Turn，不能每个阶段创建一个 Turn。提交操作在预检前持久化，冻结文档/工作副本、源指纹、评论 ID/修订/正文、附件引用和完整性、项目规则指纹、服务/模型/交付方式。提交记录不授予文件修改权限。

ProjectFileRepository 是业务持久化操作唯一写者；ConversationRepository 仅投影不可变事实。Request/提交/决定的既有操作记录保存稳定 eventId 与待投影事实；不能依赖 React 生命周期。多文件原子替换不是事务：先保存恢复信息，幂等补 Conversation，补写不得再次运行 Agent。不同工具事件有独立稳定序号；终态单独去重。必要权威写入失败阻断副作用。

重启时：未启动的提交恢复要求并等待明确操作；启动回执丢失先核对；执行中断核对进程、会话与产物；候选已落盘只补投影；已应用核对 Promotion 并补最终决定。不得统一将 running 置 cancelled。流式丢失标记截断，不补编内容。

单文档只允许一个活跃执行或待决定候选。默认服务仅初始化文档选择，本轮使用冻结快照。账号诊断按账号/配置代次更新，任务修复还须校验原文档身份。停止与完成在 Bridge 串行裁决：先接受取消则迟到输出不可发布；候选先成为权威结果则报告结果已就绪。

公共进度只允许阶段、时间、活动时间、字节量、经脱敏限长的公开文字及固定工具类别摘要。原始 HTML、隐藏推理、prompt、凭据、绝对路径、工具参数与输出不能进入 Renderer。耗时由本轮时钟计算，不依赖活动事件；单调时钟不跨进程恢复。

## 实施与验收

按 [实施记录](../STEMMIO_TRUSTED_LOOP.md) 的九个 PR 推进。测试使用新建合成项目，不迁移旧项目、不补造旧历史。既有源内容、身份、候选校验和版本规则保持权威。真实账号验证与 fixture 结果分别报告；没有真实受管 Codex 闭环不能宣称连接问题已修复。
