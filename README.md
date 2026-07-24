<p align="center">
  <img src="public/brand-logo.png" width="96" alt="PageRoot logo / 源页 Logo" />
</p>

<h1 align="center">PageRoot</h1>

<p align="center">
  <strong>Edit visually. Stay in source.</strong><br />
  A local-first, source-preserving visual HTML editor for macOS.<br /><br />
  <strong>所见即可改，源码始终是真相。</strong><br />
  面向 macOS 的本地优先、源码保真可视化 HTML 编辑器。
</p>

<p align="center">
  <a href="https://github.com/Charleyli925/PageRoot/releases/latest"><img src="https://img.shields.io/github/v/release/Charleyli925/PageRoot?style=flat-square&label=latest" alt="Latest PageRoot release" /></a>
  <a href="https://github.com/Charleyli925/PageRoot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Charleyli925/PageRoot/ci.yml?branch=main&style=flat-square&label=build" alt="PageRoot build status" /></a>
  <img src="https://img.shields.io/badge/macOS-12%2B-111111?style=flat-square&logo=apple" alt="macOS 12 or later" />
  <img src="https://img.shields.io/badge/Apple%20silicon-arm64-6e5de7?style=flat-square" alt="Apple silicon arm64" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-4d66cc?style=flat-square" alt="Apache 2.0 license" /></a>
</p>

<p align="center">
  <a href="https://github.com/Charleyli925/PageRoot/releases/latest"><strong>Download for Apple silicon</strong></a>
  · <a href="#english">English</a>
  · <a href="#chinese">中文</a>
  · <a href="docs/ARCHITECTURE.md">Architecture</a>
  · <a href="https://github.com/Charleyli925/PageRoot/issues/new/choose">Report an issue</a>
</p>

<p align="center">
  <img src="docs/assets/pageroot-welcome-hero.png" width="1040" alt="PageRoot source-preserving visual HTML editor welcome page / 源页源码保真可视化 HTML 编辑器欢迎页" />
</p>

<p align="center">
  <sub>Rendered from the welcome project included with PageRoot · 截取自源页内置欢迎项目</sub>
</p>

<a id="english"></a>

## Visual HTML editing without surrendering your source

PageRoot is a local-first visual HTML editor for macOS—a source-preserving alternative to conventional WYSIWYG website editors for real `.html` files. Open a local page, double-click supported text, and edit with the browser’s native caret, selection, paste, and input-method behavior. PageRoot maps that intent back to the exact source range and writes a minimal patch instead of serializing the preview DOM.

For larger or generative changes, anchor comments to the whole page, a section, specific text, or an insertion point, then attach reference images or files. PageRoot freezes the exact request, prepares a clipboard-only QoderWork handoff, validates returned HTML against identity, source hash, path, integrity, and allowed scope, and keeps an accepted result as a separate version that you choose when to open.

It is built for people editing AI-generated landing pages, prototypes, documentation pages, static pages, and hand-authored HTML who want visual speed without losing source fidelity.

### Why PageRoot

- **Edit directly on the page.** Double-click safe text, place the caret where you clicked, type with a native-feeling workflow, format supported text, and reorder supported sibling sections.
- **Preserve the HTML you actually own.** Every persistent visual edit becomes a source-level patch limited to the resolved target. Unrelated markup, formatting, and authored structure are not rebuilt from the DOM.
- **Review changes in context.** Comments stay attached to page, section, text, or insertion targets. Images and files travel with the comment, so the request and its evidence remain together.
- **Bring AI changes back as verified versions.** The submitted source is frozen, QoderWork handoff stays clipboard-only, returned HTML must pass fail-closed checks, and pre-submit files remain available.
- **Detect conflicts instead of overwriting them.** Local writes are serialized and atomic; an unexpected external file change pauses writeback and asks you to resolve it.

<p align="center">
  <img src="docs/assets/pageroot-welcome-features.png" width="1040" alt="PageRoot visual HTML editing, precise source patches, comments, attachments, and validation features / 源页功能介绍" />
</p>

### From a local HTML file to a verified version

1. **Open and edit.** Open a real local HTML file. Safe text edits and supported visual adjustments write back automatically through precise source patches.
2. **Comment and hand off.** Mark the exact place that needs a larger change, add context or attachments, then let PageRoot freeze and copy the QoderWork handoff.
3. **Validate and choose.** PageRoot checks the returned full HTML before creating a new immutable version. Your current file is not silently replaced; you explicitly open the latest version.

### Source-first by design

```text
Authored HTML
  → native DOM / Selection / IME intent
  → SourceIndex + TargetResolver
  → minimal SourcePatch
  → hash-checked atomic file write
```

The current HTML bytes are authoritative. Preview DOM is disposable and is never serialized back as the persistence source. PageRoot is not a low-code page builder, and unsafe or ambiguous edits stop instead of guessing.

### Download and requirements

[Download the latest PageRoot DMG](https://github.com/Charleyli925/PageRoot/releases/latest) from GitHub Releases.

- macOS 12 or later
- Apple silicon (`arm64`)
- Current desktop interface: Simplified Chinese
- Current builds use ad-hoc signing and are not Apple-notarized. On first launch, Control-click PageRoot and choose **Open** if macOS blocks it.
- Verify the DMG with the release’s `SHA256SUMS.txt`. Every official release also includes `update-manifest.json` and `build-info.json` for version and source provenance.

<a id="chinese"></a>

## 让真实 HTML 始终掌握控制权的可视化编辑器

源页是一款面向 macOS 的本地优先可视化 HTML 编辑器，也是一种不会把预览 DOM 重新序列化回源码的所见即所得编辑方式。打开真实的本地 `.html` 文件，双击安全可编辑的文字，即可沿用熟悉的光标、选区、粘贴和中文输入法体验。源页会把你的操作精确映射回源码，只修改对应范围。

遇到生成内容、跨区域调整或需要更多判断的修改，可以把评论锚定到整个页面、模块、具体文字或插入位置，并附上参考图片和文件。源页会冻结本轮输入，只把 QoderWork 交接内容复制到剪贴板；AI 返回后还要通过身份、源码 Hash、路径、完整 HTML 和修改范围校验，才能形成由你主动打开的新版本。

它适合修改 AI 生成的落地页、原型、文档页、静态页面和手写 HTML：既获得可视化网页编辑的直观速度，也保留本地 HTML 编辑器应有的源码可信度。

### 为什么选择源页

- **直接在真实页面上修改。** 双击安全文字，光标落在点击位置；自然输入、选择和粘贴，并可调整受支持的文字样式与同级模块顺序。
- **只改你明确选择的范围。** 每次持久化编辑都是源码级局部 Patch，不会用预览 DOM 重建整份文件，也不会顺带改乱无关结构和格式。
- **让评论始终带着上下文。** 评论可以跟随页面、模块、具体文字或插入位置，图片和文件附件与目标、要求、历史版本保持对应。
- **把 AI 结果作为经过校验的新版本带回来。** 提交内容先冻结，QoderWork 仅做剪贴板交接，返回结果必须通过完整校验，提交前文件继续保留。
- **遇到冲突就停止，而不是覆盖。** 本地写回串行且原子；发现文件被其他程序修改时会暂停写入，等待你明确处理。

### 从本地 HTML 到经过校验的新版本

1. **打开并直接修改。** 打开真实本地 HTML；安全文字与受支持的视觉调整会通过精准源码 Patch 自动写回。
2. **评论并交给 AI。** 标出需要较大修改的准确位置，补充说明或附件，由源页冻结本轮内容并复制 QoderWork 交接信息。
3. **校验后由你决定打开。** 源页先核对 AI 返回的完整 HTML，再建立不可变的新版本；不会静默替换当前文件，最新版由你主动打开。

### 源码优先，而不是 DOM 优先

```text
真实 HTML
  → 原生 DOM / Selection / IME 操作意图
  → SourceIndex + TargetResolver 精确定位
  → 最小 SourcePatch
  → Hash 校验后的原子文件写回
```

真实 HTML 字节始终是唯一事实源，预览 DOM 只是可丢弃的投影，永远不会被序列化回源文件。源页不是低代码搭建器；目标不明确或无法安全修改时，系统会停止而不是猜测。

### 下载与运行要求

从 [GitHub Releases](https://github.com/Charleyli925/PageRoot/releases/latest) 下载最新版 PageRoot DMG。

- macOS 12 或更高版本
- Apple 芯片 Mac（`arm64`）
- 当前桌面界面语言：简体中文
- 当前构建使用 ad-hoc 签名，尚未完成 Apple 公证。首次启动如被 macOS 拦截，请按住 Control 点击 PageRoot，然后选择“打开”。
- 可使用 Release 中的 `SHA256SUMS.txt` 校验 DMG；正式 Release 还包含 `update-manifest.json` 与 `build-info.json`，用于核对版本和源码来源。

## Build and contribute / 开发与贡献

PageRoot is an Electron desktop application built with React and TypeScript. The repository includes the renderer, desktop boundary, source-patch engine, validation protocol, fixtures, automated gates, and release provenance tooling.

源页是使用 React、TypeScript 与 Electron 构建的桌面应用。仓库包含渲染界面、桌面权限边界、源码 Patch 引擎、校验协议、固定样本、自动化门禁和发布溯源工具。

### Local development / 本地开发

Requires macOS 12 or later and Node.js `22.13.0` or a compatible Node 22 release.

需要 macOS 12 或更高版本，以及 Node.js `22.13.0` 或兼容的 Node 22 版本。

```bash
git clone https://github.com/Charleyli925/PageRoot.git
cd PageRoot
npm ci
npx playwright install chromium
npm run desktop:dev
```

### Validation / 验证

```bash
npm run task:status        # inspect branch, diff, and worktree
npm run task:start -- fix/short-name
npm run gate:edit          # focused feedback while editing
npm run task:finish        # completed task gate against origin/main
npm run gate:release:auto  # full clean-source release gate
npm run release:mac        # build and verify the arm64 DMG
```

Release and artifact gates accept only committed, clean source trees. See the [development guide](docs/DEVELOPMENT.md), [test strategy](tests/TEST_STRATEGY.md), and [release guide](docs/RELEASING.md).

发布与安装包门禁只接受已经提交且工作区干净的源码。详见[开发指南](docs/DEVELOPMENT.md)、[测试策略](tests/TEST_STRATEGY.md)和[发布指南](docs/RELEASING.md)。

### Repository map / 仓库结构

| Path | Purpose / 用途 |
| --- | --- |
| `app/` | React UI and source-patch editing core / React 界面与源码 Patch 编辑核心 |
| `desktop/` | Electron main process, preload, and desktop runtime / Electron 主进程、预加载与桌面运行时 |
| `scripts/` | Bridge, validators, task gates, and release tools / Bridge、校验器、任务门禁与发布工具 |
| `schemas/` | Current protocol JSON Schemas / 当前协议 JSON Schema |
| `fixtures/` | Stable compatibility and validation samples / 协议兼容与校验固定样本 |
| `tests/` | Node, Browser, Electron, and packaged-runtime tests / Node、Browser、Electron 与安装包测试 |
| `docs/` | Architecture, protocol, security, development, and governance / 架构、协议、安全、开发与治理文档 |

### Source of truth / 唯一真相

The public `main` branch is the canonical source. Task branches are temporary working surfaces; DMGs, `.app` bundles, `release/`, and `output/` are reproducible artifacts, not source.

公开仓库的 `main` 分支是项目源码的唯一真相。任务分支只是临时工作面；DMG、`.app`、`release/` 和 `output/` 都是可重新生成的产物，不是源码。

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and the [public-source boundary](docs/OPEN_SOURCE_BOUNDARY.md). Report security issues privately through [SECURITY.md](SECURITY.md), not through a public Issue.

参与贡献前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)与[公开源码边界](docs/OPEN_SOURCE_BOUNDARY.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要提交公开 Issue。

## License / 许可证

Code is licensed under the [Apache License 2.0](LICENSE). The PageRoot name and visual identity are not granted under the code license; see [TRADEMARKS.md](TRADEMARKS.md). Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

代码以 [Apache License 2.0](LICENSE) 开源。PageRoot 名称和视觉标识不随代码许可证授权，详见 [TRADEMARKS.md](TRADEMARKS.md)。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
