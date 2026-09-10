# Codex Subagent 路由决策

> 这是当前决策记录。生效配置位于 `.codex/config.toml`、`.codex/agents/` 和 `AGENTS.md`。

## 怎么使用

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
| `reviewer` | `gpt-5.6-sol` | `high` | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

## 3. Astra 路由表

只要主 Agent 是 Astra 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `max` | 按需调用 |
| `worker` | `gpt-5.6-luna` | `max` | 按需调用 |
| `reviewer` | `gpt-5.6-sol` | `xhigh` | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

## 4. Ultra

Sol Ultra 和 Astra Ultra 保持用户选择及 Codex 原生委派行为，不读取普通 Sol/Astra 路由表。

目前没有可核验的公开配置表明 Sol Ultra 与 Astra Ultra 使用不同的委派触发条件。因此普通 Sol/Astra 共同采用 Ultra 可观察到的核心原则：可独立并行且能明显改善速度或质量时主动委派。两者仍按各自路由表选择子 Agent 模型和推理强度。

- Ultra 是否仍固定使用某个 `tester`：否
- Ultra 是否仍要求一个独立 `reviewer`：否
- Ultra 的其他例外：无

## 5. 共用规则

- 普通 Sol/Astra 是否需要用户明确要求才调用子 Agent：否，由主 Agent 主动判断
- 什么时候主动调用：存在具体、范围明确、可独立并行的任务，并且并行很可能明显节省时间或提高质量
- 优先委派什么：探索、测试执行、日志分析、问题分流、总结等以读取为主或中间输出噪音较大的工作
- 什么时候不调用：短任务、当前关键路径上的阻塞任务、需要与主任务持续共享决策的紧耦合任务
- 主 Agent 在子 Agent 运行期间做什么：继续处理不重叠的工作；只有结果成为下一步依赖时才等待
- 每次委派必须写清楚什么：任务边界、输入和约束、主 Agent 是否或何时等待、需要返回的摘要或产物
- 子 Agent 如何返回结果：返回精炼结论和证据路径，不把原始中间日志塞回主上下文；完整日志留在指定报告或产物目录
- Sol 与 Astra 是否使用不同的触发规则：否；目前只区分子 Agent 的模型和推理强度
- 最多同时运行多少个子 Agent：3
- 最多同时写代码的子 Agent：1
- 子 Agent 是否可以继续调用子 Agent：否
- 指定模型不可用时怎么办：去掉显式模型和推理强度后重试一次，使子 Agent 继承主 Agent
- 主 Agent 既不是 Sol 也不是 Astra 时：子 Agent 继承主 Agent
- Terra 专属配置和 `terra-luna-standard`：删除

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
- `features list` 不会反映本次项目级覆盖；验证时以从项目目录启动的真实会话元数据为准。

## 参考

- [OpenAI Docs：子智能体](https://learn.chatgpt.com/zh-Hans/docs/agent-configuration/subagents)
- [OpenAI Docs：模型与推理强度](https://learn.chatgpt.com/zh-Hans/docs/models?surface=app)
