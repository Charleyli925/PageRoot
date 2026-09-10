# Codex Subagent 路由填写表

> 这是待填写草案，不是当前生效配置。填写确认后，再把结果转换成 `.codex/` 和 `AGENTS.md` 配置。

## 怎么使用

- 用户在模型选择器中选择什么模型和推理强度，主 Agent 就使用什么。
- 主 Agent 是 **Sol 且不是 Ultra**：填写并使用“Sol 路由表”。
- 主 Agent 是 **Astra 且不是 Ultra**：填写并使用“Astra 路由表”。
- 主 Agent 是 **Sol Ultra 或 Astra Ultra**：不使用下面两张表，保持 Ultra 原生行为。
- 角色决定子 Agent 做什么；路由表决定这个角色使用什么模型和推理强度。

例如：用户选择 Sol High，需要探索代码时，主 Agent 查 Sol 表的 `explorer` 行；用户选择 Astra XHigh 时，则查 Astra 表的 `explorer` 行。

## 1. 子 Agent 角色

这一节只确定职责，不选择模型。

| 角色 | 做什么 | 权限 | 是否保留 |
|---|---|---|---|
| `explorer` | 查找文件、代码路径、状态流和风险 | 只读 | `<是/否>` |
| `worker` | 根据明确任务修改代码并做短验证 | 可写 | `<是/否>` |
| `reviewer` | 独立检查错误、回归、竞态和测试缺口 | 只读 | `<是/否>` |
| `tester` | 运行现有测试并收集报告，不修改代码和测试 | 只写测试生成物 | `<是/否>` |
| `<其他角色>` | `<填写>` | `<填写>` | `<是/否>` |

## 2. Sol 路由表

只要主 Agent 是 Sol 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `<填写>` | `<填写>` | `<填写>` |
| `worker` | `<填写>` | `<填写>` | `<填写>` |
| `reviewer` | `<填写>` | `<填写>` | `<填写>` |
| `tester` | `<填写>` | `<填写>` | `<填写>` |
| `<其他角色>` | `<填写>` | `<填写>` | `<填写>` |

## 3. Astra 路由表

只要主 Agent 是 Astra 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `<填写>` | `<填写>` | `<填写>` |
| `worker` | `<填写>` | `<填写>` | `<填写>` |
| `reviewer` | `<填写>` | `<填写>` | `<填写>` |
| `tester` | `<填写>` | `<填写>` | `<填写>` |
| `<其他角色>` | `<填写>` | `<填写>` | `<填写>` |

## 4. Ultra

Sol Ultra 和 Astra Ultra 保持用户选择及 Codex 原生委派行为，不读取普通 Sol/Astra 路由表。

- Ultra 是否仍固定使用某个 `tester`：`<否 / 填写模型和推理强度>`
- Ultra 是否仍要求一个独立 `reviewer`：`<是/否>`
- Ultra 的其他例外：`<填写或无>`

## 5. 共用规则

- 最多同时运行多少个子 Agent：`<填写>`
- 最多同时写代码的子 Agent：`<填写，建议 1>`
- 子 Agent 是否可以继续调用子 Agent：`<填写，建议否>`
- 指定模型不可用时怎么办：`<继承主 Agent / 使用备用模型 / 停止并报告>`
- 主 Agent 既不是 Sol 也不是 Astra 时：`<子 Agent 继承主 Agent / 其他>`
- Terra 专属配置和 `terra-luna-standard`：`<删除/保留>`

## 6. 填完后确认

- [ ] Sol 表已填完。
- [ ] Astra 表已填完。
- [ ] Ultra 的例外已确认。
- [ ] 共用规则已填完。
- [ ] 角色职责中没有写模型。
- [ ] 路由表中每个保留角色都有模型和推理强度。

## 参考

- [OpenAI Docs：子智能体](https://learn.chatgpt.com/zh-Hans/docs/agent-configuration/subagents)
- [OpenAI Docs：模型与推理强度](https://learn.chatgpt.com/zh-Hans/docs/models?surface=app)
