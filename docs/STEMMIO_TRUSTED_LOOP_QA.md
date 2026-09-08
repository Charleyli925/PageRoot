# Stemmio 可信修改闭环：验收记录

本记录区分自动化回归、真实账号证据和仍阻塞的验收项。测试全部使用新建合成 HTML；没有迁移、删除或清理旧项目，没有更新已安装应用，也没有发布。PR-0 #474 的自动合并在撤销生效前已完成；用户最新要求是其余 PR 修复后保持 Draft 并停止，不再合并。

## 代码与自动化

- PR-0 #474 已合并；PR-1–PR-8 保持 Draft。PR-2 #476 是选择器/计时器修复的独立交付入口，PR-6 已纳入同一分支祖先，整合没有重复功能净差异。
- PR-7 Draft #482（提交索引以 PR 最新 head 为准）覆盖 Candidate 专属审阅/采用/不用、采用前 Draft drain、后续评论修订保留、Promotion 幂等和重启历史；完整交付结果见 PR。
- PR-8 集成 Review 聚焦与新标注渲染的时序修复，避免显式段落定位回退到整个区块而把目标移出窄画布；验证从顶部区域选择两段后，内外画布中的标注都可见。PR-8 对接主线 Developer Preview 隔离改动，并补充丢提交回执、丢采用回执、进度容量、拖动中刷新、长历史滚动、200% 缩放和启动取消竞争。
- `tests/submission-receipt.test.mjs`：保存与重复请求、预检失败、重启事实投影、后续评论保留、结果/停止竞争、进度上限与可见截断。
- `tests/run-workflow.test.mjs`：持久化失败不外发、相同操作丢回执核对、服务冻结、未知结果不盲重跑。
- `tests/version-workflow.test.mjs`：源与候选身份、采用前 drain、丢采用回执重用同一决策 ID。
- `tests/agent-runtime-coordinator.test.mjs`：公开文本过滤、执行事实写入失败不启动、停止等待未发布启动并阻止迟到进程。
- `tests/codex-acp-provider.test.mjs` / `tests/qoder-acp-spike-client.test.mjs`：真实 1.7 协议形状、诊断与预检一致、模型/推理设置先于 prompt，设置失败不发送任务。
- Electron 场景覆盖连续两轮采用并重启、源变化、取消、不用、当前文档与默认服务分离、失败后恢复、复制失败与迟到 finalizer。

## 视觉与键盘

`ai-provider-availability.spec.mjs` 使用真实拖动验证 340/400/480px，在拖动期间等待一次 Conversation 刷新；键盘调整验证焦点和数值。长历史追加时保留阅读位置，显式“新进展”返回底部，决定区始终独立于历史滚动。200% 使用 Electron 原生 zoom，等待网格动画收敛，核对父容器裁切与关闭按钮焦点，再通过 `webContents.capturePage()` 留证。计时没有逐秒 aria-live 播报。

合成截图位于 `output/design-qa/ai-assistant-redesign/` 和 `output/design-qa/agent-setup-journeys/`，成功的 CI 桌面反馈与正式 AI 证据产物也包含 `output/design-qa`，不提交生成图像：三宽度、执行、待决定、设置失败/修复、审阅、长历史、200% 缩放。截图不是全部真实账号验收的替代品。

## 真实账号结果与阻断

现有 Codex/Qoder 登录已获用户授权用于合成项目。测试入口为显式 opt-in 的 `scripts/qa-trusted-loop-real-accounts.mjs`，复制的是运行时组件，不读取、解密或复制凭据；原始输出仅保留本地。

1. **Codex 模型目录故障已复现并修复。** 设置初始化通过、提交却返回 `CODEX_PROTOCOL_UNSUPPORTED`。受管 1.7.0 实现使用 `modelId[effort]`，旧校验全部过滤；归一化后真实预检成功，进入执行。
2. **Codex 完整闭环未通过。** 真实模型写出了候选但明确报告缺少 ACP `terminal/create`，不能运行受限 finalizer。主机拒绝采用。该项仍阻止宣称本轮规划全部完成或进入发布；不得用模拟通过、跳过 finalizer 或放宽权限取代。见 ADR 0053 的兼容性补记。
3. **Qoder 真实运行后取消已验证。** 2026-09-08 11:37:56–11:38:27 UTC 的合成项目中，先观察到 `qoder-cli / running` 再停止；磁盘 Request 最终为 `cancelled`，原始文件及 Working Copy 字节保持不变（本地 `report.json` 状态 `qoder-running-stop-confirmed`）。 另外从真实时间序列发现启动未登记时取消的竞争，已补充同一启动操作的等待与取消检查，并用确定性单元回归验证不会迟到启动。
4. **DeepSeek 真实账号与跨服务重启链未验证。** 早前直接解密本机保存凭据的方案未执行。按本次评审规划，仅通过正常连接流程，在隔离窗口连接；不解密、复制或导出现有凭据。已有模拟 DeepSeek 成功/失败/重启测试不能替代本项。

上述 2、4 项保持发布阻断。PR-8 可以审查代码与证据，但不能据此宣布真实账号矩阵全绿。

已对经受管包校验的已知不兼容 1.7.0 版本增加预检阻断：`CODEX_EXECUTION_CONTRACT_UNSUPPORTED`，不再重复产生服务用量；要求记录仍保留。该阻断是诚实的兼容性状态，不代表 Codex 完整闭环已经修复。

最终直接复核本机受管 1.7.0（通过原生登录状态命令，不读取凭据文件）：installation/authentication 为 ready，readiness 为 connection-failed，cause 为 CODEX_EXECUTION_CONTRACT_UNSUPPORTED，失败阶段为 execution-contract。已确认不再把该已知执行限制显示为可用连接。

Codex 后续入口的权限与验收条件见 `STEMMIO_CODEX_RESTRICTED_TOOL_ADAPTER_PROPOSAL.md`。当前上游尚不能证明原生工具受等价限制；当前 PR 没有创建该入口。只有需要扩大既有权威时才另行请求授权。

PR-8 最终集成基线：主线 589c8954，包括 #473 运行隔离、#480 Stable ID 自动纠错、#474 契约和 #484 收敛规则。保留本轮真实进度事件及模型绑定；共享运行时冲突已逐项合并并纳入最终门禁。

## 分支交付索引

| 阶段 | PR | 当前状态 |
| --- | --- | --- |
| PR-0 | [#474](https://github.com/Charleyli925/PageRoot/pull/474) | 已合并（撤销自动合并前） |
| PR-1 | [#475](https://github.com/Charleyli925/PageRoot/pull/475) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-2 | [#476](https://github.com/Charleyli925/PageRoot/pull/476) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-3 | [#477](https://github.com/Charleyli925/PageRoot/pull/477) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-4 | [#478](https://github.com/Charleyli925/PageRoot/pull/478) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-5 | [#479](https://github.com/Charleyli925/PageRoot/pull/479) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-6 | [#481](https://github.com/Charleyli925/PageRoot/pull/481) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-7 | [#482](https://github.com/Charleyli925/PageRoot/pull/482) | Draft，精确提交以 PR 最新 head 和交付记录为准 |
| PR-8 | [#483](https://github.com/Charleyli925/PageRoot/pull/483) | Draft，精确提交以 PR 最新 head 和交付记录为准 |

PR-8 分支为 `feature/stemmio-trusted-loop-pr8`；完整门禁后提交，真实验收阻断仍保留。

先前集成曾有完整交付通过记录，但 `49b15908` 的后续本地矩阵出现 1 个 Review 像素比较失败，不能继续引用较早数字为当前 head 背书。本次修订重新运行适用的 `task:finish`；实际选中/执行/通过/跳过数量与精确提交见 PR 正文和对应 CI 产物。Draft `pr-feedback` 不等同于 Ready `release-gate`；当前不转 Ready、不合并、不宣称发布资格。


## 本次评审补修

- PR-3：保存提交或预检期间切文档，统一结束原始的未启动提交；已派发而结果未知的 Request 保留原有核对路径。
- PR-4：提交前预留 128 条消息、2 个 Context、1 个 Turn 和 2 MiB；接近消息、Context、字节边界时轮换并保留旧历史关联。要求大于 1 MiB 时在接收前拒绝，正常要求不截断。终态不被进度挤掉。
- PR-5：仅把 assembled visible-text 允许清单封存成至多 4096 字符的脱敏公开摘要；不保存隐藏推理、工具参数或未校验 HTML。失败、停止后可从既有提交记录恢复。云端回归暴露的重试预检与结束竞争已用确定性测试复现并修复；取消中的原 Run 禁止迟到启动，后端未登记启动也纳入清理确认。该保护从 PR-8 前移到 PR-5，后续分支继承。
- PR-6：默认呈现要求、摘要、结果、决定，过程折叠在“查看处理记录”。旧阶段文本兼容折叠；三宽度实际截图随 CI 上传。
- PR-7：正在采用和采用结果待确认优先于 Review，持续复用同一 Candidate 决定身份；未知期间禁止相反决定，并自动核对。旧历史的“尚未采用”不再被渲染为当前状态。
- PR-8：已知 Codex 执行契约不兼容使用明确说明与“使用其他 AI”主动作，重新检查为次级动作；不重装同一已知不兼容组件。集成前置修复与后端丢回执/重启/视觉场景。

保护性 Codex 修复与完整 Codex 可用性分开交付。Codex 完整执行和正常连接下的 DeepSeek 跨服务真实验收仍按上述事实保留阻断，不通过绕过执行权限或提取凭据制造通过。
