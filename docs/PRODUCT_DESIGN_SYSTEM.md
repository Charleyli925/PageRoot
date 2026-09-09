# Stemmio Product Design System

状态：V1，设计决策入口。适用于 Stemmio 工作台；旧 PageRoot 文件名是兼容标识。
本文整理现有产品原则，不宣称所有目标行为都已实现。

## 规则所有权

| 层 | 唯一事实源 | 本层责任 |
| --- | --- | --- |
| Product Principles | 本文；对象定义见 [MVP_PRD](MVP_PRD.md) 与 [版本专项 PRD](VERSION_AND_PROJECT_FILES_PRD.md) | 体验目标、决策顺序、模式入口 |
| Interaction Contracts | [INTERACTION_FLOW](INTERACTION_FLOW.md) 与其指向的专项合同 | 操作、状态、权限、文案和恢复结果 |
| Visual Language | [DESIGN_LANGUAGE](DESIGN_LANGUAGE.md) | 令牌、排印、密度、控件、视觉 QA |
| Review Protocol | [DESIGN_REVIEW_PROTOCOL](DESIGN_REVIEW_PROTOCOL.md) | 取证、状态覆盖、问题分类与验收 |
| 执行记录 | [design-qa](../design-qa.md) | 具体版本、截图、发现和验证限制；不是新的规则源 |

Skill 位于 [.agents/skills/stemmio-product-design/SKILL.md](../.agents/skills/stemmio-product-design/SKILL.md)，仅路由，不复制上述合同。
架构定位仍从 [ARCHITECTURE_MAP](ARCHITECTURE_MAP.md) 和 capability-context 开始。

## 产品心智与控制权

Stemmio 让用户直接编辑本地 HTML，也能把明确的修改意图交给 AI，审阅结果后决定是否采纳。
Project 是工作上下文；Document 是源文件身份；Version 是版本身份；工作文件可有本地修改。
Request 冻结本轮意图与输入；Candidate 是待核验、待决定的独立结果；Preview 是展示，Review 是审阅；
Adopt / Promotion 是有权威校验的采纳动作。具体持久化时点以交互与版本专项合同为准。
这些词用于设计分析，界面应使用合同中的简短用户语言，不暴露 Hash、事务或内部路径。

- 源 HTML 是保存事实，运行态 DOM 不能反向成为保存源。
- AI 返回、Candidate 核验、进入审阅、采纳成功是不同事实，不互相冒充。
- 查看历史不等于修改当前版本，切标签不等于取消后台任务。
- 可恢复不等于所有操作都支持同一个 Undo。文字撤销、历史查看、新建版本和采纳后的恢复分别按合同描述，不能承诺跨重启保留撤销栈。

## 闭环设计原则

**Intent → State → Action → Feedback → Result → Next → Recovery**

每个用户任务都应能回答：为什么来这里、当前是什么状态、能做什么、操作有没有响应、
产生了什么、下一步是什么、失败后如何恢复。缺项先作为调查线索，只有任务需要且证据表明缺失时才报告缺陷。
这不是要求七块 UI 或七段说明；已有上下文、按钮状态和自然返回路径可以共同完成闭环。

1. **上下文连续**：用户能辨别当前项目、文件、版本及操作范围；切换和重新进入不偷换对象。
2. **事实先于反馈**：进行中、停止请求、停止确认、结果可审阅和结果已采纳分别表达；不编造百分比或完成时间。
3. **AI 主动，用户保有控制**：意图 → 真实进展 → 必要检查点 → 结果 → 明确采纳 → 合同允许的恢复。
4. **恢复有出口**：失败保留有效内容与用户意图，明确可用动作；未知回执先由系统查询收敛，不制造重复版本。
5. **秒懂、极简优雅、Quiet First**：正常保存安静；需要决定或恢复时才突出反馈。避免多个区域重复播报同一事实。
6. **一致与可达**：复用既有控件、键盘语义和令牌；焦点、禁用、加载、错误及 reduced motion 都应可理解。

## 决策顺序与冲突处理

先保护数据、身份和真实授权边界，再保证任务闭环与可达性，再优化理解成本和视觉一致性。
“秒懂”与“优雅”的具体取舍沿用 DESIGN_LANGUAGE，不机械增加解释文案。
视觉规范中“先交付并说明偏离”只适用于非阻断的设计取舍，不能覆盖安全边界或必需门禁。

同一问题先定位唯一 owner；专项合同明确覆盖旧条款时遵循该覆盖。无明确覆盖且规则相互矛盾时，
记录两处原文、影响和待决策事项，不由 Skill 静默重定义行为，不把文档矛盾直接报成产品 bug。
更改交互合同写回 INTERACTION_FLOW 或专项 owner；更改视觉规则写回 DESIGN_LANGUAGE。
只有明确需求才扩大范围；确定性门禁通过后，P2/P3 记录后续，按 AGENTS 的 P0/P1 收敛规则交付。

## Pattern 入口

这些是审阅问题与合同索引，不是另一份状态机。

| 模式 | 应回答的问题 | 行为 owner |
| --- | --- | --- |
| 首次导入 / 新项目 | 将创建什么？取消保留什么？何时允许处理原稿？ | INTERACTION_FLOW §3.1.1；IMPORT_CONFIRMATION_PRD |
| 项目 / 文件 / 版本导航 | 我在看哪份？编辑会作用于谁？返回后上下文还在吗？ | INTERACTION_FLOW §2、§11、§12 及“历史创建闭环” |
| Agent 请求与进展 | 本轮意图和输入是什么？真实执行状态是什么？能否停止？ | INTERACTION_FLOW §7–8、§13；AI_CONVERSATION_WORKSPACE_PRD |
| Candidate / Review / Adopt | 结果是否核验？前后是哪份？采纳后打开什么？ | INTERACTION_FLOW §8–10；VERSION_AND_PROJECT_FILES_PRD |
| 错误 / 再进入 | 已有结果是否保留？重试同一操作还是新任务？ | INTERACTION_FLOW §10、§12、§15 |
| 屏幕与控件 | 主操作是否唯一清楚？焦点、密度与状态是否一致？ | DESIGN_LANGUAGE §2–5 |

## 历史产品倾向

[DESIGN_DECISIONS](DESIGN_DECISIONS.md) 将历史用户讨论区分为稳定原则、局部要求和已替代决定。
设计变更有歧义时查相关主题，不读取全部历史；原始会话只留本地证据，不作为 Skill 的隐式新指令。

## V1 来源与范围

本体系以仓库合同和历史 QA 为事实源。用户提供的外部 Skill 对照方案作为方法输入：
Vercel 的薄路由与定位结论、Ajnas 的流程覆盖、Elia 的证据和问题词汇、
uxuiprinciples 的 Agent 控制权、Cuellar 的任务导向 critique。
2026-09-09 已回读以下上游 Skill 的固定版本；仅吸收方法，不安装或执行外部脚本：

| 参考 | 吸收 | 不照搬 |
| --- | --- | --- |
| [Vercel](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) | 独立规则源、精确文件定位 | 每次审阅依赖远端规则；本项目以随代码维护的合同为准 |
| [Elia](https://github.com/EliaAlberti/ux-audit-skill/blob/76eb1ab73560c90275823395fda52c3ca4ea8b2b/SKILL.md) | 截图证据边界、稳定问题词汇 | 全框架扫表、固定正面发现数量、Nielsen 分数 |
| [Ajnas](https://github.com/AjnasNB/web-app-ux-auditor-skill/blob/6252a1a92efe40da50836f1ad5294c293c6443d0/SKILL.md) | 真实流程、状态覆盖、运行证据 | 全站路线和移动宽度对桌面任务的机械套用 |
| [uxuiprinciples](https://github.com/uxuiprinciples/agent-skills/blob/bc3f52deb45e3f8638d9ad0e82149182a6c0e410/ai-interface-reviewer/SKILL.md) | 人类控制、交接、可信结果与审计 | 仅因描述未提及某状态就判严重缺陷；固定扣分和外部 API 依赖 |
| [Cuellar](https://github.com/cuellarfr/design-skills/blob/b41750affc03669988b649380756bc17fa427a09/skills/design-critique/SKILL.md) | 按用户目标判断层级、信息组织和文案 | 无本地证据的时间阈值、比例和定律式结论 |

CI 继续由现有影响映射和门禁负责；V1 不新增调度器、全量 UI 强制测试或独立设计打分门禁。
