# 开发者测试包 Playbook

开发者测试包（Developer Preview）是一个按需使用的轻量安装包，用来在正式签名、公证和发布之前，让开发者先安装并确认“这次提交的内容确实被打进去了，应用可以基本启动”。它不是每次发布的必经步骤，也不是 Release Candidate。

## 什么时候执行

只有开发者明确要求时才执行，例如：

- “给我一个开发者测试包”
- “先打一个可安装的测试包给我验证”
- “运行 Developer Preview”

“正式打包”“制作 Release Candidate”或“发布”不会自动插入开发者测试包。开发者没有明确要求时，直接按正式候选流程推进。

如果请求同时写明“不要真实打包”，只修改或检查流程定义，不能运行本 Playbook 的打包命令，也不能触发 GitHub Actions 工作流。

## 默认源码范围

“生成最新安装包”、“生成最新开发者测试安装包”默认表示：

- 以实时最新 `origin/main` 为基线，继承已合并 PR 的代码。
- 将当前开发范围内所有未被开发者明确排除的相关 PR 最新 head
  组合进来；开放、Draft 和关闭未合并均不会因状态被自动略过。
- 若 PR 堆叠，按依赖顺序组合并去重；若已被另一 PR 替代，不重复应用，
  但必须在交付报告中写明替代关系。
- 若有明确的“排除 #N”、“只打 `main`”或“只包含 #N/#M”，才修改默
  认范围，并在交付时列出所有排除项及理由。

实际打包前，先查询 GitHub 的实时 PR 清单，记录每个选中 PR 的最新 head
OID，再从 `origin/main` 创建临时 `integration/` 分支组合未合并项。该分支
只是打包输入，不会因此合并或修改原 PR。有任何未合并 PR 时，安装包
必须使用 Developer Preview 身份且不可正式发布；需要正式包时，相关 PR 必须
先合并或被开发者明确排除。

临时组合出现冲突、最新 head 无法取得或无法证明某个选定 PR 已进入
Tree 时，必须停止并报告，不能静默漏包。`npm run package:developer`
只对当前干净 Tree 打包，不负责在命令内自动合并 PR。

## 默认入口

推荐使用 GitHub Actions：

1. 打开 `Developer Preview` 工作流。
2. 选择需要验证的提交所在分支。
3. 架构固定为 `arm64`。
4. 手动点击运行。
5. 下载名为 `PageRoot-developer-preview-…` 的 Actions artifact。

工作流摘要会同时给出“安装包内容报告”，artifact 内也包含
`package-delivery-report.json` 和可直接用于交付回复的
`package-delivery-report.md`。

本机明确需要生成时，也可以在干净且已提交的目标 Tree 上执行：

```bash
npm run package:developer
```

产物位于 `output/developer-preview/`。GitHub artifact 保留 7 天。

## 名称与版本规范

开发者测试包同时通过应用名、安装包名和版本号表明身份：

- 安装后的应用名固定为 `PageRoot Developer Preview`，Bundle ID 固定在正式版 ID 的 `.developer-preview` 子标识下，因此可以和正式版 `PageRoot` 并存。
- DMG 固定命名为 `PageRoot-Developer-Preview-<测试版本>-<架构>.dmg`。
- `developer-preview.json` 同时记录源码版本、最近正式 tag、测试序号、测试版本、应用名和 Bundle ID。

测试版本先由最近一个正式 `vA.B.C` tag 和该 tag 之后的 first-parent 提交序号 `N` 生成易读序号：补丁位使用“下一正式补丁号 + `999` + 序号”。例如正式版本为 `0.9.5` 时：

- 第 1 个提交的序号前缀：`0.9.69991`
- 第 2 个提交的序号前缀：`0.9.69992`

完整测试版本始终在这个前缀后附加精确 commit 标识，例如
`0.9.69991-dev.g<40 位 Commit SHA>`；对应产物为
`PageRoot-Developer-Preview-0.9.69991-dev.g<40 位 Commit SHA>-arm64.dmg`。
这保留了容易识别、按提交顺延的 `0.9.69991`/`0.9.69992` 规则，同时让不同
分支上序号碰巧相同的两个 Tree 也不会共享应用或 DMG 版本。

同一个提交重复构建始终得到同一个完整测试版本；新提交才会顺延。新的正式 tag 会重置基线。基线只能是 `origin` 上存在、指向 commit、消息符合发布流程的注释 `vA.B.C` tag；本地轻量 tag 或未推送的自定义 tag 不会被当作正式版本。工作流会拒绝没有该正式 tag、直接位于正式 tag 上或含未提交修改的测试构建，避免版本身份不确定。`package.json` 和正式发布产物仍保留正式版本与 `PageRoot` 名称，不会被测试包配置改写。

## 自动校验范围

默认轻量流程只做以下工作：

1. 拒绝未提交的源代码，并把 commit SHA 与 Tree SHA 写入证明。
2. 构建最新 Electron renderer。
3. 只生成一个对应架构的 DMG，不生成 updater ZIP、blockmap 或发布元数据。
4. 校验 `app.asar` 文件闭包、源文件、Bridge、Schema、法律资源、测试应用名、测试版本、独立 Bundle ID、架构、DMG 完整性和只读挂载内容。
5. 要求 ad-hoc 签名，不读取 Developer ID、Apple 公证或发布凭据。
6. 使用隔离 userData 启动真实 `.app`，确认首个窗口、版本、Bridge、Workbench 就绪状态和正常退出。
7. 写入 `developer-preview.json`，包括 DMG SHA-256，并固定：
   - `kind: developer-preview`
   - `releaseEligible: false`
   - `notarized: false`
8. 在所有校验通过后查询 GitHub，生成安装包内容报告：绑定 DMG Hash、
   `v0.9.5..HEAD` 一类的源码范围、提交/文件统计，逐个列出关联 PR 的当前
   状态和一句话摘要，并显式列出没有 PR 的直接提交。
9. 对照打包前 PR 清单，确认所有选中项已进入 Tree，并在交付中列出
   所有明确排除或被替代的 PR 及理由。

它不会运行完整 Node、Browser、Electron 或 AI 发布矩阵，不会访问真实用户文档，不会创建 tag、GitHub Release 或更新器资产，也不会上传到正式发布通道。

## 开发者安装验证

下载后，开发者只需做一次短验证：

1. 对照 `developer-preview.json` 确认测试版本、正式基线、测试序号、架构、commit 与 DMG SHA-256。
2. 对照 `package-delivery-report.md` 确认内容范围、所有关联 PR、PR 当前
   状态/检查结果、每个 PR 的一句话修改摘要，以及未关联 PR 的直接提交。
3. 安装并打开应用。因为包使用 ad-hoc 签名且未公证，macOS 可能要求在 Finder 中按住 Control 点击应用并选择“打开”。
4. 使用真实文档的副本打开应用，确认本次最关键的一到两个能力能正常运行。
5. 记录通过或明确的失败现象。

## 安装包交付回复

每次真正生成开发者测试包后，给开发者的回复必须包含 DMG 链接、版本、
架构、大小、SHA-256、源码范围和变更规模，并逐个列出报告中的 PR 链接、
当前状态与一句话修改摘要；每个明确排除/替代 PR 及理由也要列出；没有
PR 的提交也要列出，若没有则明确写“无”。
因为 PR 状态会变化，延迟交付时要针对同一个 DMG 刷新报告。只有 DMG 而没有
完整内容报告，不能算完成交付。

不要清除系统 quarantine，不要把这个 DMG 当作正式版本分发。人工安装结果只用于尽早发现打包范围或基本运行问题，不会改变正式发布门禁。

## 失败与后续

- 任何源代码修改都会产生新的 Tree SHA；修复后需要开发者再次明确要求，才重新生成测试包。
- 开发者测试包通过后，正式 Release Candidate 仍从受审查的 `main` 重新执行完整正式流程。
- 开发者测试包失败时，先依据 `output/test-runs/`、`output/playwright/` 和 `developer-preview.json` 定位是内容、启动还是环境问题；不要用正式发布流程反复试错。
- 开发者测试包不能被提升为正式 Release，也不能用来绕过 PR source gate、Developer ID 签名、公证、更新资产或冻结字节校验。
