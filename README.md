# 源页（PageRoot）

> Edit visually. Stay in source.

源页是一款本地 macOS HTML 编辑工作台。它让你直接在页面上可视化修改内容，同时始终以真实 HTML 源码作为唯一事实源。

## 下载

当前公开发布版支持 Apple 芯片 Mac（arm64）：

- [下载最新版源页](https://github.com/Charleyli925/PageRoot/releases/latest)

当前已经发布的 `v0.7.4` 安装资产仍使用旧文件名 `YuanYe-<版本号>-arm64.dmg`；后续新构建将统一使用 `PageRoot-<版本号>-<架构>.dmg`，App 英文安装名为 `PageRoot`，界面名称为“源页”。

当前安装包尚未完成 Apple Developer ID 公证。首次启动时，请按住 Control 点击应用，选择“打开”；如仍被阻止，请前往“系统设置 → 隐私与安全”选择“仍要打开”。

## 更新方式

源页会在桌面后端自动检查这个仓库中的最新公开版本。没有新版时界面不显示额外内容；发现新版后，左上角 Logo 右下角会出现 `new!`，点击 Logo 即可打开本仓库。用户下载 DMG 后手动覆盖安装；当前不会静默下载或自动替换应用。

每个 Release 同时提供：

- `update-manifest.json`：供源页检测最新版本。
- `SHA256SUMS.txt`：用于核验安装包完整性。

这个仓库只用于公开提供安装包和发布说明，不包含源页应用源码。
