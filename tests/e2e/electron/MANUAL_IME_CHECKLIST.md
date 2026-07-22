# 已退出活动门禁的旧输入法清单

状态：`retired`。

此文件名仅为兼容旧文档链接保留，不再定义测试、发布签署或待办事项。PageRoot 的活动测试全部无人值守，不要求任何人安装、点击、输入、观察录像或判断结果。

composition、Apple 拼音临时 wrapper 轨迹、Selection、取消/迟到事件、磁盘持久化、undo/redo 和候选包运行时现在由 Browser、Electron 与 packaged-runtime 自动门禁执行，机器判断标准见 `tests/TEST_STRATEGY.md` 和 `IME_EVENT_MATRIX.md`。

第三方 macOS 输入法候选窗尚没有稳定的无人值守驱动和机器 oracle，因此只登记为自动化覆盖边界，不设置人工替代门禁，也不把合成事件回放描述成真实 OS 输入法已通过。
