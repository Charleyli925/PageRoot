# Codex Subagent 路由决策

> 这是当前决策记录。生效配置位于 `.codex/config.toml`、`.codex/agents/` 和 `AGENTS.md`。

## 怎么使用

- 这是主 Agent 的按需运行手册，不会被 Codex 自动加载。主 Agent 只需在大型任务第一次进行非 Ultra 委派前读取；子 Agent 通常只接收自己的精简任务包，不重复读取全文。
- 用户在模型选择器中选择什么模型和推理强度，主 Agent 就使用什么。
- 本项目启用 Codex multi-agent V2。该开关作用于整个项目，普通 Sol/Astra 使用下面的路由规则；其他主模型仍继承自己的模型选择。
- 主 Agent 是 **Sol 且不是 Ultra**：使用“Sol 路由表”。
- 主 Agent 是 **Astra 且不是 Ultra**：使用“Astra 路由表”。
- 主 Agent 是 **Sol Ultra 或 Astra Ultra**：不使用下面两张表，保持 Ultra 原生行为。
- 角色决定子 Agent 做什么；路由表决定这个角色使用什么模型和推理强度。

例如：用户选择 Sol High，需要探索代码时，主 Agent 查 Sol 表的 `explorer` 行；用户选择 Astra XHigh 时，则查 Astra 表的 `explorer` 行。

## 1. 子 Agent 角色

这一节只确定职责，不选择模型。

| 角色 | 做什么 | 权限 | 是否保留 |
|---|---|---|---|
| `explorer` | 查找文件、代码路径、状态流和风险 | 只读 | 是，使用 Codex 内置角色 |
| `worker` | 根据明确任务修改代码并做短验证 | 可写 | 是，使用 Codex 内置角色 |
| `reviewer` | 独立检查错误、回归、竞态和测试缺口 | 只读 | 是，使用项目自定义角色 |
| `tester` | 运行现有测试并收集报告，不修改代码和测试 | 只写测试生成物 | 是，使用项目自定义角色 |

## 2. Sol 路由表

只要主 Agent 是 Sol 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `max` | 按需调用 |
| `worker` | `gpt-5.6-luna` | `max` | 按需调用 |
| `reviewer` | `gpt-5.6-sol` | 最低 `high`，随主 Agent 向上对齐 | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

## 3. Astra 路由表

只要主 Agent 是 Astra 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `max` | 按需调用 |
| `worker` | `gpt-5.6-luna` | `max` | 按需调用 |
| `reviewer` | `gpt-6-astra` | 最低 `high`，随主 Agent 向上对齐 | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

### Reviewer 对齐表

Reviewer 与主 Agent 使用同一模型家族，推理强度最低为 High；当主 Agent 为 XHigh 或 Max 时继续向上对齐。

| 主 Agent | Reviewer |
|---|---|
| Sol Low / Medium / High | Sol High |
| Sol XHigh | Sol XHigh |
| Sol Max | Sol Max |
| Astra Low / Medium / High | Astra High |
| Astra XHigh | Astra XHigh |
| Astra Max | Astra Max |
| Sol/Astra Ultra | 保持 Ultra 原生选择 |

## 4. Ultra

Sol Ultra 和 Astra Ultra 保持用户选择及 Codex 原生委派行为，不读取普通 Sol/Astra 路由表。

目前没有可核验的公开配置表明 Sol Ultra 与 Astra Ultra 使用不同的委派触发条件。因此普通 Sol/Astra 共同采用 Ultra 可观察到的核心原则：可独立并行且能明显改善速度或质量时主动委派。两者仍按各自路由表选择子 Agent 模型和推理强度。

- Ultra 是否仍固定使用某个 `tester`：否
- Ultra 是否仍要求一个独立 `reviewer`：否
- Ultra 的其他例外：不强制使用第 5 节的项目级路由证据、依赖分波、任务包和线程生命周期规则

## 5. 共用规则

> 本节是普通（非 Ultra）委派运行闭环的唯一详细规则。`AGENTS.md` 只保留触发和安全摘要，避免两处同时维护细节。

- 普通 Sol/Astra 是否需要用户明确要求才调用子 Agent：否，由主 Agent 主动判断
- 什么时候主动调用：存在具体、范围明确、可独立并行的任务，并且并行很可能明显节省时间或提高质量
- 优先委派什么：探索、测试执行、日志分析、问题分流、总结等以读取为主或中间输出噪音较大的工作
- 什么时候不调用：短任务、当前关键路径上的阻塞任务、需要与主任务持续共享决策的紧耦合任务
- 主 Agent 在子 Agent 运行期间做什么：继续处理不重叠的工作；只有结果成为下一步依赖时才等待
- 多步骤任务如何调度：主 Agent 在当前会话中维护一个精简任务表，每项写明任务 ID、`depends_on`、源版本、文件所有权和 `blocked | ready | active | completed | failed | cancelled` 状态。只启动 `ready` 任务；只有主 Agent 核验工作结果后才能标记 `completed` 并解锁下一轮。`failed`、`cancelled` 或工作结果未核验的任务不解锁依赖；循环依赖由主 Agent 重新拆分，不强行启动。路由证据另行记为 `verified | fallback | unverified | mismatch`，不与任务状态混用；`unverified` 只表示模型路由没有被证明，不自动否定已独立核验的工作结果
- 每次委派必须写清楚什么：任务 ID 和目的、为什么单独委派、绝对 checkout 和目标文件、base 与确切 HEAD；源不干净时还需记录 dirty 状态、任务相关 diff 或 working-tree hash，并在接受结果前重新核对。同时写明输入和约束、依赖与相关任务、验收标准、验证方法、停止条件、主 Agent 是否或何时等待、需要返回的摘要或产物。需要原始日志或持久产物时必须给出返回路径；否则只返回精炼的线程结果。不需要完整对话历史时，优先使用 `fork_turns: "none"` 和自包含任务包
- 子 Agent 如何返回结果：返回任务 ID 与建议状态、角色、预期路由、它可见的实际路由或 `unverified`、变更文件或证据路径、已做验证、剩余不确定性和阻塞；完整日志留在指定报告或产物目录
- 如何核验实际模型：主 Agent 在发起前记录角色、预期模型、预期推理强度和显式/继承方式；启动后由主 Agent 核对客户端线程信息，或子会话运行记录的 `turn_context.model`、`turn_context.effort` 和 `turn_context.multi_agent_version`。不以子 Agent 的自述作为证明
- 实际路由不匹配时怎么办：先停止并不接受代码变更。预期路由为显式值时，用原显式值重试一次；确认模型或强度不可用时，先记录原路由失败，再将“继承主 Agent”记为该次重试的授权 fallback 预期；实际元数据匹配该 fallback 时可继续，但必须报告 fallback。原预期路由为继承时，重试时仍省略模型和强度，不改成显式值。一次重试或 fallback 后仍不匹配或失败，标记任务 `failed`，保留只读证据，不解锁依赖。元数据不可见只标记 `unverified`；它不等于不匹配，也不得作为路由已证明的证据
- 什么时候 steer：由主 Agent 在关键输入变化、任务越界、与其他任务重复、使用过期源版本，或无法按约定返回证据时发起一次纠偏
- 什么时候停止：由主 Agent 在任务已过期或已被其他任务取代时停止并标记 `cancelled`；在指向错误源版本、需要未授权操作、与另一写 Agent 冲突，或一次纠偏后仍无有效进展时停止并标记 `failed`。两者均保留可用的部分证据并释放文件所有权
- 完成线程如何处理：正常情况下由 Codex 运行时自动释放。如果已完成线程仍占用名额，主 Agent 只使用当前客户端明确提供的关闭/释放能力；客户端没有该能力时报告限制，不虚构操作或继续超额启动
- 主 Agent 如何接受结果：子 Agent 摘要只是线索，不是验收证明；在解锁依赖任务或影响交付前，必须检查引用的 diff、文件、日志或产物并核对验收标准。主 Agent 再在当前会话和最终汇总中发布权威结果记录：任务 ID、最终状态、角色、预期路由、路由证据状态、实际路由或 `unverified`、源指纹、变更文件或证据路径、验证、剩余不确定性和阻塞
- Sol 与 Astra 是否使用不同的触发规则：否；目前只区分子 Agent 的模型和推理强度
- 最多同时运行多少个子 Agent：3
- 最多同时写入同一 worktree 的子 Agent：1，包括测试生成物和报告
- 子 Agent 是否可以继续调用子 Agent：否
- 指定模型不可用时怎么办：记录原路由失败，去掉显式模型和推理强度后重试一次，并将继承主 Agent 记为该次重试的授权 fallback 预期
- 主 Agent 既不是 Sol 也不是 Astra 时：子 Agent 继承主 Agent
- Terra 专属配置和 `terra-luna-standard`：删除
- 运行证据记录在哪里：记录在当前会话的委派说明和最终汇总中；任务已有报告目录时可同步写入。不为此单独新建产品元数据或 CI 车道

## 6. 填完后确认

- [x] Sol 表已填完。
- [x] Astra 表已填完。
- [x] Ultra 的例外已确认。
- [x] 共用规则已填完。
- [x] 角色职责中没有写模型。
- [x] 路由表中每个保留角色都有模型和推理强度。

## 7. 兼容性与验证

- 当前桌面端附带的 Codex CLI `0.153.4` 将 `multi_agent_v2` 标记为 stable，但官方配置参考尚未列出这个键；Codex 升级后需要重新验证。
- 已分别用普通 `gpt-5.6-sol` / `low` 和 `gpt-6-astra` / `low` 启动真实项目会话，两者的会话元数据均记录 `multi_agent_version: "v2"`。
- 2026-09-10 的两个真实子线程探针分别显式请求 `gpt-5.6-sol` / `high` 和 `gpt-5.6-luna` / `max`；子会话 `turn_context` 记录的实际模型、推理强度与请求一致，且均为 `multi_agent_version: "v2"`。这证明本次显式路由，不代替今后每次委派的运行证据。
- 同日的 Reviewer 顶档对齐探针分别显式请求 `gpt-6-astra` / `max` 和 `gpt-5.6-sol` / `max`；子会话 `turn_context` 记录均与请求一致且为 V2。这验证了 Sol/Astra Max Reviewer 不降级的显式路由能力，其他深度仍按每次委派记录实际证据。
- `features list` 不会反映本次项目级覆盖；验证时以从项目目录启动的真实会话元数据为准。

## 参考

- [OpenAI Docs：子智能体](https://learn.chatgpt.com/zh-Hans/docs/agent-configuration/subagents)
- [OpenAI Docs：模型与推理强度](https://learn.chatgpt.com/zh-Hans/docs/models?surface=app)
