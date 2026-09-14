# 结构原地编辑与 Native Edit 目标所有权验收报告

日期：2026-09-15
状态：Draft PR 阶段；未合并、未 Ready、未打包发布

## 结论摘要

本分支修复了长会话中“产品选中的目标”和浏览器实际 `activeElement` 可能分叉的问题，并把结构操作的输出选择（复制后的新元素、删除后的落点、移动后的元素）作为一次明确的目标交接继续传递给评论、格式、保存和下一次编辑。

当前结论不是“全部真实语料通过”：源码级、合成 Electron 和既有定向 Electron 验收已经通过；用户指定的私有 HTML 语料已运行能力预检，但 8 个文件均在 discovery 阶段被 Harness 拒绝，尚未形成可签收的 A/B/C 冻结结果。旧的 `pr1_*` 冻结计划也被当前 Stemmio 身份校验以 `FROZEN_IDENTITY_INVALID` 拒绝，因此没有通过替换目标或修改操作顺序来制造通过结果。

这保留了新结构原地路径的 fail-closed 行为：能够证明身份、源码、父节点和宿主关系时才原地执行，不能证明时仍走 Candidate；本次修复没有把回退开关变成用户设置。

## 本次修复范围

- `HtmlCanvasEditor` 在结构操作完成后生成 `operationOutputSelection`：复制选择新副本，删除选择源代码推导出的落点，移动继续绑定移动元素；评论锚点与该选择一起更新，避免原元素和副本共享逻辑身份。
- Native Edit 启动时验证当前 lease、目标元素、`contenteditable`、`activeElement` 和 Selection 是否属于同一目标。旧 session 不再无条件复用；失效时先完成旧 session，无法证明新目标时 fail closed。
- 增加受同一 lease 约束的焦点恢复入口。保存等宿主异步工作结束后只恢复当前 Native Edit 目标；短暂的 iframe/body blur 只在同一 session 仍有效时有限重试，明确的外部焦点仍由用户拥有。
- 删除后的选择不再被无条件清空；Harness 也从删除前冻结源码推导并核验新落点，随后把已核验的落点传给继续编辑步骤。
- 增加一个合成 Electron 回归：复制后不重新点击直接评论、格式化，再删除并不重新点击直接评论删除落点。
- 增加测试专用的 `STEMMIO_DISABLE_STRUCTURAL_IN_PLACE=1` 回退入口，仅用于冻结测试 C 组；产品没有新增设置或开关。

现有交互契约仍由 `docs/INTERACTION_FLOW.md` 第 5 节负责，本次没有改变用户可见的产品边界。

## 已执行验证

以下命令均在隔离任务 worktree、当前分支源码上执行；报告中的测试不包含私有 HTML 内容、个人路径或运行日志。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `npm ci` | 通过 | 依赖安装完成；npm audit 仍报告 1 个 moderate，未执行破坏性修复 |
| `npm run gate:edit` | 通过 | architecture/typecheck + 465 个 Node 测试全部通过；仅有既有宽度预算 advisory |
| 结构投影/目标重绑定/真实语料契约定向 Node | 通过 | 71/71 |
| `node --check`（变更的 `.mjs`） | 通过 | 无语法错误 |
| `npm run desktop:renderer` | 通过 | Vite renderer build 成功；保留既有大 chunk warning |
| 变更文件定向 ESLint | 通过 | 0 errors；8 warnings，均为既有规则/代码风格提示 |
| 新增合成 Electron 回归 | 通过 | 1 passed；覆盖 copy → direct comment → direct format → delete landing → direct comment |
| 既有 Electron 定向回归 | 通过 | 14 passed；覆盖复制、删除、混合内容 Undo、跨父移动、Runtime 编辑、Native Edit rebase、Candidate commit failure 等 |
| 收尾门禁第一轮 | 发现并修正测试契约 | `task:finish` 的 74 个 Electron 用例中 72 passed、2 failed；失败都集中在 Candidate handoff 后仍按旧元素断言选择。定向复验这 2 个用例在新提交上 2/2 passed，随后重新执行完整收尾门禁。 |
| 收尾门禁第二轮（最终） | 通过 | `npm run task:finish`：465 Node、66 Browser、83 Electron、15 AI 全部通过，0 failed、0 skipped、0 not executed。 |

关键门禁的机器可读结果位于 worktree 的 `output/test-runs/`（生成目录不提交）。

## 用户指定真实语料预检

本轮使用用户指定的本地 HTML 目录作为语料来源。它是私有输入，不提交到仓库，也不在 PR 中公开文件名和绝对路径。运行的是：

```text
STEMMIO_REAL_HTML_DIR=/path/to/user-designated-corpus \
STEMMIO_REAL_HTML_MODE=capability-preflight-only \
npm run test:real-html:electron
```

本次实际目录包含 8 个 HTML 文件。预检结果为 8/8 `DISCOVERY_ERROR`，失败发生在冻结目标/能力 discovery 阶段，未进入 A 文字、B 结构、C Runtime/iframe、D 元素能力、E 编辑后重建续写的正式验收。因此：

- 不能把这次预检记为真实语料通过；
- 不能把 synthetic Electron 结果冒充私有语料验收；
- 不能用另一个更容易操作的元素替代冻结目标；
- 需要先解决当前 Stemmio 身份迁移后的真实语料导入/目标冻结问题，再从同一原始字节重新生成 B 默认、C 关闭原地路径及必要的 A/D/E 组。

之前遗留的 `pr1_*` H05 长会话计划在当前源码上被正确拒绝为 `FROZEN_IDENTITY_INVALID`。这是保护条件，不是测试失败后换目标的理由。该旧计划没有被改写或提交。

## 门禁失败的纠偏记录

第一轮 `task:finish` 没有被用重复运行来洗绿。两个失败分别是 Candidate handoff 的呈现锚点断言和慢 Runtime 场景的旧元素选择断言；实际产品行为已经把结构操作输出选择交给新副本，正是本次目标所有权修复所要求的契约。测试随后改为等待并断言操作输出的 Stable ID（呈现锚点取新的已选元素，重复副本取最后一个输出节点），没有放宽源码、焦点、结构或连续性校验。新提交上两个失败用例单独 2/2 通过，随后以该新提交重新执行完整 `task:finish`，最终 465 Node、66 Browser、83 Electron、15 AI 全部通过。

## 目标所有权回归覆盖

当前已锁住的最小契约如下：

1. 复制后不重新点击，评论和格式操作必须落到新副本；原元素的 Stable ID 和内容保持独立。
2. 删除后不重新点击，评论必须落到源代码推导的新落点，不能继续使用被删除元素的引用。
3. 原元素、副本和删除落点的评论锚点分别解析到各自元素；结构操作输出选择与评论锚点同步。
4. Native Edit 重新进入时必须验证 session lease、目标元素、`activeElement`、`contenteditable` 与 Selection；无法证明时不报告成功。
5. Save/flush 的异步完成只可恢复当前 lease 的 Native Edit 目标，不能把旧 session 的焦点拉回另一个 Stable ID。
6. C 组开关只改变结构原地路径选择，不改变目标身份、源码校验、保存和恢复语义。

## 重建比例的报告口径

本分支不把 Candidate 数量或 Runtime handoff 数量命名为“整页重写率”。后续完整真实语料验收需要分别记录：

- Candidate 创建、取消、失败；
- Active 页面交接和真实 Document 替换；
- 复用同一个 Document 对象但发生 `document.open()`/`write()`/`close()` 的整页重写；
- 作者脚本重新激活；
- 局部更新接受、投影失败后的恢复。

同一次交接的多个观测信号只计一次用户画布重建；隐藏 Candidate 失败或 inactive 槽清空不另算一次。普通编辑、复制、删除、插入、跨父移动、结构 Undo/Redo 将分别以冻结的“已接受编辑操作”为分母。必须原地的样本另报意外重建率，非法拒绝和投影失败恢复不能算作“成功避免重建”。

此外，`working` 与 `rendered` hash 一致不能单独证明没有整页重写；验收还要读取实际保存字节、受影响节点文字/样式/结构、原元素与副本身份以及评论锚点。

## 尚未签收的范围

以下项目在真实语料 discovery 修复后必须从新的当前身份冻结计划开始执行：

- 8 文件同语料 B 默认、C 关闭结构原地路径的配对；必要时补 A 旧基线和 D/E 组；
- 原有连续编辑线：文字输入、中文输入法、连续 Enter、外部粘贴、范围格式、结束/自动/手动保存、切换选择；
- 结构与评论交叉线：复制、直接编辑/评论/格式、移动、删除落点、Undo/Redo、保存和重开；
- Candidate 竞争、动态失败、静态回退、双重失败、重试和同字节权威重载；
- 长页面、嵌套滚动、图表、评论栏、缩放和页内标签的阅读位置、工具栏目标、评论锚点、白屏/跳动/失焦与下一次输入；
- 在完整冻结场景通过后，再扩展独立会话及同一长会话 20/50/100 轮，并观察失效引用、历史淘汰、观察器、待处理 Candidate/恢复请求和内存增长。

这些未执行项是当前 Draft PR 的明确限制，不降低本次已经通过的源码和合成回归证据，也不构成最终真实语料签收。

## 隐私与交付边界

PR 只包含源码、测试和本报告；用户 HTML、附件、截图、私有绝对路径、项目记录和生成二进制均留在本机临时目录。此 PR 保持 Draft，不执行 Ready、合并、打包或发布。
