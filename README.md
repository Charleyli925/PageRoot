# YuanYe

YuanYe 是本地 macOS HTML 编辑工作台。

## 下载

当前公开发布版支持 Apple 芯片 Mac（arm64）：

- [下载最新版 YuanYe](https://github.com/Charleyli925/YuanYe/releases/latest)

下载 `YuanYe-<版本号>-arm64.dmg`，打开后把 YuanYe 拖入
“Applications（应用程序）”。

当前安装包尚未完成 Apple Developer ID 公证。首次启动时，请按住
Control 点击 YuanYe，选择“打开”；如仍被阻止，请前往
“系统设置 → 隐私与安全”选择“仍要打开”。

## 更新方式

YuanYe 会检测这个仓库中的最新公开版本。发现新版后，应用会打开 GitHub
发布页，由用户下载 DMG 并手动覆盖安装；当前不会静默下载或自动替换应用。

每个 Release 同时提供：

- `update-manifest.json`：供 YuanYe 检测最新版本。
- `SHA256SUMS.txt`：用于核验安装包完整性。

这个仓库只用于公开提供安装包和发布说明，不包含 YuanYe 应用源码。
