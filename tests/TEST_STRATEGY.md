# PageRoot 自动化测试策略

目标不是增加测试数量，而是在尽量短的反馈时间内发现真实缺陷。所有活动门禁都必须无人值守：不等待真人点击、输入、观察、判断或把任务转交给外部模型。测试物料可以由确定性生成器产生，但判断标准必须由源码字节、Hash、状态机、DOM/几何或明确协议字段自动给出。

## 四层门禁

| 门禁 | 使用时机 | 覆盖 | 目标 |
|---|---|---|---|
| `npm run gate:edit` | 一次局部修改后 | 只运行影响映射命中的 Node 文件；必要时 typecheck | 快速发现局部逻辑错误，不启动浏览器或 Electron |
| `npm run gate:task` | 一个开发任务完成时 | 静态检查、受影响 Node 文件，以及相关 Browser/Electron/AI 冒烟 | 在较短时间内证明生产链路已经接通 |
| `npm run gate:release:auto` | 发布前 | 全量 Node、完整 Browser、完整 Electron、确定性 AI 闭环、真实 HTML 发现式门禁 | 不用冒烟代替完整回归 |
| `npm run gate:artifact:auto` | 生成候选包 | release 全部内容、打包、打包 App 实机启动、DMG/签名/包内容校验 | 证明最终候选物，而不只证明源码运行时 |

`release` 和 `artifact` 不根据改动缩减范围。`edit` 和 `task` 的选择由 `tests/test-impact-map.json` 决定，模型或开发者只选择门禁层级，不临时拼接测试命令。

工作区有未提交修改时，`edit/task` 自动读取 staged、unstaged 和 untracked 文件。任务已经提交后应运行 `npm run gate:task -- --base <基准分支或提交>`；干净工作区又没有 `--base` 时门禁会明确失败，不会把“零测试”伪装成通过。

`npm run task:finish` 是 `gate:task -- --base origin/main` 的安全任务包装，不引入新的门禁层。`tests/task-workflow.test.mjs` 在独立临时 Git 仓库中验证分支名、干净 `main`、远端同步、脏工作区拒绝和最终差异报告，不会操作开发者的真实分支。

## 测试类型与去重

- 核心 Node：算法、状态机、序列化、事务、错误关闭和 forward/inverse 不变量。
- 源码字符串合同：只在其拥有的组件或控制器变化时运行；不把实现文本匹配当作主要正确性证据。
- Browser 冒烟：固定覆盖脚本隔离、源码字节、格式骨架、历史和能力降级五类关键风险；完整 Browser 仍包含所有回归，不修改或跳过已知失败。
- Electron 冒烟：固定覆盖真实 authored DOM 输入和一次带磁盘持久化的 composition；完整 Electron 保留保存、关闭重开、undo/redo 等全部路径。
- AI 闭环：任务级只跑正常闭环和越界失败 2 个代表场景；发布级跑完整 6 个场景，包括复制失败、缺失 finalizer、非法 HTML 和版本激活失败。测试自动生成受控 AI 输出并执行正式 finalizer，不等待外部模型或真人接力。
- 候选包：从 `.app` 的真实可执行文件启动，使用隔离 userData，完成源码字节 oracle；随后校验 app.asar、Bridge、Schema、签名、DMG 和只读挂载内容。

顶层 Node 测试在一次执行中只出现一次。精确影响映射优先；只有找不到任何精确用例时才启用 `node-core` 兜底。Web 与 Electron renderer 在一个门禁内各最多构建一次。

## 判断标准优先级

1. 原始 Buffer、SHA-256、forward/inverse Patch、磁盘重读结果。
2. 明确状态机字段、revision、协议 Schema、失败码和文件清单。
3. DOM 身份、Selection、caret、几何、scroll 和布局指纹。
4. 截图、trace 和视频只作为失败诊断物，不要求真人看图后决定通过。

`tests/generated-source-invariants.test.mjs` 用固定种子生成 BOM、LF/CRLF、单双引号、多语言 Unicode、entity、注释和脚本文本组合。每个失败都带 seed；测试用独立字节替换 oracle 验证未命中范围、undo 和 redo，而不是复用被测实现计算期望值。

## 真实 HTML 与输入法边界

`npm run test:real-html` 默认使用仓库内复杂 HTML 物料，自动发现一个可编辑目标和一个明确降级目标，并验证几何与字节不变量。也可以用 `PAGEROOT_REAL_HTML_PATH` 覆盖直接测试的输入，或对门禁执行器传入 `--real-html <绝对路径>`；原文件不会被写入。

当前自动化能证明 Chromium/Electron composition 事件序列、Apple 拼音临时 wrapper 轨迹、取消/迟到事件、持久化和 canonical reconcile。它不能诚实证明第三方 macOS 输入法候选窗本身。该能力在出现可无人值守、可复现并有机器 oracle 的 OS 级驱动前只登记为覆盖边界，不设人工门禁，也不伪装成已自动验证。

## 证据与新增测试准入

每次门禁写入 `output/test-runs/<run-id>/selection.json` 和 `results.json`，记录 HEAD、工作区内容 Hash、改动文件、选择原因、命令、耗时和首个失败。Playwright 的失败截图、trace、视频和 HTML report 继续位于 `output/playwright/`。

新增测试至少要回答四件事：对应哪个真实故障；使用哪个独立 oracle；属于哪个门禁层；是否已经被更低成本测试覆盖。不能给出明确答案的重复排列或纯“代码里存在某个字符串”测试，不应加入常规门禁。
