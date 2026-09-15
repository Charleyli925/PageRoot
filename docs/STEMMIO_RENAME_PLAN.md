# Stemmio 更名与本地文件边界执行计划

执行基线：`711f6c2e9e84ee57c3d3e59667a0aab54d167d5b`（历史仓库 `Charleyli925/PageRoot`）。
本文件把 2026-09-14 的切换规划落成仓库内的执行清单；历史 ADR、CHANGELOG 和第三方声明仍按原文保留，现行 GitHub 地址使用更名后的 Stemmio 仓库。

## 冻结合同

| 项目 | Stemmio 合同 |
| --- | --- |
| 中文产品名 | 源页 |
| 英文产品 / Bundle | Stemmio / `com.stemmio.app` |
| Preview | Stemmio Developer Preview / `com.stemmio.app.developer-preview` |
| npm name | `stemmio` |
| 稳定目录 | Documents/Application Support 下的 `Stemmio` |
| Preview 目录 | `Stemmio Developer Preview` |
| source 目录 | `Stemmio Development` |
| Chromium 会话 | 当前渠道 userData 下的 `chromium` |
| 项目控制目录 | `.stemmio/` |
| Registry / 锁 | `.stemmio-registry.json` / `.stemmio-registry-write-lock` |
| 导入暂存 | `..stemmio-import-` |
| 无覆盖临时文件 | `.stemmio-new-` |
| 持久元素身份 | `data-stemmio-id`，`sm1_` + UUID v4 去横线 |
| 运行时协议 | `stemmio-preview:` / `stemmio-edit-runtime:` |
| 运行时 origin | `https://stemmio-preview.invalid` |
| 对话 actor | `stemmio`（记录版本 3） |
| 自有 Schema | `https://stemmio.local/schemas/` |
| 自有环境变量 | `STEMMIO_*`；第三方标准变量不改 |
| GitHub | 已改名为 `Charleyli925/Stemmio`；不回写旧 Release 与 tag |

## 渠道与隔离规则

- stable、preview、source 使用各自的产品目录；E2E 只接受系统临时目录下的单次绝对根。
- 不读取、迁移、接管或删除旧 PageRoot 管理目录、Keychain 条目或旧 Registry。
- 用户主动选择的旧 HTML 可以导入；导入创建新的 Stemmio 项目副本且不回写原文件。
- Preview、source 和中间测试包不得承载正式 Stemmio 项目。
- `isPageRootElement`、`isPageRootSelection` 等页面语义名称、历史资料和拒绝旧格式的负向测试是精确例外。

## 批次状态与合同归属

| 批次 | 目标 | 状态 |
| --- | --- | --- |
| 0 | 基线、命中分类、发布边界 | 已完成；合同、例外分类和交付边界已冻结 |
| 1 | 应用身份、运行环境、路径隔离、凭证入口 | 已完成；代码、测试和负向隔离检查已同步 |
| 2 | Preview/Edit scheme、临时 DOM 属性、运行时消息 | 已完成；协议、CSP、bootstrap 和双方运行时已同步 |
| 3 | 项目布局、Registry、导入和非覆盖写边界 | 已完成；`.stemmio`、Registry、锁及暂存前缀已收口 |
| 4 | 持久元素身份、Schema、Candidate/Review 全链路 | 已完成；`data-stemmio-id`/`sm1_` 已贯穿生产链路与夹具 |
| 5 | Conversation v3、Schema 命名空间、首次安装验收 | 已完成；v3 为唯一当前写入格式，旧 v2 明确拒绝 |
| 6 | 剩余工程命名、变量、夹具和防回流检查 | 已完成；自有命名、环境变量、CI/夹具和合同门禁已更新 |

## 命中分类规则

1. 现行生产合同：按所属批次原子修改生成端、消费端、校验器、持久入口、Schema、Agent 指令和测试。
2. 页面语义：保留 `isPageRootElement`/`isPageRootSelection` 等非产品身份语义。
3. 历史证据：ADR、CHANGELOG、冻结 QA 和迁移拒绝测试只在必要处补充说明，不机械改写。
4. 外部/第三方：GitHub 仓库地址、Apple/GitHub/NPM 标准变量、第三方 Agent 名称不改。
5. 旧格式负向测试：明确验证旧 scheme、旧 actor、旧属性或旧目录不会被 Stemmio 自动接管。

## 交付边界

本分支完成代码、Schema、夹具和门禁更新；每批次的合同与测试边界均可独立审查。除非另行授权，不合并、发布、改仓库名、上传正式 Release 或安装到用户正式渠道；第 5 批的“可承担正式数据”只在完整安装验收后成立。
