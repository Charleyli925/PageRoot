# 源页（PageRoot）

[![CI](https://github.com/Charleyli925/PageRoot/actions/workflows/ci.yml/badge.svg)](https://github.com/Charleyli925/PageRoot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Charleyli925/PageRoot)](https://github.com/Charleyli925/PageRoot/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Edit visually. Stay in source.

源页是一款本地 macOS HTML 编辑工作台。它允许用户直接在真实页面上修改内容，同时始终以原始 HTML 源码为唯一内容事实源。当前源码版本为 `0.8.2`。

## 核心原则

- 所有持久化修改都通过源码级局部 Patch 完成，不把预览 DOM 序列化回源文件。
- 本地编辑自动、串行、原子写回；发现外部修改时停止覆盖并提示冲突。
- AI 返回必须经过身份、协议、范围、完整 HTML 和文件 Hash 校验，校验成功后才形成不可变版本。
- 应用只把交接内容复制到剪贴板，不会自动控制第三方 AI 客户端。

更完整的实现边界见[架构说明](docs/ARCHITECTURE.md)和[安全模型](docs/SECURITY_MODEL.md)。

## 下载

Apple 芯片 Mac 用户可从 [GitHub Releases](https://github.com/Charleyli925/PageRoot/releases/latest) 下载最新版 DMG。当前构建使用 ad-hoc 签名，尚未完成 Apple Developer ID 公证；首次启动可能需要按住 Control 点击应用并选择“打开”。

每个正式 Release 应包含：

- `PageRoot-<version>-arm64.dmg`
- `SHA256SUMS.txt`
- `update-manifest.json`
- `build-info.json`，记录安装包对应的 Git commit 和 tree

## 本地开发

要求 macOS 12 或更高版本、Node.js `22.13.0` 或兼容的 Node 22 版本。

```bash
git clone https://github.com/Charleyli925/PageRoot.git
cd PageRoot
npm ci
npx playwright install chromium
npm run desktop:dev
```

常用验证命令：

```bash
npm run gate:edit          # 开发中的定向检查
npm run gate:task          # 一项修改完成后的检查
npm run gate:release:auto  # 干净提交上的完整发布前检查
npm run release:mac        # 完整检查、打包并验证 arm64 DMG
```

发布门禁只接受已经提交且工作区干净的源码。详细环境与测试说明见[开发指南](docs/DEVELOPMENT.md)。

## 仓库结构

```text
app/       Web 界面与源码 Patch 编辑核心
desktop/   Electron 主进程、预加载与桌面运行时
scripts/   Bridge、协议校验、测试门禁与发布工具
schemas/   当前协议的 JSON Schema
fixtures/  协议兼容性固定样本
tests/     Node、Browser 与 Electron 测试
docs/      架构、协议、开发和治理文档
```

## 唯一真相与协作方式

公开仓库的 `main` 分支是项目源码的唯一真相。开发分支是临时工作面；DMG、`.app`、`release/` 和 `output/` 都是可重新生成的产物，不是源码。不要从安装包反向修改代码，也不要在多个文件夹中各自维护一份“最新版”。

日常 Git 操作、分支命名、提交和回滚方法见[Git 工作流](docs/GIT_WORKFLOW.md)；发版规则见[发布指南](docs/RELEASING.md)。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)与[公开边界](docs/OPEN_SOURCE_BOUNDARY.md)。安全问题请不要提交公开 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

代码以 [Apache License 2.0](LICENSE) 开源。项目名称与视觉标识不随代码许可证授权，见 [TRADEMARKS.md](TRADEMARKS.md)。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
